"""Stored-span export into an independent resumable manifest, never plaintext."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid

from .catalog import Catalog, file_hash, operation_lock, publish_output, safe_target
from .cmf import Archive, Cancelled, FormatError, check_cancel

APPLICATION_ID = 0x43505253  # CPRS, separate from the operational catalog.


def archive_rows(paths, cancel=None):
    for path in paths:
        path = Path(path).resolve()
        with Archive(path) as archive:
            stat = os.fstat(archive.file.fileno())
            for entry in archive.entries(cancel):
                yield dict(archive=str(path),archive_size=stat.st_size,archive_mtime=stat.st_mtime_ns,
                           ordinal=entry.index,name=entry.name,size=entry.size,stored=entry.stored,
                           offset=entry.offset,flag=entry.flag)


def catalog_rows(catalog, filters, cancel=None):
    where, values = catalog.where(filters)
    cursor = (-1,-1,-1)
    while True:
        check_cancel(cancel)
        with catalog.connect() as db:
            rows = db.execute(f'''SELECT e.*,a.path archive,a.size archive_size,a.mtime archive_mtime,
                                 a.status archive_status FROM entries e JOIN archives a ON a.id=e.archive_id
                                 WHERE {where} AND (e.archive_id,e.offset,e.id)>(?,?,?)
                                 ORDER BY e.archive_id,e.offset,e.id LIMIT 100''',values+list(cursor)).fetchall()
        if not rows:
            return
        for row in rows:
            cursor = (row['archive_id'],row['offset'],row['id'])
            yield dict(row)


def preserve_rows(rows, destination, cancel=None, progress=lambda **kw: None):
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with operation_lock(destination):
        return _preserve(rows,destination,cancel,progress)


def _preserve(rows, destination, cancel, progress):
    started = time.monotonic()
    path = destination/'preservation.sqlite3'
    existed = path.exists()
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    archive = None
    pending = []
    result = dict(done=0,preserved=0,skipped=0,recovered=0,failed=0,stored_bytes=0,
                  restored_plaintext=0,destination=str(destination))
    def flush():
        if pending:
            with db:
                db.executemany('''INSERT INTO files(archive,ordinal,name,source_size,source_mtime,offset,
                                 stored_size,unpacked_size,flag,output,sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                                 ON CONFLICT(archive,ordinal) DO UPDATE SET name=excluded.name,
                                 source_size=excluded.source_size,source_mtime=excluded.source_mtime,offset=excluded.offset,
                                 stored_size=excluded.stored_size,unpacked_size=excluded.unpacked_size,flag=excluded.flag,
                                 output=excluded.output,sha256=excluded.sha256''',pending)
                db.executemany('DELETE FROM failures WHERE archive=? AND ordinal=?',
                               ((r[0],r[1]) for r in pending))
            pending.clear()
    try:
        app_id = db.execute('PRAGMA application_id').fetchone()[0]
        if existed and app_id != APPLICATION_ID:
            raise ValueError('다른 DB가 있는 폴더입니다. 별도 원시 보존 폴더를 지정해 주세요.')
        db.executescript(f'''PRAGMA application_id={APPLICATION_ID}; PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS files(archive TEXT,ordinal INTEGER,name TEXT,source_size INTEGER,
                source_mtime INTEGER,offset INTEGER,stored_size INTEGER,unpacked_size INTEGER,flag INTEGER,
                output TEXT,sha256 TEXT,PRIMARY KEY(archive,ordinal));
            CREATE TABLE IF NOT EXISTS failures(archive TEXT,ordinal INTEGER,error TEXT,PRIMARY KEY(archive,ordinal));
        ''')
        last_flush = time.monotonic()
        for row in rows:
            check_cancel(cancel)
            temp = None
            try:
                Catalog.verify_source(row)
                extension = 'TET' if row['name'].lower().endswith('.tet') else 'stored.bin'
                relative = Catalog.output_relative(dict(row,category='stored',detail='미복원 원본',format=extension,flag=0))
                target = safe_target(destination,relative)
                previous = db.execute('SELECT * FROM files WHERE archive=? AND ordinal=?',
                                      (row['archive'],row['ordinal'])).fetchone()
                if (previous and (previous['source_size'],previous['source_mtime'],previous['offset'],previous['stored_size']) ==
                        (row['archive_size'],row['archive_mtime'],row['offset'],row['stored'])):
                    recorded = Path(previous['output'])
                    # Older .stored.bin exports remain intact; publish a .TET
                    # alongside them once, then resume from the new path.
                    if recorded.parent == target.parent and recorded.suffix.lower() == target.suffix.lower():
                        recorded = safe_target(destination,recorded.relative_to(destination))
                        if recorded.is_file() and recorded.stat().st_size==row['stored'] and file_hash(recorded,cancel)==previous['sha256']:
                            Catalog.verify_source(row)
                            result['skipped'] += 1
                            continue
                if archive is None or str(archive.path) != row['archive']:
                    if archive is not None:
                        archive.__exit__()
                        archive = None
                    archive = Archive(row['archive'])
                opened = os.fstat(archive.file.fileno())
                if (opened.st_size,opened.st_mtime_ns)!=(row['archive_size'],row['archive_mtime']):
                    raise FormatError('열린 원본이 분석 기록과 다릅니다. 다시 분석해 주세요.')
                target.parent.mkdir(parents=True,exist_ok=True)
                safe_target(destination,target.relative_to(destination))
                temp = target.with_name(target.name+'.'+uuid.uuid4().hex+'.partial')
                digest = hashlib.sha256()
                count = 0
                with temp.open('xb') as stream:
                    for block in archive.stored_chunks(Catalog.entry(row),cancel):
                        stream.write(block)
                        digest.update(block)
                        count += len(block)
                if count != row['stored']:
                    raise FormatError('원시 보존 크기가 저장 범위와 다릅니다.')
                Catalog.verify_source(row)
                target,reused = publish_output(temp,target,digest.hexdigest(),destination,cancel)
                temp = None
                pending.append((row['archive'],row['ordinal'],row['name'],row['archive_size'],row['archive_mtime'],
                                row['offset'],row['stored'],row['size'],row['flag'],str(target),digest.hexdigest()))
                result['preserved'] += 1
                result['recovered'] += int(reused)
                result['stored_bytes'] += count
            except Cancelled:
                raise
            except Exception as exc:
                result['failed'] += 1
                with db:
                    db.execute('INSERT OR REPLACE INTO failures VALUES(?,?,?)',(row['archive'],row['ordinal'],str(exc)))
            finally:
                if temp is not None:
                    temp.unlink(missing_ok=True)
                result['done'] += 1
                if len(pending)>=100 or time.monotonic()-last_flush>=0.5:
                    flush()
                    last_flush=time.monotonic()
                progress(phase='preserve',current=row['name'],**result)
        flush()
        result['elapsed_seconds'] = round(time.monotonic()-started,3)
        result['note']='저장 바이트 보존입니다. 압축 해제·복호화·스크립트 원문 복원을 수행하지 않았습니다.'
        report=destination/'preservation-summary.json'
        temporary=report.with_suffix('.json.partial')
        temporary.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        temporary.replace(report)
        return result
    finally:
        try:
            flush()
        finally:
            if archive is not None:
                archive.__exit__()
            db.close()


def preserve_archives(paths,destination,cancel=None,progress=lambda **kw: None):
    rows = archive_rows(paths,cancel)
    try:
        return preserve_rows(rows,destination,cancel,progress)
    finally:
        rows.close()
