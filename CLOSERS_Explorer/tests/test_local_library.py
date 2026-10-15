import errno
import json
from pathlib import Path
import re
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from test_explorer import fixture
from closers.catalog import Catalog
from closers.library import PreservationLinks
from closers.server import create_server, Jobs, reveal_saved_file


class LocalLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.catalog = Catalog(self.root/'work')
        self.output = self.root/'assets'

    def tearDown(self):
        self.temp.cleanup()

    def test_duplicate_names_and_content_keep_all_sources_and_files(self):
        a=fixture(self.root/'a.cmf',[('same.txt',b'one',0),('alias.txt',b'one',0)])
        b=fixture(self.root/'b.cmf',[('same.txt',b'two',1)])
        self.catalog.scan([a,b]);self.catalog.extract(self.output)
        rows=self.catalog.entries({})['items']
        self.assertEqual(len(rows),3)
        self.assertEqual(len({r['output'] for r in rows}),3)
        by_name=self.catalog.entries({'duplicate':'name'})
        self.assertEqual([r['name'] for r in by_name['items']],['same.txt','same.txt'])
        by_content=self.catalog.entries({'duplicate':'content'})
        self.assertEqual({r['name'] for r in by_content['items']},{'same.txt','alias.txt'})
        Path(rows[0]['output']).unlink()
        self.assertFalse(self.catalog.get(rows[0]['id'])['saved_exists'])
        # Recorded-path filtering does not pretend to check every file on disk.
        self.assertEqual(self.catalog.entries({'saved':'recorded'})['total'],3)

    def test_failure_stage_and_uncategorized_extraction(self):
        a=fixture(self.root/'a.cmf',[('ok.unknown',b'custom',0),('bad.lua',b'body',1,b'YWJjZGVm')])
        self.catalog.scan([a]);result=self.catalog.extract(self.output)
        self.assertEqual(result['failed'],1)
        rows={r['name']:r for r in self.catalog.entries({})['items']}
        self.assertEqual(rows['ok.unknown']['category'],'other')
        self.assertTrue(rows['ok.unknown']['saved_exists'])
        bad=rows['bad.lua']
        self.assertEqual((bad['error_stage'],bad['issue']['stage']),('decode','decode'))
        self.assertIn('미지원',bad['issue']['reason'])
        self.assertIn('저장 바이트',bad['issue']['action'])
        with patch('closers.catalog.publish_output',side_effect=OSError(errno.ENOSPC,'no space left')):
            other=self.catalog.extract(self.root/'new-output',{'ids':[rows['ok.unknown']['id']]})
        self.assertEqual(other['failed'],1)
        updated=self.catalog.get(rows['ok.unknown']['id'])
        self.assertEqual((updated['error_stage'],updated['issue']['kind']),('write','space'))
        a.unlink();self.catalog.extract(self.output,{'ids':[bad['id']]})
        self.assertEqual(self.catalog.get(bad['id'])['error_stage'],'source')

    def test_known_scope_outside_policy_and_immutable_job_arguments(self):
        a=fixture(self.root/'a.cmf',[('ok.txt',b'ok',0),('other.zzz',b'x',0),('secret.txt',b'secret',2)])
        self.catalog.scan([a])
        result=self.catalog.extract(self.output,{'category':'scripts'})
        self.assertEqual((result['done'],result['outside_scope'],result['encrypted']),(1,2,0))
        result=self.catalog.process([a],self.output,{'category':'scripts'})
        self.assertEqual(result['outside_scope'],2)
        entered,release=threading.Event(),threading.Event()
        actual=self.catalog.extract
        def blocking(*args,**kwargs):
            entered.set();release.wait(5);return actual(*args,**kwargs)
        jobs=Jobs(self.catalog)
        args={'output':str(self.output),'filters':{'category':'scripts'}}
        with patch.object(self.catalog,'extract',side_effect=blocking):
            jobs.start('extract',args);self.assertTrue(entered.wait(5))
            args['filters']['category']='encrypted'
            self.assertEqual(jobs.snapshot()['scope']['filters']['category'],'scripts')
            release.set();jobs.thread.join(10)
        self.assertFalse(jobs.thread.is_alive())
        self.assertEqual(jobs.snapshot()['result']['done'],1)
        self.assertIn('범위 밖 2개',jobs.snapshot()['current'])
        self.assertIn('실패 아님',jobs.snapshot()['current'])

    def test_preservation_link_is_read_only_and_checks_source_identity(self):
        a=fixture(self.root/'a.cmf',[('bad.lua',b'body',1,b'YWJjZGVm')])
        self.catalog.scan([a]);self.catalog.extract(self.output)
        row=self.catalog.get(self.catalog.entries({})['items'][0]['id'])
        destination=self.root/'stored';self.catalog.preserve(destination)
        before=(destination/'preservation.sqlite3').read_bytes()
        links=PreservationLinks(self.catalog.workspace);links.register(destination)
        linked=links.matches(row)
        self.assertEqual(len(linked),1);self.assertTrue(linked[0]['current']);self.assertTrue(linked[0]['exists'])
        self.assertEqual(self.catalog.get(row['id'])['status'],'error')
        self.assertEqual((destination/'preservation.sqlite3').read_bytes(),before)
        self.assertFalse(links.matches(dict(row,archive_mtime=row['archive_mtime']+1))[0]['current'])
        Path(linked[0]['output']).unlink()
        self.assertFalse(links.matches(row)[0]['exists'])
        self.assertEqual(len(PreservationLinks(self.catalog.workspace).matches(row)),1)

    def test_file_reveal_uses_recorded_existing_file(self):
        path=self.root/'한글.dat';path.write_bytes(b'payload')
        with patch('closers.server.subprocess.Popen') as launch:
            self.assertEqual(reveal_saved_file({'output':str(path)}),str(path))
            self.assertEqual(launch.call_args.args[0],['explorer.exe','/select,',str(path.resolve())])
            with self.assertRaises(ValueError):reveal_saved_file({'output':None})
            self.assertEqual(launch.call_count,1)

    def test_http_original_download_offline_auth_and_preserved_bytes(self):
        dds=b'DDS '+bytes(124)
        a=fixture(self.root/'a.cmf',[('폴더/한글.DDS',dds,1),('bad.lua',b'body',1,b'YWJjZGVm'),('secret.txt',b'raw',2)])
        self.catalog.scan([a]);self.catalog.extract(self.output)
        rows={r['name']:r for r in self.catalog.entries({})['items']}
        bad=rows['bad.lua'];self.catalog.preserve(self.root/'stored',{'ids':[bad['id']]})
        server=create_server(self.catalog);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        try:
            html=urlopen(base).read().decode();token=re.search(r'name="explorer-token" content="([^"]+)"',html)[1]
            def request(path,payload=None,auth=True):
                return urlopen(Request(base+path,data=json.dumps(payload).encode() if payload is not None else None,
                    headers={'X-Explorer-Token':token if auth else 'bad','Content-Type':'application/json'}))
            with request('/api/register-preservation',{'path':str(self.root/'stored')}) as response:
                self.assertEqual(response.status,200)
            with request('/api/info/'+str(bad['id'])) as response:
                info=json.load(response)
            self.assertEqual(info['issue']['stage'],'decode')
            self.assertEqual(info['preview_issue']['stage'],'preview')
            self.assertTrue(info['preservations'][0]['exists'])
            with request(f"/api/download/{bad['id']}?kind=stored") as response:
                self.assertEqual(response.read(),b'YWJjZGVm')
            with self.assertRaises(HTTPError) as error:
                request(f"/api/download/{bad['id']}?kind=stored&catalog=unknown")
            self.assertEqual(error.exception.code,400)
            original=rows['폴더/한글.DDS'];a.unlink()
            with patch('closers.server.Media.file',side_effect=AssertionError('preview must not be used')):
                with request(f"/api/download/{original['id']}") as response:
                    self.assertEqual(response.read(),dds)
                    self.assertIn(quote('한글.DDS'),response.headers['Content-Disposition'])
            with request('/api/info/'+str(original['id'])) as response:
                info=json.load(response)
            self.assertIsNone(info['preview_error']);self.assertTrue(info['saved_exists'])
            with self.assertRaises(HTTPError) as error:request(f"/api/download/{original['id']}",auth=False)
            self.assertEqual(error.exception.code,403)
            with self.assertRaises(HTTPError) as error:request(f"/api/download/{rows['secret.txt']['id']}")
            self.assertEqual(error.exception.code,400)
            Path(original['output']).unlink()
            with self.assertRaises(HTTPError) as error:request(f"/api/download/{original['id']}")
            self.assertEqual(error.exception.code,400)
        finally:
            server.shutdown();thread.join(5);server.server_close()


if __name__=='__main__':unittest.main()
