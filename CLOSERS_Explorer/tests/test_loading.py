import struct
import unittest
from unittest.mock import Mock, patch

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
        data = LoadingData(Mock())
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
