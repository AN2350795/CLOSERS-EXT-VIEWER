import json
import sqlite3
import struct
import tempfile
from pathlib import Path
import unittest
from contextlib import closing

from closers.lua_literals import tables
from closers.motion_names import join,decorate,character_layers
from closers.catalog import Catalog
from closers.game_names import GameNames
from closers.model_library import Models
from test_explorer import fixture
from test_model import binary_model,animation


def literal_table(name,value):
    def string(text):
        body=text.encode('cp949')+b'\0';return struct.pack('<Q',len(body))+body
    constants=[];code=[]
    def op(code_id,a=0,b=0,c=0,bx=None):
        code.append(code_id|(a<<6)|((bx<<14) if bx is not None else (b<<23)|(c<<14)))
    def constant(text):
        constants.append(text);return len(constants)-1
    def build(value,register):
        if isinstance(value,dict):
            op(10,register)
            for key,child in value.items():
                build(child,register+1);op(9,register,b=256+constant(str(key)),c=register+1)
        else:op(1,register,bx=constant(value))
    build(value,0);op(7,bx=constant(name));op(30)
    return (b'\x1bLuaQ\0\x01\x04\x08\x04\x08\0'+string('@fixture')+b'\0'*12+
            struct.pack('<I',len(code))+struct.pack('<'+'I'*len(code),*code)+struct.pack('<I',len(constants))+
            b''.join(b'\x04'+string(v) for v in constants))


