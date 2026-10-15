"""Repeatable real engine benchmark, exclusively in a new result directory."""
import cProfile
import hashlib
import json
from pathlib import Path
import platform
import pstats
import shutil
import time
import tracemalloc

from .catalog import Catalog, file_hash
from .cmf import Archive, FormatError


def measure(action, profile_path):
    profiler = cProfile.Profile()
    tracemalloc.start()
    started = time.perf_counter()
    try:
        result = profiler.runcall(action)
        elapsed = time.perf_counter() - started
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    profiler.dump_stats(str(profile_path))
    stats = pstats.Stats(profiler)
    groups = {name: 0.0 for name in ('discovery', 'table_parse', 'classification', 'decompression',
                                    'output', 'db', 'revalidation_hash', 'input', 'other')}
    functions = []
    for (filename, line, name), (primitive, calls, own, cumulative, callers) in stats.stats.items():
        category = 'other'
        if '_sqlite3' in name or 'sqlite3.Connection' in name or 'sqlite3.Cursor' in name:
            category = 'db'
        elif 'zlib' in name:
            category = 'decompression'
        elif name in ('decode', 'entries') and filename.endswith('cmf.py'):
            category = 'table_parse'
        elif name in ('classify', 'prefix'):
            category = 'classification'
        elif 'write' in name and ('_io.' in name or 'FileIO' in name):
            category = 'output'
        elif 'read' in name and '_io.' in name:
            category = 'input'
        elif name in ('_walk', 'walk') or 'scandir' in name:
            category = 'discovery'
        elif 'HASH' in name or name == 'file_hash':
            category = 'revalidation_hash'
        groups[category] += own
        functions.append(dict(file=filename, line=line, name=name, calls=calls, self_seconds=own, cumulative_seconds=cumulative))
    return dict(result=result, seconds=elapsed, python_peak_bytes=peak, self_seconds=groups,
                functions=sorted(functions, key=lambda x: x['self_seconds'], reverse=True)[:30])


def benchmark(paths, destination, batch_size=100):
    paths = sorted(set(Path(p).resolve() for p in paths))
    if not paths or any(not p.is_file() or p.suffix.lower() != '.cmf' for p in paths):
        raise ValueError('벤치마크에는 대표 CMF 파일의 명시적 목록을 지정해 주세요.')
    count = 0
    for path in paths:
        try:
            with Archive(path) as archive:
                count += archive.count
        except (FormatError, UnicodeError):
            pass  # The scan will record the actual header failure.
    if count > 4096 or sum(p.stat().st_size for p in paths) > 256 * 1024 * 1024:
        raise ValueError('벤치마크 표본은 4,096항목·입력 256 MiB 이하로 나누어 주세요.')
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=False)
    manifest = [dict(path=str(p), size=p.stat().st_size, mtime_ns=p.stat().st_mtime_ns, sha256=file_hash(p)) for p in paths]
    (destination / 'sample.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    catalog = Catalog(destination / 'work')
    output = destination / 'assets'
    runs = {}
    runs['scan'] = measure(lambda: catalog.scan(paths), destination / 'scan.prof')
    with catalog.connect() as db:
        expected = db.execute('SELECT COALESCE(SUM(size),0) FROM entries WHERE flag<>2').fetchone()[0]
        stored = db.execute('SELECT COALESCE(SUM(stored),0) FROM entries WHERE flag<>2').fetchone()[0]
    if expected * 2 + 64 * 1024 * 1024 > shutil.disk_usage(destination).free:
        raise ValueError('대표 샘플 출력과 임시 파일을 위한 여유 공간이 부족합니다.')
    runs['extract'] = measure(lambda: catalog.extract(output, batch_size=batch_size), destination / 'extract.prof')
    runs['resume'] = measure(lambda: catalog.extract(output), destination / 'resume.prof')
    runs['scan_resume'] = measure(lambda: catalog.scan(paths), destination / 'scan_resume.prof')
    with catalog.connect() as db:
        hashes = [dict(r) for r in db.execute('SELECT a.path archive,e.ordinal,e.size,e.sha256,e.output FROM entries e JOIN archives a ON a.id=e.archive_id WHERE e.output IS NOT NULL ORDER BY a.path,e.ordinal')]
    for row in hashes:
        if Path(row['output']).stat().st_size != row['size'] or file_hash(row['output']) != row['sha256']:
            raise ValueError('추출 결과의 크기 또는 SHA-256 검증 실패')
        del row['output']
    for row in manifest:
        path = Path(row['path'])
        if path.stat().st_size != row['size'] or path.stat().st_mtime_ns != row['mtime_ns'] or file_hash(path) != row['sha256']:
            raise ValueError('벤치마크 중 원본 변경')
    for name, run in runs.items():
        run['files_per_second'] = run['result'].get('done', run['result'].get('archives', 0)) / run['seconds']
        run['logical_output_bytes_per_second'] = run['result'].get('bytes', 0) / run['seconds']
    runs['extract']['logical_stored_bytes_per_second'] = stored / runs['extract']['seconds']
    result = dict(python=platform.python_version(), platform=platform.platform(), sample=manifest, batch_size=batch_size,
                  expected_output_bytes=expected, runs=runs, validated_outputs=hashes,
                  notes=['cProfile and tracemalloc enabled: instrumentation adds overhead.',
                         'Self time buckets do not overlap; cumulative functions include callees. Inspect .prof for callers.',
                         'Discovery uses explicit files, not a full directory walk. Input/output rates are logical payload bytes, not physical disk traffic.',
                         'Source hashing warms the OS cache; no cold-cache claim. New extraction and SHA-256 resume are separate.',
                         'Python allocation peak excludes native SQLite/zlib allocations and process RSS.'])
    (destination / 'benchmark.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result
