import copy
import unittest
import json
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from closers.catalog import Catalog
from closers.model_library import Models
from test_explorer import fixture
from closers.motion_sound import sound_tables,sound_rule
from closers.motion_extras import references,compile_extras,effect_dependencies


class MotionSoundTests(unittest.TestCase):
    def test_audio_candidates_resolve_new_files_and_preserve_ambiguity(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            catalog.scan([fixture(root/'one.cmf',[('NEW.OGG',b'OggSfixture',0),('DUP.OGG',b'OggSone',0)]),fixture(root/'two.cmf',[('DUP.OGG',b'OggStwo',0)])])
            entry=dict(key='sound',kind='sound',status='ready',sound_names=['new.ogg','DUP.OGG','MISSING.OGG'],models=[])
            with closing(sqlite3.connect(catalog.game_names.path)) as db,db:
                db.executescript('PRAGMA user_version=1;CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE names(filename TEXT,label TEXT,priority INTEGER);CREATE TABLE motion_extras(character TEXT,clip TEXT,details_json TEXT);')
                db.execute('INSERT INTO motion_extras VALUES(?,?,?)',('NEW','MOTION',json.dumps([entry])))
            catalog.game_names.refresh();item=Models(catalog).extra_sources('NEW','MOTION',set())[0]
            self.assertIsNotNone(item['sounds'][0]['selected']);self.assertIsNone(item['sounds'][1]['selected']);self.assertIsNone(item['sounds'][2]['selected'])
            self.assertEqual(len(item['sounds'][1]['candidates']),2);self.assertTrue(item['warnings'])
            self.assertNotIn('sounds',catalog.game_names.motion_extras['NEW','MOTION'][0])

    def test_state_voice_effect_sound_and_new_rows_keep_exact_provenance(self):
        sound={'m_vecSoundName':{1:'SE_START.OGG'},'m_fEventTime':.2,'m_bAnimTime':'FALSE'}
        voice={'m_vecSoundName':{1:'VOICE_A.OGG',2:'VOICE_B.OGG'},'m_bUseVoice':'TRUE','m_PlayRate':75}
        tables={'SOUND_TEMPLET.LUA':{'m_mapUnitStateEventSound':{1:{'m_GameUnitSubType':'GUST_USER_ROGUE',1:{'m_StateName':'S','m_EventSound':{1:sound}}}},'m_mapDamageEffectEventSound':{1:{'m_DamageEffectName':'DE','m_EventSound':{1:sound}}}},
                'SOUND_VOICE_TEMPLET3.LUA':{'m_mapUnitStateEventSound':{1:{'m_GameUnitSubType':'GUST_USER_ROGUE',1:{'m_StateName':'S','m_EventSound':{1:voice}}}}}}
        rigs={'ROGUE':[('BASE.LUA',{'GAME_UNIT_TEMPLET':{'m_mapUnitStateData':{1:{'m_StateName':'S','m_AnimName':'CLIP','m_EventDamageEffect':{1:{'m_DamageEffectName':'DE','m_fEventTime':1}}}}}})]}
        sounds=sound_tables(tables);refs=references(rigs,sounds)
        result=compile_extras(refs,{'DE':{'source':'DE.LUA','m_MainEffectName':'MISSING'}},{},sounds=sounds)['ROGUE','CLIP']
        events=[r for r in result if r['kind']=='sound'];self.assertEqual(len(events),3)
        parent=next(r for r in result if r['kind']=='effect')
        attached=next(r for r in events if 'parent_key' in r)
        self.assertEqual(attached['parent_key'],parent['key']);self.assertEqual(attached['at'],.2)
        self.assertEqual(attached['source'],'SOUND_TEMPLET.LUA')
        # Missing visual geometry must not remove its sound-only event.
        self.assertEqual(attached['status'],'ready');self.assertEqual(parent['status'],'unavailable')
        v=next(r for r in events if r['voice']);self.assertEqual(v['sound_names'],['VOICE_A.OGG','VOICE_B.OGG']);self.assertEqual(v['probability'],.75)
        tables['SOUND_VOICE_TEMPLET3.LUA']['m_mapUnitStateEventSound'][1][1]['m_EventSound'][2]={'m_vecSoundName':{1:'VOICE_NEW.OGG'}}
        self.assertEqual(len(references(rigs,sound_tables(tables))['ROGUE']['CLIP']),4)

    def test_loop_volume_stop_groups_and_duplicate_definitions(self):
        row={'m_vecSoundName':{1:'MUSIC.OGG'},'m_bLoop':'TRUE','m_bStopSound':'TRUE','m_audioVolume':30,'m_usSoundGroupID':5,'m_setStopSoundGroupID':{1:7},'m_fFadeOutTime':.5}
        rule=sound_rule(row);self.assertTrue(rule['loop']);self.assertTrue(rule['stop_on_end']);self.assertEqual(rule['volume'],.3);self.assertEqual(rule['stop_groups'],[7])
        row['m_bNoStopSound']='TRUE';self.assertFalse(sound_rule(row)['stop_on_end']);self.assertTrue(sound_rule(row)['keep_on_end'])
        table={'m_mapDamageEffectEventSound':{1:{'m_DamageEffectName':'DE','m_EventSound':{1:row,2:copy.deepcopy(row)}}}}
        self.assertEqual(len(sound_tables({'A.LUA':table})[1]['DE']),1)
        with self.assertRaises(ValueError):sound_rule({'m_audioVolume':float('nan')})

    def test_direct_mesh_events_are_resolved_without_damage_effect(self):
        rigs={'NEW':[('NEW.LUA',{'GAME_UNIT_TEMPLET':{'m_mapUnitStateData':{1:{'m_StateName':'S','m_AnimName':'CLIP','m_EventXMeshPlayer':{1:{'m_SeqName':'XE'}}}}}})]}
        result=compile_extras(references(rigs),{}, {'XE':{'source':'X.LUA','m_vecMeshName':'MODEL.X'}})['NEW','CLIP']
        self.assertEqual(result[0]['status'],'ready');self.assertEqual(result[0]['kind'],'effect');self.assertEqual(result[0]['models'],['MODEL.X'])

    def test_unhandled_new_events_keep_source_and_resource_inventory(self):
        rigs={'NEW':[('BASE.LUA',{'GAME_UNIT_TEMPLET':{'m_mapUnitStateData':{1:{'m_StateName':'S','m_AnimName':'CLIP','m_EventFutureCutScene':{1:{'texture':'NEW.DDS','sound':'NEW.OGG','physics':'ARBITRARY_SCRIPT()'}}}}}}),
                     ('NEW.LUA',{'GAME_UNIT_TEMPLET':{'m_mapUnitStateData':{1:{'m_StateName':'S','m_AnimName':'CLIP'}}}})]}
        result=compile_extras(references(rigs),{}, {})['NEW','CLIP']
        event=result[0]['events']['m_EventFutureCutScene']
        self.assertEqual(event['source'],'BASE.LUA');self.assertEqual(event['resources'],['NEW.DDS','NEW.OGG']);self.assertEqual(event['count'],1)
        self.assertEqual(result[0]['status'],'unavailable')

    def test_nested_effects_sound_and_cycles_preserve_parent_clocks(self):
        refs={'NEW':{'CLIP':[dict(kind='effect',state='S',row={'m_DamageEffectName':'A','source':'RIG.LUA'})]}}
        damage={'A':{'source':'A.LUA','m_MainEffectName':'XE','m_EventDamageEffect':{1:{'m_DamageEffectName':'B','m_fEventTime':.5}}},
                'B':{'source':'B.LUA','m_MainEffectName':'XE','m_EventDamageEffect':{1:{'m_DamageEffectName':'A'}},'m_EventSound':{1:{'m_vecSoundName':{1:'CHILD.OGG'},'m_fEventTime':.2}}}}
        result=compile_extras(refs,damage,{'XE':{'source':'X.LUA','m_vecMeshName':'MODEL.X'}})['NEW','CLIP']
        self.assertEqual(len(result),4)
        child=result[1];sound=next(e for e in result if e['kind']=='sound')
        self.assertEqual(child['parent_key'],result[0]['key']);self.assertEqual(child['at'],.5)
        self.assertEqual(sound['parent_key'],child['key']);self.assertEqual(sound['at'],.2)
        self.assertTrue(any(e['status']=='unavailable' and '16' in e['error'] for e in result))
        wanted,meshes=effect_dependencies(refs,{'CHILD_FIRST.LUA':{'m_mapDamageEffectData':{1:dict(damage['B'],m_DamageEffectName='B')}},'PARENT_LAST.LUA':{'m_mapDamageEffectData':{1:dict(damage['A'],m_DamageEffectName='A')}}})
        self.assertEqual(wanted,{'A','B'});self.assertEqual(meshes,{'XE'})
