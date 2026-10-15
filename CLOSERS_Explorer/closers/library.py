"""Saved-file access and read-only links to independent preservation catalogs."""
import json
import os
from contextlib import closing
from pathlib import Path
import sqlite3
import threading
import uuid


def saved_file(row):
    value = row.get('output')
    if not value:
        return None
    path = Path(value)
    try:
        return path if path.is_file() and not path.name.endswith('.partial') else None
    except OSError:
        return None


class PreservationLinks:
    def __init__(self, workspace):
        self.workspace = Path(workspace)
        self.registry = self.workspace / 'preservation-sources.json'
        self.lock = threading.Lock()
        self.sources = set()
        if self.registry.is_file():
            try:
                values = json.loads(self.registry.read_text(encoding='utf-8'))
                if isinstance(values, list):
                    self.sources.update(Path(value).resolve() for value in values if isinstance(value,str))
            except (OSError, ValueError):
                pass
        candidates = [self.workspace / 'stored-preservation' / 'preservation.sqlite3']
        candidates.extend((self.workspace.parent / 'preserved').glob('*/*/preservation.sqlite3'))
        for path in candidates:
            if path.is_file():
                self.sources.add(path.resolve())

    @staticmethod
    def connection(path):
        db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=2)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        return db

    def register(self, folder):
        path = (Path(folder).expanduser().resolve() / 'preservation.sqlite3')
        if not path.is_file():
            raise ValueError('보존 DB가 없습니다. preservation.sqlite3가 있는 폴더를 지정하세요.')
        with closing(self.connection(path)) as db:
            from .preservation import APPLICATION_ID
            if db.execute('PRAGMA application_id').fetchone()[0] != APPLICATION_ID:
                raise ValueError('저장 바이트 보존용 DB가 아닙니다.')
            db.execute('SELECT archive,ordinal,name,source_size,source_mtime,offset,stored_size,output FROM files LIMIT 0')
        with self.lock:
            sources = self.sources | {path}
            temp = self.registry.with_name(self.registry.name + '.' + uuid.uuid4().hex + '.partial')
            try:
                temp.write_text(json.dumps(sorted(map(str, sources)), ensure_ascii=False, indent=2), encoding='utf-8')
                os.replace(temp, self.registry)
            finally:
                temp.unlink(missing_ok=True)
            self.sources = sources
        return str(path.parent)

    def matches(self, row):
        with self.lock:
            sources = list(self.sources)
        matches = []
        for source in sorted(sources):
            try:
                db = self.connection(source)
                try:
                    result = db.execute('SELECT * FROM files WHERE archive=? AND ordinal=?',
                                        (row['archive'], row['ordinal'])).fetchone()
                finally:
                    db.close()
                if result is None:
                    continue
                item = dict(result)
                current = (item['name'], item['source_size'], item['source_mtime'], item['offset'], item['stored_size'],item['unpacked_size'],item['flag']) == (
                    row['name'], row['archive_size'], row['archive_mtime'], row['offset'], row['stored'],row['size'],row['flag'])
                item.update(current=current, exists=bool(saved_file(item)), catalog=str(source))
                matches.append(item)
            except (OSError, sqlite3.Error):
                # A missing/offline registered disk must not break the resource inspector.
                continue
        return matches
