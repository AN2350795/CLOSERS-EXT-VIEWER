"""Disposable loading-picker data, validated by catalog revision and file metadata."""
from collections import OrderedDict
from contextlib import closing, contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
import uuid


# Bump when thumbnail rendering or the cached menu schema changes.
VERSION = 2
MAX_BYTES = 256 * 1024 * 1024


def stamp(path):
    try:
        stat = Path(path).stat()
        return [stat.st_size, stat.st_mtime_ns, stat.st_ino]
    except FileNotFoundError:
        return None


class LoadingCache:
    def __init__(self, catalog):
        self.catalog = catalog
        self.directory = catalog.workspace / 'thumbnail-cache'
        self.memory = OrderedDict()
        self.lock = threading.RLock()
        self.local = threading.local()

    def revision(self):
        # Avoid Catalog.connect(): picker cache hits need no game-name index refresh.
        with closing(sqlite3.connect(self.catalog.db, timeout=30)) as db:
            revision = db.execute("SELECT value FROM catalog_meta WHERE key='revision'").fetchone()[0]
        return [revision, self.catalog.db.stat().st_ino]

    def watch(self, path):
        path = str(path)
        value = stamp(path)
        for record in getattr(self.local, 'records', ()):
            record['files'].setdefault(path, value)

    def inherit(self, record):
        for parent in getattr(self.local, 'records', ()):
            for path, value in record['files'].items():
                parent['files'].setdefault(path, value)

    @contextmanager
    def capture(self):
        record = dict(version=VERSION, revision=self.revision(), files={})
        records = getattr(self.local, 'records', None)
        if records is None:
            records = self.local.records = []
        records.append(record)
        try:
            yield record
        finally:
            records.pop()

    def valid(self, record):
        try:
            return (record.get('version') == VERSION and record.get('revision') == self.revision()
                    and isinstance(record.get('files'), dict)
                    and all(stamp(path) == value for path, value in record['files'].items()))
        except (OSError, TypeError, ValueError):
            return False

    def path(self, key):
        digest = hashlib.sha256(json.dumps([VERSION, key]).encode()).hexdigest()
        return self.directory / digest

    def get(self, key, persistent=False):
        with self.lock:
            record = self.memory.get(key)
            if record is None and persistent:
                try:
                    record = json.loads(self.path(key).with_suffix('.json').read_text(encoding='utf-8'))
                    if not isinstance(record, dict):
                        return False, None
                    if record.get('png'):
                        body = self.path(key).with_suffix('.png').read_bytes()
                        if hashlib.sha256(body).hexdigest() != record['png']:
                            return False, None
                        record['value'] = body
                except (OSError, ValueError, TypeError):
                    return False, None
            if record is None or not self.valid(record) or 'value' not in record:
                self.memory.pop(key, None)
                return False, None
            if key[0] == 'thumbnail' and not isinstance(record['value'], bytes):
                return False, None
            self.inherit(record)
            self.memory[key] = record
            self.memory.move_to_end(key)
            while len(self.memory) > 128:
                self.memory.popitem(last=False)
            return True, record['value']

    @staticmethod
    def atomic_write(path, body):
        temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.partial')
        try:
            temp.write_bytes(body)
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)

    def put(self, key, value, record, persistent=False):
        if not self.valid(record):
            raise ValueError('에셋을 준비하는 동안 원본이 변경되었습니다. 다시 시도해 주세요.')
        record = dict(record, value=value)
        with self.lock:
            if persistent:
                self.directory.mkdir(exist_ok=True)
                manifest = dict(record)
                if isinstance(value, bytes):
                    manifest.pop('value')
                    manifest['png'] = hashlib.sha256(value).hexdigest()
                    self.atomic_write(self.path(key).with_suffix('.png'), value)
                self.atomic_write(self.path(key).with_suffix('.json'), json.dumps(manifest).encode())
                self.trim()
            self.memory[key] = record
            self.memory.move_to_end(key)
            while len(self.memory) > 128:
                self.memory.popitem(last=False)
        self.inherit(record)
        return value

    def trim(self):
        files = sorted((p for p in self.directory.iterdir() if p.suffix in ('.png', '.json')),
                       key=lambda p: p.stat().st_mtime_ns)
        total = sum(p.stat().st_size for p in files)
        for path in files:
            if total <= MAX_BYTES:
                break
            size = path.stat().st_size
            path.unlink(missing_ok=True)
            total -= size
