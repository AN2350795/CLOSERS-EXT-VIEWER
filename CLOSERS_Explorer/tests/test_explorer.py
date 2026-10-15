import hashlib
import json
import os
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import threading
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from closers.cmf import Archive, Cancelled, CHUNK, FormatError, LEGACY_KEYS, MODERN_KEYS
from closers.catalog import Catalog, file_hash, safe_target, operation_lock
from closers.server import Media


def encode(data, keys):
    result = bytearray()
    for index, (value,) in enumerate(struct.iter_unpack('<I', data)):
        raw = struct.pack('<I', value ^ keys[index % 3])
        result.extend((raw[3], raw[1], raw[2], raw[0]))
    return result


def fixture(path, entries, version=2):
    """entries: (name, content, storage flag[, encoded payload override])."""
    keys = LEGACY_KEYS if version <= 3 else MODERN_KEYS
    signature = 'COMBINE FILE ver. 1.0' if version == 1 else f'COMBINE FILE ver.{version}'
    header = signature.encode('utf-16-le').ljust(100, b'\0')
    header += encode(struct.pack('<I', len(entries)), LEGACY_KEYS)
    table, payload = bytearray(), bytearray()
    for item in entries:
        name, content, flag = item[:3]
        stored = item[3] if len(item) > 3 else zlib.compress(content) if flag == 1 else content
        row = name.encode('utf-16-le').ljust(512, b'\0')
        row += struct.pack('<4I', len(content), len(stored), len(payload), flag)
        table.extend(encode(row, keys))
        payload.extend(stored)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + table + bytes(version if version > 2 else 0) + payload)
    return path


class ExplorerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.catalog = Catalog(self.root / 'work')
        self.output = self.root / 'output'

    def tearDown(self):
        self.temp.cleanup()

    def test_versions_and_mixed_storage(self):
        for version in range(1, 11):
            with self.subTest(version=version):
                path = fixture(self.root / f'{version}.cmf', [('한글.PNG', b'\x89PNG\r\n\x1a\n' + b'a' * 100, 0),
                                      ('folder/data.txt', b'abcd' * 100000, 1)], version)
                with Archive(path) as archive:
                    entries = list(archive.entries())
                    self.assertEqual(len(entries), 2)
                    self.assertEqual(entries[0].name, '한글.PNG')
                    self.assertEqual(b''.join(archive.chunks(entries[1])), b'abcd' * 100000)

    def test_corrupt_headers_do_not_allocate_from_count(self):
        path = fixture(self.root / 'bad.cmf', [])
        raw = bytearray(path.read_bytes())
        raw[100:104] = encode(struct.pack('<I', 0xffffffff), LEGACY_KEYS)
        path.write_bytes(raw)
        with self.assertRaises(FormatError):
            Archive(path)
        path.write_bytes(b'broken')
        with self.assertRaises(FormatError):
            Archive(path)
        fixture(path, [], 11)
        with self.assertRaisesRegex(FormatError, '버전 11'):
            Archive(path)

    def test_out_of_bounds_entry(self):
        path = fixture(self.root / 'bad.cmf', [('a.txt', b'hello', 0)])
        path.write_bytes(path.read_bytes()[:-1])
        with Archive(path) as archive, self.assertRaises(FormatError):
            list(archive.entries())

    def test_stream_buffer_bounded_for_high_ratio(self):
        payload = b'A' * (24 * 1024 * 1024)
        path = fixture(self.root / 'large.cmf', [('huge.txt', payload, 1)])
        with Archive(path) as archive:
            entry = next(archive.entries())
            digest, length, biggest = hashlib.sha256(), 0, 0
            for block in archive.chunks(entry):
                digest.update(block)
                length += len(block)
                biggest = max(biggest, len(block))
            self.assertLessEqual(biggest, CHUNK)
            self.assertEqual(length, len(payload))
            self.assertEqual(digest.digest(), hashlib.sha256(payload).digest())

    def test_compression_corruption_and_size_mismatch(self):
        for encoded in (zlib.compress(b'payload')[:-2], zlib.compress(b'too long'), zlib.compress(b'payload')+b'trailer'):
            path = fixture(self.root / 'bad.cmf', [('a.txt', b'payload', 1, encoded)])
            with Archive(path) as archive, self.assertRaises((FormatError, zlib.error)):
                list(archive.chunks(next(archive.entries())))

    def test_scan_resume_paging_and_actual_format(self):
        path = fixture(self.root / 'sample.cmf', [('renamed.OGG', b'RIFF1234WAVEdata', 0), ('portrait.DDS', b'\x89PNG\r\n\x1a\n', 1)])
        self.assertEqual(self.catalog.scan([path])['archives'], 1)
        self.assertEqual(self.catalog.scan([path])['skipped'], 1)
        result = self.catalog.entries({'category': 'images', 'limit': 1})
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['items'][0]['format'], 'png')
        self.assertEqual(self.catalog.entries({'format': 'wav'})['total'], 1)
        self.assertEqual(self.catalog.entries({'ids': []})['total'], 0)

    def test_search_escapes_sql_wildcards(self):
        path = fixture(self.root / 'sample.cmf', [('a_b.txt', b'hi', 0), ('acb.txt', b'hi', 0)])
        self.catalog.scan([path])
        self.assertEqual(self.catalog.entries({'q': 'a_b'})['total'], 1)
        self.assertEqual(self.catalog.entries({'q': "' OR 1=1 --"})['total'], 0)

    def test_duplicates_resume_and_user_changes_preserved(self):
        path = fixture(self.root / 'sample.cmf', [('same.txt', b'one', 0), ('same.txt', b'two', 1)])
        self.catalog.scan([path])
        self.assertEqual(self.catalog.extract(self.output)['failed'], 0)
        rows = self.catalog.entries({})['items']
        self.assertNotEqual(rows[0]['output'], rows[1]['output'])
        self.assertEqual(self.catalog.extract(self.output)['skipped'], 2)
        old = Path(rows[0]['output'])
        old.write_bytes(b'user change')
        self.catalog.extract(self.output)
        self.assertEqual(old.read_bytes(), b'user change')
        self.assertNotEqual(self.catalog.get(rows[0]['id'])['output'], str(old))

    def test_changed_source_is_rejected_and_rescannable(self):
        path = fixture(self.root / 'sample.cmf', [('data.txt', b'one', 0)])
        self.catalog.scan([path])
        fixture(path, [('data.txt', b'changed', 1)])
        self.assertEqual(self.catalog.extract(self.output)['failed'], 1)
        self.catalog.scan([path])
        self.assertEqual(self.catalog.extract(self.output)['failed'], 0)

    def test_invalid_path_cannot_escape_output(self):
        names = ['../escape.txt', '/root.txt', 'C:\\escape.txt', 'folder/../../bad.txt', 'evil:stream.txt']
        self.catalog.scan([fixture(self.root / 'bad.cmf', [(n, b'payload', 0) for n in names])])
        result = self.catalog.extract(self.output)
        self.assertEqual(result['failed'], len(names))
        self.assertFalse((self.root / 'escape.txt').exists())
        self.assertEqual(list(self.output.rglob('*.partial')), [])

    def test_windows_reserved_names_are_safe(self):
        self.catalog.scan([fixture(self.root / 'names.cmf', [('CON.txt', b'payload', 0), ('foo/na?me.txt', b'payload', 0)])])
        self.assertEqual(self.catalog.extract(self.output)['failed'], 0)

    def test_failure_isolation(self):
        good = fixture(self.root / 'good.cmf', [('good.txt', b'good', 0)])
        bad = self.root / 'bad.cmf'
        bad.write_bytes(b'not cmf')
        self.assertEqual(self.catalog.scan([bad, good])['failed'], 1)
        self.assertEqual(self.catalog.entries({})['total'], 1)
        self.assertEqual(self.catalog.stats()['error_count'], 1)

    def test_payload_failure_isolated_and_partial_removed(self):
        self.catalog.scan([fixture(self.root / 'mixed.cmf', [('bad.txt', b'payload', 1, zlib.compress(b'payload')[:-1]), ('good.txt', b'valid', 0)])])
        result = self.catalog.extract(self.output)
        self.assertEqual(result['failed'], 1)
        self.assertEqual(self.catalog.stats()['statuses']['extracted'], 1)
        self.assertEqual(list(self.output.rglob('*.partial')), [])

    def test_cancel_mid_file_then_resume(self):
        self.catalog.scan([fixture(self.root / 'big.cmf', [('large.txt', b'A' * (4 * 1024 * 1024), 1)])])
        cancel = threading.Event()
        def progress(**state):
            if state.get('written', 0) >= CHUNK:
                cancel.set()
        with self.assertRaises(Cancelled):
            self.catalog.extract(self.output, cancel=cancel, progress=progress)
        self.assertEqual(list(self.output.rglob('*.partial')), [])
        self.assertEqual(self.catalog.extract(self.output)['failed'], 0)

    def test_cancelled_rescan_retains_previous_catalog(self):
        path = fixture(self.root / 'sample.cmf', [('a.txt', b'old', 0)])
        self.catalog.scan([path])
        fixture(path, [('b.txt', b'changed', 0)])
        cancel = threading.Event()
        def progress(**state):
            cancel.set()
        with self.assertRaises(Cancelled):
            self.catalog.scan([path], cancel, progress)
        self.assertEqual(self.catalog.entries({})['items'][0]['name'], 'a.txt')

    def test_encrypted_raw_is_explicit(self):
        self.catalog.scan([fixture(self.root / 'encrypted.cmf', [('secret.lua', b'opaque', 2)])])
        result = self.catalog.extract(self.output)
        self.assertEqual(result['encrypted'], 1)
        self.assertEqual(list(self.output.rglob('*')), [])
        self.catalog.extract(self.output, raw=True)
        row = self.catalog.entries({})['items'][0]
        self.assertEqual(row['status'], 'raw')
        self.assertTrue(row['output'].endswith('.encrypted.bin'))
        self.assertEqual(Path(row['output']).read_bytes(), b'opaque')

    def test_csv_is_bom_encoded_and_formula_safe(self):
        self.catalog.scan([fixture(self.root / 'formula.cmf', [('=evil.txt', b'payload', 0)])])
        output = self.root / 'catalog.csv'
        self.catalog.export_manifest(output)
        self.assertTrue(output.read_bytes().startswith(b'\xef\xbb\xbf'))
        self.assertIn("'=evil.txt", output.read_text(encoding='utf-8-sig'))

    def test_connections_closed(self):
        with self.catalog.connect() as db:
            db.execute('SELECT 1')
        with self.assertRaises(sqlite3.ProgrammingError):
            db.execute('SELECT 1')

    def test_parallel_operation_is_rejected(self):
        path = fixture(self.root / 'sample.cmf', [('a.txt', b'content', 0)])
        with operation_lock(self.catalog.workspace):
            with self.assertRaisesRegex(ValueError, '다른 프로그램'):
                self.catalog.scan([path])
        self.assertEqual(self.catalog.scan([path])['failed'], 0)

    def test_extracted_preview_works_without_original(self):
        content = b'RIFF1234WAVEdata'
        path = fixture(self.root / 'sample.cmf', [('audio.ogg', content, 1)])
        self.catalog.scan([path])
        self.catalog.extract(self.output)
        row = self.catalog.get(self.catalog.entries({})['items'][0]['id'])
        path.unlink()
        media = Media(self.catalog)
        self.assertEqual(media.read(row, 4096), content)
        stream, size, mime = media.file(row)
        with stream:
            self.assertEqual(stream.read(), content)
        self.assertEqual(size, len(content))


if __name__ == '__main__':
    unittest.main()
