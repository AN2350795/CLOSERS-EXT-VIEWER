import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

from closers.loading import LoadingData, region
from closers.lua_literals import tables


def literal_chunk(opcodes, constants):
    def string(s):
        raw = s.encode()+b'\0'
        return struct.pack('<Q', len(raw))+raw
    body = b'\x1bLuaQ\0\x01\x04\x08\x04\x08\0'+string('fixture')+bytes(12)
    body += struct.pack('<I', len(opcodes))+struct.pack('<'+'I'*len(opcodes), *opcodes)
    body += struct.pack('<I', len(constants))
    for value in constants:
        body += b'\x04'+string(value) if isinstance(value, str) else b'\x03'+struct.pack('<d', value)
    return body


class LoadingTests(unittest.TestCase):
    def test_effect_uses_registered_frames_times_scale_and_latency(self):
        data = LoadingData(Mock())
        seq = dict(m_SeqName='EFFECT', m_ParticleType='PCT_2D_PLANE', m_LifeTime=99999,
            m_iMaxParticleNum=1, m_SrcBlend='CON_D3DBLEND_SRCALPHA', m_DestBlend='CON_D3DBLEND_INVSRCALPHA',
            m_fLatencyTime=.49, m_vecEventList={
                1:{1:'PCET_INITIAL',2:'PCET_TEXTURE','STR':'a.png'},
                2:{1:'PCET_INITIAL',2:'PCET_TEX_ANIM','STR':'ANIM'},
                3:{1:'PCET_INITIAL',2:'PCET_SIZE','XYZ':{1:100,2:50}},
                4:{1:'PCET_INITIAL',2:'PCET_SCALE','VAL':2}})
        def table(name):
            if name == 'TEX_ANIM_DATA.LUA':
                return {'m_mapTexAnimData':{1:dict(m_AnimName='ANIM',m_vecFrame={
                    1:dict(m_TexName='a.png',m_fTime=2),2:dict(m_TexName='b.png',m_fTime=.03)})}}
            return {'PARTICLE_SYSTEM':{1:seq}}
        data.table = table
        data.image_id = lambda name: {'a.png':1,'b.png':2}[name]
        preset = dict(effects='"EFFECT",',positions='{125,200},',scales='{1,2},')
        effects, warnings = data.effects(preset)
        self.assertEqual(warnings, [])
        self.assertEqual(effects[0]['frames'], [dict(entry_id=1,duration=2),dict(entry_id=2,duration=.03)])
        self.assertEqual((effects[0]['x'],effects[0]['y'],effects[0]['width'],effects[0]['height']), (25,100,200,200))
        self.assertEqual(effects[0]['delay'], .49)
        seq['m_MaskTexName'] = 'mask.png'
        effects, warnings = data.effects(preset)
        self.assertEqual(effects, [])
        self.assertIn('EFFECT', warnings[0])

    def test_same_name_different_images_are_not_selected_automatically(self):
        from closers.catalog import Catalog
        from test_explorer import fixture
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            catalog = Catalog(root/'work')
            catalog.scan([fixture(root/'a.cmf',[('frame.PNG',b'first',0)]),
                          fixture(root/'b.cmf',[('frame.PNG',b'second',0)])])
            with self.assertRaisesRegex(ValueError, '서로 다른 이미지'):
                LoadingData(catalog).image_id('frame.png')

    def test_literal_named_table_and_reject_calls(self):
        # TEXTURE_UV = { m_Key = 'TOP' }; bytecode is read, never executed.
        body = literal_chunk([10, 9 | 256 << 23 | 257 << 14, 7 | 2 << 14, 30], ['m_Key', 'TOP', 'TEXTURE_UV'])
        self.assertEqual(tables(body), {'TEXTURE_UV': {'m_Key': 'TOP'}})
        with self.assertRaises(ValueError): tables(literal_chunk([28], []))
        with self.assertRaises(ValueError): tables(body[:-2])

    def test_region_validates_four_corners(self):
        uv = dict(m_LeftTop={1: 0, 2: 172}, m_RightTop={1: 450, 2: 172},
                  m_LeftBottom={1: 0, 2: 256}, m_RightBottom={1: 450, 2: 256})
        self.assertEqual(region(uv), dict(x=0, y=172, width=450, height=84))
        uv['m_RightBottom'][2] = 255
        with self.assertRaises(ValueError): region(uv)

    def test_plan_uses_game_placement_and_named_mark(self):
        data = LoadingData(MagicMock())
        data.presets = lambda: [dict(id=67, image='frame.PNG', top='TOP', bottom='BOT',
                                    mark='marks.PNG', mark_key='SUMMER', effects='')]
        data.image_id = lambda name: 1 if name == 'frame.PNG' else 2
        data.atlas = lambda name: dict(TOP=dict(x=0,y=0,width=450,height=170),
            BOT=dict(x=0,y=172,width=450,height=84), SUMMER=dict(x=322,y=0,width=161,height=161))
        def pic(uv,x,y,w,h):
            return dict(UVKey=uv,m_Pos={1:x,2:y},m_fWidth=w,m_fHeight=h)
        dialog = dict(DIALOG=dict(CONTROL={1:dict(m_Name='SLOT_1_INFO',m_vecPicData={
            1:pic('LOADING_DUNGEON',2,2,450,640),2:pic('TOP',2,2,450,170),3:pic('BOT',2,558,450,84)})}))
        with patch('closers.loading.tables', return_value=dialog), patch.object(data, 'body', return_value=b''):
            result = data.plan(67)
        self.assertEqual(result['layers'][1]['y'], 556)
        self.assertEqual(result['layers'][1]['width'], 450)
        self.assertEqual(result['mark']['crop']['x'], 322)
        self.assertEqual(result['mark']['crop']['width'], 161)


if __name__ == '__main__': unittest.main()
