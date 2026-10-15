"""Read-only catalog snapshot and bounded CMF header evidence collection."""
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import sqlite3
import time


def readonly(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)


def header_kind(header):
    if len(header) < 104:
        return 'truncated_header', None
    try:
        signature = header[:100].decode('utf-16-le').split('\0')[0]
    except UnicodeError:
        return 'unknown_signature', None
    if signature == 'COMBINE FILE ver. 1.0':
        return 'legacy_1_0', signature
    if re.fullmatch(r'COMBINE FILE ver\.\d+', signature):
        return 'versioned_archive', signature
    if header[4:].startswith('COMBINE FILE ver.'.encode('utf-16-le')):
        return 'embedded_header_candidate', signature
    return 'unknown_signature', signature


def diagnose(workspace, destination, samples=3):
    """Never construct Catalog on the source: even its constructor writes PRAGMAs."""
    if not 1 <= samples <= 20:
        raise ValueError('samples must be between 1 and 20')
    source = Path(workspace).resolve() / 'catalog.sqlite3'
    if not source.is_file():
        raise FileNotFoundError(source)
    destination = Path(destination).resolve()
    if destination == source.parent or destination.is_relative_to(source.parent):
        raise ValueError('진단 폴더는 운영 작업 공간 밖에 지정해 주세요.')
    destination.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    snapshot = destination / 'catalog.snapshot.sqlite3'
    db = readonly(source)
    backup = sqlite3.connect(snapshot)
    try:
        db.backup(backup, pages=256)
    finally:
        backup.close()
        db.close()
    db = readonly(snapshot)
    db.row_factory = sqlite3.Row
    groups = {}
    directories, sizes, errors = Counter(), Counter(), Counter()
    inspected = changed = unreadable = 0
    try:
        archives = dict(db.execute('SELECT status,COUNT(*) FROM archives GROUP BY status'))
        entries = dict(db.execute('SELECT status,COUNT(*) FROM entries GROUP BY status'))
        output = dict(db.execute('SELECT COUNT(*) count,COALESCE(SUM(size),0) bytes FROM entries WHERE output IS NOT NULL').fetchone())
        entry_errors = [dict(r) for r in db.execute('SELECT error,COUNT(*) count FROM entries WHERE error IS NOT NULL GROUP BY error ORDER BY count DESC')]
        entry_samples = []
        for group in entry_errors[:20]:
            for row in db.execute('''SELECT a.path,e.name,e.size,e.stored,e.offset,e.flag,e.error
                                     FROM entries e JOIN archives a ON a.id=e.archive_id WHERE e.error=? ORDER BY e.id LIMIT ?''',
                                  (group['error'], samples)):
                item = dict(row)
                try:
                    with Path(item['path']).open('rb') as stream:
                        stream.seek(item['offset'])
                        head = stream.read(min(104, item['stored']))
                    item['stored_header_hex'] = head.hex()
                    item['stored_ascii'] = ''.join(chr(b) if 32 <= b < 127 else '.' for b in head)
                except OSError as exc:
                    item['read_error'] = str(exc)
                entry_samples.append(item)
        with (destination / 'failures.jsonl').open('x', encoding='utf-8') as stream:
            for row in db.execute("SELECT path,size,mtime,error FROM archives WHERE status='error' ORDER BY path"):
                item = dict(row)
                path = Path(row['path'])
                directories[str(path.parent)] += 1
                errors[row['error']] += 1
                bucket = 'unknown' if row['size'] is None else ('<1KiB' if row['size'] < 1024 else '<1MiB' if row['size'] < 1048576 else '<100MiB' if row['size'] < 104857600 else '>=100MiB')
                sizes[bucket] += 1
                try:
                    before = path.stat()
                    with path.open('rb') as f:
                        header = f.read(104)
                    after = path.stat()
                    item.update(current_size=after.st_size, header_hex=header.hex())
                    kind, signature = header_kind(header)
                    item.update(kind=kind, signature=signature)
                    item['source_changed'] = ((before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns)
                                              or (after.st_size, after.st_mtime_ns) != (row['size'], row['mtime']))
                    changed += item['source_changed']
                    inspected += 1
                except OSError as exc:
                    item.update(kind='unreadable', read_error=str(exc))
                    unreadable += 1
                key = item['kind'] + ':' + (item.get('signature') or '')
                group = groups.setdefault(key, dict(kind=item['kind'], signature=item.get('signature'), count=0, samples=[]))
                group['count'] += 1
                if len(group['samples']) < samples:
                    group['samples'].append(item)
                stream.write(json.dumps(item, ensure_ascii=False) + '\n')
    finally:
        db.close()
    result = dict(created_utc=datetime.now(timezone.utc).isoformat(), source_db=str(source),
                  snapshot=str(snapshot), archives=archives, entries=entries, recorded_output=output,
                  entry_errors=entry_errors, entry_error_samples=entry_samples,
                  failed_headers_read=inspected, unreadable=unreadable, source_changed=changed,
                  header_groups=list(groups.values()), errors=dict(errors), size_buckets=dict(sizes),
                  directories=dict(directories), free_bytes=shutil.disk_usage(destination).free,
                  elapsed_seconds=time.perf_counter()-started,
                  scope='Snapshot catalog only; 104 bytes per failed file. Header grouping is evidence, not payload validation. No source catalog or output files modified.')
    (destination / 'diagnosis.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result
