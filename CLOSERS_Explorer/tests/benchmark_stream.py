"""Stream 1 GiB of highly compressible data without retaining it in memory."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import time
import tracemalloc
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from closers.cmf import Archive, CHUNK, LEGACY_KEYS
from test_explorer import encode

with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / 'large.cmf'
    chunk = b'A' * CHUNK
    original_size = 1024 * 1024 * 1024
    compressor = zlib.compressobj(1)
    expected = hashlib.sha256()
    with path.open('wb') as file:
        file.write(bytes(632))
        for _ in range(original_size // CHUNK):
            file.write(compressor.compress(chunk))
            expected.update(chunk)
        file.write(compressor.flush())
        stored_size = file.tell() - 632
        file.seek(0)
        file.write('COMBINE FILE ver.2'.encode('utf-16-le').ljust(100, b'\0'))
        file.write(encode(struct.pack('<I', 1), LEGACY_KEYS))
        file.write(encode('large.bin'.encode('utf-16-le').ljust(512, b'\0') + struct.pack('<4I', original_size, stored_size, 0, 1), LEGACY_KEYS))
    tracemalloc.start()
    started = time.perf_counter()
    actual, total, max_chunk = hashlib.sha256(), 0, 0
    with Archive(path) as archive:
        for block in archive.chunks(next(archive.entries())):
            actual.update(block)
            total += len(block)
            max_chunk = max(max_chunk, len(block))
    elapsed = time.perf_counter() - started
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert total == original_size and actual.digest() == expected.digest()
    assert max_chunk <= CHUNK and peak < 4 * 1024 * 1024
    result = dict(unpacked_bytes=total, compressed_bytes=stored_size, seconds=round(elapsed, 3),
                  peak_python_allocated_bytes=peak, maximum_chunk_bytes=max_chunk, sha256=actual.hexdigest())
    print(json.dumps(result, indent=2))
    output = Path(__file__).resolve().parents[1] / 'docs' / 'stream-benchmark.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
