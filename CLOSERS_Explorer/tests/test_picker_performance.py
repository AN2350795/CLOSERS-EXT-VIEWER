from pathlib import Path
import re
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request,urlopen

from closers.catalog import Catalog
from closers.server import create_server
import test_avatar_types
from test_composition import png
from test_explorer import fixture


class PickerQueryTests(unittest.TestCase):
    setUp=test_avatar_types.AvatarTypeTests.setUp

    def test_one_connection_and_indexed_exact_icon_queries_preserve_types(self):
        statements=[];original=self.catalog.open_connection
        def opened():
            db=original();db.set_trace_callback(statements.append);return db
        with patch.object(self.catalog,'open_connection',side_effect=opened) as connections:
            result=self.models.groups.browse(dict(character='STRIKER',items='1',mode='parts'))
        self.assertEqual(connections.call_count,1)
        self.assertEqual(result['total'],5)
        self.assertEqual(len({r['preview_entry'] for r in result['items']}),5)
        query=next(s for s in statements if 'INDEXED BY idx_entry_name_nocase' in s)
        with self.catalog.connect() as db:
            plans=[r[3] for r in db.execute('EXPLAIN QUERY PLAN '+query)]
        self.assertTrue(any('SEARCH' in p and 'idx_entry_name_nocase' in p for p in plans),plans)
        # Saved-state filters are evaluated on each request, not frozen in a page cache.
        self.assertEqual(self.models.groups.browse(dict(character='STRIKER',items='1',mode='parts',saved='existing'))['total'],0)
        row=self.catalog.get(result['items'][0]['id']);saved=self.root/'saved.X';saved.write_bytes(b'model')
        with self.catalog.connect() as db:db.execute('UPDATE entries SET output=? WHERE id=?',(str(saved),row['id']))
        self.assertEqual(self.models.groups.browse(dict(character='STRIKER',items='1',mode='parts',saved='existing'))['total'],0)
        # A proper catalog revision exposes the newly registered output.
        with self.catalog.connect() as db:self.catalog.changed(db)
        self.assertEqual(self.models.groups.browse(dict(character='STRIKER',items='1',mode='parts',saved='existing'))['total'],5)
        saved.unlink()
        self.assertEqual(self.models.groups.browse(dict(character='STRIKER',items='1',mode='parts',saved='existing'))['total'],0)


class PickerMediaTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.catalog=Catalog(self.root/'work');self.body=png(2,2)
        self.source=fixture(self.root/'icons.cmf',[('icon.PNG',self.body,0)])
        self.catalog.scan([self.source]);self.server=create_server(self.catalog)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.close)
        self.base=f'http://127.0.0.1:{self.server.server_port}'
        page=urlopen(self.base+'/model').read().decode()
        self.token=re.search(r'name="explorer-token" content="([^"]+)"',page)[1]

    def close(self):
        self.server.shutdown();self.server.server_close();self.thread.join()

    def get(self,**headers):
        return urlopen(Request(self.base+'/api/media/1',headers={'X-Explorer-Token':self.token,**headers}))

    def test_thumbnail_bytes_need_no_name_refresh_and_revalidate_before_304(self):
        with patch.object(self.catalog.game_names,'refresh',side_effect=AssertionError('names on media path')):
            with self.get() as response:
                self.assertEqual(response.read(),self.body);etag=response.headers['ETag']
                self.assertEqual(response.headers['Cache-Control'],'private, no-cache')
            with self.assertRaises(HTTPError) as cached:self.get(**{'If-None-Match':etag})
            self.assertEqual(cached.exception.code,304)
            with self.get(Range='bytes=0-7') as response:
                self.assertEqual(response.status,206);self.assertEqual(response.read(),self.body[:8])
            with self.assertRaises(HTTPError) as denied:
                self.get(**{'X-Explorer-Token':'wrong','If-None-Match':etag})
            self.assertEqual(denied.exception.code,403)
            self.source.write_bytes(self.source.read_bytes()+b'changed')
            with self.assertRaises(HTTPError) as changed:self.get(**{'If-None-Match':etag})
            self.assertNotEqual(changed.exception.code,304)

    def test_saved_image_edit_invalidates_etag_without_changing_source(self):
        self.catalog.process([self.source],self.root/'assets')
        with self.get() as response:etag=response.headers['ETag'];response.read()
        saved=Path(self.catalog.get(1)['output']);other=png(2,2,lambda x,y:(255,255,0,255))
        self.assertEqual(len(other),len(self.body));saved.write_bytes(other)
        with self.get(**{'If-None-Match':etag}) as response:
            self.assertEqual(response.status,200);self.assertNotEqual(response.headers['ETag'],etag)
            self.assertEqual(response.read(),other)
