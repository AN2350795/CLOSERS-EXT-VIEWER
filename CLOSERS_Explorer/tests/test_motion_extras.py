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
    def test_custom_effect_conditions_survive_compilation_and_parent_resolution(self):
        from closers.motion_converts import resolve
        custom={1:13.0}
        refs={'STRIKER':{'EMOTION_DANCE':[
            dict(kind='effect',state='USN_EMOTION_DANCE',row=dict(m_DamageEffectName='ROOT',m_vecShowEffectCustomID=custom)),
            dict(kind='equipment',state='USN_EMOTION_DANCE',row=dict(m_vecShowEffectCustomID=custom))]}}
        damage={'ROOT':dict(source='effect.LUA',m_MainEffectName='DUST',m_EventParticle={1:dict(m_SeqName='DUST')})}
        rule=particle_rule(dict(m_TexName='WHITE.PNG'))
        items=compile_extras(refs,damage,{},{'DUST':rule})['STRIKER','EMOTION_DANCE']
        self.assertEqual(len(items),3)
        self.assertTrue(all(e['condition_schema']==2 for e in items))
        self.assertEqual(items[0]['conditions']['m_vecShowEffectCustomID'],custom)
        self.assertEqual(items[2]['conditions']['m_vecShowEffectCustomID'],custom)
        result=resolve({('STRIKER','EMOTION_DANCE'):items},{},'STRIKER','EMOTION_DANCE')
        self.assertEqual(result[1]['conditions']['parent']['m_vecShowEffectCustomID'],custom)
        self.assertFalse(items[1]['conditions'])
        self.assertFalse(items[0]['warnings'])

    def test_condition_warnings_do_not_mutate_shared_particle_definitions(self):
        rule=particle_rule(dict(m_TexName='WHITE.PNG'))
        rule['warnings']=['source warning']
        refs={'STRIKER':{'MOVE':[
            dict(kind='particle',state='S1',row=dict(m_SeqName='DUST',m_ItemID=42)),
            dict(kind='particle',state='S2',row=dict(m_SeqName='DUST'))]}}
        result=compile_extras(refs,{},{},{'DUST':rule})['STRIKER','MOVE']
        self.assertEqual(rule['warnings'],['source warning'])
        self.assertEqual(result[1]['warnings'],['source warning'])
        self.assertEqual(len(result[0]['warnings']),2)
        result[0]['warnings'].append('changed preview')
        self.assertEqual(result[1]['warnings'],['source warning'])

    def test_large_snapshot_is_compressed_and_restores_unicode_after_eviction(self):
        details=[dict(label='반복 보이스',source='SOUND_VOICE_TEMPLET.LUA',at=.25) for _ in range(500)]
        encoded=json.dumps(details,ensure_ascii=False)
        index=ExtraIndex([('STRIKER','LARGE',encoded),*(('STRIKER',str(i),'[]') for i in range(40))])
        self.assertLess(len(index.raw['STRIKER','LARGE']),len(encoded.encode('utf-8'))//4)
        self.assertEqual(index['STRIKER','LARGE'],details)
        index['STRIKER','LARGE'][0]['label']='변경된 미리보기'
        for i in range(40):index['STRIKER',str(i)]
        self.assertEqual(index['STRIKER','LARGE'],details)

    def test_effect_layers_survive_mesh_and_particle_normalization(self):
        mesh=mesh_rule(dict(m_vecMeshName='PROP.X',m_Layer='ROL_EFFECT_3'))
        particle=particle_rule(dict(m_TexName='WHITE.PNG',m_Layer='ROL_EFFECT_0'))
        self.assertEqual(mesh['layer'],'ROL_EFFECT_3')
        self.assertEqual(particle['layer'],'ROL_EFFECT_0')

    def test_dof_plane_requires_ordinary_world_particle_inputs(self):
        base=dict(m_TexName='WHITE.PNG',m_Layer='ROL_EFFECT_0')
        self.assertTrue(particle_rule(base)['dof_plane'])
        self.assertTrue(particle_rule(dict(base,m_bZWriteEnable='TRUE'))['dof_plane'])
        for extra in [dict(m_bDownUI='TRUE'),dict(m_bOverUI=True),dict(m_bInnerUI='TRUE'),
                      dict(m_bUISeq='TRUE'),dict(m_bDownUI='UNKNOWN'),dict(m_bZEnable='FALSE'),
                      dict(m_Layer='ROL_EFFECT_59'),dict(m_Layer=None),dict(m_bDualBlending='TRUE'),
                      dict(m_ParticleType='PCT_2D_PLANE'),dict(m_MaskTexName='MASK.PNG'),
                      dict(m_DissolveTexName='MASK.PNG'),dict(m_bTrace='TRUE'),dict(m_bLandConnect='TRUE')]:
            with self.subTest(extra=extra):
                self.assertFalse(particle_rule(dict(base,**extra))['dof_plane'])

    def test_additive_dof_requires_audited_single_plane_blend(self):
        base=dict(m_TexName='WHITE.PNG',m_Layer='ROL_EFFECT_0',m_DestBlend='CON_D3DBLEND_ONE')
        self.assertTrue(particle_rule(base)['dof_additive_plane'])
        self.assertFalse(particle_rule(base)['dof_plane'])
        for extra in [dict(m_SrcBlend='ONE'),dict(m_DestBlend='DESTALPHA'),dict(m_bZEnable='FALSE'),
                      dict(m_bDualBlending='TRUE'),dict(m_Layer='ROL_EFFECT_59'),dict(m_bDownUI='TRUE'),
                      dict(m_ParticleType='PCT_MESH',m_MeshName='PROP.X'),dict(m_MaskTexName='MASK.PNG')]:
            with self.subTest(extra=extra):self.assertFalse(particle_rule(dict(base,**extra))['dof_additive_plane'])

    def test_land_trace_mask_requires_one_matching_sibling_emission(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            catalog.scan([fixture(root/'one.cmf',[('PROP.X',binary_model(),0),('MASK.PNG',b'fixture',0)])])
            plane=particle_rule(dict(m_TexName='MASK.PNG',m_bDualBlending='TRUE'))
            trace=particle_rule(dict(m_ParticleType='PCT_MESH',m_MeshName='PROP.X',m_bTrace='TRUE',m_bLandConnect='TRUE',m_CullMode='CON_D3DCULL_NONE'))
            common=dict(kind='particle',status='ready',bone='',state='S1',parent_key='parent',at=1.3,offset=[30,0,0],anim_time=False)
            entries=[dict(common,key='mask',models=[],particle_name='MASK'),dict(common,key='trace',models=['PROP.X'],particle_name='TRACE')]
            with closing(sqlite3.connect(catalog.game_names.path)) as db,db:
                db.executescript('PRAGMA user_version=1;CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE names(filename TEXT,label TEXT,priority INTEGER);CREATE TABLE motion_extras(character TEXT,clip TEXT,details_json TEXT);CREATE TABLE motion_particles(name TEXT,details_json TEXT);')
                db.execute('INSERT INTO motion_extras VALUES(?,?,?)',('STRIKER','MOVE',json.dumps(entries)))
                db.executemany('INSERT INTO motion_particles VALUES(?,?)',[('MASK',json.dumps(plane)),('TRACE',json.dumps(trace))])
            catalog.game_names.refresh();models=Models(catalog);result=models.extra_sources('STRIKER','MOVE',set())
            self.assertEqual(result[1]['trace_receiver_key'],'mask')
            self.assertEqual(result[1]['particle']['cull'],'CON_D3DCULL_NONE')
            entries.append(dict(entries[0],key='another-mask'))
            with closing(sqlite3.connect(catalog.game_names.path)) as db,db:
                db.execute('UPDATE motion_extras SET details_json=?',(json.dumps(entries),))
            catalog.game_names.refresh()
            self.assertNotIn('trace_receiver_key',models.extra_sources('STRIKER','MOVE',set())[1])

    def test_inherited_equipment_hide_is_scoped_to_game_state(self):
        rig=layers();base=rig['STRIKER'][0][1]['GAME_UNIT_TEMPLET']['m_mapUnitStateData'][1]
        base['m_EventEquipHide']={1:dict(m_bAnimTime='FALSE',m_fEventTimeMin=.1,m_fEventTimeMax=30,m_HideEquipPosition='EP_AVATAR_WEAPON')}
        refs=references(rig);hide=next(item for item in refs['STRIKER']['MOVE'] if item['kind']=='equipment')
        self.assertEqual(hide['row']['source'],'base.LUA')
        compiled=compile_extras(refs,{},{} )['STRIKER','MOVE'];event=next(item for item in compiled if item['kind']=='equipment')
        self.assertEqual(event['state'],'USN_EMOTION_TEST');self.assertEqual(event['part'],'WEAPON');self.assertFalse(event['anim_time'])
        self.assertEqual((event['at'],event['until']),(.1,30));self.assertEqual(event['models'],[])

    def test_cube_dissolve_and_parent_effect_scale_are_preserved(self):
        rule=mesh_rule(dict(m_vecMeshName='CUBE.X',m_DissolveTexName='MASK.PNG',m_vecEventList={
            1:{1:'MPETT_GLOBAL',2:'MPET_INITIAL',3:'MPET_DISSOLVE','RGBA':{1:1,2:1,3:1,4:0},'WIDTH':.05,'THRESHOLD':1},
            2:{1:'MPETT_GLOBAL',2:'MPET_FADE',3:'MPET_DISSOLVE',4:0,5:.4,'RGBA':{1:1,2:1,3:1,4:1},'WIDTH':.1,'THRESHOLD':{1:0,2:1}}}))
        self.assertEqual(rule['dissolve_texture'],'MASK.PNG');self.assertEqual(len(rule['tracks']),6);self.assertFalse(rule['warnings'])
        self.assertEqual(rule['tracks'][0]['property'],'dissolveColor');self.assertEqual(rule['tracks'][3]['value'][-1],1)
        self.assertEqual(rule['tracks'][5]['value'],[0,1])
        particle=particle_rule(dict(m_DissolveTexName='PARTICLE_MASK.DDS',m_TexName='WHITE.PNG',m_vecEventList={
            1:{1:'PCET_FADE',2:'PCET_DISSOLVE',3:0,4:1,'THRESHOLD':{1:1,2:0}}}))
        self.assertEqual(particle['dissolve_texture'],'PARTICLE_MASK.DDS')
        self.assertEqual(particle['tracks'][-1]['value'],[1,0])
        rig=layers();rig['STRIKER'][0][1]['GAME_UNIT_TEMPLET']['m_mapUnitStateData'][1]['m_EventDamageEffect'][1]['m_fScale']=.4
        item=compile_extras(references(rig),{},{} )['STRIKER','MOVE'][1]
        self.assertEqual(item['scale'],.4)

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
            catalog.scan([fixture(root/'one.cmf',[('SMOKE.PNG',b'fixture',0),('MASK.PNG',b'mask',0)])])
            rule=particle_rule(dict(m_SeqName='STEAM',m_MaskTexName='MASK.PNG',m_vecEventList={1:{1:'PCET_INITIAL',2:'PCET_TEXTURE','STR':'SMOKE.PNG'}}))
            entry=dict(key='steam',kind='particle',status='ready',models=[],particle_name='STEAM',bone='')
            with closing(sqlite3.connect(catalog.game_names.path)) as db,db:
                db.executescript('PRAGMA user_version=1;CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE names(filename TEXT,label TEXT,priority INTEGER);CREATE TABLE motion_extras(character TEXT,clip TEXT,details_json TEXT);CREATE TABLE motion_particles(name TEXT,details_json TEXT);')
                db.execute('INSERT INTO motion_extras VALUES(?,?,?)',('STRIKER','MOVE',json.dumps([entry])))
                db.execute('INSERT INTO motion_particles VALUES(?,?)',('STEAM',json.dumps(rule)))
            catalog.game_names.refresh()
            item=Models(catalog).extra_sources('STRIKER','MOVE',set())[0]
            self.assertEqual(item['images'][0]['selected'],Models(catalog).matches('SMOKE.PNG')[0]['id'])
            self.assertEqual(item['mask_image']['selected'],Models(catalog).matches('MASK.PNG')[0]['id'])
            self.assertEqual(item['particle']['mask_texture'],'MASK.PNG')
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
