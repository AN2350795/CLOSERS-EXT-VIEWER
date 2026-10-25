from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from closers.motion_extras import references,compile_extras,mesh_rule,unique_rows,ExtraIndex
from closers.catalog import Catalog
from closers.model_library import Models
from test_explorer import fixture
from test_model import binary_model,animation


def layers():
    base={'GAME_UNIT_TEMPLET':{'m_vecAnimAddModelData':{1:{'m_AnimName':'MOVE','m_XFileName':'PROP.X','m_BoneName':'CHILD'}},
            'm_mapUnitStateData':{1:{'m_StateName':'USN_EMOTION_TEST','m_AnimName':'MOVE','m_EventDamageEffect':{1:{'m_DamageEffectName':'DE_TEST','m_fEventTime':.25,'m_bHold':'TRUE'}}}}}}
    return {'STRIKER':[('base.LUA',base),('character.LUA',{'GAME_UNIT_TEMPLET':{'m_mapUnitStateData':{1:{'m_StateName':'USN_EMOTION_TEST','m_fAnimSpeed':.5}}}})]}


class MotionExtrasTests(unittest.TestCase):
    def test_index_decodes_only_recent_motion_entries(self):
        index=ExtraIndex(('STRIKER',str(i),json.dumps([dict(label=str(i))])) for i in range(40))
        self.assertEqual(len(index),40);self.assertEqual(len(index.cache),0)
        for i in range(40):self.assertEqual(index['STRIKER',str(i)][0]['label'],str(i))
        self.assertEqual(len(index.cache),32);self.assertNotIn(('STRIKER','0'),index.cache)

    def test_props_effects_timing_and_inherited_source(self):
        refs=references(layers())
        damage={'DE_TEST':dict(m_MainEffectName='XE_TEST',source='damage.LUA',m_EventParticle={1:dict(m_SeqName='STEAM')})}
        meshes={'XE_TEST':dict(m_vecMeshName='EFFECT.X',m_fLifeTime=2,source='mesh.LUA',m_vecEventList={
            1:{1:'MPETT_GLOBAL',2:'MPET_INITIAL',3:'MPET_ANIM_NAME','STR':'EFFECT_ANIM'},
            2:{1:'MPETT_ANIM',2:'MPET_FADE',3:'MPET_COLOR',4:0,5:1,'RGBA':{1:1,2:1,3:1,4:0}}})}
        items=compile_extras(refs,damage,meshes)['STRIKER','MOVE']
        self.assertEqual(len(items),3)
        self.assertEqual(items[0]['models'],['PROP.X']);self.assertEqual(items[0]['bone'],'CHILD')
        self.assertEqual(items[1]['source'],'base.LUA')
        self.assertEqual(items[1]['at'],.25);self.assertEqual(items[1]['animation'],'EFFECT_ANIM')
        self.assertTrue(items[1]['follow']);self.assertEqual(items[1]['fades'][0]['color'][-1],0)
        self.assertEqual(items[2]['status'],'unavailable');self.assertEqual(items[2]['kind'],'particle')

    def test_unsupported_conditions_and_effect_rules_are_explicit(self):
        rig=layers();rig['STRIKER'][0][1]['GAME_UNIT_TEMPLET']['m_mapUnitStateData'][1]['m_EventDamageEffect'][1]['m_SetID']=42
        items=compile_extras(references(rig),{},{} )['STRIKER','MOVE']
        self.assertEqual(items[1]['status'],'unavailable');self.assertIn('장비',items[1]['error'])
        for row in [dict(m_vecMeshName='E.X',m_BillBoardType='BBT_SCREEN'),dict(m_vecMeshName='E.X',m_vGravity={2:-1}),
                    dict(m_vecMeshName='E.X',m_vecEventList={1:{3:'MPET_UNKNOWN'}})]:
            with self.assertRaises(ValueError):mesh_rule(row)

    def test_duplicate_definitions_do_not_get_guessed(self):
        row=dict(m_SeqName='XE',m_vecEventList={1:{1:'value','STR':'test'}})
        tables={'a.LUA':{'X_MESH_PLAYER':{1:row}},'b.LUA':{'X_MESH_PLAYER':{1:row}}}
        self.assertIn('XE',unique_rows(tables,'X_MESH_PLAYER','m_SeqName',{'XE'}))
        tables['b.LUA']['X_MESH_PLAYER'][1]={**row,'m_fLifeTime':2}
        self.assertNotIn('XE',unique_rows(tables,'X_MESH_PLAYER','m_SeqName',{'XE'}))

    def test_clip_resolves_source_and_missing_bones_and_preserves_plain_clips(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            source=fixture(root/'one.cmf',[('MOTION_STRIKER.X',binary_model(),0),('MOTION_STRIKER.XMD',animation(),0),('PROP.X',binary_model(),0)])
            catalog.scan([source]);ids={r['name']:r['id'] for r in catalog.entries({})['items']}
            items=compile_extras(references(layers()),{},{} )['STRIKER','MOVE']
            with closing(sqlite3.connect(catalog.game_names.path)) as db,db:
                db.executescript('PRAGMA user_version=1;CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE names(filename TEXT,label TEXT,priority INTEGER);CREATE TABLE motion_extras(character TEXT,clip TEXT,details_json TEXT);')
                db.execute('INSERT INTO motion_extras VALUES(?,?,?)',('STRIKER','MOVE',json.dumps(items)))
            models=Models(catalog);rig=ids['MOTION_STRIKER.X'];anim=ids['MOTION_STRIKER.XMD']
            metadata=models.animations(rig,anim);packet=models.clip(rig,anim,0,metadata['animation_source']['sha256'])
            self.assertEqual(packet['extras'][0]['resources'][0]['selected'],ids['PROP.X'])
            self.assertEqual(models.extra_sources('STRIKER','MOVE',set())[0]['status'],'unavailable')
            self.assertNotIn('resources',catalog.game_names.motion_extras['STRIKER','MOVE'][0])
            self.assertEqual(models.clip(rig,anim,1,metadata['animation_source']['sha256'])['extras'],[])
            duplicate=fixture(root/'two.cmf',[('PROP.X',binary_model(),0)]);catalog.scan([duplicate])
            self.assertEqual(models.extra_sources('STRIKER','MOVE',{'CHILD'})[0]['status'],'unavailable')
