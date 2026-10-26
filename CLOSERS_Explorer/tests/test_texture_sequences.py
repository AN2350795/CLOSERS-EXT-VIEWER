import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from closers.texture_sequences import texture_sequences
from closers.catalog import Catalog
from closers.model_library import Models
from test_explorer import fixture
from test_model import binary_model


class TextureSequenceTests(unittest.TestCase):
    def test_exact_first_frame_links_keep_order_hold_and_ambiguity(self):
        def sequence(name,first='FIRST.PNG'):
            return dict(m_AnimName=name,m_vecFrame={1:dict(m_TexName=first,m_fTime=.1),2:dict(m_TexName='BODY.PNG',m_fTime=999999)})
        result=texture_sequences({'TEX.LUA':{'m_mapTexAnimData':{1:sequence('REVEAL')}}})
        self.assertEqual(result['FIRST.PNG']['frames'][-1],dict(name='BODY.PNG',duration=999999))
        self.assertEqual(result['FIRST.PNG']['source'],'TEX.LUA')
        result=texture_sequences({'TEX.LUA':{'m_mapTexAnimData':{1:sequence('ONE'),2:sequence('TWO')}}})
        self.assertTrue(result['FIRST.PNG']['ambiguous'])
        self.assertNotIn('BODY.PNG',result)

    def test_optional_index_connects_model_material_and_frame_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            catalog.scan([fixture(root/'models.cmf',[('MODEL.X',binary_model('FIRST.PNG'),0),('FIRST.PNG',b'first',0),('BODY.PNG',b'body',0)])])
            models=Models(catalog);rig=models.matches('MODEL.X')[0]['id']
            self.assertNotIn('texture_animation',models.scene([rig])['meshes'][0]['materials'][0])
            sequence=dict(name='REVEAL',source='TEX.LUA',frames=[dict(name='FIRST.PNG',duration=.1),dict(name='BODY.PNG',duration=999999)])
            with closing(sqlite3.connect(catalog.game_names.path)) as db,db:
                db.executescript('PRAGMA user_version=1;CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE names(filename TEXT,label TEXT,priority INTEGER);CREATE TABLE texture_animations(filename TEXT PRIMARY KEY,details_json TEXT);')
                db.execute('INSERT INTO texture_animations VALUES(?,?)',('FIRST.PNG',json.dumps(sequence)))
            catalog.game_names.refresh();scene=models.scene([rig]);linked=scene['meshes'][0]['materials'][0]['texture_animation']
            self.assertEqual(linked['name'],'REVEAL')
            self.assertEqual([f['selected'] for f in linked['frames']],[models.matches('FIRST.PNG')[0]['id'],models.matches('BODY.PNG')[0]['id']])
