import base64
import hashlib
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

from closers import ntf
from closers.catalog import Catalog
from closers.game_names import GameNames,build_index
from closers.model_groups import ModelGroups
from test_explorer import fixture
from test_model import binary_model
from test_model_visibility import lua_patterns


def table(types,records):
    body=bytearray(struct.pack('<'+'I'*(len(types)+2),len(types),*types,len(records)))
    ends=[]
    for record in records:
        for kind,value in zip(types,record):
            if kind==8:
                encoded=value.encode('utf-16-le')
                body.extend(struct.pack('<I',len(encoded)//2)+encoded)
            else:body.extend(int(value).to_bytes(ntf.SIZES[kind],'little'))
        ends.append(len(body))
    return bytes(body)+struct.pack('<'+'I'*len(ends),*ends)


class NtfTests(unittest.TestCase):
    def test_row_boundaries_unicode_and_unknown_types(self):
        body=table((5,8,8),[(123,'ST_ITEM_TEST','시험 의상'),(124,'KEY','😀')])
        self.assertEqual(list(ntf.rows(body))[1],[124,'KEY','😀'])
        for broken in (body[:-1],body+b'junk',body[:12],struct.pack('<I',9999),
                       struct.pack('<4I',1,99,1,16)):
            with self.subTest(broken=broken[:12]),self.assertRaises(ValueError):list(ntf.rows(broken))

    def test_pe_key_locator_without_executing_code(self):
        body=bytearray(1024)
        body[:2]=b'MZ';struct.pack_into('<I',body,60,128);body[128:132]=b'PE\0\0'
        struct.pack_into('<H',body,134,1);struct.pack_into('<H',body,148,240);struct.pack_into('<H',body,152,0x20b)
        struct.pack_into('<8sIIII',body,392,b'.text\0\0\0',512,0x1000,512,512)
        key=bytes(range(32));iv=bytes(range(16));body[712:744]=key;body[752:768]=iv
        site=0x1020
        code=b'\x48\x8d\x15'+struct.pack('<i',0x10c8-(site+7))+b'\x48\x8d\x4c\x24\x40\xe8\0\0\0\0'
        code+=b'\x44\x8b\x4c\x24\x34\x41\xc1\xe9\x04\xc7\x44\x24\x28\x01\0\0\0'
        code+=b'\x48\x8d\x05'+struct.pack('<i',0x10f0-(site+len(code)+7))+b'\x48\x89\x44\x24\x20'
        body[544:544+len(code)]=code
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'test.exe';path.write_bytes(body)
            self.assertEqual(ntf.script_keys(path),(key,iv))
            path.write_bytes(b'not a PE')
            with self.assertRaises(ValueError):ntf.script_keys(path)

    def test_real_index_join_search_ambiguity_and_atomic_failure(self):
        try:from Crypto.Cipher import AES
        except ImportError:self.skipTest('optional pycryptodome needed for index generation test')
        key=bytes(range(32));iv=bytes(range(16))
        def encrypt(value):
            pad=16-len(value)%16
            return base64.b64encode(AES.new(key,AES.MODE_CBC,iv).encrypt(value+bytes([pad])*pad))
        def packed(value):return encrypt(zlib.compress(value))
        name='123_GUST_USER_CASTER_CLOTH_225_A_EP_AVATAR_DEFENCE_UPBODY.X'
        strings=table((5,8,8),[(1,'NAME_A','이슬비 시험 의상 [A타입]'),(2,'NAME_B','이슬비 시험 의상 [B타입]')])
        strings=strings[:20]+encrypt(strings[20:])
        types=(5,8,8,8,8)+(12,)*28+(4,8,8)
        model_values=[100,'GUST_INVALID',name,'','',*([0]*31)]
        model_values[33:]=[1,'2','']
        model_other=model_values.copy();model_other[0]=101
        models=table(types,[model_values,model_other])
        frame_data=lua_patterns([['EQ_LEG2',2],['EQ_LEG',1]])
        types=(8,5,8,8)+(12,)*7+(8,)+(12,)*194
        items=table(types,[('CVN',100,'NAME_A','CLOTH_225_A',*([0]*7),'GUST_USER_CASTER',*([0]*194)),
                           ('CVN',101,'NAME_B','CLOTH_225_B',*([0]*7),'GUST_USER_CASTER',*([0]*194))])
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work');exe=root/'test.exe';exe.write_bytes(b'test')
            source=fixture(root/'source.cmf',[(n,b,1,packed(b)) for n,b in [
                ('STRING_TABLE_ITEM_KOREA.NTF',strings),('ITEM_MODEL_TEMPLET.NTF',models),('ITEM_TEMPLET.NTF',items),('FRAME_UNIQUE_ID.LUA',frame_data)]]+[(name,binary_model(),1)])
            catalog.scan([source]);before=hashlib.sha256(source.read_bytes()).digest()
            with patch.object(ntf,'script_keys',return_value=(key,iv)):
                result=build_index(catalog.workspace,exe)
            self.assertEqual(result['models'],1)
            rows=catalog.entries({'q':'시험 의상'})
            self.assertEqual(rows['total'],1)
            row=rows['items'][0]
            self.assertEqual(row['name'],name)
            self.assertEqual(row['game_name_count'],2)
            self.assertEqual(catalog.game_names.model_rules[name.upper()],dict(priority=1,groups=[2]))
            self.assertEqual(catalog.game_names.frame_patterns,[['EQ_LEG2',2],['EQ_LEG',1]])
            self.assertIn('[A타입]',row['display_name'])
            self.assertEqual(ModelGroups(catalog).browse({'q':'B타입'})['total'],1)
            with catalog.connect() as db:
                where,values=catalog.where({'q':'시험 의상'})
                self.assertEqual(db.execute('SELECT count(*) FROM entries e JOIN archives a ON a.id=e.archive_id WHERE '+where,values).fetchone()[0],1)
            self.assertEqual(hashlib.sha256(source.read_bytes()).digest(),before)
            index=catalog.workspace/'game-names.sqlite3';old=index.read_bytes()
            with patch.object(ntf,'script_keys',return_value=(bytes(32),iv)),self.assertRaises(ValueError):build_index(catalog.workspace,exe)
            self.assertEqual(index.read_bytes(),old)
            source.write_bytes(source.read_bytes()+b'changed')
            self.assertEqual(catalog.entries({'q':'시험 의상'})['total'],0)
            self.assertFalse(catalog.game_names.model_rules)
            source.unlink()
            self.assertEqual(catalog.entries({'q':'시험 의상'})['total'],1)
            with self.assertRaises(ValueError):ntf.restore(packed(b'abc'),2,key,iv)
            with self.assertRaises(ValueError):ntf.decrypt(b'###',key,iv)


if __name__=='__main__':unittest.main()
