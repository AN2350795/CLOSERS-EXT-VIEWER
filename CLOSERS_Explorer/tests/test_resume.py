import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from test_explorer import fixture
from closers.catalog import Catalog, file_hash
from closers.cmf import Archive, Cancelled, PARSER_VERSION


class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.catalog = Catalog(self.root / 'work')
        self.output = self.root / 'assets'

    def tearDown(self):
        self.temp.cleanup()

    def test_forced_exit_after_publish_recovers_without_duplicate(self):
        source = fixture(self.root / 'a.cmf', [('a.txt', b'payload', 1)])
        self.catalog.scan([source])
        script = """
import os,sys
from closers import catalog
original = catalog.publish_output
def crash(*args, **kwargs):
    original(*args, **kwargs)
    os._exit(73)
catalog.publish_output = crash
catalog.Catalog(sys.argv[1]).extract(sys.argv[2])
"""
        child = subprocess.run([sys.executable, '-c', script, str(self.catalog.workspace), str(self.output)],
                               cwd=Path(__file__).resolve().parents[1],
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.assertEqual(child.returncode, 73)
        self.assertEqual(self.catalog.entries({})['items'][0]['status'], 'indexed')
        files = [p for p in self.output.rglob('*') if p.is_file()]
        self.assertEqual(len(files), 1)
        self.assertEqual(self.catalog.extract(self.output)['recovered'], 1)
        self.assertEqual([p for p in self.output.rglob('*') if p.is_file()], files)
        self.assertEqual(self.catalog.extract(self.output)['skipped'], 1)

    def test_user_change_conflict_is_reused_on_subsequent_resume(self):
        source = fixture(self.root / 'a.cmf', [('a.txt', b'payload', 1)])
        self.catalog.scan([source])
        self.catalog.extract(self.output)
        row = self.catalog.entries({})['items'][0]
        original = Path(row['output'])
        original.write_bytes(b'user data')
        self.catalog.extract(self.output)
        replacement = self.catalog.get(row['id'])['output']
        self.assertNotEqual(str(original), replacement)
        self.assertEqual(self.catalog.extract(self.output)['skipped'], 1)
        self.assertEqual(self.catalog.get(row['id'])['output'], replacement)
        self.assertEqual(original.read_bytes(), b'user data')

    def test_database_failure_after_publish_is_recoverable(self):
        source = fixture(self.root / 'a.cmf', [('a.txt', b'payload', 1)])
        self.catalog.scan([source])
        with patch.object(self.catalog, 'flush_results', side_effect=OSError('simulated commit failure')):
            with self.assertRaises(OSError):
                self.catalog.extract(self.output)
        self.assertIsNone(self.catalog.entries({})['items'][0]['output'])
        self.assertEqual(self.catalog.extract(self.output)['recovered'],1)
        self.assertEqual(len([p for p in self.output.rglob('*') if p.is_file()]),1)

    def test_failed_rescan_keeps_outputs_but_blocks_stale_extraction(self):
        source = fixture(self.root / 'a.cmf', [('a.txt', b'payload', 1)])
        self.catalog.scan([source])
        self.catalog.extract(self.output)
        before=self.catalog.entries({})['items'][0]
        source.write_bytes(b'broken update')
        self.assertEqual(self.catalog.scan([source])['failed'],1)
        after=self.catalog.entries({})['items'][0]
        self.assertEqual((before['output'],before['sha256']),(after['output'],after['sha256']))
        self.assertEqual(self.catalog.extract(self.output)['failed'],1)
        self.assertEqual(Path(before['output']).read_bytes(),b'payload')

    def test_fast_mode_and_old_metadata_fallback(self):
        source = fixture(self.root / 'a.cmf', [('a.txt', b'payload', 1)])
        self.catalog.scan([source])
        self.catalog.extract(self.output)
        with patch('closers.catalog.file_hash', side_effect=AssertionError('unexpected hash')):
            self.assertEqual(self.catalog.extract(self.output, verify='fast')['skipped'], 1)
        row = self.catalog.entries({})['items'][0]
        with self.catalog.connect() as db:
            db.execute('UPDATE entries SET output_size=NULL,output_mtime=NULL')
        with patch('closers.catalog.file_hash', wraps=file_hash) as hashed:
            self.assertEqual(self.catalog.extract(self.output, verify='fast')['skipped'], 1)
            self.assertEqual(hashed.call_count, 1)
        path = Path(row['output'])
        before = path.stat()
        path.write_bytes(b'changed')
        os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
        # Fast mode explicitly cannot detect changes with identical metadata.
        self.assertEqual(self.catalog.extract(self.output, verify='fast')['skipped'], 1)
        self.assertEqual(self.catalog.extract(self.output, verify='sha256')['skipped'], 0)
        self.assertEqual(path.read_bytes(), b'changed')

    def test_parse_cancel_retains_rows_and_has_no_main_write_transaction(self):
        source = fixture(self.root / 'a.cmf', [('a.txt', b'old', 1)])
        self.catalog.scan([source])
        self.catalog.extract(self.output)
        before = self.catalog.entries({})['items']
        fixture(source, [('a.txt', b'new content', 1)])
        def interrupt(*args):
            self.assertFalse(self.catalog.local.db.in_transaction)
            raise Cancelled()
        with patch('closers.catalog.Archive.prefix', side_effect=interrupt):
            with self.assertRaises(Cancelled):
                self.catalog.scan([source])
        self.assertEqual(self.catalog.entries({})['items'], before)

    def test_error_cache_invalidates_for_parser_source_and_explicit_retry(self):
        source = self.root / 'bad.cmf'
        source.write_bytes(b'bad')
        self.catalog.scan([source])
        with patch('closers.catalog.Archive', side_effect=AssertionError('cache missed')):
            self.assertEqual(self.catalog.scan([source])['cached_errors'], 1)
        self.assertEqual(self.catalog.scan([source], retry_errors=True)['cached_errors'], 0)
        with self.catalog.connect() as db:
            db.execute('UPDATE archives SET parser_version=?', (PARSER_VERSION-1,))
        self.assertEqual(self.catalog.scan([source])['cached_errors'], 0)
        fixture(source, [('a.txt', b'valid', 0)])
        self.assertEqual(self.catalog.scan([source])['failed'], 0)

    def test_one_handle_per_archive_and_no_transaction_during_payload(self):
        source = fixture(self.root / 'a.cmf', [(f'{i}.txt', b'payload', 1) for i in range(12)])
        self.catalog.scan([source])
        original = Archive.chunks
        def chunks(archive, entry, cancel=None):
            self.assertFalse(self.catalog.local.db.in_transaction)
            yield from original(archive, entry, cancel)
        with patch('closers.catalog.Archive', wraps=Archive) as opened, patch.object(Archive, 'chunks', chunks):
            result = self.catalog.extract(self.output)
        self.assertEqual(result['failed'], 0)
        self.assertEqual(opened.call_count, 1)

    def test_old_schema_migration_preserves_ids_outputs_and_hashes(self):
        source = fixture(self.root / 'a.cmf', [('a.txt', b'payload', 1)])
        self.catalog.scan([source])
        self.catalog.extract(self.output)
        row = self.catalog.entries({})['items'][0]
        with self.catalog.connect() as db:
            for column in ('output_size', 'output_mtime'):
                db.execute(f'ALTER TABLE entries DROP COLUMN {column}')
            for column in ('parser_version', 'error_kind'):
                db.execute(f'ALTER TABLE archives DROP COLUMN {column}')
            db.execute('PRAGMA user_version=0')
        migrated = Catalog(self.catalog.workspace)
        after = migrated.entries({})['items'][0]
        for key in ('id', 'archive_id', 'output', 'sha256', 'name'):
            self.assertEqual(after[key], row[key])
        self.assertEqual(migrated.extract(self.output, verify='fast')['skipped'], 1)

    def test_process_extracts_before_discovering_next_and_respects_filter(self):
        first = fixture(self.root / 'first.cmf', [('a.txt', b'a', 0), ('a.ogg', b'OggS', 0)])
        second = fixture(self.root / 'second.cmf', [('b.txt', b'b', 0)])
        def paths():
            yield first
            self.assertEqual(self.catalog.entries({'status': 'extracted'})['total'], 1)
            yield second
        result = self.catalog.process(paths(), self.output, {'category': 'scripts'})
        self.assertEqual(result['done'], 2)
        self.assertEqual(result['failed'], 0)
        result = self.catalog.process([first, second], self.output, {'category': 'scripts'})
        self.assertEqual(result['scan_skipped'], 2)
        self.assertEqual(result['skipped'], 2)
