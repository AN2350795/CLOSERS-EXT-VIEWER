from io import BytesIO
from pathlib import Path
import hashlib
import json
import re
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request,urlopen
import zlib

from test_explorer import fixture
from closers.catalog import Catalog,file_hash
from closers.composition import CompositionImages,resolve_sources
from closers.server import create_server,Media


def png(width,height,pixel=lambda x,y:(255,0,0,255)):
    def chunk(kind,data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    raw=b''.join(b'\0'+bytes(v for x in range(width) for v in pixel(x,y)) for y in range(height))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')


class CompositionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.catalog=Catalog(self.root/'work');self.images=CompositionImages(self.catalog)

    def tearDown(self):self.temp.cleanup()

    def test_native_full_resolution_and_catalog_unmodified(self):
        body=png(4096,2,lambda x,y:(x%256,10,20,255))
        source=fixture(self.root/'a.cmf',[('illustration.PNG',body,1)])
        self.catalog.scan([source]);before=self.catalog.revision();source_hash=file_hash(source)
        path,metadata=self.images.prepare(1)
        self.assertEqual((metadata['width'],metadata['height']),(4096,2))
        self.assertEqual(path.read_bytes(),body)
        self.assertEqual(metadata['image_sha256'],hashlib.sha256(body).hexdigest())
        self.assertEqual(self.catalog.revision(),before);self.assertEqual(file_hash(source),source_hash)
        self.assertIsNone(self.catalog.get(1)['output'])

    def test_native_png_without_pillow(self):
        body=png(3,2)
        self.catalog.scan([fixture(self.root/'a.cmf',[('a.PNG',body,0)])])
        original=__import__
        def optional(name,*args,**kwargs):
            if name=='PIL' or name.startswith('PIL.'):raise ImportError('optional package missing')
            return original(name,*args,**kwargs)
        with patch('builtins.__import__',side_effect=optional):
            path,metadata=self.images.prepare(1)
        self.assertEqual(path.read_bytes(),body);self.assertEqual(metadata['height'],2)

    def test_full_dds_conversion_separate_from_thumbnail(self):
        from PIL import Image
        body=BytesIO();Image.new('RGBA',(4096,4),(12,34,56,200)).save(body,'DDS')
        source=fixture(self.root/'a.cmf',[('frame.DDS',body.getvalue(),1)])
        self.catalog.process([source],self.root/'assets');row=self.catalog.get(1);before=file_hash(row['output'])
        stream,length,mime=Media(self.catalog).file(row)
        with stream,Image.open(stream) as image:self.assertEqual(image.width,2048)
        path,metadata=self.images.prepare(1)
        with Image.open(path) as image:
            self.assertEqual(image.size,(4096,4));self.assertEqual(image.getpixel((3000,1)),(12,34,56,200))
        self.assertEqual(file_hash(row['output']),before)
        self.assertIn('composition-cache',str(path));self.assertEqual(metadata['width'],4096)

    def test_saved_offline_and_edited_content_hash(self):
        first=png(2,2);second=png(2,2,lambda x,y:(0,255,0,255))
        source=fixture(self.root/'a.cmf',[('a.png',first,0)])
        self.catalog.process([source],self.root/'assets');source.unlink()
        path,metadata=self.images.prepare(1);self.assertEqual(path.read_bytes(),first)
        saved=Path(self.catalog.get(1)['output']);saved.write_bytes(second)
        other,current=self.images.prepare(1)
        self.assertNotEqual(current['source_sha256'],metadata['source_sha256'])
        self.assertEqual(other.read_bytes(),second)

    def test_input_limits_corruption_and_encrypted_rejection(self):
        source=fixture(self.root/'a.cmf',[('bad.dds',b'DDS '+bytes(124),0),('secret.png',png(1,1),2),('big.png',png(1,1),0)])
        self.catalog.scan([source])
        with self.assertRaises(Exception):self.images.prepare(1)
        with self.assertRaises(ValueError):self.images.prepare(2)
        with self.catalog.connect() as db:db.execute('UPDATE entries SET size=? WHERE id=3',(64*1024*1024+1,))
        with self.assertRaisesRegex(ValueError,'64 MiB'):self.images.prepare(3)
        with patch('closers.composition.dimensions',return_value=(4096,4097)):
            with self.assertRaisesRegex(ValueError,'픽셀'):self.images.prepare(1)
        self.assertFalse(list(self.images.directory.glob('*.partial')))

    def test_source_resolution_uses_provenance_not_stale_id(self):
        self.catalog.scan([fixture(self.root/'a.cmf',[('a.png',png(1,1),0)]),fixture(self.root/'b.cmf',[('a.png',png(1,1),0)])])
        source=self.images.prepare(2)[1];source['entry_id']=1
        self.assertEqual(resolve_sources(self.catalog,[source]),[2])
        source['name']='missing.png'
        with self.assertRaisesRegex(ValueError,'찾을 수'):resolve_sources(self.catalog,[source])
        with self.assertRaises(ValueError):resolve_sources(self.catalog,[dict(archive='x',name='x',ordinal='0')])
        with self.assertRaises(ValueError):resolve_sources(self.catalog,[])

    def test_oversized_conversion_does_not_accumulate_cache_files(self):
        from PIL import Image
        body=BytesIO();Image.new('RGBA',(2,2),(12,34,56,200)).save(body,'DDS')
        self.catalog.scan([fixture(self.root/'a.cmf',[('frame.dds',body.getvalue(),1)])])
        def oversized(image,path,*args,**kwargs):Path(path).write_bytes(b'x'*400)
        with patch('closers.composition.MAX_BYTES',300),patch.object(Image.Image,'save',new=oversized):
            with self.assertRaisesRegex(ValueError,'변환된'):self.images.prepare(1)
        self.assertFalse(list(self.images.directory.iterdir()))

    def test_http_auth_hash_and_full_original_bytes(self):
        body=png(3,2)
        self.catalog.scan([fixture(self.root/'a.cmf',[('a.png',body,0)])])
        server=create_server(self.catalog);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        try:
            html=urlopen(base+'/compose').read().decode();self.assertIn('PNG 저장',html)
            token=re.search(r'name="explorer-token" content="([^"]+)"',html)[1]
            def request(path,data=None,auth=True):
                return urlopen(Request(base+path,data=json.dumps(data).encode() if data is not None else None,
                                      headers={'X-Explorer-Token':token if auth else 'wrong','Content-Type':'application/json'}))
            metadata=json.load(request('/api/composition-source/1'))
            endpoint='/api/composition-image/1?sha256='+metadata['image_sha256']
            with request(endpoint) as response:
                self.assertEqual(response.read(),body);self.assertEqual(response.headers['Content-Type'],'image/png')
            with self.assertRaises(HTTPError) as denied:request(endpoint,auth=False)
            self.assertEqual(denied.exception.code,403)
            with self.assertRaises(HTTPError) as mismatch:request('/api/composition-image/1?sha256=wrong')
            self.assertEqual(mismatch.exception.code,400)
            self.assertEqual(json.load(request('/api/composition-resolve',{'sources':[metadata]}))['ids'],[1])
        finally:server.shutdown();thread.join(5);server.server_close()


if __name__=='__main__':unittest.main()
