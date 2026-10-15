import hashlib
import os
from contextlib import closing
from pathlib import Path
import sqlite3
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch
import zlib

from test_explorer import fixture, encode
from closers.catalog import Catalog
from closers.cmf import Archive, Cancelled, CHUNK, FormatError, decode, LEGACY_KEYS, MODERN_KEYS
from closers.header_index import HeaderIndex, export_index, index_summary
from closers.preservation import archive_rows, preserve_archives, preserve_rows


def header_fixture(root):
    records = []
    for version in range(1, 11):
        cmf = fixture(root / f'{version}.cmf', [('folder/a.lua', b'body', 0)], version)
        raw = cmf.read_bytes()[:104+528]
        if version >= 4:
            raw = raw[:104] + encode(decode(raw[104:], MODERN_KEYS), LEGACY_KEYS)
        records.append(raw + struct.pack('<II', 123, version*500))
    path = root / 'HEADER.CMF'
    path.write_bytes(struct.pack('<I', len(records)) + b''.join(records))
    return path


class PreservationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.dest = self.root / 'preserved'

    def tearDown(self):
        self.temp.cleanup()

    def rows(self):
        with closing(sqlite3.connect(self.dest / 'preservation.sqlite3')) as db:
            db.row_factory = sqlite3.Row
            return db.execute('SELECT * FROM files ORDER BY ordinal').fetchall()

    def test_exact_stored_spans_and_resume_without_plaintext_claim(self):
        encoded = b'QmFzZTY0LXVua25vd24=' * 10000
        compressed = zlib.compress(b'restored text' * 1000)
        path = fixture(self.root/'script.cmf', [('script.lua', b'x'*500000, 1, encoded),
                       ('next.lua', b'next', 2), ('z.lua', b'restored text'*1000, 1)])
        result = preserve_archives([path], self.dest)
        self.assertEqual((result['preserved'], result['failed'], result['restored_plaintext']), (3, 0, 0))
        for row, expected in zip(self.rows(), (encoded, b'next', compressed)):
            output = Path(row['output'])
            self.assertTrue(output.name.endswith('.stored.bin'))
            self.assertEqual(output.read_bytes(), expected)
            self.assertEqual(row['sha256'], hashlib.sha256(expected).hexdigest())
        self.assertEqual(preserve_archives([path], self.dest)['skipped'], 3)
        with Archive(path) as archive:
            blocks = list(archive.stored_chunks(next(archive.entries())))
            self.assertLessEqual(max(map(len, blocks)), CHUNK)

    def test_modified_output_is_preserved_and_orphan_is_recovered(self):
        path = fixture(self.root/'a.cmf', [('a.lua', b'original', 0)])
        preserve_archives([path], self.dest)
        output = Path(self.rows()[0]['output'])
        output.write_bytes(b'user modified')
        result = preserve_archives([path], self.dest)
        replacement = Path(self.rows()[0]['output'])
        self.assertNotEqual(output, replacement)
        self.assertEqual(output.read_bytes(), b'user modified')
        self.assertEqual(replacement.read_bytes(), b'original')
        with closing(sqlite3.connect(self.dest/'preservation.sqlite3')) as db, db:
            db.execute('DELETE FROM files')
        self.assertEqual(preserve_archives([path], self.dest)['recovered'], 1)
        self.assertEqual(Path(self.rows()[0]['output']), replacement)

    def test_tet_extension_and_old_binary_resume_preserve_existing_bytes(self):
        path = fixture(self.root/'a.cmf', [('portrait.tet', b'plaintext', 1, b'YWJjZGVm')])
        self.assertEqual(preserve_archives([path],self.dest)['preserved'],1)
        output = Path(self.rows()[0]['output'])
        self.assertEqual(output.suffix,'.TET')
        self.assertEqual(output.read_bytes(),b'YWJjZGVm')
        old = output.with_suffix('.stored.bin')
        output.rename(old)
        with closing(sqlite3.connect(self.dest/'preservation.sqlite3')) as db, db:
            db.execute('UPDATE files SET output=?',(str(old),))
        self.assertEqual(preserve_archives([path],self.dest)['preserved'],1)
        self.assertEqual(old.read_bytes(),output.read_bytes())
        self.assertEqual(preserve_archives([path],self.dest)['skipped'],1)
        output.write_bytes(b'user modified')
        self.assertEqual(preserve_archives([path],self.dest)['preserved'],1)
        self.assertEqual(output.read_bytes(),b'user modified')
        replacement = Path(self.rows()[0]['output'])
        self.assertEqual(replacement.suffix,'.TET')
        self.assertEqual(replacement.read_bytes(),b'YWJjZGVm')

    @unittest.skipUnless(os.name=='nt','Windows Explorer integration')
    def test_open_folder_accepts_only_existing_directory(self):
        from closers.server import open_output_folder
        with patch('closers.server.os.startfile') as startfile:
            self.assertEqual(open_output_folder(str(self.root)),str(self.root.resolve()))
            startfile.assert_called_once_with(str(self.root.resolve()),'explore')
            for value in (None,'',str(self.root/'missing')):
                with self.assertRaises(ValueError):
                    open_output_folder(value)
            file = self.root/'a.TET'
            file.write_bytes(b'data')
            with self.assertRaises(ValueError):
                open_output_folder(str(file))
            self.assertEqual(startfile.call_count,1)

    def test_catalog_preservation_does_not_change_entry_status_or_output(self):
        path = fixture(self.root/'a.cmf', [('bad.lua', b'plaintext', 1, b'unknown')])
        catalog = Catalog(self.root/'work')
        catalog.process([path], self.root/'assets')
        with catalog.connect() as db:
            before = list(db.iterdump())
        result = catalog.preserve(self.dest, {'status':'error'})
        self.assertEqual(result['preserved'], 1)
        with catalog.connect() as db:
            self.assertEqual(before, list(db.iterdump()))

    def test_stale_source_and_traversal_are_rejected(self):
        path = fixture(self.root/'a.cmf', [('safe.lua', b'body', 0)])
        rows = list(archive_rows([path]))
        path.write_bytes(path.read_bytes()+b'changed')
        self.assertEqual(preserve_rows(rows, self.dest)['failed'], 1)
        unsafe = fixture(self.root/'unsafe.cmf', [('../outside.lua', b'body', 0)])
        self.assertEqual(preserve_archives([unsafe], self.dest)['failed'], 1)
        self.assertEqual(self.rows(), [])
        self.assertFalse(list(self.root.rglob('*.stored.bin')))

    def test_cancel_mid_copy_cleans_partial_and_can_resume(self):
        path = fixture(self.root/'a.cmf', [('a.lua', b'x'*(CHUNK*3), 0)])
        cancel = threading.Event()
        original = Archive.stored_chunks
        def cancelling(archive, entry, event):
            for block in original(archive, entry, event):
                yield block
                cancel.set()
        with patch.object(Archive, 'stored_chunks', cancelling), self.assertRaises(Cancelled):
            preserve_archives([path], self.dest, cancel)
        self.assertFalse(list(self.dest.rglob('*.partial')))
        self.assertEqual(self.rows(), [])
        self.assertEqual(preserve_archives([path], self.dest)['preserved'], 1)

    def test_foreign_database_is_not_modified(self):
        self.dest.mkdir()
        database = self.dest/'preservation.sqlite3'
        with closing(sqlite3.connect(database)) as db, db:
            db.execute('CREATE TABLE original(value)')
        before = database.read_bytes()
        with self.assertRaises(ValueError):
            preserve_rows([], self.dest)
        self.assertEqual(before, database.read_bytes())

    def test_header_all_versions_export_metadata_and_process_classification(self):
        path = header_fixture(self.root)
        self.assertEqual(index_summary(path), {'archives':10, 'entries':10})
        with HeaderIndex(path) as index:
            for record in index.records():
                self.assertEqual(record.relative_archive, f'DAT{record.version}/DAT{record.version*500}.CMF')
                self.assertEqual(next(index.entries(record)).offset, 0)
        result = export_index(path, self.dest)
        self.assertEqual((result['archive_records'], result['entry_descriptors'], result['payload_files']), (10,10,0))
        with closing(sqlite3.connect(self.dest/'index.sqlite3')) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM entries').fetchone()[0], 10)
        catalog = Catalog(self.root/'work')
        result = catalog.process([path], self.root/'assets')
        self.assertEqual((result['indexes'], result['failed'], result['done']), (1,0,0))
        self.assertEqual(catalog.scan([path])['indexes'], 1)
        with catalog.connect() as db:
            self.assertEqual(db.execute('SELECT status FROM archives').fetchone()[0], 'index')
        with self.assertRaises(FileExistsError):
            export_index(path, self.dest)

    def test_incomplete_header_never_publishes_complete_database(self):
        path = header_fixture(self.root)
        original = path.read_bytes()
        for suffix, bad in [('truncated', original[:-1]), ('extra', original+b'extra')]:
            path.write_bytes(bad)
            destination = self.root/suffix
            with self.assertRaises(FormatError):
                export_index(path, destination)
            self.assertFalse((destination/'index.sqlite3').exists())
            self.assertFalse((destination/'index-summary.json').exists())


if __name__ == '__main__':
    unittest.main()
