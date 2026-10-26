import tempfile
from pathlib import Path
import struct
import unittest
import json
import re
import threading
import urllib.request
import urllib.error
from closers.model import parse_x
from closers.model_x_animation import embedded_clip
from closers.catalog import Catalog
from closers.model_library import Models
from test_explorer import fixture
from test_model import binary_model,obj,name,numbers


def animated_model(target='CHILD',kind=2,width=3):
    keys=numbers([kind,2,0,width])+numbers([5,0,0] if width==3 else [.70710678,-.70710678,0,0],True)
    keys+=numbers([4800,width])+numbers([7,0,0] if width==3 else [1,0,0,0],True)
    ref=struct.pack('<H',10)+name(target)+struct.pack('<H',11)
    return binary_model()+obj('AnimTicksPerSecond',numbers([4800]))+obj('AnimationSet',obj('Animation',ref+obj('AnimationKey',keys)),'BOX_LOOP')


class EmbeddedAnimationTests(unittest.TestCase):
    def test_named_channels_timing_and_rotation_convention(self):
        body=animated_model();scene=parse_x(body);packet=embedded_clip(body,scene['frames'],'BOX_LOOP')
        self.assertEqual(packet['clip']['duration'],1)
        self.assertEqual(packet['tracks'][0]['frame'],1)
        self.assertEqual(packet['tracks'][0]['keys'][1],dict(time=1,value=[7,0,0]))
        body=animated_model(kind=0,width=4);packet=embedded_clip(body,parse_x(body)['frames'],'BOX_LOOP')
        self.assertAlmostEqual(packet['tracks'][0]['keys'][0]['value'][0],2**-.5)
        self.assertAlmostEqual(packet['tracks'][0]['keys'][0]['value'][3],2**-.5)
        for body,label in [(animated_model(target='OTHER'),'BOX_LOOP'),(animated_model(),'OTHER'),(animated_model(kind=99),'BOX_LOOP')]:
            with self.assertRaises(ValueError):embedded_clip(body,parse_x(body)['frames'],label)

    def test_same_source_hash_is_required(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work');catalog.scan([fixture(root/'models.cmf',[('BOX.X',animated_model(),0)])])
            models=Models(catalog);entry=catalog.entries({})['items'][0]['id'];scene=models.scene([entry]);sha=scene['skeleton_source']['sha256']
            packet=models.effect_embedded_clip(entry,'BOX_LOOP',sha)
            self.assertEqual(packet['skeleton_source']['sha256'],sha)
            packet['tracks'].clear()
            self.assertTrue(models.effect_embedded_clip(entry,'BOX_LOOP',sha)['tracks'])
            with self.assertRaises(ValueError):models.effect_embedded_clip(entry,'BOX_LOOP','wrong')

            from closers.server import create_server
            server=create_server(catalog,0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                base=f'http://127.0.0.1:{server.server_port}'
                with urllib.request.urlopen(base+'/model') as response:
                    token=re.search(r'name="explorer-token" content="([^"]+)"',response.read().decode()).group(1)
                url=base+f'/api/model-effect-clip?skeleton={entry}&name=BOX_LOOP&sha256={sha}'
                with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(url)
                self.assertEqual(error.exception.code,403)
                request=urllib.request.Request(url,headers={'X-Explorer-Token':token})
                with urllib.request.urlopen(request) as response:packet=json.load(response)
                self.assertEqual(packet['tracks'][0]['property'],'position')
            finally:server.shutdown();server.server_close();thread.join()
