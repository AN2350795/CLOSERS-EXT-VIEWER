import copy
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest

from closers.model_visibility import frame_patterns,model_rule,apply_visibility
from closers.catalog import Catalog
from closers.model_library import Models
from test_explorer import fixture
from test_model import binary_model


def lua_patterns(patterns):
    def string(s):
        data=s.encode()+b'\0';return struct.pack('<Q',len(data))+data
    def instruction(op,a=0,b=0,c=0,bx=None):
        return op|(a<<6)|((bx<<14) if bx is not None else (b<<23)|(c<<14))
    constants=['FRAME_UNIQUE_ID'];code=[instruction(10)]
    for reg,(prefix,ident) in enumerate(patterns,1):
        constants.extend([prefix,float(ident)])
        code.extend([instruction(10,reg),instruction(1,reg+1,bx=len(constants)-2),
                     instruction(1,reg+2,bx=len(constants)-1),instruction(34,reg,b=2,c=1)])
    code.extend([instruction(34,b=len(patterns),c=1),instruction(7,bx=0)])
    body=b'\x1bLuaQ\0\x01\x04\x08\x04\x08\0'+string('@fixture')+b'\0'*12
    body+=struct.pack('<I',len(code))+struct.pack('<'+'I'*len(code),*code)+struct.pack('<I',len(constants))
    for value in constants:
        body+=b'\x04'+string(value) if isinstance(value,str) else b'\x03'+struct.pack('<d',value)
    return body


