from contextlib import closing,redirect_stdout
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

from closers.catalog import Catalog
from closers.cmf import Cancelled
from closers.model_catalog import build
from closers.model_groups import classify,ModelGroups
from closers.model_names import package_names,unit_header,unit_names
from closers.motion_names import join,decorate
from test_explorer import fixture
from test_model import binary_model,animation


class ModelCatalogTests(unittest.TestCase):
    def test_shared_clips_keep_code_and_exact_skill_name_takes_precedence(self):
        names={('STRIKER','JUMP_DOWN'):[dict(label='위상 집속검',kind='skill',skill_id='SI_STRIKER_PLUS_NINE')],
               ('STRIKER','SI_STRIKER_FIRE_AIR'):[dict(label='긴급 회피',kind='skill',skill_id='SI_STRIKER_EVADE'),
                    dict(label='발포',kind='skill',skill_id='SI_STRIKER_FIRE')]}
        jump,fire=decorate([dict(name='JUMP_DOWN'),dict(name='SI_STRIKER_FIRE_AIR')],'STRIKER',names)
        self.assertEqual(jump['display_name'],'JUMP_DOWN')
        self.assertEqual(jump['name_kind'],'reference')
        self.assertEqual(jump['game_names'],['위상 집속검'])
        self.assertEqual(fire['display_name'],'발포')
        self.assertEqual(fire['game_names'],['발포','긴급 회피'])
        self.assertEqual(fire['name_kind'],'official')
        legacy=decorate([dict(name='SI_STRIKER_LEGACY_FIRE')],'STRIKER',{
            ('STRIKER','SI_STRIKER_LEGACY_FIRE'):[dict(label='발포',kind='skill',skill_id='SI_STRIKER_FIRE',state='USN_SI_STRIKER_LEGACY_FIRE')]
        })[0]
        self.assertEqual(legacy['display_name'],'발포')
        self.assertEqual(legacy['name_kind'],'official')
        dedicated=decorate([dict(name='SKILL_STRIKER_CLASS_1_SKILL_4')],'STRIKER',{
            ('STRIKER','SKILL_STRIKER_CLASS_1_SKILL_4'):[dict(label='#cffffff결전기 : 폭령검#cx',kind='skill',skill_id='SI_STRIKER_BURST_BLADE')]
        })[0]
        self.assertEqual(dedicated['display_name'],'결전기 : 폭령검')
        self.assertEqual(dedicated['name_kind'],'official')
    def test_old_motion_category_is_upgraded_before_model_filtered_extraction(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            catalog.scan([fixture(root/'old.cmf',[('MOTION_STRIKER.XMD',animation(),0)])])
            with catalog.connect() as db:
                db.execute("UPDATE entries SET category='other',detail='기타 파일' WHERE format='xmd'")
            result=catalog.extract(root/'assets',{'category':'models'})
            self.assertEqual(result['done'],1)
            row=catalog.entries({})['items'][0]
            self.assertEqual(Path(row['output']).read_bytes(),animation())

    def test_known_conventions_preserve_unknowns_and_avatar_parts(self):
        for filename,kind in [('MOTION_STRIKER.XMD','motion'),('GUST_NPC_PET_SAMPLE.X','pet'),
                ('_XE_PROP.X','effect'),('__XX_GUST_NPC_BEAM.X','effect'),('CAMERA_STRIKER.X','camera'),
                ('DI_TOWN_PLAN.X','collision'),('DRAMA_TEST.XMD','cinematic'),('SPN_TEST.SKEL','spine'),
                ('AREA02_ROAD.X','background'),('UNPROVEN.X','unknown')]:
            with self.subTest(filename=filename):self.assertEqual(classify(filename)['kind'],kind)
        self.assertEqual(classify('499906613_GUST_GATEKEEPER_A_EP_AVATAR_ACC_BODY_CHEST.X')['kind'],'avatar')

    def test_full_skill_names_are_character_scoped_and_ignore_requirement_states(self):
        skills={'SKILL_TEMPLET':{1:dict(m_SkillID='SI_STRIKER_FIRE',m_UnitStateName='USN_FIRE',
            m_UnitStateNameInAir='USN_FIRE_AIR',m_RequiredState='USN_IDLE'),
            2:dict(m_SkillID='SI_CASTER_FIRE',m_UnitStateName='USN_FIRE')}}
        rigs={c:[('unit.lua',{1:dict(m_StateName='USN_FIRE',m_AnimName='SI_'+c+'_FIRE'),
            2:dict(m_StateName='USN_FIRE_AIR',m_AnimName='AIR'),3:dict(m_StateName='USN_IDLE',m_AnimName='IDLE')})] for c in ('STRIKER','CASTER')}
        names=join(skills,rigs,{'ST_SI_STRIKER_FIRE_NAME':('발포','STRINGS'),
            'ST_SI_CASTER_FIRE_NAME':('전하','STRINGS')},'SKILL_TEMPLET_STRIKER.LUA')
        self.assertEqual(names['STRIKER','SI_STRIKER_FIRE'][0]['label'],'발포')
        self.assertEqual(names['CASTER','SI_CASTER_FIRE'][0]['label'],'전하')
        self.assertNotIn(('STRIKER','IDLE'),names)
        clips=[dict(name='SI_STRIKER_FIRE')];decorate(clips,'STRIKER',names)
        self.assertEqual(clips[0]['name_kind'],'official')
        decorate(clips,'UNKNOWN',names);self.assertNotIn('display_name',clips[0])

    def test_skin_names_keep_character_scene_and_raw_clip_context(self):
        row=['CVN',20,1,'"GUST_USER_STRIKER",',7,8,0,0,0,0,0,0,'ST_SKIN','DESC']
        registrations={('STRIKER','TOWN_IDLE'):[dict(type='SCT_TOWN_MOTION',group=8,state='USN_IDLE',source='TOWN',ambiguous=False)],
            ('CASTER','TOWN_IDLE'):[dict(type='SCT_TOWN_MOTION',group=8,state='USN_IDLE',source='TOWN',ambiguous=False)],
            ('STRIKER','OTHER'):[dict(type='SCT_DUNGEON_MOTION',group=8,state='USN_IDLE',source='DUNGEON',ambiguous=False)]}
        names=package_names([row],{'ST_SKIN':('#Cffcc00실제 스킨#CX','STRING_TABLE')},registrations)
        self.assertEqual(set(names),{('STRIKER','TOWN_IDLE')})
        clip=decorate([dict(name='TOWN_IDLE')],'STRIKER',names)[0]
        self.assertEqual(clip['display_name'],'실제 스킨 · TOWN_IDLE')
        self.assertEqual(clip['name_kind'],'context')

    def test_unit_names_follow_declared_reference_and_inheritance_only(self):
        units={'GUST_NPC_MONSTER_BASE.LUA':unit_header({'GAME_UNIT_TEMPLET':dict(m_MotionFileName='rig.x',m_Name='ST_BASE')}),
            'GUST_NPC_MONSTER_CHILD.LUA':dict(parent='GUST_NPC_MONSTER_BASE',m_Name='ST_CHILD'),
            'GUST_NPC_PET_LOOP.LUA':dict(parent='GUST_NPC_PET_LOOP')}
        names,kinds,errors=unit_names(units,{'ST_BASE':('원본','strings'),'ST_CHILD':('자식','strings')},{'RIG.X','RIG.XMD','RIG_OTHER.X'})
        self.assertEqual({r[0] for r in names},{'RIG.X','RIG.XMD'})
        self.assertEqual({r[1] for r in names},{'원본','자식'})
        self.assertEqual(kinds['RIG.X'],'monster')
        self.assertIn('GUST_NPC_PET_LOOP.LUA',errors)

    def test_snapshot_upgrades_old_motion_category_and_preserves_saved_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            catalog.process([fixture(root/'one.cmf',[('RIG.X',binary_model(),0),('MOTION_STRIKER.XMD',animation(),0),
                ('UNPROVEN.X',binary_model(),0)])],root/'assets')
            with catalog.connect() as db:
                db.execute("UPDATE entries SET category='other',detail='기타 파일' WHERE format='xmd'")
            with closing(sqlite3.connect(catalog.workspace/'game-names.sqlite3')) as db,db:
                db.executescript('''PRAGMA user_version=1; CREATE TABLE metadata(key TEXT,value TEXT);
                    CREATE TABLE names(filename TEXT,label TEXT,priority INTEGER);
                    CREATE TABLE resource_groups(filename TEXT,kind TEXT);
                    CREATE TABLE motion_names(character TEXT,clip TEXT,details_json TEXT);''')
                db.execute("INSERT INTO names VALUES('RIG.X','실제 몬스터',1)")
                db.execute("INSERT INTO resource_groups VALUES('RIG.X','monster')")
                db.execute('INSERT INTO motion_names VALUES(?,?,?)',('STRIKER','MOVE',json.dumps([dict(label='인사하기',kind='skill',skill_id='SI_COMMON_EMOTION_HELLO')])) )
            result=build(catalog)
            self.assertEqual(result['files'],3);self.assertEqual(result['official_file_names'],1)
            self.assertEqual(result['official_clip_names'],1)
            report=json.loads(Path(result['report']).read_text(encoding='utf-8'))
            motion=next(f for f in report['files'] if f['format']=='xmd')
            self.assertEqual(Path(motion['output']).read_bytes(),animation())
            self.assertEqual(catalog.get(motion['id'])['category'],'models')
            self.assertEqual(ModelGroups(catalog).browse(dict(mode='files',kind='monster'))['total'],1)
            self.assertEqual(ModelGroups(catalog).browse(dict(mode='files',format='xmd'))['total'],1)
            previous=Path(result['report']).read_bytes();cancel=threading.Event();cancel.set()
            with self.assertRaises(Cancelled):build(catalog,cancel)
            self.assertEqual(Path(result['report']).read_bytes(),previous)

    def test_cli_extract_postprocesses_once_and_explicit_opt_out_works(self):
        import explorer
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=fixture(root/'one.cmf',[('one.txt',b'asset',0)])
            catalog=Catalog(root/'work');catalog.scan([source])
            args=['explorer.py','--workspace',str(catalog.workspace),'extract','--output',str(root/'assets')]
            with patch('sys.argv',args),patch('closers.postprocess.run',return_value=dict(failed=0)) as run,redirect_stdout(io.StringIO()):
                self.assertEqual(explorer.main(),0);run.assert_called_once()
            with patch('sys.argv',args+['--no-postprocess']),patch('closers.postprocess.run') as run,redirect_stdout(io.StringIO()):
                self.assertEqual(explorer.main(),0);run.assert_not_called()
