"""Read-only, independent comparison of exported bytes with their source spans.

Usage: python tests/validate_stored_results.py ../preserved/2026-09-11
Writes only validation.json inside that explicit export directory.
"""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import time


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate(root):
    started = time.monotonic()
    results = []
    for folder in ('script-pack','script-cmfs'):
        database = root/folder/'preservation.sqlite3'
        count = total = 0
        source = None
        source_path = None
        last = time.monotonic()
        try:
            with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)) as db:
                db.row_factory = sqlite3.Row
                assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
                assert db.execute('SELECT COUNT(*) FROM failures').fetchone()[0] == 0
                for row in db.execute('SELECT * FROM files ORDER BY archive,offset,ordinal'):
                    path = Path(row['archive'])
                    stat = path.stat()
                    assert (stat.st_size,stat.st_mtime_ns) == (row['source_size'],row['source_mtime'])
                    if path != source_path:
                        if source:
                            source.close()
                        source = path.open('rb')
                        source_path = path
                    assert 0 <= row['offset'] <= row['offset']+row['stored_size'] <= stat.st_size
                    source.seek(row['offset'])
                    expected = hashlib.sha256()
                    remaining = row['stored_size']
                    while remaining:
                        block = source.read(min(128*1024,remaining))
                        assert block
                        remaining -= len(block)
                        expected.update(block)
                    output = Path(row['output'])
                    assert output.is_relative_to(root/folder) and output.name.endswith('.stored.bin')
                    assert output.stat().st_size == row['stored_size']
                    assert expected.hexdigest() == row['sha256'] == digest(output),row['ordinal']
                    count += 1
                    total += row['stored_size']
                    if time.monotonic()-last>5:
                        print(json.dumps(dict(folder=folder,verified=count)),flush=True)
                        last=time.monotonic()
                assert count == json.loads((root/folder/'preservation-summary.json').read_text(encoding='utf-8'))['done']
        finally:
            if source:
                source.close()
        results.append(dict(folder=folder,verified=count,stored_bytes=total))
    baseline=json.loads((root/'baseline.json').read_text(encoding='utf-8'))
    for record in baseline['files']:
        path=Path(record['path'])
        assert path.stat().st_size==record['size'] and digest(path)==record['sha256'],str(path)
    sources=json.loads((root/'remaining-sources.json').read_text(encoding='utf-8'))
    for path,expected in sources.items():
        stat=Path(path).stat()
        assert [stat.st_size,stat.st_mtime_ns]==expected,path
    with closing(sqlite3.connect((root/'header-index-v2'/'index.sqlite3').as_uri()+'?mode=ro',uri=True)) as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        index_counts={table:db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for table in ('archives','entries')}
    result=dict(status='passed',stored_exports=results,index_counts=index_counts,
                baseline_files_sha256_unchanged=len(baseline['files']),remaining_source_stats_unchanged=len(sources),
                restored_plaintext=0,elapsed_seconds=round(time.monotonic()-started,3))
    (root/'validation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    validate(Path(sys.argv[1]).resolve())
