import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest

from closers.catalog import Catalog
from closers.model import parse_x,parse_xmd,bind_mapping,IDENTITY
from closers.model_library import Models
from test_explorer import fixture
from test_model import animation,binary_model,varint,wide


def legacy_motion():
    body=struct.pack('<I',2)+varint(1)+wide('MOVE')*2+struct.pack('<f',1)+b'\x01\x80'+varint(2)
    for time,x in [(0,5),(.5,6)]:
        body+=struct.pack('<f',time)+varint(2)+struct.pack('<20f',
            0,0,0,1,1,1,1,x,0,0,0,0,0,1,1,1,1,0,0,0)
    return body


class MotionRecoveryTests(unittest.TestCase):
    def test_animated_default_still_requires_complete_time_zero_pose_and_valid_later_keys(self):
        scene=parse_x(binary_model());motion=parse_xmd(animation())
        motion['retained'][0]['keys'][1]['transforms'][0][7]=6
        mapping=bind_mapping(scene,motion)
        self.assertTrue(mapping['animated_default']);self.assertEqual(mapping['verified_bones'],2)
        self.assertEqual(mapping['validated_default_keys'],2)
        invalid=copy.deepcopy(motion);invalid['retained'][0]['keys'][0]['transforms'][0][7]=8
        with self.assertRaises(ValueError):bind_mapping(scene,invalid)
        invalid=copy.deepcopy(motion);invalid['retained'][0]['keys'][1]['transforms'][0][3]=.5
        with self.assertRaises(ValueError):bind_mapping(scene,invalid)
        invalid=copy.deepcopy(motion);invalid['retained'][0]['keys'][0]['time']=.1
        with self.assertRaises(ValueError):bind_mapping(scene,invalid)

    def helper_scene(self,collision=False):
        scene=parse_x(binary_model());helper='COLLISION_SPHERE_HEAD' if collision else 'BIP01_FOOTSTEPS'
        scene['frames'].append(dict(name=helper,parent=0,matrix=IDENTITY.copy()))
        if collision:
            scene['frames'].append(dict(name='WSM_COLLISION_SPHERE_HEAD',parent=2,matrix=IDENTITY.copy()))
            scene['meshes'].append(dict(name='COLLISION_SPHERE_HEAD_MC',frame=3,skin=[]))
        return scene

    def helper_motion(self,scene):
        transforms=[]
        for f in sorted(scene['frames'],key=lambda f:f['name']):
            x=100 if f['name'] in ('BIP01_FOOTSTEPS','COLLISION_SPHERE_HEAD') else 5 if f['name']=='CHILD' else 0
            transforms.append([0,0,0,1,1,1,1,x,0,0])
        return dict(bones=len(transforms),retained=[dict(keys=[dict(time=0,scale_count=len(transforms),transforms=transforms)])])

    def test_utility_exception_requires_isolated_unskinned_helper_subtree(self):
        for collision in (False,True):
            scene=self.helper_scene(collision);motion=self.helper_motion(scene)
            mapping=bind_mapping(scene,motion)
            self.assertEqual(len(mapping['utility_pose_differences']),1)
            self.assertLessEqual(mapping['maximum_error'],.005)
            used=copy.deepcopy(scene);used['meshes'][0]['skin'].append(dict(bone=used['frames'][2]['name']))
            with self.assertRaises(ValueError):bind_mapping(used,motion)
        scene=self.helper_scene();scene['frames'].append(dict(name='HAND',parent=2,matrix=IDENTITY.copy()))
        with self.assertRaises(ValueError):bind_mapping(scene,self.helper_motion(scene))
        scene=self.helper_scene(True);scene['meshes'][-1]['name']='BODY_GEOMETRY'
        with self.assertRaises(ValueError):bind_mapping(scene,self.helper_motion(scene))

    def test_legacy_layout_and_exact_companion_first_pose(self):
        body=legacy_motion();metadata=parse_xmd(body,selected=0)
        self.assertEqual(metadata['version'],0);self.assertEqual(metadata['bones'],2)
        self.assertEqual(metadata['retained'][0]['keys'][1]['transforms'][0][7],6)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            catalog.scan([fixture(root/'one.cmf',[('RIG.X',binary_model(),0),('RIG.XMD',body,0),('OTHER.XMD',body,0)])])
            ids={r['name']:r['id'] for r in catalog.entries({})['items']};models=Models(catalog)
            result=models.animations(ids['RIG.X'],ids['RIG.XMD'])
            self.assertEqual(result['mapping']['method'],'alphabetical/verified-clip-start/direct-coordinates')
            clip=models.clip(ids['RIG.X'],ids['RIG.XMD'],0,result['animation_source']['sha256'])
            self.assertEqual(len(clip['keys']),2)
            library=models.motion_library(ids['RIG.X'],[])
            self.assertEqual(next(f for f in library['files'] if f['id']==ids['RIG.XMD'])['status'],'ready')
            with self.assertRaises(ValueError):models.animations(ids['RIG.X'],ids['OTHER.XMD'])
            from closers.model_catalog import build
            report=build(catalog)
            self.assertEqual(report['legacy_xmd_files'],2)
            self.assertEqual(report['parse_unavailable'],0)
            files=json.loads(Path(report['report']).read_text(encoding='utf-8'))['files']
            self.assertTrue(all(f['xmd_version']==0 for f in files if f['format']=='xmd'))

    def test_malformed_legacy_counts_truncation_and_trailing_bytes_are_rejected(self):
        for body in (legacy_motion()[:-1],legacy_motion()+b'junk',struct.pack('<I',2)+varint(0),
                     legacy_motion().replace(struct.pack('<f',0)+varint(2),struct.pack('<f',0)+varint(1),1)):
            with self.subTest(length=len(body)),self.assertRaises(ValueError):parse_xmd(body,selected=0)
