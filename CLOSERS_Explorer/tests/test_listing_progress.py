import json
from pathlib import Path
import re
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request,urlopen

from closers.catalog import Catalog
from closers.listing_progress import report,reporting,rows,locked,batch
from closers.server import create_server
from test_explorer import fixture
from test_model import binary_model


class ListingProgressTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.catalog=Catalog(self.root/'work')
        self.catalog.scan([fixture(self.root/'one.cmf',[('MOTION_STRIKER.X',binary_model(),0)])])
        self.server=create_server(self.catalog)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.close)
        self.base=f'http://127.0.0.1:{self.server.server_port}'
        self.token=re.search('name="explorer-token" content="([^"]+)"',urlopen(self.base+'/model').read().decode()).group(1)

    def close(self):
        self.server.shutdown();self.server.server_close();self.thread.join(3)

    def request(self,path,token=None):
        return urlopen(Request(self.base+path,headers={'X-Explorer-Token':self.token if token is None else token}),timeout=5)

    def test_stream_reports_real_counts_and_preserves_ordinary_api_and_auth(self):
        with self.request('/api/model-browser?mode=files') as response:normal=json.load(response)
        with self.request('/api/model-browser?mode=files&progress=1') as response:
            self.assertIn('application/x-ndjson',response.headers['Content-Type'])
            packets=[json.loads(line) for line in response if line.strip()]
        self.assertEqual(packets[-1]['result'],normal)
        measured=[p['progress'] for p in packets if 'progress' in p and p['progress']['total']==1]
        self.assertTrue(any(p['done']==1 for p in measured))
        with self.assertRaises(HTTPError) as denied:self.request('/api/model-browser?progress=1','wrong')
        self.assertEqual(denied.exception.code,403)
        with self.request('/model-list-progress.js') as response:self.assertEqual(response.status,200)

    def test_stream_delivers_progress_before_result_and_errors_remain_readable(self):
        entered=threading.Event();release=threading.Event()
        def load(_,filters):
            report('items','정보 연결 중',12,18);entered.set();release.wait(3)
            raise ValueError('원본 확인 필요')
        with patch('closers.model_groups.ModelGroups.browse',load):
            with self.request('/api/model-browser?progress=1') as response:
                first=json.loads(response.readline());second=json.loads(response.readline())
                self.assertEqual(first['progress']['stage'],'starting')
                self.assertEqual(second['progress']['done'],12)
                self.assertTrue(entered.wait(1));release.set()
                final=json.loads(response.readline());self.assertEqual(final['error'],'원본 확인 필요')

    def test_client_disconnect_stops_work_at_a_progress_checkpoint(self):
        entered=threading.Event();finished=threading.Event();count=[]
        def load(_,filters):
            entered.set()
            try:
                for value in rows(range(20000),'items','항목 연결 중'):
                    count.append(value);time.sleep(.001)
                return dict(items=[],total=0)
            finally:finished.set()
        with patch('closers.model_groups.ModelGroups.browse',load):
            stream=socket.create_connection(('127.0.0.1',self.server.server_port),timeout=3)
            message=f'GET /api/model-browser?progress=1 HTTP/1.0\r\nHost: 127.0.0.1:{self.server.server_port}\r\nX-Explorer-Token: {self.token}\r\n\r\n'
            stream.sendall(message.encode());self.assertTrue(entered.wait(3))
            stream.shutdown(socket.SHUT_RDWR);stream.close()
            self.assertTrue(finished.wait(3),'disconnected listing kept processing')
            self.assertLess(len(count),20000)

    def test_thread_local_counts_do_not_cross_and_failed_lock_writes_release_waiter(self):
        found=[[],[]];barrier=threading.Barrier(2)
        def work(index):
            with reporting(found[index].append):
                barrier.wait(2);list(rows(range(index+2),'items',str(index)))
        workers=[threading.Thread(target=work,args=(i,)) for i in range(2)]
        for worker in workers:worker.start()
        for worker in workers:worker.join(3)
        self.assertTrue(all(not w.is_alive() for w in workers))
        self.assertEqual(found[0][-1]['done'],2);self.assertEqual(found[1][-1]['done'],3)
        lock=threading.Lock();lock.acquire()
        def disconnected(packet):
            if packet['stage']=='waiting':raise BrokenPipeError()
        with self.assertRaises(BrokenPipeError),reporting(disconnected):
            with locked(lock):pass
        lock.release()
        with locked(lock):pass

    def test_batches_and_unknown_totals_do_not_fabricate_overall_percentages(self):
        events=[]
        with reporting(events.append):
            with batch(2,3):list(rows(range(2),'names','명칭 연결'))
            report('cache','캐시 확인')
        self.assertEqual(events[-2]['batch'],dict(index=2,total=3))
        self.assertEqual(events[-2]['done'],2)
        self.assertIsNone(events[-1]['batch']);self.assertIsNone(events[-1]['total'])
