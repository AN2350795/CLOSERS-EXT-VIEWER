import csv
from contextlib import contextmanager
from functools import wraps
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import threading
import time
import uuid
import zlib

from .cmf import Archive, Cancelled, Entry, FormatError, PARSER_VERSION, UnsupportedFormat, check_cancel, classify
from .groups import group_key, expression
from .issues import issue

CATEGORIES = {'images': '이미지', 'audio': '오디오', 'models': '3D 모델',
              'scripts': '스크립트·설정', 'other': '기타', 'encrypted': '암호화'}


@contextmanager
def operation_lock(workspace):
    """Coordinate CLI and UI processes without holding a long SQLite transaction."""
    with (Path(workspace) / 'operation.lock').open('a+b') as stream:
        stream.seek(0, os.SEEK_END)
        if stream.tell() == 0:
            stream.write(b'0')
            stream.flush()
        stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise ValueError('다른 프로그램에서 이 작업 공간을 분석·추출 중입니다.') from exc
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def exclusive(method):
    @wraps(method)
    def run(self, *args, **kwargs):
        with operation_lock(self.workspace), self.session():
            return method(self, *args, **kwargs)
    return run


class Catalog:
    def __init__(self, workspace):
        self.workspace = Path(workspace).resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.db = self.workspace / 'catalog.sqlite3'
        self.local = threading.local()
        with self.connect() as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version > 4:
                raise ValueError(f'미지원 DB 스키마 버전 {version}')
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS archives(
                    id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, size INTEGER,
                    mtime INTEGER, version INTEGER, status TEXT, error TEXT, scanned REAL);
                CREATE TABLE IF NOT EXISTS entries(
                    id INTEGER PRIMARY KEY, archive_id INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
                    ordinal INTEGER, name TEXT, size INTEGER, stored INTEGER, offset INTEGER, flag INTEGER,
                    category TEXT, detail TEXT, format TEXT, status TEXT DEFAULT 'indexed',
                    output TEXT, sha256 TEXT, error TEXT, UNIQUE(archive_id, ordinal));
                CREATE INDEX IF NOT EXISTS idx_category ON entries(category, detail, id);
                CREATE INDEX IF NOT EXISTS idx_status ON entries(status, id);
                CREATE INDEX IF NOT EXISTS idx_format ON entries(format, id);
                CREATE INDEX IF NOT EXISTS idx_archive_offset ON entries(archive_id, offset, id);
            ''')
        if version < 2:
            with operation_lock(self.workspace), self.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                for table, columns in {
                    'archives': {'parser_version': 'INTEGER', 'error_kind': 'TEXT'},
                    'entries': {'output_size': 'INTEGER', 'output_mtime': 'INTEGER'},
                }.items():
                    existing = {r[1] for r in db.execute(f'PRAGMA table_info({table})')}
                    for name, kind in columns.items():
                        if name not in existing:
                            db.execute(f'ALTER TABLE {table} ADD COLUMN {name} {kind}')
                db.execute('''CREATE TABLE IF NOT EXISTS group_notes(
                              axis TEXT NOT NULL,value TEXT NOT NULL,label TEXT NOT NULL,tags TEXT NOT NULL,
                              PRIMARY KEY(axis,value))''')
                db.execute('PRAGMA user_version=2')
        if version < 3:
            with operation_lock(self.workspace), self.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                existing = {r[1] for r in db.execute('PRAGMA table_info(entries)')}
                if 'error_stage' not in existing:
                    db.execute('ALTER TABLE entries ADD COLUMN error_stage TEXT')
                db.execute('CREATE INDEX IF NOT EXISTS idx_entry_name ON entries(name)')
                db.execute('CREATE INDEX IF NOT EXISTS idx_entry_hash ON entries(sha256) WHERE sha256 IS NOT NULL')
                db.execute('PRAGMA user_version=3')
        if version < 4:
            with operation_lock(self.workspace), self.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                for table, columns in {
                    'archives': {'indexed_size': 'INTEGER', 'indexed_mtime': 'INTEGER'},
                    'entries': {'failure_key': 'TEXT', 'error_first': 'REAL', 'error_last': 'REAL',
                                'error_attempts': 'INTEGER DEFAULT 0'},
                }.items():
                    existing = {r[1] for r in db.execute(f'PRAGMA table_info({table})')}
                    for name, kind in columns.items():
                        if name not in existing:
                            db.execute(f'ALTER TABLE {table} ADD COLUMN {name} {kind}')
                db.execute("UPDATE archives SET indexed_size=size,indexed_mtime=mtime WHERE status='ready'")
                db.execute('''CREATE TABLE IF NOT EXISTS archive_history(
                              id INTEGER PRIMARY KEY,archive_id INTEGER NOT NULL,path TEXT NOT NULL,
                              size INTEGER,mtime INTEGER,version INTEGER,parser_version INTEGER,saved REAL NOT NULL)''')
                db.execute('''CREATE TABLE IF NOT EXISTS entry_history(
                              id INTEGER PRIMARY KEY,revision_id INTEGER NOT NULL REFERENCES archive_history(id),
                              entry_id INTEGER,ordinal INTEGER,name TEXT,record TEXT NOT NULL)''')
                db.execute('CREATE INDEX IF NOT EXISTS idx_history_archive ON archive_history(archive_id,id)')
                db.execute('CREATE INDEX IF NOT EXISTS idx_history_entry ON entry_history(revision_id,ordinal)')
                db.execute('CREATE INDEX IF NOT EXISTS idx_history_original_id ON entry_history(entry_id)')
                db.execute('CREATE TABLE IF NOT EXISTS catalog_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL)')
                db.execute("INSERT OR IGNORE INTO catalog_meta VALUES('revision',0)")
                db.execute('PRAGMA user_version=4')

    @staticmethod
    def changed(db):
        db.execute("UPDATE catalog_meta SET value=value+1 WHERE key='revision'")

    def revision(self):
        with self.connect() as db:
            return db.execute("SELECT value FROM catalog_meta WHERE key='revision'").fetchone()[0]

    @staticmethod
    def failure_identity(path, size, mtime, entry):
        # Source metadata has the same limitation as scan/resume: edits retaining both
        # size and mtime require an explicit retry. No output path is part of this key.
        return hashlib.sha256(json.dumps([str(path), size, mtime, PARSER_VERSION,
                                          entry.index, entry.name, entry.size, entry.stored,
                                          entry.offset, entry.flag], ensure_ascii=False).encode()).hexdigest()

    def open_connection(self):
        db = sqlite3.connect(self.db, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.create_function('resource_group', 4, group_key, deterministic=True)
        from .model_groups import field
        db.create_function('model_field', 2, field, deterministic=True)
        return db

    @contextmanager
    def session(self):
        """One connection per worker, without sharing it with HTTP threads."""
        db = self.open_connection()
        self.local.db = db
        try:
            yield
        finally:
            self.local.db = None
            db.close()

    @contextmanager
    def connect(self):
        shared = getattr(self.local, 'db', None)
        db = shared if shared is not None else self.open_connection()
        try:
            with db:
                yield db
        finally:
            if shared is None:
                db.close()

    def candidates(self, paths, cancel=None):
        seen = set()
        for source in paths:
            source = Path(source).expanduser().resolve()
            if not source.exists():
                raise FileNotFoundError(f'입력 경로가 없습니다: {source}')
            if source.is_dir():
                def fail(error):
                    raise error
                def walk():
                    for root, dirs, files in os.walk(source, followlinks=False, onerror=fail):
                        check_cancel(cancel)
                        dirs[:] = [d for d in dirs if not (Path(root) / d).is_symlink()
                                   and not (hasattr(Path(root) / d, 'is_junction') and (Path(root) / d).is_junction())
                                   and (Path(root) / d).resolve() != self.workspace]
                        for name in files:
                            if name.lower().endswith('.cmf'):
                                yield Path(root) / name
                paths_here = walk()
            else:
                paths_here = (source,)
            for path in paths_here:
                check_cancel(cancel)
                path = path.resolve()
                if path.suffix.lower() == '.cmf' and path not in seen:
                    seen.add(path)
                    yield path

    def scan_one(self, path, cancel=None, retry_errors=False):
        with self.connect() as db:
            old = db.execute('SELECT * FROM archives WHERE path=?', (str(path),)).fetchone()
        stat = None
        try:
            stat = path.stat()
            unchanged = old and (old['size'], old['mtime']) == (stat.st_size, stat.st_mtime_ns)
            if unchanged and old['status'] == 'ready' and old['parser_version'] == PARSER_VERSION and not retry_errors:
                return dict(skipped=1, failed=0, cached_errors=0, entry_errors=0)
            if unchanged and old['status'] == 'index' and old['parser_version'] == PARSER_VERSION:
                return dict(skipped=1,failed=0,cached_errors=0,entry_errors=0,indexes=1)
            if (unchanged and old['status'] == 'error' and old['parser_version'] == PARSER_VERSION
                    and old['error_kind'] != 'io' and not retry_errors):
                return dict(skipped=0, failed=1, cached_errors=1, entry_errors=0)
            with path.open('rb') as probe:
                is_index = probe.read(108)[4:].startswith('COMBINE FILE ver.'.encode('utf-16-le'))
            if is_index:
                from .header_index import index_summary
                index_summary(path,cancel)
                after = path.stat()
                if (after.st_size,after.st_mtime_ns)!=(stat.st_size,stat.st_mtime_ns):
                    raise FormatError('인덱스 분석 중 원본이 변경되었습니다.')
                with self.connect() as db:
                    db.execute('''INSERT INTO archives(path,size,mtime,status,scanned,parser_version,error_kind)
                                  VALUES(?,?,?,'index',?,?,'index') ON CONFLICT(path) DO UPDATE SET
                                  size=excluded.size,mtime=excluded.mtime,status='index',scanned=excluded.scanned,
                                  parser_version=excluded.parser_version,error=NULL,error_kind='index' ''',
                               (str(path),stat.st_size,stat.st_mtime_ns,time.time(),PARSER_VERSION))
                    self.changed(db)
                return dict(skipped=0,failed=0,cached_errors=0,entry_errors=0,indexes=1)
            # Stage a complete archive outside the main DB write transaction.
            # Spills to a temporary file after 1 MiB; cancellation preserves prior rows.
            entry_errors = 0
            with tempfile.SpooledTemporaryFile(max_size=1024*1024, mode='w+t', encoding='utf-8') as staged:
                with Archive(path) as archive:
                    version = archive.version
                    for entry in archive.entries(cancel):
                        check_cancel(cancel)
                        try:
                            prefix = archive.prefix(entry)
                            category, detail, fmt = classify(entry.name, prefix, entry.flag)
                            error = None
                            failure_key = None
                        except Cancelled:
                            raise
                        except Exception as exc:
                            category, detail, fmt = classify(entry.name, b'', entry.flag)
                            error = str(exc)
                            failure_key = (self.failure_identity(path, stat.st_size, stat.st_mtime_ns, entry)
                                           if isinstance(exc, (FormatError, zlib.error, UnicodeError)) else None)
                            entry_errors += 1
                        staged.write(json.dumps((entry.index, entry.name, entry.size, entry.stored,
                                                 entry.offset, entry.flag, category, detail, fmt,
                                                 'encrypted' if entry.flag == 2 else 'indexed', error,
                                                 'decode' if error else None, failure_key)) + '\n')
                after = path.stat()
                if (after.st_size, after.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
                    raise FormatError('목록을 읽는 동안 원본이 변경되었습니다.')
                check_cancel(cancel)
                staged.seek(0)
                with self.connect() as db:
                    db.execute('INSERT INTO archives(path) VALUES(?) ON CONFLICT(path) DO NOTHING', (str(path),))
                    archive_id = db.execute('SELECT id FROM archives WHERE path=?', (str(path),)).fetchone()[0]
                    same_index = old and (old['indexed_size'], old['indexed_mtime']) == (stat.st_size, stat.st_mtime_ns)
                    if same_index:
                        previous = iter(db.execute('SELECT ordinal,name,size,stored,offset,flag FROM entries WHERE archive_id=? ORDER BY ordinal', (archive_id,)))
                        for line in staged:
                            check_cancel(cancel)
                            if tuple(json.loads(line)[:6]) != tuple(next(previous, ())):
                                same_index = False
                                break
                        if next(previous, None) is not None:
                            same_index = False
                        staged.seek(0)
                    if old and not same_index:
                        previous = db.execute('SELECT * FROM entries WHERE archive_id=?', (archive_id,))
                        first = previous.fetchone()
                        if first:
                            revision_id = db.execute('''INSERT INTO archive_history(archive_id,path,size,mtime,version,parser_version,saved)
                                                        VALUES(?,?,?,?,?,?,?)''',
                                                     (archive_id,str(path),old['indexed_size'],old['indexed_mtime'],
                                                      old['version'],old['parser_version'],time.time())).lastrowid
                            def history_rows():
                                yield (revision_id,first['id'],first['ordinal'],first['name'],json.dumps(dict(first)))
                                for row in previous:
                                    check_cancel(cancel)
                                    yield (revision_id,row['id'],row['ordinal'],row['name'],json.dumps(dict(row)))
                            db.executemany('INSERT INTO entry_history(revision_id,entry_id,ordinal,name,record) VALUES(?,?,?,?,?)',history_rows())
                        db.execute('DELETE FROM entries WHERE archive_id=?', (archive_id,))
                    def records():
                        next_id = db.execute('''SELECT COALESCE(MAX(value),0)+1 FROM (
                                                SELECT MAX(id) value FROM entries UNION ALL SELECT MAX(entry_id) FROM entry_history)''').fetchone()[0]
                        for line in staged:
                            check_cancel(cancel)
                            yield (next_id,archive_id, *json.loads(line))
                            next_id += 1
                    db.executemany('''INSERT INTO entries(id,archive_id,ordinal,name,size,stored,offset,flag,
                                   category,detail,format,status,error,error_stage,failure_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                                   ON CONFLICT(archive_id,ordinal) DO UPDATE SET
                                   category=excluded.category,detail=excluded.detail,format=excluded.format,
                                   error=excluded.error,error_stage=excluded.error_stage,failure_key=excluded.failure_key''', records())
                    db.execute("""UPDATE archives SET size=?,mtime=?,version=?,status='ready',error=NULL,
                                  scanned=?,parser_version=?,error_kind=NULL,indexed_size=?,indexed_mtime=? WHERE id=?""",
                               (stat.st_size, stat.st_mtime_ns, version, time.time(), PARSER_VERSION,
                                stat.st_size,stat.st_mtime_ns,archive_id))
                    self.changed(db)
            return dict(skipped=0, failed=0, cached_errors=0, entry_errors=entry_errors)
        except Cancelled:
            raise
        except Exception as exc:
            kind = 'unsupported' if isinstance(exc, UnsupportedFormat) else 'io' if isinstance(exc, OSError) else 'format'
            with self.connect() as db:
                db.execute("""INSERT INTO archives(path,size,mtime,status,error,scanned,parser_version,error_kind)
                              VALUES(?,?,?,'error',?,?,?,?) ON CONFLICT(path) DO UPDATE SET
                              size=excluded.size,mtime=excluded.mtime,status='error',error=excluded.error,
                              scanned=excluded.scanned,parser_version=excluded.parser_version,error_kind=excluded.error_kind""",
                           (str(path), stat.st_size if stat else None, stat.st_mtime_ns if stat else None,
                            str(exc), time.time(), PARSER_VERSION, kind))
                self.changed(db)
                # Keep prior extraction paths/hashes for inspection; extraction checks archive status.
            return dict(skipped=0, failed=1, cached_errors=0, entry_errors=0)

    @exclusive
    def scan(self, paths, cancel=None, progress=lambda **kw: None, retry_errors=False):
        result = dict(archives=0, skipped=0, failed=0, cached_errors=0, entry_errors=0,indexes=0)
        for path in self.candidates(paths, cancel):
            progress(phase='scan', current=str(path), done=result['archives'],archive_failed=result['failed'],entry_failed=0, **{k:v for k,v in result.items() if k != 'archives'})
            check_cancel(cancel)
            one = self.scan_one(path, cancel, retry_errors)
            result['archives'] += 1
            for key, value in one.items():
                result[key] += value
        progress(phase='scan', done=result['archives'],archive_failed=result['failed'],entry_failed=0, current='목록 처리 종료', **result)
        return result

    @staticmethod
    def where(filters):
        clauses, values = ['1=1'], []
        for key in ('character','kind','family','part','variant'):
            if filters.get('model_'+key):
                clauses.append("e.category='models' AND model_field(e.name,?)=?")
                values.extend((key,filters['model_'+key]))
        for key in ('category', 'detail', 'format', 'status'):
            if filters.get(key):
                clauses.append(f'e.{key}=?')
                values.append(filters[key])
        if filters.get('archive_id') is not None:
            clauses.append('e.archive_id=?')
            values.append(int(filters['archive_id']))
        duplicate = filters.get('duplicate')
        if duplicate:
            if duplicate not in ('name', 'content'):
                raise ValueError('중복 기준은 name 또는 content입니다.')
            column = 'name' if duplicate == 'name' else 'sha256'
            clauses.append(f'EXISTS(SELECT 1 FROM entries d WHERE d.{column}=e.{column} AND d.id<>e.id)')
        saved = filters.get('saved')
        if saved:
            if saved not in ('recorded', 'unrecorded'):
                raise ValueError('저장 필터가 올바르지 않습니다.')
            clauses.append('e.output IS NOT NULL' if saved == 'recorded' else 'e.output IS NULL')
        if filters.get('group_axis'):
            expr = expression(filters['group_axis'])
            if filters.get('group_value') is not None:
                clauses.append(expr + '=?')
                values.append(filters['group_value'])
            else:
                clauses.append(expr + ' IS NOT NULL')
            if filters['group_axis'] == 'quest_candidate':
                clauses.append("e.category='audio'")
        if filters.get('q'):
            clauses.append('(e.name LIKE ? ESCAPE \'\\\' OR a.path LIKE ? ESCAPE \'\\\')')
            query = filters['q'].replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            values.extend((f'%{query}%', f'%{query}%'))
        if 'ids' in filters:
            ids = filters['ids']
            if not isinstance(ids, list) or len(ids) > 200:
                raise ValueError('선택 추출은 한 번에 200개까지 가능합니다.')
            clauses.append('e.id IN (' + ','.join('?' for _ in ids) + ')' if ids else '0=1')
            values.extend(int(value) for value in ids)
        return ' AND '.join(clauses), values

    def entries(self, filters):
        where, values = self.where(filters)
        page = max(1, int(filters.get('page', 1)))
        limit = min(200, max(1, int(filters.get('limit', 60))))
        with self.connect() as db:
            total = db.execute(f'SELECT COUNT(*) FROM entries e JOIN archives a ON a.id=e.archive_id WHERE {where}', values).fetchone()[0]
            rows = db.execute(f'''SELECT e.*, a.path AS archive, a.version,a.status archive_status FROM entries e
                                  JOIN archives a ON a.id=e.archive_id WHERE {where} ORDER BY e.id LIMIT ? OFFSET ?''',
                              values + [limit, (page - 1) * limit]).fetchall()
            items = [self.decorate(dict(row), db) for row in rows]
        return dict(total=total, page=page, limit=limit, items=items)

    @staticmethod
    def decorate(row, db):
        from .library import saved_file
        if row.get('category')=='models':
            from .model_groups import classify
            row['model_group']=dict(classify(row['name']))
        row['saved_exists'] = bool(saved_file(row))
        row['same_name_count'] = db.execute('SELECT count(*) FROM entries WHERE name=?', (row['name'],)).fetchone()[0]
        row['same_content_count'] = (db.execute('SELECT count(*) FROM entries WHERE sha256=?', (row['sha256'],)).fetchone()[0]
                                     if row.get('sha256') else 0)
        row['issue'] = issue(row.get('error'), row.get('error_stage'))
        return row

    def groups(self, filters):
        axis = filters.get('group_axis', 'prefix')
        expr = expression(axis)
        selection = dict(filters, group_axis=axis)
        selection.pop('group_value', None)
        where, values = self.where(selection)
        page = max(1, int(filters.get('page', 1)))
        limit = min(100, max(1, int(filters.get('limit', 30))))
        minimum = min(10000, max(1, int(filters.get('minimum', 1))))
        grouped = f'''SELECT {expr} value,COUNT(*) count,SUM(e.size) bytes,MIN(e.id) representative
                      FROM entries e JOIN archives a ON a.id=e.archive_id WHERE {where}
                      GROUP BY {expr} HAVING COUNT(*)>=?'''
        with self.connect() as db:
            total = db.execute('SELECT COUNT(*) FROM (' + grouped + ')', values + [minimum]).fetchone()[0]
            rows = db.execute(f'''WITH grouped AS ({grouped})
                                  SELECT g.*,n.label,n.tags FROM grouped g LEFT JOIN group_notes n ON n.axis=? AND n.value=g.value
                                  ORDER BY g.count DESC,g.value LIMIT ? OFFSET ?''',
                              values + [minimum, axis, limit, (page-1)*limit]).fetchall()
        return dict(axis=axis,total=total,page=page,limit=limit,items=[dict(r) for r in rows],
                    evidence='파일명 코드 후보; 퀘스트명·화자·대사·순서·분기 미확정' if axis=='quest_candidate' else '파일명·경로 기반 가상 그룹')

    @exclusive
    def save_group(self, axis, value, label, tags=''):
        expression(axis)
        if not all(isinstance(v, str) for v in (value, label, tags)) or len(value)>4096 or len(label)>200 or len(tags)>1000:
            raise ValueError('그룹 이름 또는 태그가 너무 길거나 형식이 잘못되었습니다.')
        with self.connect() as db:
            db.execute('''INSERT INTO group_notes(axis,value,label,tags) VALUES(?,?,?,?)
                          ON CONFLICT(axis,value) DO UPDATE SET label=excluded.label,tags=excluded.tags''',
                       (axis,value,label,tags))

    def stats(self):
        with self.connect() as db:
            groups = [dict(r) for r in db.execute('SELECT category,detail,COUNT(*) AS count,SUM(size) AS bytes FROM entries GROUP BY category,detail')]
            statuses = {r[0]: r[1] for r in db.execute('SELECT status,COUNT(*) FROM entries GROUP BY status')}
            archives = dict(db.execute('SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM archives').fetchone())
            errors = [dict(r) for r in db.execute("SELECT path,error FROM archives WHERE status='error' ORDER BY id LIMIT 100")]
            error_count = db.execute("SELECT COUNT(*) FROM archives WHERE status='error'").fetchone()[0]
            formats = [r[0] for r in db.execute('SELECT DISTINCT format FROM entries ORDER BY format')]
            entry_error_count = db.execute('SELECT COUNT(*) FROM entries WHERE error IS NOT NULL').fetchone()[0]
            error_groups = [dict(r) for r in db.execute("SELECT COALESCE(error_kind,'legacy') kind,error,COUNT(*) count FROM archives WHERE status='error' GROUP BY error_kind,error ORDER BY count DESC LIMIT 100")]
            index_count = db.execute("SELECT count(*) FROM archives WHERE status='index'").fetchone()[0]
            issue_entry_count = db.execute("SELECT count(*) FROM entries WHERE error IS NOT NULL OR status IN ('error','encrypted')").fetchone()[0]
            entry_issues = []
            for r in db.execute('SELECT error,error_stage,count(*) count FROM entries WHERE error IS NOT NULL GROUP BY error,error_stage'):
                entry_issues.append(dict(issue(r['error'], r['error_stage']), count=r['count']))
        return dict(groups=groups, statuses=statuses, archives=archives, errors=errors, error_count=error_count,
                    entry_error_count=entry_error_count, error_groups=error_groups, formats=formats,
                    index_count=index_count,issue_entry_count=issue_entry_count,entry_issues=entry_issues)

    def get(self, entry_id):
        with self.connect() as db:
            row = db.execute('''SELECT e.*,a.path AS archive,a.size AS archive_size,a.mtime AS archive_mtime,a.version,a.status AS archive_status
                                FROM entries e JOIN archives a ON a.id=e.archive_id WHERE e.id=?''', (entry_id,)).fetchone()
        if row is None:
            raise ValueError('항목이 없습니다.')
        with self.connect() as db:
            result = self.decorate(dict(row), db)
            result['history_count'] = db.execute('SELECT count(*) FROM archive_history WHERE archive_id=?',(row['archive_id'],)).fetchone()[0]
            return result

    @staticmethod
    def entry(row):
        return Entry(row['ordinal'], row['name'], row['size'], row['stored'], row['offset'], row['flag'])

    @staticmethod
    def verify_source(row):
        if 'archive_status' in row.keys() and row['archive_status'] != 'ready':
            raise FormatError('이 아카이브의 분석이 실패했습니다. 원본을 다시 분석해 주세요.')
        stat = Path(row['archive']).stat()
        if stat.st_size != row['archive_size'] or stat.st_mtime_ns != row['archive_mtime']:
            raise FormatError('원본이 변경되었습니다. 폴더를 다시 분석해 주세요.')

    @exclusive
    def extract(self, output, filters=None, raw=False, cancel=None, progress=lambda **kw: None,
                verify='sha256', batch_size=100, retry_errors=False):
        return self.extract_impl(output, filters, raw, cancel, progress, verify, batch_size, retry_errors)

    @exclusive
    def process(self, paths, output, filters=None, raw=False, cancel=None, progress=lambda **kw: None,
                verify='sha256', retry_errors=False, workers=1):
        if workers not in (1,2,4):
            raise ValueError('동시 처리 수는 1, 2, 4 중에서 선택해 주세요.')
        if workers > 1:
            from .parallel import process_parallel
            return process_parallel(self,paths,output,filters,raw,cancel,progress,verify,retry_errors,workers)
        return self._process_serial(paths,output,filters,raw,cancel,progress,verify,retry_errors)

    def _process_serial(self, paths, output, filters=None, raw=False, cancel=None, progress=lambda **kw: None,
                        verify='sha256', retry_errors=False):
        """Commit each archive's catalog, then extract it before discovering the next."""
        totals = dict(archives=0, scanned=0, scan_skipped=0, archive_failed=0, entry_errors=0,indexes=0,entry_failed=0,
                      done=0, failed=0, skipped=0, encrypted=0, recovered=0, bytes=0,outside_scope=0,cached_failures=0)
        for path in self.candidates(paths, cancel):
            progress(phase='process', discovering=True, total=None, current=str(path), **totals)
            check_cancel(cancel)
            result = self.scan_one(path, cancel, retry_errors)
            totals['archives'] += 1
            totals['scan_skipped'] += result['skipped']
            totals['archive_failed'] += result['failed']
            totals['failed'] += result['failed']
            totals['entry_errors'] += result['entry_errors']
            totals['indexes'] += result.get('indexes',0)
            if result['failed'] or result.get('indexes'):
                continue
            totals['scanned'] += 1 - result['skipped']
            with self.connect() as db:
                archive_id = db.execute('SELECT id FROM archives WHERE path=?', (str(path),)).fetchone()[0]
            selection = dict(filters or {}, archive_id=archive_id)
            current_state = {}
            def report(**state):
                current_state.update(state)
                state = current_state
                progress(phase='process', discovering=True, total=None, current=state.get('current', str(path)),
                         done=totals['done'] + state.get('done', 0), failed=totals['failed'] + state.get('failed', 0),
                         skipped=totals['skipped'] + state.get('skipped', 0), written=totals['bytes'] + state.get('written', 0),
                         archives=totals['archives'],archive_failed=totals['archive_failed'],
                         entry_failed=totals['entry_failed']+state.get('failed',0),indexes=totals['indexes'],
                         encrypted=totals['encrypted']+state.get('encrypted',0),
                         cached_failures=totals['cached_failures']+state.get('cached_failures',0))
            extracted = self.extract_impl(output, selection, raw, cancel, report, verify, retry_errors=retry_errors)
            for key in ('done', 'failed', 'skipped', 'encrypted', 'recovered', 'bytes','outside_scope','cached_failures'):
                totals[key] += extracted[key]
            totals['entry_failed'] += extracted['failed']
        progress(phase='process', discovering=False, total=totals['done'], current='통합 처리 종료', **totals)
        return totals

    def flush_results(self, pending):
        if not pending:
            return
        with self.connect() as db:
            for record in pending:
                if record['error'] is not None:
                    now = time.time()
                    db.execute("""UPDATE entries SET status='error',error=?,error_stage=?,failure_key=?,
                                  error_first=COALESCE(error_first,?),error_last=?,error_attempts=error_attempts+?
                                  WHERE id=?""", (record['error'],record.get('stage'),record.get('failure_key'),
                                                 now,now,0 if record.get('cached') else 1,record['id']))
                else:
                    db.execute("""UPDATE entries SET status=?,output=?,sha256=?,output_size=?,output_mtime=?,
                                  error=NULL,error_stage=NULL,failure_key=NULL WHERE id=?""",
                               (record['status'], record['output'], record['sha256'], record['size'], record['mtime'], record['id']))
            self.changed(db)
        pending.clear()

    def extract_impl(self, output, filters=None, raw=False, cancel=None, progress=lambda **kw: None,
                     verify='sha256', batch_size=100, retry_errors=False):
        if verify not in ('sha256', 'fast'):
            raise ValueError('검증 정책은 sha256 또는 fast입니다.')
        if not 1 <= batch_size <= 500:
            raise ValueError('저장 배치는 1~500개입니다.')
        output = Path(output).expanduser().resolve()
        output.mkdir(parents=True, exist_ok=True)
        where, values = self.where(filters or {})
        with self.connect() as db:
            total = db.execute(f'SELECT COUNT(*) FROM entries e JOIN archives a ON a.id=e.archive_id WHERE {where}', values).fetchone()[0]
            available = db.execute('SELECT count(*) FROM entries' + (' WHERE archive_id=?' if (filters or {}).get('archive_id') is not None else ''),
                                   [filters['archive_id']] if (filters or {}).get('archive_id') is not None else []).fetchone()[0]
            outside_scope = available-total
        done = failed = skipped = written = encrypted = recovered = cached_failures = 0
        cursor = (-1, -1, -1)
        pending = []
        archive = None
        archive_path = None
        flushed = time.monotonic()
        try:
            while True:
                check_cancel(cancel)
                with self.connect() as db:
                    rows = db.execute(f"""SELECT e.*,a.path AS archive,a.size AS archive_size,a.mtime AS archive_mtime,
                                          a.status AS archive_status FROM entries e JOIN archives a ON a.id=e.archive_id
                                          WHERE {where} AND (e.archive_id,e.offset,e.id)>(?,?,?)
                                          ORDER BY e.archive_id,e.offset,e.id LIMIT 100""", values + list(cursor)).fetchall()
                if not rows:
                    break
                for row in rows:
                    check_cancel(cancel)
                    cursor = (row['archive_id'], row['offset'], row['id'])
                    progress(phase='extract', total=total, done=done, failed=failed,entry_failed=failed,archive_failed=0, skipped=skipped,
                             written=written, encrypted=encrypted, recovered=recovered,cached_failures=cached_failures, current=row['name'])
                    if row['flag'] == 2 and not raw:
                        done += 1
                        encrypted += 1
                        continue
                    temp = None
                    stage = 'source'
                    try:
                        self.verify_source(row)
                        if (not retry_errors and row['failure_key'] and row['error'] and
                                row['failure_key'] == self.failure_identity(row['archive'],row['archive_size'],row['archive_mtime'],self.entry(row))):
                            cached_failures += 1
                            failed += 1
                            done += 1
                            if row['status'] != 'error':
                                pending.append(dict(id=row['id'],error=row['error'],stage='decode',failure_key=row['failure_key'],cached=True))
                            continue
                        stage = 'path'
                        relative = self.output_relative(row)
                        target = safe_target(output, relative)
                        # Use the recorded conflict path too, so edited originals do not
                        # produce another duplicate on each subsequent run.
                        recorded = Path(row['output']) if row['output'] else None
                        if (recorded and recorded.parent == target.parent
                                and (recorded.name == target.name or
                                     (recorded.stem.startswith(relative.stem + '__') and recorded.suffix == target.suffix))):
                            candidate = safe_target(output, recorded.relative_to(output))
                        else:
                            candidate = target
                        if candidate.is_file() and row['output'] == str(candidate) and row['sha256']:
                            stage = 'verify'
                            meta = candidate.stat()
                            metadata_matches = (row['output_size'], row['output_mtime']) == (meta.st_size, meta.st_mtime_ns)
                            valid = metadata_matches if verify == 'fast' and metadata_matches else file_hash(candidate, cancel) == row['sha256']
                            after = candidate.stat()
                            if valid and (meta.st_size, meta.st_mtime_ns) == (after.st_size, after.st_mtime_ns):
                                self.verify_source(row)
                                skipped += 1
                                done += 1
                                if not metadata_matches or row['status'] != ('raw' if row['flag']==2 else 'extracted') or row['error']:
                                    pending.append(dict(id=row['id'], status='raw' if row['flag']==2 else 'extracted',
                                                        output=str(candidate), sha256=row['sha256'], size=after.st_size,
                                                        mtime=after.st_mtime_ns, error=None))
                                continue
                        stage = 'write'
                        target.parent.mkdir(parents=True, exist_ok=True)
                        safe_target(output, target.relative_to(output))
                        temp = target.with_name(target.name + '.' + uuid.uuid4().hex + '.partial')
                        digest = hashlib.sha256()
                        if archive_path != row['archive']:
                            stage = 'archive'
                            if archive is not None:
                                archive.__exit__()
                                archive = None
                            archive_path = None
                            archive = Archive(row['archive'])
                            archive_path = row['archive']
                        opened = os.fstat(archive.file.fileno())
                        if (opened.st_size, opened.st_mtime_ns) != (row['archive_size'], row['archive_mtime']):
                            raise FormatError('열린 원본 파일이 분석 기록과 다릅니다. 다시 분석해 주세요.')
                        stage = 'write'
                        with temp.open('xb') as dest:
                            stage = 'decode'
                            for block in archive.chunks(self.entry(row), cancel):
                                stage = 'write'
                                dest.write(block)
                                digest.update(block)
                                written += len(block)
                                progress(written=written)
                                stage = 'decode'
                        stage = 'source'
                        self.verify_source(row)
                        check_cancel(cancel)
                        stage = 'write'
                        target, reused = publish_output(temp, target, digest.hexdigest(), output, cancel)
                        temp = None
                        recovered += int(reused)
                        meta = target.stat()
                        pending.append(dict(id=row['id'], status='raw' if row['flag']==2 else 'extracted',
                                            output=str(target), sha256=digest.hexdigest(), size=meta.st_size,
                                            mtime=meta.st_mtime_ns, error=None))
                    except Cancelled:
                        raise
                    except Exception as exc:
                        failed += 1
                        deterministic = stage == 'decode' and isinstance(exc, (FormatError,zlib.error,UnicodeError))
                        pending.append(dict(id=row['id'], error=str(exc),stage=stage,
                                            failure_key=(self.failure_identity(row['archive'],row['archive_size'],row['archive_mtime'],self.entry(row))
                                                         if deterministic else None)))
                    finally:
                        if temp is not None:
                            temp.unlink(missing_ok=True)
                        if len(pending) >= batch_size or time.monotonic() - flushed >= 0.5:
                            self.flush_results(pending)
                            flushed = time.monotonic()
                    done += 1
        finally:
            if archive is not None:
                archive.__exit__()
            self.flush_results(pending)
            progress(done=done,failed=failed,entry_failed=failed,skipped=skipped,encrypted=encrypted,written=written,cached_failures=cached_failures)
        progress(phase='extract', done=done, total=total, failed=failed,entry_failed=failed,archive_failed=0, skipped=skipped, written=written,
                 encrypted=encrypted, recovered=recovered,cached_failures=cached_failures, current='추출 처리 종료')
        return dict(total=total, done=done, failed=failed, skipped=skipped, encrypted=encrypted,
                    recovered=recovered, bytes=written,outside_scope=outside_scope,cached_failures=cached_failures)

    @exclusive
    def preserve(self,destination,filters=None,cancel=None,progress=lambda **kw: None):
        from .preservation import catalog_rows,preserve_rows
        if Path(destination).resolve()==self.workspace:
            raise ValueError('운영 작업 공간과 다른 원시 보존 폴더를 지정해 주세요.')
        return preserve_rows(catalog_rows(self,filters or {},cancel),destination,cancel,progress)

    @staticmethod
    def output_relative(row):
        original = row['name'].replace('\\', '/')
        parts = original.split('/')
        if original.startswith('/') or any(part in ('..', '') or ':' in part for part in parts):
            raise ValueError('안전하지 않은 내부 파일 경로입니다.')
        parts = [safe_name(part) for part in parts if part != '.']
        if not parts:
            raise ValueError('파일명이 없습니다.')
        filename = Path(parts[-1])
        ext = '.encrypted.bin' if row['flag'] == 2 else '.' + safe_name(row['format'])
        parts[-1] = safe_name(filename.stem)[:100] + f"__{row['ordinal']:06d}" + ext
        archive_key = hashlib.sha256(str(row['archive']).encode('utf-8')).hexdigest()[:16]
        folder = safe_name(Path(row['archive']).stem)[:60] + '_' + archive_key
        return Path(row['category']) / safe_name(row['detail']) / folder / Path(*parts)

    def export_manifest(self, destination):
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp = destination.with_name(destination.name + '.' + uuid.uuid4().hex + '.partial')
        try:
            with self.connect() as db, temp.open('w', encoding='utf-8-sig', newline='') as stream:
                writer = csv.writer(stream)
                writer.writerow(['id','archive','version','original_name','category','detail','actual_format','size','stored','flag','status','output','sha256','error'])
                for row in db.execute('''SELECT e.id,a.path,a.version,e.name,e.category,e.detail,e.format,e.size,e.stored,e.flag,
                                         e.status,e.output,e.sha256,e.error FROM entries e JOIN archives a ON a.id=e.archive_id ORDER BY e.id'''):
                    # Keep spreadsheet applications from interpreting archive names as formulas.
                    writer.writerow(["'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@', '\t', '\r')) else v for v in row])
            temp.replace(destination)
        finally:
            temp.unlink(missing_ok=True)


def publish_output(temp, target, digest, root, cancel=None):
    """Content-based conflict names recover files published before a DB commit.

    Never replace existing bytes. A matching orphan is adopted only after both
    the current source stream and existing output have been hashed completely.
    """
    original = target
    number = 0
    while True:
        check_cancel(cancel)
        safe_target(root, target.relative_to(root))
        if target.exists():
            before = target.stat()
            if target.is_file() and file_hash(target, cancel) == digest:
                after = target.stat()
                if (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns):
                    temp.unlink()
                    return target, True
            suffix = '__' + digest[:16] + (f'_{number}' if number else '')
            target = original.with_name(original.stem + suffix + original.suffix)
            number += 1
            continue
        try:
            if os.name == 'nt':
                temp.rename(target)
            else:
                os.link(temp, target)
                temp.unlink()
            return target, False
        except FileExistsError:
            continue


def safe_name(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).rstrip(' .')[:120] or '_'
    if name.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}:
        name = '_' + name
    return name


def safe_target(root, relative):
    target = root / relative
    if not target.resolve().is_relative_to(root):
        raise ValueError('출력 폴더 밖으로 나가는 경로입니다.')
    current = target
    while current != root:
        if current.is_symlink() or (hasattr(current, 'is_junction') and current.is_junction()):
            raise ValueError('출력 경로에 심볼릭 링크 또는 정션이 있습니다.')
        current = current.parent
    return target


def file_hash(path, cancel=None):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while block := stream.read(128 * 1024):
            check_cancel(cancel)
            digest.update(block)
    return digest.hexdigest()
