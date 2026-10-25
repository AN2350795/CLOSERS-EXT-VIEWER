from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from closers.motion_extras import references,compile_extras,mesh_rule,particle_rule,unique_rows,ExtraIndex
from closers.catalog import Catalog
from closers.model_library import Models
from test_explorer import fixture
from test_model import binary_model,animation


def layers():
    base={'GAME_UNIT_TEMPLET':{'m_vecAnimAddModelData':{1:{'m_AnimName':'MOVE','m_XFileName':'PROP.X','m_BoneName':'CHILD'}},
            'm_mapUnitStateData':{1:{'m_StateName':'USN_EMOTION_TEST','m_AnimName':'MOVE','m_EventDamageEffect':{1:{'m_DamageEffectName':'DE_TEST','m_fEventTime':.25,'m_bHold':'TRUE'}}}}}}
    return {'STRIKER':[('base.LUA',base),('character.LUA',{'GAME_UNIT_TEMPLET':{'m_mapUnitStateData':{1:{'m_StateName':'USN_EMOTION_TEST','m_fAnimSpeed':.5}}}})]}


class MotionExtrasTests(unittest.TestCase):
    def test_spine_and_fbx_particle_rules_preserve_settings(self):
        rule=particle_rule(dict(m_SeqName='SPINE',m_vecEventList={
            1:{1:'PCET_INITIAL',2:'PCET_SPINE','STR':'SPN_TEST','CLIPPING':'EMOTION','POS':{2:330},'SCALE':{1:.37,2:.37,3:1}},
            2:{1:'PCET_AT',2:'PCET_SPINE_ANIM',3:.2,'STR':'MIX01','TIME_SCALE':1.5}}))
        self.assertEqual(rule['spine']['name'],'SPN_TEST');self.assertEqual(rule['spine']['clipping'],'EMOTION')
        self.assertEqual(rule['spine']['events'],[dict(name='MIX01',at=.2,speed=1.5)])
        fbx=particle_rule(dict(m_ParticleType='PCT_MESH',m_MeshName='MODEL.FBX',m_mapUVOffset={1:dict(m_TexName='FX.PNG',m_Offset={1:.01,2:1})}))
        self.assertEqual(fbx['models'],['MODEL.FBX']);self.assertEqual(fbx['frames'][0]['name'],'FX.PNG')
        self.assertEqual(fbx['uv_offsets'][0]['offset'],[.01,1])

    def test_binary_effect_sources_and_atlas_pages_are_verified(self):
        import base64
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            binary=b'Kaydara FBX Binary  \x00\x1a\x00fixture'
            catalog.scan([fixture(root/'one.cmf',[('FX.FBX',binary,0),('FX.SKEL',b'skel fixture',0),('FX.ATLAS',b'FX.PNG\nsize: 4,4\n\nFX2.PNG\nsize: 4,4\n',0),('FX.PNG',b'fixture',0),('BAD.ATLAS',b'../private.PNG\nsize: 4,4\n',0)])])
            ids={r['name']:r['id'] for r in catalog.entries({})['items']};models=Models(catalog)
            result=models.effect_resource(ids['FX.FBX']);self.assertEqual(base64.b64decode(result['body']),binary)
            self.assertEqual(result['source']['entry_id'],ids['FX.FBX'])
            atlas=models.spine_atlas(ids['FX.ATLAS']);self.assertEqual(atlas['images'][0]['selected'],ids['FX.PNG'])
            self.assertIsNone(atlas['images'][1]['selected'])
            with self.assertRaises(ValueError):models.effect_resource(ids['FX.PNG'])
            with self.assertRaises(ValueError):models.spine_atlas(ids['BAD.ATLAS'])

    def test_empty_prop_override_removes_inherited_model(self):
        rig=layers()
        rig['STRIKER'].append(('override.LUA',{'GAME_UNIT_TEMPLET':{'m_vecAnimAddModelData':{1:dict(m_AnimName='MOVE',m_XFileName='')}}}))
        items=references(rig)['STRIKER']['MOVE']
        self.assertFalse(any(i['kind']=='model' for i in items))

    def test_particle_index_resolves_textures_without_mutating_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            catalog.scan([fixture(root/'one.cmf',[('SMOKE.PNG',b'fixture',0)])])
            rule=particle_rule(dict(m_SeqName='STEAM',m_vecEventList={1:{1:'PCET_INITIAL',2:'PCET_TEXTURE','STR':'SMOKE.PNG'}}))
            entry=dict(key='steam',kind='particle',status='ready',models=[],particle_name='STEAM',bone='')
            with closing(sqlite3.connect(catalog.game_names.path)) as db,db:
                db.executescript('PRAGMA user_version=1;CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE names(filename TEXT,label TEXT,priority INTEGER);CREATE TABLE motion_extras(character TEXT,clip TEXT,details_json TEXT);CREATE TABLE motion_particles(name TEXT,details_json TEXT);')
                db.execute('INSERT INTO motion_extras VALUES(?,?,?)',('STRIKER','MOVE',json.dumps([entry])))
                db.execute('INSERT INTO motion_particles VALUES(?,?)',('STEAM',json.dumps(rule)))
            catalog.game_names.refresh()
            item=Models(catalog).extra_sources('STRIKER','MOVE',set())[0]
            self.assertEqual(item['images'][0]['selected'],catalog.entries({})['items'][0]['id'])
            self.assertEqual(item['particle']['max_particles'],1)
            self.assertNotIn('particle',catalog.game_names.motion_extras['STRIKER','MOVE'][0])

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

    def test_conditions_and_mesh_tracks_can_be_previewed(self):
        rig=layers();rig['STRIKER'][0][1]['GAME_UNIT_TEMPLET']['m_mapUnitStateData'][1]['m_EventDamageEffect'][1]['m_SetID']=42
        damage={'DE_TEST':dict(m_MainEffectName='XE',source='damage.LUA')}
        meshes={'XE':dict(m_vecMeshName='E.X',source='mesh.LUA',m_BillBoardType='BBT_SCREEN',m_vGravity={2:-1},m_bDualBlending='TRUE',m_vecEventList={
            1:{1:'MPETT_GLOBAL',2:'MPET_INITIAL',3:'MPET_SIZE','XYZ':{1:2,2:3,3:4}},
            2:{1:'MPETT_GLOBAL',2:'MPET_FADE',3:'MPET_UNKNOWN'}})}
        item=compile_extras(references(rig),damage,meshes)['STRIKER','MOVE'][1]
        self.assertEqual(item['status'],'ready');self.assertEqual(item['conditions'],{'m_SetID':42})
        self.assertEqual(item['gravity'],[0,-1,0]);self.assertTrue(item['dual']);self.assertTrue(item['warnings'])
        self.assertEqual(item['tracks'][0]['value'],[2,3,4])

    def test_particles_frames_ranges_and_parent_event(self):
        rule=particle_rule(dict(m_SeqName='STEAM',m_LifeTime={1:.5,2:1},m_EmitRate=8,m_iMaxParticleNum=32,m_vecEventList={
            1:{1:'PCET_INITIAL',2:'PCET_TEX_ANIM','STR':'TEX'},
            2:{1:'PCET_INITIAL',2:'PCET_COLOR','RGBA_255':{1:255,2:128,3:0,4:255}},
            3:{1:'PCET_FADE_FINAL',2:'PCET_SIZE',3:0,'XYZ':{1:2,2:2,3:2}}}),
            {'TEX':{'m_vecFrame':{1:dict(m_TexName='A.DDS',m_fTime=.1),2:dict(m_TexName='B.DDS',m_fTime=.2)}}})
        self.assertEqual(rule['life'],[.5,1]);self.assertEqual(len(rule['frames']),2)
        self.assertAlmostEqual(rule['tracks'][0]['value'][1],128/255)
        damage={'DE_TEST':dict(m_MainEffectName='MISSING',source='damage.LUA',m_EventParticle={1:dict(m_SeqName='STEAM',m_fEventTime=.1)})}
        items=compile_extras(references(layers()),damage,{}, {'STEAM':rule})['STRIKER','MOVE']
        self.assertEqual(items[-1]['status'],'ready');self.assertEqual(items[-1]['parent_key'],items[1]['key'])
        self.assertEqual(items[-1]['at'],.1)

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
            ambiguous=models.extra_sources('STRIKER','MOVE',{'CHILD'})[0]
            self.assertEqual(ambiguous['status'],'ready');self.assertIsNone(ambiguous['resources'][0]['selected']);self.assertEqual(len(ambiguous['resources'][0]['candidates']),2)
