import json
from pathlib import Path
import re
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from closers.catalog import Catalog
from closers.cmf import Cancelled
from closers.game_names import build_index
from closers.postprocess import Step, executable_path, run
from closers.server import Jobs, create_server
from test_explorer import fixture


class PostprocessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.catalog = Catalog(self.root/'work')
        self.source = fixture(self.root/'DAT'/'one.cmf', [('one.txt', b'asset', 0)])
        self.output = self.root/'assets'

    def finish(self, jobs):
        jobs.thread.join(10)
        self.assertFalse(jobs.thread.is_alive())
        return jobs.snapshot()

    def test_process_runs_after_extract_and_retry_does_not_extract(self):
        jobs = Jobs(self.catalog)
        def derived(catalog, options, paths, cancel, progress):
            self.assertTrue(catalog.entries({})['items'][0]['saved_exists'])
            return {'models': 1}
        with patch('closers.postprocess.STEPS', (Step('test', '시험 단계', derived),)):
            jobs.start('process', dict(paths=[str(self.source)], output=str(self.output), postprocess={'enabled': True}))
            state = self.finish(jobs)
            self.assertEqual(state['status'], 'completed')
            self.assertEqual(state['result']['postprocess']['steps'][0]['result']['models'], 1)
            with patch.object(self.catalog, 'extract', side_effect=AssertionError('must not extract')):
                jobs.start('postprocess', {'postprocess': {}})
                self.assertEqual(self.finish(jobs)['status'], 'completed')

    def test_missing_executable_preserves_assets_and_reports_issues(self):
        jobs = Jobs(self.catalog)
        jobs.start('process', dict(paths=[str(self.source)], output=str(self.output), postprocess={'enabled': True}))
        state = self.finish(jobs)
        self.assertEqual(state['status'], 'issues')
        self.assertIn('CW.EXE', state['result']['postprocess']['steps'][0]['error'])
        row = self.catalog.entries({})['items'][0]
        self.assertEqual(Path(row['output']).read_bytes(), b'asset')
        with patch('closers.postprocess.run', side_effect=AssertionError('disabled')):
            jobs.start('extract', dict(output=str(self.output), postprocess={'enabled': False}))
            self.assertEqual(self.finish(jobs)['status'], 'completed')

    def test_extension_failure_does_not_prevent_next_step_and_cancel_stops(self):
        calls = []
        def failed(*args):raise ValueError('시험 실패')
        def completed(*args):calls.append('completed');return {}
        cancel = threading.Event()
        with patch('closers.postprocess.STEPS', (Step('bad','실패',failed), Step('ok','성공',completed))):
            result = run(self.catalog, {}, cancel, lambda **kw: None)
            self.assertEqual(result['failed'], 1)
            self.assertEqual(calls, ['completed'])
            cancel.set()
            with self.assertRaises(Cancelled):run(self.catalog, {}, cancel, lambda **kw: None)
        index = self.catalog.workspace/'game-names.sqlite3'
        index.write_bytes(b'previous index')
        with self.assertRaises(Cancelled):build_index(self.catalog.workspace, self.root/'missing.exe', cancel=cancel)
        self.assertEqual(index.read_bytes(), b'previous index')

    def test_discovery_rejects_ambiguous_installations_and_honors_explicit_path(self):
        self.catalog.scan([self.source])
        exe = self.root/'CW.EXE';exe.write_bytes(b'exe')
        self.assertEqual(executable_path(self.catalog, {}, ()), exe)
        other = self.root/'DAT'/'CW.EXE';other.write_bytes(b'other')
        with self.assertRaises(ValueError):executable_path(self.catalog, {}, ())
        self.assertEqual(executable_path(self.catalog, {'executable': str(exe)}, ()), exe)

    def test_executable_discovery_supports_dat_shards(self):
        source=fixture(self.root/'DAT'/'DAT0'/'nested.cmf',[('one.txt',b'asset',0)])
        self.catalog.scan([source])
        exe=self.root/'CW.EXE';exe.write_bytes(b'exe')
        self.assertEqual(executable_path(self.catalog,{},()),exe)

    def test_http_retry_and_option_validation(self):
        server = create_server(self.catalog)
        thread = threading.Thread(target=server.serve_forever, daemon=True);thread.start()
        try:
            base = f'http://127.0.0.1:{server.server_port}'
            token = re.search(r'name="explorer-token" content="([^"]+)"', urlopen(base).read().decode())[1]
            def request(options, auth=token):
                return urlopen(Request(base+'/api/postprocess', data=json.dumps({'postprocess':options}).encode(),
                                      headers={'X-Explorer-Token':auth,'Content-Type':'application/json'}))
            with self.assertRaises(HTTPError) as error:request({name: 'bad' for name in ['enabled']})
            self.assertEqual(error.exception.code, 400)
            with self.assertRaises(HTTPError) as error:request({}, 'bad')
            self.assertEqual(error.exception.code, 403)
            with patch('closers.postprocess.STEPS', ()):
                with request({}) as response:self.assertEqual(response.status, 200)
                # Wait for the server's worker using its state endpoint.
                for _ in range(100):
                    with urlopen(Request(base+'/api/state',headers={'X-Explorer-Token':token})) as response:state=json.load(response)
                    if not state['job']['running']:break
                self.assertEqual(state['job']['status'], 'completed')
        finally:
            server.shutdown();thread.join(5);server.server_close()

    def test_cancel_during_postprocess_keeps_extraction_and_blocks_other_jobs(self):
        entered, release = threading.Event(), threading.Event()
        def blocking(catalog, options, paths, cancel, progress):
            entered.set()
            release.wait(5)
            progress(current='취소 확인')
            raise AssertionError('cancel must stop the step')
        jobs = Jobs(self.catalog)
        with patch('closers.postprocess.STEPS', (Step('blocking','대기',blocking),)):
            jobs.start('process', dict(paths=[str(self.source)], output=str(self.output), postprocess={'enabled':True}))
            try:
                self.assertTrue(entered.wait(5))
                self.assertEqual(jobs.snapshot()['phase'], 'postprocess')
                with self.assertRaises(ValueError):jobs.start('scan', {'paths':[str(self.source)]})
                jobs.cancel.set()
            finally:
                release.set()
            state = self.finish(jobs)
        self.assertEqual(state['status'], 'cancelled')
        self.assertEqual(state['result']['done'], 1)
        self.assertTrue(self.catalog.entries({})['items'][0]['saved_exists'])
