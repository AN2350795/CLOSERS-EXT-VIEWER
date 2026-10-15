import json
from pathlib import Path
import re
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request,urlopen

from test_explorer import fixture
from closers.catalog import Catalog,file_hash
from closers.cmf import Archive,Cancelled
from closers.reports import ensure_report
from closers.server import create_server,Jobs
from closers.updates import compare,history,history_file


class Stage2Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.catalog = Catalog(self.root / 'work')
        self.output = self.root / 'assets'

    def tearDown(self):
        self.temp.cleanup()

    def test_decode_failure_cache_force_and_decoder_invalidation(self):
        source = fixture(self.root / 'bad.cmf',[('bad.lua',b'body',1,b'YWJjZGVm')])
        self.catalog.scan([source])
        with patch.object(Archive,'chunks',side_effect=AssertionError('cached failure must not decode')):
            result = self.catalog.extract(self.output)
        self.assertEqual((result['failed'],result['cached_failures']),(1,1))
        before = self.catalog.get(1)
        result = self.catalog.extract(self.output,retry_errors=True)
        self.assertEqual((result['failed'],result['cached_failures']),(1,0))
        self.assertEqual(self.catalog.get(1)['error_attempts'],before['error_attempts']+1)
        with patch('closers.catalog.PARSER_VERSION',999):
            self.assertEqual(self.catalog.extract(self.output)['cached_failures'],0)
        self.assertEqual(self.catalog.extract(self.output)['cached_failures'],0) # previous decoder key invalid
        fixture(source,[('bad.lua',b'fixed',1)])
        self.catalog.scan([source])
        self.assertEqual(self.catalog.extract(self.output)['failed'],0)
        self.assertEqual(Path(self.catalog.entries({})['items'][0]['output']).read_bytes(),b'fixed')

    def test_transient_write_and_source_failures_are_never_cached(self):
        source = fixture(self.root / 'good.cmf',[('a.bin',b'abcd',1)])
        self.catalog.scan([source])
        original = Path.open
        def deny(path,*args,**kwargs):
            if str(path).endswith('.partial'):
                raise OSError(28,'disk full')
            return original(path,*args,**kwargs)
        with patch('pathlib.Path.open',new=deny):
            self.assertEqual(self.catalog.extract(self.output)['failed'],1)
        self.assertIsNone(self.catalog.get(1)['failure_key'])
        self.assertEqual(self.catalog.extract(self.output)['failed'],0)
        source.unlink()
        self.assertEqual(self.catalog.extract(self.output)['failed'],1)
        self.assertIsNone(self.catalog.get(1)['failure_key'])

    def test_changed_archive_preserves_history_files_and_never_reuses_ids(self):
        source = fixture(self.root / 'a.cmf',[('same.bin',b'old',1),('removed.bin',b'gone',1)])
        self.catalog.process([source],self.output)
        old = self.catalog.entries({})['items']
        archive_id = old[0]['archive_id']
        fixture(source,[('same.bin',b'new bytes',1)])
        self.catalog.scan([source])
        new = self.catalog.entries({})['items'][0]
        self.assertGreater(new['id'],max(row['id'] for row in old))
        self.assertIsNone(new['output'])
        previous = history(self.catalog,archive_id)
        self.assertEqual(previous['total'],2)
        self.assertTrue(all(row['saved_exists'] for row in previous['items']))
        self.catalog.extract(self.output)
        self.assertEqual(Path(self.catalog.get(new['id'])['output']).read_bytes(),b'new bytes')
        for row in old:
            self.assertEqual(file_hash(row['output']),row['sha256'])
        path,name = history_file(self.catalog,previous['items'][0]['history_id'])
        self.assertTrue(path.is_file());self.assertEqual(name,old[0]['name'])

    def test_unchanged_reparse_preserves_id_output_and_hash(self):
        source = fixture(self.root / 'a.cmf',[('a.bin',b'body',1)])
        self.catalog.process([source],self.output)
        old = self.catalog.get(1)
        with patch('closers.catalog.PARSER_VERSION',999):
            self.assertEqual(self.catalog.scan([source])['skipped'],0)
        new = self.catalog.get(1)
        for key in ('id','output','sha256','output_size','output_mtime'):
            self.assertEqual(new[key],old[key])
        self.assertEqual(new['history_count'],0)

    def test_compare_scope_missing_root_and_cancel_are_safe(self):
        source_dir = self.root / 'sources'
        a = fixture(source_dir / 'a.cmf',[('a.bin',b'old',1)])
        gone = fixture(source_dir / 'gone.cmf',[('b.bin',b'old',1)])
        other = fixture(self.root / 'outside.cmf',[])
        self.catalog.scan([source_dir,other])
        fixture(a,[('a.bin',b'new-long',1)]);gone.unlink()
        fixture(source_dir / 'new.cmf',[])
        before = self.catalog.revision()
        result = compare(self.catalog,[source_dir])
        self.assertEqual(result['counts'],dict(added=1,changed=1,missing=1,unchanged=0))
        self.assertEqual(self.catalog.revision(),before)
        report = (self.catalog.workspace / 'update-comparison.json').read_bytes()
        with self.assertRaises(FileNotFoundError):compare(self.catalog,[self.root / 'missing'])
        cancel = threading.Event();cancel.set()
        with self.assertRaises(Cancelled):compare(self.catalog,[source_dir],cancel)
        self.assertEqual((self.catalog.workspace / 'update-comparison.json').read_bytes(),report)
        self.assertEqual(self.catalog.stats()['archives']['count'],3)

    def test_reports_are_lazy_revision_checked_and_failure_atomic(self):
        source = fixture(self.root / 'a.cmf',[('a.bin',b'old',1)])
        jobs = Jobs(self.catalog)
        with patch.object(self.catalog,'export_manifest',side_effect=AssertionError('job must not generate CSV')):
            jobs.start('process',dict(paths=[str(source)],output=str(self.output)))
            jobs.thread.join(5)
        self.assertEqual(jobs.snapshot()['status'],'completed')
        self.assertFalse((self.catalog.workspace / 'catalog.csv').exists())
        path = ensure_report(self.catalog)
        original = path.read_bytes();stamp = path.stat().st_mtime_ns
        with patch.object(self.catalog,'export_manifest',side_effect=AssertionError('reuse current report')):
            self.assertEqual(ensure_report(self.catalog),path)
        self.assertEqual(path.stat().st_mtime_ns,stamp)
        fixture(source,[('new.bin',b'new',1)]);self.catalog.scan([source])
        with patch.object(self.catalog,'export_manifest',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):ensure_report(self.catalog)
        self.assertEqual(path.read_bytes(),original)
        ensure_report(self.catalog)
        self.assertIn('new.bin',path.read_text(encoding='utf-8-sig'))

    def test_parallel_integrity_resume_and_bounded_active_archives(self):
        sources = [fixture(self.root / f'{i}.cmf',[('same.bin',bytes([i])*200000,1)]) for i in range(8)]
        for workers in (1,2,4):
            catalog = Catalog(self.root / f'work{workers}')
            output = self.root / f'assets{workers}'
            active = set();peak = 0;guard = threading.Lock()
            chunks = Archive.chunks
            def tracked(arc,*args,**kwargs):
                nonlocal peak
                with guard:
                    active.add(id(arc));peak = max(peak,len(active))
                try:
                    time.sleep(.002)
                    yield from chunks(arc,*args,**kwargs)
                finally:
                    with guard:active.remove(id(arc))
            with patch.object(Archive,'chunks',new=tracked):
                result = catalog.process(sources,output,workers=workers)
            self.assertEqual((result['done'],result['failed']),(8,0))
            self.assertLessEqual(peak,workers)
            self.assertEqual(catalog.process(sources,output,workers=workers)['skipped'],8)
            rows = catalog.entries({})['items']
            self.assertEqual(len({row['output'] for row in rows}),8)
            for row in rows:self.assertEqual(file_hash(row['output']),row['sha256'])

    def test_parallel_cancel_flushes_completed_results_and_resumes(self):
        sources = [fixture(self.root / f'{i}.cmf',[('a.bin',bytes([i])*300000,1)]) for i in range(10)]
        cancel = threading.Event()
        chunks = Archive.chunks
        counter = 0;guard = threading.Lock()
        def interrupted(arc,entry,event=None,*args,**kwargs):
            nonlocal counter
            for block in chunks(arc,entry,event,*args,**kwargs):
                if event is not None:
                    with guard:
                        counter += 1
                        if counter == 4:cancel.set()
                yield block
        with patch.object(Archive,'chunks',new=interrupted):
            with self.assertRaises(Cancelled):self.catalog.process(sources,self.output,cancel=cancel,workers=4)
        self.assertFalse(list(self.output.rglob('*.partial')))
        result = self.catalog.process(sources,self.output,workers=4)
        self.assertEqual(result['failed'],0)
        self.assertEqual(self.catalog.stats()['statuses']['extracted'],10)

    def test_http_comparison_history_download_auth_and_csv_refresh(self):
        source = fixture(self.root / 'a.cmf',[('a.bin',b'old',1)])
        self.catalog.process([source],self.output)
        fixture(source,[('a.bin',b'new',1)])
        self.catalog.scan([source])
        server = create_server(self.catalog)
        thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            token = re.search(r'name="explorer-token" content="([^"]+)"',urlopen(base).read().decode())[1]
            def request(path,data=None,auth=True):
                return urlopen(Request(base+path,data=json.dumps(data).encode() if data is not None else None,
                                      headers={'X-Explorer-Token':token if auth else 'wrong','Content-Type':'application/json'}))
            previous = json.load(request('/api/history?archive_id=1'))
            self.assertEqual(previous['total'],1)
            endpoint = '/api/history-download/'+str(previous['items'][0]['history_id'])
            self.assertEqual(request(endpoint).read(),b'old')
            with self.assertRaises(HTTPError) as denied:request(endpoint,auth=False)
            self.assertEqual(denied.exception.code,403)
            request('/api/compare',{'paths':[str(self.root)]}).close()
            server.jobs.thread.join(5)
            self.assertEqual(server.jobs.snapshot()['status'],'completed')
            self.assertTrue(json.load(request('/api/update-comparison'))['complete'])
            self.assertIn(b'a.bin',request('/api/manifest').read())
        finally:
            server.shutdown();thread.join(5);server.server_close()


if __name__ == '__main__':unittest.main()
