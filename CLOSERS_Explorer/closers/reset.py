"""Confirmed removal of generated files, never of source archives or whole user folders."""
from contextlib import ExitStack, closing, contextmanager
import hashlib
import json
import os
from pathlib import Path
import secrets
import threading
import time

from .catalog import operation_lock
from .library import PreservationLinks
from .preservation import APPLICATION_ID


class RequestGate:
    """Allow concurrent HTTP readers; wait for open downloads before maintenance."""
    def __init__(self):
        self.condition = threading.Condition()
        self.readers = 0
        self.writing = False

    @contextmanager
    def read(self):
        with self.condition:
            if self.writing:
                raise ValueError('전체 초기화 중입니다. 완료 후 다시 시도해 주세요.')
            self.readers += 1
        try:
            yield
        finally:
            with self.condition:
                self.readers -= 1
                self.condition.notify_all()

    @contextmanager
    def write(self):
        with self.condition:
            if self.writing:
                raise ValueError('이미 전체 초기화 중입니다.')
            self.writing = True
            while self.readers:
                self.condition.wait()
        try:
            yield
        finally:
            with self.condition:
                self.writing = False
                self.condition.notify_all()


class Reset:
    def __init__(self, catalog, preservations):
        self.catalog = catalog
        self.preservations = preservations
        self.pending = None

    @staticmethod
    def checked(value):
        """Reject links/junctions in every path component before resolving a target."""
        path = Path(os.path.abspath(value))
        for part in (path, *path.parents):
            if part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction()):
                raise ValueError(f'링크 또는 연결된 폴더는 초기화할 수 없습니다: {part}')
        if path.resolve() != path:
            raise ValueError(f'실제 경로가 달라 초기화할 수 없습니다: {path}')
        return path

    @contextmanager
    def locks(self):
        # Also exclude another CLI preserving bytes in a connected destination.
        with ExitStack() as stack:
            stack.enter_context(operation_lock(self.catalog.workspace))
            for folder in sorted({p.parent for p in self.preservations.sources}):
                self.checked(folder)
                if folder.is_dir() and folder != self.catalog.workspace:
                    stack.enter_context(operation_lock(folder))
            yield

    def plan(self, delete_preserved):
        workspace = self.checked(self.catalog.workspace)
        originals, outputs = set(), set()
        with self.catalog.connect() as db:
            originals.update(Path(r[0]).resolve() for r in db.execute('SELECT path FROM archives'))
            originals.update(Path(r[0]).resolve() for r in db.execute('SELECT path FROM archive_history'))
            outputs.update(r[0] for r in db.execute('SELECT output FROM entries WHERE output IS NOT NULL'))
            for row in db.execute('SELECT record FROM entry_history'):
                value = json.loads(row[0]).get('output')
                if value:
                    outputs.add(value)
            entries = db.execute('SELECT count(*) FROM entries').fetchone()[0]
            archives = db.execute('SELECT count(*) FROM archives').fetchone()[0]
            revision = db.execute("SELECT value FROM catalog_meta WHERE key='revision'").fetchone()[0]
            notes = [tuple(r) for r in db.execute('SELECT * FROM group_notes ORDER BY axis,value')]
        preserved, preservation_files = set(), set()
        for source in sorted(self.preservations.sources):
            source = self.checked(source)
            if not source.is_file():
                continue
            with closing(PreservationLinks.connection(source)) as db:
                if db.execute('PRAGMA application_id').fetchone()[0] != APPLICATION_ID:
                    raise ValueError(f'보존 DB를 확인할 수 없습니다: {source}')
                for row in db.execute('SELECT archive,output FROM files'):
                    originals.add(Path(row[0]).resolve())
                    if row[1]:
                        output = self.checked(row[1])
                        if not output.is_relative_to(source.parent):
                            raise ValueError(f'보존 폴더 밖의 파일 기록입니다: {output}')
                        preserved.add(output)
            preservation_files.update(source.parent / name for name in (
                'preservation.sqlite3', 'preservation.sqlite3-wal', 'preservation.sqlite3-shm',
                'preservation-summary.json', 'manifest.jsonl'))
        protected = originals | {self.catalog.db, workspace / 'operation.lock'}
        if not delete_preserved:
            protected |= preserved | preservation_files | {self.preservations.registry}
        preserved_roots = {p.parent / 'stored' for p in self.preservations.sources}
        files, kept = {}, set()

        def add(value):
            path = self.checked(value)
            if (path in protected or path.suffix.lower() == '.cmf'
                    or (not delete_preserved and any(path.is_relative_to(root) for root in preserved_roots))):
                if path.exists():
                    kept.add(str(path))
                return
            if path.is_file():
                meta = path.stat()
                files[str(path)] = (meta.st_size, meta.st_mtime_ns, meta.st_dev, meta.st_ino)

        # Enumerate files only. Never recursively remove directories that might contain sources.
        roots = {workspace / name for name in ('assets', 'preview-cache', 'composition-cache')}
        if delete_preserved:
            roots |= preserved_roots
        for root in sorted(roots):
            root = self.checked(root)
            if root.is_dir():
                for directory, folders, names in os.walk(root, followlinks=False):
                    self.checked(directory)
                    for folder in folders:
                        self.checked(Path(directory) / folder)
                    for name in names:
                        add(Path(directory) / name)
        for output in outputs:
            add(output)
        for name in ('catalog.csv', 'summary.json', 'update-comparison.json',
                     'catalog.csv.revision.json', 'summary.json.revision.json'):
            add(workspace / name)
        if delete_preserved:
            for path in preserved | preservation_files | {self.preservations.registry}:
                add(path)
        # File metadata and catalog revision detect changed results between review and execution.
        fingerprint = hashlib.sha256(json.dumps(
            [revision, archives, entries, notes, delete_preserved,
             sorted((path, (meta[0], 0, meta[2], meta[3]) if path.endswith('.sqlite3-shm') else meta)
                    for path, meta in files.items()),
             sorted(map(str, self.preservations.sources))], ensure_ascii=False).encode()).hexdigest()
        return dict(files=files, fingerprint=fingerprint, delete_preserved=delete_preserved,
                    archives=archives, entries=entries, kept=len(kept),
                    folders=sorted({str(Path(p).parent) for p in files}),
                    count=len(files), bytes=sum(meta[0] for meta in files.values()), workspace=str(workspace))

    def preview(self, delete_preserved=False):
        if not isinstance(delete_preserved, bool):
            raise ValueError('보존 데이터 삭제 옵션이 올바르지 않습니다.')
        with self.locks():
            plan = self.plan(delete_preserved)
        plan['id'] = secrets.token_urlsafe(24)
        plan['expires'] = time.monotonic() + 600
        self.pending = plan
        return {key: value for key, value in plan.items() if key not in ('files', 'fingerprint', 'expires')}

    def execute(self, plan_id, confirmation, progress=lambda **kw: None):
        plan = self.pending
        if (confirmation != '전체 초기화' or not plan or plan_id != plan['id']
                or time.monotonic() > plan['expires']):
            raise ValueError('삭제 범위를 다시 확인하고 전체 초기화를 입력해 주세요.')
        with self.locks():
            current = self.plan(plan['delete_preserved'])
            if current['fingerprint'] != plan['fingerprint']:
                raise ValueError('확인 후 데이터가 변경되었습니다. 삭제 범위를 다시 확인해 주세요.')
            self.pending = None
            # Keep the catalog records if a filesystem deletion fails, so a retry can find leftovers.
            def deletion_order(item):
                path = Path(item[0])
                return (2 if path == self.preservations.registry else
                        1 if path.name == 'preservation.sqlite3' else 0, str(path))
            for done, (value, expected) in enumerate(sorted(plan['files'].items(), key=deletion_order), 1):
                path = self.checked(value)
                meta = path.stat()
                actual = (meta.st_size, meta.st_mtime_ns, meta.st_dev, meta.st_ino)
                if path.name.endswith('.sqlite3-shm'):
                    actual = (actual[0], expected[1], actual[2], actual[3])
                if actual != expected:
                    raise ValueError(f'파일이 변경되어 초기화를 중단했습니다: {path}')
                path.unlink()
                if done % 100 == 0:
                    progress(done=done, total=plan['count'], current=f'생성 파일 삭제 중 · {done}/{plan["count"]}')
            with self.catalog.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                for table in ('entry_history', 'archive_history', 'entries', 'archives', 'group_notes'):
                    db.execute(f'DELETE FROM {table}')
                self.catalog.changed(db)
            with self.catalog.connect() as db:
                db.execute('VACUUM')
            if plan['delete_preserved']:
                self.preservations.sources.clear()
            return dict(deleted=plan['count'], bytes=plan['bytes'], preserved_deleted=plan['delete_preserved'])