class MotionNameTests(unittest.TestCase):
    def test_boolean_literal_opcode_without_running_lua(self):
        body=bytearray(literal_table('BOOL','unused'))
        offset=12+8+len('@fixture')+1+12+4
        # LOADBOOL replaces LOADK; external functions remain unsupported.
        struct.pack_into('<I',body,offset,2|(1<<23))
        self.assertIs(tables(bytes(body))['BOOL'],True)

    def test_build_publishes_join_with_common_state_inheritance(self):
        import base64,zlib
        from unittest.mock import patch
        from closers import ntf
        from closers.game_names import build_index
        from test_game_names import table
        try:from Crypto.Cipher import AES
        except ImportError:self.skipTest('pycryptodome unavailable')
        key=bytes(range(32));iv=bytes(range(16))
        def encrypt(body):
            pad=16-len(body)%16
            return base64.b64encode(AES.new(key,AES.MODE_CBC,iv).encrypt(body+bytes([pad])*pad))
        def strings(records):
            body=table((5,8,8),records);return body[:20]+encrypt(body[20:])
        model_types=(5,8,8,8,8)+(12,)*28+(4,8,8)
        model=[100,'GUST_USER_STRIKER','123_GUST_USER_STRIKER_BASIC_EP_AVATAR_HAIR.X','','',*([0]*31)];model[33:]=[1,'','']
        item_types=(8,5,8,8,8,8,8)+(12,)*4+(8,)+(12,)*194
        item=['CVN',100,'ITEM_NAME','BASIC','','','',*([0]*4),'GUST_USER_STRIKER',*([0]*194)]
        files=[('STRING_TABLE_ITEM_KOREA.NTF',strings([(1,'ITEM_NAME','시험 머리')])),
               ('ITEM_MODEL_TEMPLET.NTF',table(model_types,[model])),('ITEM_TEMPLET.NTF',table(item_types,[item])),
               ('STRING_TABLE_CHAR_KOREA.NTF',strings([(1,'ST_SI_COMMON_EMOTION_HELLO_NAME','인사하기')])),
               ('SKILL_TEMPLET.LUA',literal_table('SKILL_TEMPLET',{'1':{'m_SkillID':'SI_COMMON_EMOTION_HELLO','m_UnitStateName':'USN_EMOTION_HELLO'}})),
               ('GUST_USER_CHARACTER_BASE_TOWN.LUA',literal_table('GAME_UNIT_TEMPLET',{'m_vecAnimAddModelData':{'1':{'m_AnimName':'MOVE','m_XFileName':'PROP.X','m_BoneName':'CHILD'}},'m_mapUnitStateData':{
                   '1':{'m_StateName':'USN_EMOTION_HELLO','m_AnimName':'MOVE','m_PlayType':'XAP_ONE_WAIT','m_AnimEndChangeState':'USN_EMOTION_HELLO_LOOP'},
                   '2':{'m_StateName':'USN_EMOTION_HELLO_LOOP','m_AnimName':'LOOP','m_PlayType':'XAP_LOOP','m_CancelState':'USN_EMOTION_HELLO_END'},
                   '3':{'m_StateName':'USN_EMOTION_HELLO_END','m_AnimName':'END','m_PlayType':'XAP_ONE_WAIT','m_AnimEndChangeState':'USN_ASTAND'}}})),
               ('GUST_USER_BASE_STRIKER.LUA',literal_table('BASE_TEMPLATE',{'m_GameUnitSubType':'GUST_USER_CHARACTER_BASE_TOWN'}))]
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work');exe=root/'CW.EXE';exe.write_bytes(b'fixture')
            source=fixture(root/'one.cmf',[(n,b,1,encrypt(zlib.compress(b))) for n,b in files]);catalog.scan([source])
            with patch.object(ntf,'script_keys',return_value=(key,iv)):result=build_index(catalog.workspace,exe)
            self.assertEqual(result['motion_names'],1)
            self.assertEqual(result['motion_sequences'],1)
            self.assertEqual(result['motion_extras'],1)
            catalog.game_names.refresh()
            self.assertTrue(catalog.game_names.sequence_index_available)
            self.assertEqual([s['name'] for s in catalog.game_names.motion_sequences['STRIKER'][0]['steps']],['MOVE','LOOP','END'])
            self.assertEqual(catalog.game_names.motion_extras['STRIKER','MOVE'][0]['models'],['PROP.X'])
            name=catalog.game_names.motion_names['STRIKER','MOVE'][0]
            self.assertEqual(name['label'],'인사하기')
            self.assertEqual(name['state_table'],'GUST_USER_CHARACTER_BASE_TOWN.LUA')
            self.assertEqual(name['string_table'],'STRING_TABLE_CHAR_KOREA.NTF')

    def test_declared_inheritance_order_and_cycles(self):
        mapping={'GUST_USER_STRIKER.LUA':{'BASE_TEMPLATE':{'m_GameUnitSubType':'GUST_USER_BASE_STRIKER'}},
                 'GUST_USER_BASE_STRIKER.LUA':{'BASE_TEMPLATE':{'m_GameUnitSubType':'GUST_USER_CHARACTER_BASE_TOWN'}},
                 'GUST_USER_CHARACTER_BASE_TOWN.LUA':{}}
        self.assertEqual([n for n,t in character_layers('STRIKER',mapping)],list(reversed(mapping)))
        mapping['GUST_USER_CHARACTER_BASE_TOWN.LUA']={'BASE_TEMPLATE':{'m_GameUnitSubType':'GUST_USER_STRIKER'}}
        with self.assertRaises(ValueError):character_layers('STRIKER',mapping)

    def test_exact_join_character_overrides_shared_names_and_no_guesses(self):
        skills={'SKILL_TEMPLET':{
            1:{'m_SkillID':'SI_COMMON_EMOTION_HELLO','m_UnitStateName':'USN_EMOTION_HELLO',
               'm_vecUnitStateName_ETC':{1:'USN_EMOTION_HELLO_LOOP'}},
            2:{'m_SkillID':'SI_COMMON_EMOTION_OTHER','m_UnitStateName':'USN_EMOTION_HELLO'},
            3:{'m_SkillID':'SI_COMMON_EMOTION_UNKNOWN','m_UnitStateName':'USN_EMOTION_UNKNOWN'}}}
        rigs={'STRIKER':[
            ('base.LUA',{1:{'m_StateName':'USN_EMOTION_HELLO','m_AnimName':'OLD'},
                         2:{'m_StateName':'USN_EMOTION_HELLO_LOOP','m_AnimName':'LOOP'}}),
            ('character.LUA',{1:{'m_StateName':'USN_EMOTION_HELLO','m_AnimName':'MOVE'}})]}
        names=join(skills,rigs,{'ST_SI_COMMON_EMOTION_HELLO_NAME':('#Cffcc00인사하기#CX','main.NTF'),
                               'ST_SI_COMMON_EMOTION_OTHER_NAME':('다른 인사','char.NTF')})
        clips=decorate([{'name':'MOVE'},{'name':'LOOP'},{'name':'OLD'},{'name':'MOVE_EXTRA'}],'STRIKER',names)
        self.assertEqual(clips[0]['game_names'],['인사하기','다른 인사'])
        self.assertEqual(clips[1]['display_name'],'인사하기')
        self.assertNotIn('display_name',clips[2]);self.assertNotIn('display_name',clips[3])
        self.assertEqual(clips[0]['name_sources'][0]['state_table'],'character.LUA')
        self.assertEqual(clips[0]['name_sources'][1]['string_table'],'char.NTF')
        self.assertNotIn('display_name',decorate([{'name':'MOVE'}],'CASTER',names)[0])

    def test_index_optional_offline_stale_and_all_model_apis(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            source=fixture(root/'one.cmf',[('MOTION_STRIKER.X',binary_model(),0),('MOTION_STRIKER_EMOTION_HELLO.XMD',animation(),0)])
            catalog.process([source],root/'assets')
            ids={r['name']:r['id'] for r in catalog.entries({})['items']}
            names=GameNames(catalog.workspace);names.refresh();self.assertEqual(names.motion_names,{})
            self.assertFalse(names.sequence_index_available)
            details=[dict(label='인사하기',skill_id='SI_COMMON_EMOTION_HELLO',state='USN_EMOTION_HELLO',
                          string_key='ST_SI_COMMON_EMOTION_HELLO_NAME',state_table='state.LUA',string_table='string.NTF')]
            with closing(sqlite3.connect(names.path)) as db,db:
                db.executescript('PRAGMA user_version=1; CREATE TABLE metadata(key TEXT,value TEXT); CREATE TABLE names(filename TEXT,label TEXT,priority INTEGER); CREATE TABLE motion_names(character TEXT,clip TEXT,details_json TEXT);')
                stat=source.stat()
                db.execute('INSERT INTO metadata VALUES(?,?)',('sources',json.dumps([dict(archive=str(source),size=stat.st_size,mtime=stat.st_mtime_ns)])))
                db.execute('INSERT INTO motion_names VALUES(?,?,?)',('STRIKER','MOVE',json.dumps(details)))
            models=Models(catalog);rig=ids['MOTION_STRIKER.X'];anim=ids['MOTION_STRIKER_EMOTION_HELLO.XMD']
            source.unlink()
            listing=models.motion_library(rig,[])['files'][0]['clips'][0]
            self.assertEqual(listing['display_name'],'인사하기')
            metadata=models.animations(rig,anim)
            self.assertEqual(metadata['clips'][0]['game_names'],['인사하기'])
            self.assertEqual(models.clip(rig,anim,0,metadata['animation_source']['sha256'])['clip']['display_name'],'인사하기')
            source.write_bytes(b'changed source')
            catalog.game_names.refresh();self.assertEqual(catalog.game_names.motion_names,{})

    def test_literal_moves_and_table_member_lookup_without_executing_calls(self):
        def string(value):
            body=value.encode()+b'\0';return struct.pack('<Q',len(body))+body
        def op(code,a=0,b=0,c=0,bx=None):
            return code|(a<<6)|((bx<<14) if bx is not None else (b<<23)|(c<<14))
        constants=['RESULT','key','value']
        code=[op(10),op(1,1,bx=2),op(9,0,b=257,c=1),op(0,2,b=0),op(6,3,b=2,c=257),op(7,3,bx=0),op(30)]
        prefix=b'\x1bLuaQ\0\x01\x04\x08\x04\x08\0'+string('@fixture')+b'\0'*12
        def chunk(words):return prefix+struct.pack('<I',len(words))+struct.pack('<'+'I'*len(words),*words)+struct.pack('<I',len(constants))+b''.join(b'\x04'+string(v) for v in constants)
        self.assertEqual(tables(chunk(code))['RESULT'],'value')
        with self.assertRaises(ValueError):tables(chunk([op(28)]))
