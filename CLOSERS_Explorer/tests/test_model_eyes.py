import copy
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

from closers import ntf
from closers.catalog import Catalog
from closers.model import parse_x
from closers.model_library import Models
from test_explorer import fixture
from test_game_names import table
from test_model import binary_model
from test_model_groups import avatar


class EyeAvatarTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.catalog=Catalog(self.root/'work');self.models=Models(self.catalog)
        self.face=avatar(costume='BASIC',part='FACE');self.default='BASIC_FACE_EYE.TGA'
        source=fixture(self.root/'assets.cmf',[(self.face,binary_model(self.default),0),
            ('RED.PNG',b'image',0),('BLUE.PNG',b'image',0),('ICON.PNG',b'image',0),
            (avatar(character='CASTER',costume='BASIC',part='FACE'),binary_model(self.default),0)])
        self.catalog.scan([source])
        self.eye=self.models.eyes;self.eye.data.keys=(b'',b'')
        model_types=(5,8,8,8,8)+(12,)*28+(4,8,8)
        def model(ident,ref,owner='GUST_USER_STRIKER'):
            row=[ident,owner,self.face,ref,ref]+[0]*28+[0,'','']
            return row
        self.tables=[('ITEM_MODEL_TEMPLET.NTF',table(model_types,[model(10,'WRONG.XET','GUST_INVALID'),model(10,'RED.XET'),model(11,'BLUE.XET'),model(12,'RED.XET')])),
                     ('ITEM_TEMPLET.NTF',table((8,5,8,8,8,8),[('CVN',10,'RED_NAME','','','ICON.PNG'),('CVN',11,'BLUE_NAME','','','ICON.PNG'),('CVN',12,'RED_NAME','','','ICON.PNG')])),
                     ('STRING_TABLE_ITEM_KOREA.NTF',table((5,8,8),[(1,'RED_NAME','붉은 눈동자'),(2,'BLUE_NAME','푸른 눈동자')]))]
        self.eye._tables=lambda pattern:((name,body) for name,body in self.tables if re.fullmatch(pattern,name))
        self.enterContext(patch('closers.model_eyes.ntf.decrypt',side_effect=lambda body,*args:body))

    def test_shared_face_has_separate_basic_and_item_options(self):
        result=self.eye.browse({'character':'STRIKER'})
        self.assertEqual(result['total'],3)
        self.assertEqual(len({r['key'] for r in result['items']}),3)
        self.assertTrue(result['items'][0]['basic'])
        self.assertEqual({r['texture_name'] for r in result['items'][1:]},{'RED.PNG','BLUE.PNG'})
        self.assertEqual(next(r['item_ids'] for r in result['items'] if r['key']=='STRIKER:10'),[10,12])
        self.assertTrue(all(r['available'] for r in result['items']))
        self.assertEqual(self.eye.browse({'character':'STRIKER','q':'푸른'})['total'],1)
        self.assertEqual(self.eye.browse({'character':'STRIKER','saved':'existing'})['total'],0)
        self.assertEqual(self.eye.browse({'character':'STRIKER','saved':'missing'})['total'],3)
        self.assertEqual({f['value'] for f in result['facets']['part']},{'EYES'})

    def test_eye_scene_changes_eye_atlas_and_basic_restores_original(self):
        eye=next(r for r in self.eye.resources() if r['key']=='STRIKER:10')
        face_id=eye['face_id'];texture_id=eye['texture_id']
        part=parse_x(binary_model(self.default));skin=copy.deepcopy(part['meshes'][0]);skin['name']='FACE_SDF'
        skin['materials'][0]['texture']='BASIC_FACE.TGA';part['meshes'].append(skin)
        with patch('closers.model_library.parse_x',side_effect=lambda body:copy.deepcopy(part)):
            scene=self.models.scene([face_id],eye_key=eye['key'],eye_face=face_id,eye_texture=texture_id)
            self.assertEqual(scene['meshes'][0]['materials'][0]['texture'],'RED.PNG')
            self.assertEqual(scene['meshes'][0]['materials'][0]['image']['selected'],texture_id)
            self.assertEqual(scene['meshes'][1]['materials'][0]['texture'],'BASIC_FACE.TGA')
            self.assertEqual(scene['sources'][0]['display_name'],'붉은 눈동자')
            restored=self.models.scene([face_id],eye_key='STRIKER:basic',eye_face=face_id)
            self.assertEqual(restored['meshes'][0]['materials'][0]['texture'],self.default)
        with self.assertRaises(ValueError):self.models.scene([face_id],eye_key='STRIKER:10',eye_face=face_id,eye_texture=face_id)
        with self.assertRaises(ValueError):self.models.scene([face_id],eye_key='CASTER:basic',eye_face=face_id)
        with self.assertRaises(ValueError):self.models.scene([face_id],eye_key='STRIKER:10',eye_face=999,eye_texture=texture_id)

    def test_duplicate_sources_require_an_explicit_choice(self):
        extra=fixture(self.root/'duplicate.cmf',[('RED.PNG',b'other',0)])
        self.catalog.scan([extra])
        eye=next(r for r in self.eye.resources() if r['key']=='STRIKER:10')
        self.assertIsNone(eye['texture_id']);self.assertEqual(len(eye['texture_candidates']),2)
        with self.assertRaises(ValueError):self.eye.resolve(eye['key'],eye['face_id'])
        self.assertEqual(self.eye.resolve(eye['key'],eye['face_id'],eye['texture_candidates'][1]['id'])['key'],eye['key'])

    def test_two_registered_appearances_are_both_listed(self):
        name,body=self.tables[0];types,_,_=ntf.header(body);rows=list(ntf.rows(body))
        rows[1][4]='BLUE.XET';rows[-1][4]='BLUE.XET'
        self.tables[0]=(name,table(types,rows))
        result=self.eye.browse({'character':'STRIKER','q':'붉은'})
        self.assertEqual(result['total'],2)
        self.assertEqual({r['texture_name'] for r in result['items']},{'RED.PNG','BLUE.PNG'})
        self.assertTrue(all('표시' in r['label'] for r in result['items']))

    def test_separate_eye_geometry_keeps_face_and_hides_original_eye_groups(self):
        mesh=avatar(costume='NA',part='ACC_RING_RIGHT',number=20)
        source=fixture(self.root/'rare.cmf',[(mesh,binary_model('RARE.PNG'),0),('RARE.PNG',b'image',0)])
        self.catalog.scan([source])
        name,body=self.tables[0];types,_,_=ntf.header(body)
        model=[20,'GUST_USER_STRIKER',mesh,'RARE.XET','RARE.XET']+[0]*28+[0,'','']
        self.tables[0]=(name,table(types,[*ntf.rows(body),model]))
        name,body=self.tables[1];types,_,_=ntf.header(body)
        self.tables[1]=(name,table(types,[*ntf.rows(body),('CVN',20,'RARE_NAME','','','ICON.PNG')]))
        name,body=self.tables[2];types,_,_=ntf.header(body)
        self.tables[2]=(name,table(types,[*ntf.rows(body),(3,'RARE_NAME','희귀 눈동자')]))
        eye=next(r for r in self.eye.resources() if r['key']=='STRIKER:20')
        self.assertTrue(eye['geometry']);self.assertTrue(eye['base_face_id'])
        result=self.models.scene([eye['base_face_id'],eye['face_id']],eye_key=eye['key'],eye_face=eye['face_id'],eye_texture=eye['texture_id'])
        self.assertEqual(result['meshes'][0]['groups'],[])
        self.assertTrue(result['meshes'][1]['groups'])
        self.assertEqual(result['meshes'][1]['materials'][0]['image']['selected'],eye['texture_id'])
        with self.assertRaises(ValueError):self.models.scene([eye['face_id']],eye_key=eye['key'],eye_face=eye['face_id'],eye_texture=eye['texture_id'])

    def test_separate_eye_geometry_can_switch_between_registered_textures(self):
        mesh=avatar(costume='NA',part='ACC_RING_RIGHT',number=30)
        self.catalog.scan([fixture(self.root/'alternate.cmf',[(mesh,binary_model('RED.PNG'),0)])])
        name,body=self.tables[0];types,_,_=ntf.header(body)
        model=[30,'GUST_USER_STRIKER',mesh,'RED.XET','BLUE.XET']+[0]*28+[0,'','']
        self.tables[0]=(name,table(types,[*ntf.rows(body),model]))
        name,body=self.tables[1];types,_,_=ntf.header(body)
        self.tables[1]=(name,table(types,[*ntf.rows(body),('CVN',30,'RED_NAME','','','ICON.PNG')]))
        eye=next(r for r in self.eye.resources() if r['key']=='STRIKER:30:2')
        scene=self.models.scene([eye['base_face_id'],eye['face_id']],eye_key=eye['key'],eye_face=eye['face_id'],eye_texture=eye['texture_id'])
        self.assertEqual(scene['meshes'][1]['materials'][0]['texture'],'BLUE.PNG')


if __name__=='__main__':unittest.main()
