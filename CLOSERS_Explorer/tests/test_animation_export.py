from io import BytesIO
import re
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zlib

from PIL import Image
from closers.animation_export import AnimationExport, encode_webp
from closers.catalog import Catalog
from closers.server import create_server
from test_composition import png


def apng(colors, fps=25):
    def chunk(kind,data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
    result=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',4,4,8,6,0,0,0))+chunk(b'acTL',struct.pack('>II',len(colors),0))
    sequence=0
    for i,color in enumerate(colors):
        result+=chunk(b'fcTL',struct.pack('>IIIIIHHBB',sequence,4,4,0,0,1,fps,0,0));sequence+=1
        image=png(4,4,lambda x,y:color);offset=8;compressed=b''
        while offset<len(image):
            size=struct.unpack_from('>I',image,offset)[0]
            if image[offset+4:offset+8]==b'IDAT': compressed+=image[offset+8:offset+8+size]
            offset+=size+12
        if not i: result+=chunk(b'IDAT',compressed)
        else: result+=chunk(b'fdAT',struct.pack('>I',sequence)+compressed);sequence+=1
    return result+chunk(b'IEND',b'')


class AnimationExportTests(unittest.TestCase):
    def test_lossless_color_alpha_replacement_and_duplicate_frames(self):
        colors=[(255,0,0,255),(0,240,30,128),(0,0,0,0),(0,0,0,0),(10,20,255,64)]
        data=encode_webp(apng(colors))
        with Image.open(BytesIO(data)) as image:
            self.assertEqual(image.format,'WEBP');self.assertEqual(image.n_frames,len(colors))
            self.assertEqual(image.info['loop'],0)
            for i,color in enumerate(colors):
                image.seek(i);image.load()
                self.assertEqual(image.convert('RGBA').getpixel((2,2)),color)
                self.assertEqual(image.info['duration'],40)

    def test_fractional_frame_durations_keep_total_time(self):
        data=encode_webp(apng([(255,0,0,255)]*60,60))
        with Image.open(BytesIO(data)) as image:
            durations=[]
            self.assertEqual(image.n_frames,60)
            for i in range(image.n_frames):
                image.seek(i);image.load();durations.append(image.info['duration'])
            self.assertEqual(sum(durations),1000)
            self.assertEqual(set(durations),{16,17})

    def test_limits_and_lock_release(self):
        for body in (b'bad',png(4,4),apng([(1,2,3,255)]*251)):
            with self.assertRaises(ValueError): encode_webp(body)
        with patch('closers.animation_export.MAX_TOTAL_PIXELS',16):
            with self.assertRaises(ValueError): encode_webp(apng([(1,2,3,255)]*2))
        exporter=AnimationExport()
        exporter.gate.acquire()
        with self.assertRaisesRegex(ValueError,'다른 애니메이션'): exporter.webp(b'bad')
        exporter.gate.release()
        with self.assertRaises(ValueError): exporter.webp(b'bad')
        self.assertTrue(exporter.gate.acquire(blocking=False));exporter.gate.release()

    def test_binary_endpoint_auth_and_payload_limits(self):
        with tempfile.TemporaryDirectory() as temp:
            server=create_server(Catalog(temp));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base=f'http://127.0.0.1:{server.server_port}'
            try:
                token=re.search(r'name="explorer-token" content="([^"]+)"',urlopen(base+'/compose').read().decode())[1]
                body=apng([(255,0,0,255),(0,0,255,128)])
                def post(auth=token,mime='image/apng',data=body,extra=None):
                    return urlopen(Request(base+'/api/composition-animation/webp',data=data,headers={'X-Explorer-Token':auth,'Content-Type':mime,**(extra or {})}))
                with post() as response:
                    self.assertEqual(response.headers['Content-Type'],'image/webp')
                    with Image.open(BytesIO(response.read())) as image:self.assertEqual(image.n_frames,2)
                for args,status in [({'auth':'wrong'},403),({'mime':'application/json'},400),({'extra':{'Origin':'https://example.com'}},403),({'extra':{'Content-Length':str(128*1024*1024+1)}},400)]:
                    with self.assertRaises(HTTPError) as error:post(**args)
                    self.assertEqual(error.exception.code,status)
            finally:server.shutdown();thread.join(5);server.server_close()
