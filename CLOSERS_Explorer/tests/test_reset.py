import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from closers.catalog import Catalog, operation_lock
from closers.library import PreservationLinks
from closers.reset import Reset, RequestGate
from closers.server import create_server
from test_explorer import fixture


class ResetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.catalog = Catalog(self.root / 'work')
        self.source = fixture(self.root / 'source.cmf', [('ok.txt', b'hello', 0), ('bad.TET', b'body', 1, b'YWJjZGVm')])
        self.original = self.source.read_bytes()
        self.catalog.scan([self.source])
        self.output = self.root / 'external'
        self.catalog.extract(self.output)
        self.links = PreservationLinks(self.catalog.workspace)
        self.reset = Reset(self.catalog, self.links)

    def tearDown(self):
        self.temp.cleanup()

    def execute(self, preserved=False):
        preview = self.reset.preview(preserved)
        return self.reset.execute(preview['id'], '전체 초기화')

    def test_full_reset_clears_history_caches_reports_and_external_recorded_files(self):
        recorded = Path(self.catalog.entries({'status': 'extracted'})['items'][0]['output'])
        unrelated = self.output / 'notes.txt'; unrelated.write_text('keep')
        history = self.output / 'old.txt'; history.write_text('old')
        with self.catalog.connect() as db:
            db.execute("INSERT INTO archive_history(id,archive_id,path,saved) VALUES(1,1,?,0)", (str(self.source),))
            db.execute("INSERT INTO entry_history(revision_id,record) VALUES(1,?)", (json.dumps({'output': str(history)}),))
        self.catalog.save_group('prefix', 'ok', 'custom', 'tag')
        for name in ('preview-cache', 'composition-cache', 'assets'):
            folder = self.catalog.workspace / name; folder.mkdir(exist_ok=True)
            (folder / 'generated.bin').write_bytes(b'cached')
        embedded_source = self.catalog.workspace / 'assets' / 'original.CMF'
        embedded_source.write_bytes(self.original)
        for name in ('catalog.csv', 'summary.json', 'update-comparison.json', 'catalog.csv.revision.json'):
            (self.catalog.workspace / name).write_text('old')
        result = self.execute()
        self.assertGreater(result['deleted'], 5)
        self.assertFalse(recorded.exists()); self.assertFalse(history.exists())
        self.assertEqual(unrelated.read_text(), 'keep')
        self.assertEqual(embedded_source.read_bytes(), self.original)
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertEqual(self.catalog.entries({})['total'], 0)
        with self.catalog.connect() as db:
            for table in ('archives', 'entries', 'archive_history', 'entry_history', 'group_notes'):
                self.assertEqual(db.execute(f'SELECT count(*) FROM {table}').fetchone()[0], 0)
        self.assertFalse((self.catalog.workspace / 'catalog.csv').exists())
        self.assertEqual(self.catalog.scan([self.source])['archives'], 1)
        result = self.catalog.extract(self.output)
        self.assertEqual((result['done'], result['failed'], result['skipped']), (2, 1, 0))
        self.assertEqual(recorded.read_bytes(), b'hello')

    def test_preservation_is_optional_and_can_be_deleted_after_catalog_reset(self):
        destination = self.catalog.workspace / 'stored-preservation'
        self.catalog.preserve(destination)
        self.links.register(destination)
        stored = next((destination / 'stored').rglob('*.TET'))
        orphan = stored.with_suffix('.stored.bin'); orphan.write_bytes(b'legacy')
        unrelated = destination / 'notes.txt'; unrelated.write_text('keep')
        self.execute()
        self.assertTrue(stored.is_file()); self.assertTrue(orphan.is_file())
        self.assertTrue((destination / 'preservation.sqlite3').is_file())
        self.assertTrue(self.links.sources)
        self.execute(True)
        self.assertFalse(stored.exists()); self.assertFalse(orphan.exists())
        self.assertFalse((destination / 'preservation.sqlite3').exists())
        self.assertFalse(self.links.sources)
        self.assertFalse(PreservationLinks(self.catalog.workspace).sources)
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertTrue(unrelated.exists())

    def test_confirmation_expiry_changes_and_cli_lock_prevent_deletion(self):
        preview = self.reset.preview()
        with self.assertRaises(ValueError): self.reset.execute(preview['id'], '')
        self.reset.pending['expires'] = 0
        with self.assertRaises(ValueError): self.reset.execute(preview['id'], '전체 초기화')
        preview = self.reset.preview()
        self.catalog.save_group('prefix', 'ok', 'changed', '')
        with self.assertRaisesRegex(ValueError, '변경'): self.reset.execute(preview['id'], '전체 초기화')
        preview = self.reset.preview()
        with operation_lock(self.catalog.workspace):
            with self.assertRaises(ValueError): self.reset.execute(preview['id'], '전체 초기화')
        self.assertEqual(self.catalog.entries({})['total'], 2)

    def test_failure_keeps_catalog_for_retry(self):
        preview = self.reset.preview()
        with patch('closers.reset.Path.unlink', side_effect=PermissionError('locked')):
            with self.assertRaises(PermissionError): self.reset.execute(preview['id'], '전체 초기화')
        self.assertEqual(self.catalog.entries({})['total'], 2)
        self.execute()
        self.assertEqual(self.catalog.entries({})['total'], 0)

    def test_original_recorded_as_output_is_protected(self):
        with self.catalog.connect() as db:
            db.execute('UPDATE entries SET output=?', (str(self.source),))
        self.execute()
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_symlink_in_managed_folder_is_rejected(self):
        assets = self.catalog.workspace / 'assets'
        try:
            assets.symlink_to(self.output, target_is_directory=True)
        except OSError:
            self.skipTest('symlinks unavailable')
        with self.assertRaisesRegex(ValueError, '링크'): self.reset.preview()
        self.assertEqual(self.catalog.entries({})['total'], 2)

    @unittest.skipUnless(os.name == 'nt', 'Windows junction test')
    def test_windows_junction_is_rejected_without_touching_target(self):
        assets = self.catalog.workspace / 'assets'
        result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(assets), str(self.output)],
                                capture_output=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.assertEqual(result.returncode, 0)
        try:
            with self.assertRaises(ValueError): self.reset.preview()
            self.assertEqual(self.catalog.entries({})['total'], 2)
        finally:
            # Remove only the junction, never recurse into the existing output directory.
            assets.rmdir()

    def test_changed_file_after_review_is_rejected(self):
        preview = self.reset.preview()
        path = Path(self.catalog.entries({'status': 'extracted'})['items'][0]['output'])
        path.write_bytes(b'new content')
        with self.assertRaisesRegex(ValueError, '변경'):
            self.reset.execute(preview['id'], '전체 초기화')
        self.assertEqual(path.read_bytes(), b'new content')

    def test_gate_waits_for_downloads_and_rejects_new_readers(self):
        gate = RequestGate(); entered = threading.Event()
        with gate.read():
            thread = threading.Thread(target=lambda: self.write_gate(gate, entered))
            thread.start()
            with gate.condition:
                gate.condition.wait_for(lambda: gate.writing, timeout=2)
            self.assertTrue(gate.writing); self.assertFalse(entered.is_set())
            with self.assertRaises(ValueError):
                with gate.read(): pass
        thread.join(2); self.assertTrue(entered.is_set())
        with gate.read(): pass

    @staticmethod
    def write_gate(gate, entered):
        with gate.write(): entered.set()

    def test_http_auth_busy_confirmation_token_rotation_and_reuse(self):
        server = create_server(self.catalog)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        def token():
            return re.search(r'name="explorer-token" content="([^"]+)"', urlopen(base).read().decode())[1]
        key = token()
        def request(path, data=None, auth=None):
            return json.load(urlopen(Request(base + path,
                data=json.dumps(data).encode() if data is not None else None,
                headers={'Content-Type': 'application/json', 'X-Explorer-Token': auth or key})))
        try:
            with self.assertRaises(HTTPError) as error: request('/api/reset-preview', auth='bad')
            self.assertEqual(error.exception.code, 403)
            preview = request('/api/reset-preview')
            with self.assertRaises(HTTPError): request('/api/reset', {'plan_id': preview['id'], 'confirmation': ''})
            server.jobs.progress(running=True)
            with self.assertRaises(HTTPError): request('/api/reset', {'plan_id': preview['id'], 'confirmation': '전체 초기화'})
            server.jobs.progress(running=False)
            self.assertTrue(request('/api/reset', {'plan_id': preview['id'], 'confirmation': '전체 초기화'})['ok'])
            with self.assertRaises(HTTPError) as error: request('/api/entries')
            self.assertEqual(error.exception.code, 403)
            key = token()
            self.assertEqual(request('/api/entries')['total'], 0)
            self.assertFalse(request('/api/state')['job']['running'])
            self.assertEqual(self.source.read_bytes(), self.original)
            self.assertEqual(self.catalog.scan([self.source])['archives'], 1)
        finally:
            server.shutdown(); thread.join(5); server.server_close()


if __name__ == '__main__':
    unittest.main()