class ModelVisibilityTests(unittest.TestCase):
    def test_static_lua_constructor_preserves_prefix_order(self):
        patterns=[['EQ_LEG2',2],['WSM_EQ_LEG2',2],['EQ_LEG',1]]
        body=lua_patterns(patterns)
        self.assertEqual(frame_patterns(body),patterns)
        for broken in (body[:20],b'not lua',lua_patterns([['BAD-NAME',2]]),lua_patterns([['EQ_LEG',300]])):
            with self.subTest(broken=broken[:12]),self.assertRaises(ValueError):frame_patterns(broken)
        # An executable opcode before the literal table publication is rejected.
        pos=12+8+len('@fixture')+1+12+4
        altered=bytearray(body);struct.pack_into('<I',altered,pos,28)
        with self.assertRaises(ValueError):frame_patterns(bytes(altered))

    def test_model_group_priority_columns_validate_input(self):
        values=[0]*36;values[33]=1;values[34]='1, 2,3,3,'
        self.assertEqual(model_rule(values),dict(priority=1,groups=[1,2,3]))
        for groups in ('2;x','-1','256','2 3'):
            values[34]=groups
            with self.assertRaises(ValueError):model_rule(values)

    def test_priority_hides_only_lower_priority_named_group(self):
        parts=[dict(frames=[dict(name='UPPER')],meshes=[dict(name='shirt',frame=0)]),
               dict(frames=[dict(name='EQ_LEG2_FOOT'),dict(name='WSM_EQ_LEG3_FOOT'),dict(name='SHOE')],
                    meshes=[dict(name='leg2',frame=0),dict(name='leg3',frame=1),dict(name='shoe',frame=2)])]
        rows=[dict(id=1,name='UPPER.X'),dict(id=2,name='FOOT.X')]
        rules={'UPPER.X':dict(priority=1,groups=[2]),'FOOT.X':dict(priority=0,groups=[])}
        patterns=[['EQ_LEG2',2],['WSM_EQ_LEG3',3],['EQ_LEG',1]]
        original=copy.deepcopy(parts)
        hidden=apply_visibility(parts,rows,rules,patterns)
        self.assertEqual([h['mesh'] for h in hidden],['leg2'])
        self.assertFalse(parts[1]['meshes'][1]['equipment_hidden'])
        self.assertEqual(apply_visibility(list(reversed(copy.deepcopy(original))),list(reversed(rows)),rules,patterns),hidden)
        rules['FOOT.X']['priority']=1
        self.assertFalse(apply_visibility(parts,rows,rules,patterns))
        rules.pop('FOOT.X')
        self.assertFalse(apply_visibility(parts,rows,rules,patterns))
        self.assertFalse(apply_visibility(parts[1:],rows[1:],rules,patterns))

    def test_incomplete_dye_configuration_does_not_remove_leg_surface(self):
        part=dict(frames=[dict(name='EQ_LEG_FOOT')],meshes=[dict(name='leg',frame=0)])
        rows=[dict(id=1,name='LOWER.X'),dict(id=2,name='FOOT.X')]
        parts=[dict(frames=[],meshes=[]),copy.deepcopy(part)]
        rules={'LOWER.X':dict(priority=1,groups=[1]),'LOWER_DYE.X':dict(priority=1,groups=[1]),'FOOT.X':dict(priority=0,groups=[])}
        self.assertFalse(apply_visibility(parts,rows,rules,[['EQ_LEG',1]]))
        rows.append(dict(id=3,name='LOWER_DYE.X'));parts.append(dict(frames=[],meshes=[]))
        self.assertEqual([h['mesh'] for h in apply_visibility(parts,rows,rules,[['EQ_LEG',1]])],['leg'])

    def test_hair_eyebrows_replace_face_without_index_or_owner_rule(self):
        rows=[dict(id=1,name='300100102_GUST_USER_CASTER_BASIC_EP_AVATAR_DEFENCE_HAIR.X'),
              dict(id=2,name='300100103_GUST_USER_CASTER_BASIC_EP_AVATAR_DEFENCE_FACE.X')]
        def part(prefix):
            return dict(frames=[dict(name=prefix+'EQ_EYEBROW_CASTER'),dict(name='FACE')],
                        meshes=[dict(name='brow',frame=0,vertices=[0,0,0]),dict(name='surface',frame=1)])
        original=[part(''),part('WSM_')]
        for rules,patterns in (({},[]),({rows[0]['name']:dict(priority=1,groups=[5])},[['WSM_EQ_EYEBROW',5]])):
            for reverse in (False,True):
                parts=copy.deepcopy(original);selected=rows.copy()
                if reverse:parts.reverse();selected.reverse()
                hidden=apply_visibility(parts,selected,rules,patterns)
                self.assertEqual([(h['entry_id'],h['mesh']) for h in hidden],[(2,'brow')])
                for p,r in zip(parts,selected):
                    self.assertEqual(p['meshes'][0]['equipment_hidden'],r['id']==2)
                    self.assertFalse(p['meshes'][1]['equipment_hidden'])

        # No eyebrow geometry, an accessory or a different character cannot
        # replace the selected face's eyebrows. A face alone keeps its brows.
        for hair_name in (rows[0]['name'].replace('CASTER','STRIKER'),
                          rows[0]['name'].replace('DEFENCE_HAIR','ACC_HEAD_HAIR')):
            self.assertFalse(apply_visibility(copy.deepcopy(original),[dict(id=1,name=hair_name),rows[1]],{},[]))
        parts=copy.deepcopy(original);parts[0]['meshes'][0]['vertices']=[]
        self.assertFalse(apply_visibility(parts,rows,{},[]))
        self.assertFalse(apply_visibility([copy.deepcopy(original[1])],[rows[1]],{},[]))

    def test_embedded_hair_eyebrows_use_face_exclusive_skin_bones(self):
        # J's Volume Straight Perm has one hair mesh, no EYEBROW frame and
        # conflicting item rules. Its embedded brows use the face's brow bones.
        rows=[dict(id=1,name='300300302_GUST_USER_FIGHTER_ALPHA_A_EP_AVATAR_DEFENCE_HAIR.X'),
              dict(id=2,name='300300103_GUST_USER_FIGHTER_BASIC_EP_AVATAR_DEFENCE_FACE.X')]
        def mesh(name,bones):
            return dict(name=name,frame=-1,vertices=[0,0,0,1,0,0,0,1,0],indices=[0,1,2],
                        skin=[dict(bone=b,indices=[0,1,2],weights=[1,1,1]) for b in bones])
        hair=mesh('FIGHTER_ALPHA_A_EP_AVATAR_DEFENCE_HAIR_MC',['HEAD','BROW_L','BROW_R'])
        face=dict(frames=[],meshes=[mesh('EQ_EYEBROW_FIGHTER_BASIC_EYE_NEW_MC',['BROW_L','BROW_R']),
                                   mesh('FIGHTER_BASIC_EYE_NEW_2_MC',['HEAD','EYE']),
                                   mesh('FIGHTER_FACE_SDF_MC',['HEAD'])])
        original=[dict(frames=[],meshes=[hair]),face]
        for reverse in (False,True):
            parts=copy.deepcopy(original);selected=rows.copy()
            if reverse:parts.reverse();selected.reverse()
            hidden=apply_visibility(parts,selected,{},[])
            self.assertEqual([(h['entry_id'],h['mesh']) for h in hidden],[(2,'EQ_EYEBROW_FIGHTER_BASIC_EYE_NEW_MC')])
            self.assertEqual(sum(m['equipment_hidden'] for p in parts for m in p['meshes']),1)
        # Shared head/eye bones alone, unused vertices and zero weights are
        # insufficient evidence that hair provides replacement eyebrows.
        for mode in ('shared','zero','unused','shared_with_skin','hidden_hair','other_character'):
            parts=copy.deepcopy(original);selected=copy.deepcopy(rows);rules={};patterns=[]
            h=parts[0]['meshes'][0]
            if mode=='shared':h['skin']=h['skin'][:1]
            elif mode=='zero':
                for s in h['skin'][1:]:s['weights']=[0,0,0]
            elif mode=='unused':
                h['vertices'].extend([0]*9)
                for s in h['skin'][1:]:s['indices']=[3,4,5]
            elif mode=='shared_with_skin':
                parts[1]['meshes'][2]['skin'].extend(copy.deepcopy(h['skin'][1:]))
            elif mode=='hidden_hair':
                rules={rows[0]['name']:dict(priority=0,groups=[]),rows[1]['name']:dict(priority=1,groups=[11])}
                patterns=[['FIGHTER_ALPHA',11]]
            else:selected[0]['name']=selected[0]['name'].replace('FIGHTER','CASTER')
            apply_visibility(parts,selected,rules,patterns)
            with self.subTest(mode=mode):self.assertFalse(parts[1]['meshes'][0]['equipment_hidden'])

    def test_scene_consumes_optional_index_without_changing_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            names=[f'{i}_GUST_USER_REAPER_CLOTH_14_A_EP_AVATAR_DEFENCE_{part}.X' for i,part in enumerate(['UPBODY','FOOT'])]
            source=fixture(root/'source.cmf',[(name,binary_model(),1) for name in names])
            catalog.process([source],root/'assets')
            rows=catalog.entries({})['items'];ids={r['name']:r['id'] for r in rows};models=Models(catalog)
            self.assertFalse(models.scene([ids[n] for n in names])['equipment_visibility']['available'])
            before={r['id']:Path(r['output']).read_bytes() for r in rows}
            with closing(sqlite3.connect(catalog.game_names.path)) as db, db:
                db.executescript('PRAGMA user_version=1; CREATE TABLE names(filename,label,priority); CREATE TABLE metadata(key,value); CREATE TABLE model_visibility(filename,priority,groups_json);')
                db.execute('INSERT INTO metadata VALUES(?,?)',('model_frame_patterns',json.dumps([['ROOT',2]])))
                db.executemany('INSERT INTO model_visibility VALUES(?,?,?)',[(names[0].upper(),1,'[2]'),(names[1].upper(),0,'[]')])
            scene=models.scene([ids[n] for n in names])
            self.assertTrue(scene['equipment_visibility']['available'])
            self.assertEqual([m['source_id'] for m in scene['meshes'] if m['equipment_hidden']],[ids[names[1]]])
            self.assertEqual(before,{r['id']:Path(r['output']).read_bytes() for r in rows})
