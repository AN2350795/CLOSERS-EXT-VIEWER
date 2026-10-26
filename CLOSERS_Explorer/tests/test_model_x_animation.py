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
from test_model import binary_model,obj,name,numbers,animation,IDENTITY


def animated_model(target='CHILD',kind=2,width=3):
    keys=numbers([kind,2,0,width])+numbers([5,0,0] if width==3 else [.70710678,-.70710678,0,0],True)
    keys+=numbers([4800,width])+numbers([7,0,0] if width==3 else [1,0,0,0],True)
    ref=struct.pack('<H',10)+name(target)+struct.pack('<H',11)
    return binary_model()+obj('AnimTicksPerSecond',numbers([4800]))+obj('AnimationSet',obj('Animation',ref+obj('AnimationKey',keys)),'BOX_LOOP')


class EmbeddedAnimationTests(unittest.TestCase):
    def test_duplicate_matrix_channels_are_bound_by_their_first_local_pose(self):
        shifted=IDENTITY.copy();shifted[12]=5
        def track(matrix):
            ref=struct.pack('<H',10)+name('CHILD')+struct.pack('<H',11)
            return obj('Animation',ref+obj('AnimationKey',numbers([4,1,0,16])+numbers(matrix,True)))
        body=binary_model()+obj('Frame',b'','CHILD')+obj('AnimationSet',track(shifted)+track(IDENTITY),'BOTH')
        scene=parse_x(body);packet=embedded_clip(body,scene['frames'],'BOTH')
        self.assertEqual([t['frame'] for t in packet['tracks']],[1,2])
        scene['frames'][2]['matrix']=shifted.copy()
        with self.assertRaises(ValueError):embedded_clip(body,scene['frames'],'BOTH')
    def test_deleted_helper_channels_do_not_disable_existing_frames(self):
        body=animated_model();missing=animated_model(target='DELETED_HELPER')
        # Put an existing and a deleted frame track in the same AnimationSet.
        start=missing.index(name('Animation')+struct.pack('<H',10))
        body=body[:-2]+missing[start:-2]+body[-2:]
        packet=embedded_clip(body,parse_x(body)['frames'],'BOX_LOOP')
        self.assertEqual(len(packet['tracks']),1)
        self.assertEqual(packet['mapping']['missing_frames'],['DELETED_HELPER'])
        self.assertTrue(packet['warnings'])

    def test_other_pack_in_same_model_family_requires_unique_full_default_match(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            catalog.scan([fixture(root/'models.cmf',[('HELPER.X',binary_model(),0),('HELPER_EMOTION.XMD',animation(),0),('UNRELATED.XMD',animation(),0)])])
            models=Models(catalog);entry=models.matches('HELPER.X')[0]['id'];sha=models.scene([entry])['skeleton_source']['sha256']
            packet=models.effect_clip(entry,'MOVE',sha)
            self.assertEqual(packet['animation_source']['name'],'HELPER_EMOTION.XMD')
            self.assertEqual(packet['keys'][0]['transforms'][0][7],5)
            catalog.scan([fixture(root/'duplicate.cmf',[('HELPER_DUPLICATE.XMD',animation(),0)])])
            with self.assertRaises(ValueError):models.effect_clip(entry,'MOVE',sha)

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
