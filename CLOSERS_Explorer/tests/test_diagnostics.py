import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from test_explorer import fixture
from closers.catalog import Catalog, file_hash
from closers.cmf import Archive, FormatError, UnsupportedFormat
from closers.diagnostics import diagnose, header_kind, readonly
from closers.benchmark import benchmark


class DiagnosticTests(unittest.TestCase):
    def test_snapshot_preserves_live_wal_and_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            catalog = Catalog(root / 'work')
            source = fixture(root / 'good.cmf', [('a.txt', b'preserve', 1)])
            bad = root / 'bad.cmf'
            bad.write_bytes(b'not an archive')
            catalog.scan([source, bad])
            catalog.extract(root / 'assets')
            # Keep a WAL connection open; backup must include committed WAL rows.
            db = sqlite3.connect(catalog.db)
            try:
                db.execute("UPDATE archives SET error='wal evidence' WHERE status='error'")
                db.commit()
                before = list(db.iterdump())
                output = Path(catalog.entries({})['items'][0]['output'])
                digest = file_hash(output)
                report = diagnose(catalog.workspace, root / 'diag')
                self.assertEqual(report['errors'], {'wal evidence': 1})
                self.assertEqual(list(db.iterdump()), before)
                self.assertEqual(file_hash(output), digest)
                copied = readonly(root / 'diag/catalog.snapshot.sqlite3')
                try:
                    self.assertEqual(list(copied.iterdump()), before)
                    with self.assertRaises(sqlite3.OperationalError):
                        copied.execute('DELETE FROM entries')
                finally:
                    copied.close()
                with self.assertRaises(FileExistsError):
                    diagnose(catalog.workspace, root / 'diag')
                with self.assertRaises(ValueError):
                    diagnose(catalog.workspace, catalog.workspace / 'diagnostics')
            finally:
                db.close()

    def test_missing_changed_and_unknown_headers_remain_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            catalog = Catalog(root / 'work')
            missing = root / 'missing.cmf'
            changed = root / 'changed.cmf'
            missing.write_bytes(b'bad')
            changed.write_bytes(b'bad')
            catalog.scan([missing, changed])
            missing.unlink()
            fixture(changed, [], 1)
            report = diagnose(catalog.workspace, root / 'diag')
            self.assertEqual(report['unreadable'], 1)
            self.assertEqual(report['source_changed'], 1)
            self.assertEqual({g['kind'] for g in report['header_groups']}, {'legacy_1_0', 'unreadable'})
            self.assertEqual(header_kind(b'?' * 104)[0], 'unknown_signature')

    def test_legacy_signature_is_exact_and_ranges_still_checked(self):
        with tempfile.TemporaryDirectory() as temp:
            path = fixture(Path(temp) / 'v1.cmf', [('a.txt', b'payload', 1)], 1)
            original = path.read_bytes()
            for signature in ('COMBINE FILE ver.1', 'COMBINE FILE ver. 1.1', 'COMBINE FILE ver. 10.0'):
                path.write_bytes(signature.encode('utf-16-le').ljust(100, b'\0') + original[100:])
                with self.assertRaises(FormatError):
                    Archive(path)
            path.write_bytes(original[:-1])
            with Archive(path) as archive, self.assertRaises(FormatError):
                list(archive.entries())
            path.write_bytes(b'\x01\0\0\0' + original)
            with self.assertRaises(UnsupportedFormat):
                Archive(path)

    def test_benchmark_is_isolated_and_validates_resume(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = fixture(root / 'v1.cmf', [('a.txt', b'payload' * 100, 1)], 1)
            original = file_hash(path)
            result = benchmark([path], root / 'bench')
            self.assertEqual(result['runs']['extract']['result']['failed'], 0)
            self.assertEqual(result['runs']['resume']['result']['skipped'], 1)
            self.assertEqual(result['validated_outputs'][0]['sha256'], hashlib.sha256(b'payload' * 100).hexdigest())
            self.assertEqual(file_hash(path), original)
            with self.assertRaises(FileExistsError):
                benchmark([path], root / 'bench')
            with self.assertRaises(ValueError):
                benchmark([root], root / 'other')
