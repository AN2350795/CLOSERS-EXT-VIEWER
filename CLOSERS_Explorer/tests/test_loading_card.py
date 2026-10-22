import unittest
from unittest.mock import Mock, patch

from closers.loading_card import font_data, info_plan


class LoadingCardTests(unittest.TestCase):
    def test_info_plan_uses_game_rectangles_fonts_and_grade_sequences(self):
        data = Mock()
        pic = lambda **kw: kw
        controls = {
            1: dict(m_Name='SLOT_1_INFO', m_Pos={1:21,2:22}, m_fWidth=454, m_fHeight=724,
                m_vecPicData={1:pic(m_Pos={1:2,2:642},m_fWidth=450,m_fHeight=80,TexName='GAUGE.PNG',UVKey='CHAR_GAUGE')},
                m_vecTextData={1:dict(m_Pos={1:94,2:312},m_AlignY='AT_CENTER'),
                    2:dict(m_Pos={1:142,2:312},m_AlignY='AT_CENTER'),
                    3:dict(m_Pos={1:94,2:332},m_AlignY='AT_CENTER',m_Color={1:1,2:.8,3:0,4:1}),
                    4:dict(m_Pos={1:-10,2:322},m_AlignX='AT_RIGHT',m_AlignY='AT_CENTER',m_FTFontID='FFI_UI_BIG1')}),
            2:dict(m_Name='SLOT_1_IMG',m_Pos={1:21,2:22},m_vecPicData={1:pic(m_Pos={1:2,2:643},m_fWidth=450,m_fHeight=79,TexName='MODAL.PNG')}),
            3:dict(m_Name='SLOT_1_AGENT_GRADE',m_Pos={1:63,2:703},m_vecPicData={1:dict(m_ParticleScale={1:.5,2:.5})})}
        font = dict(m_FontName='NanumGothicExtraBold.ttf',m_FontSize=13,m_OutLineSize=1,m_fFontOutLineColorFactor=.3,m_fBoldRate=4.5)
        uv = dict(m_Key='CHAR_GAUGE',m_LeftTop={1:43,2:43},m_RightTop={1:61,2:43},m_LeftBottom={1:43,2:127},m_RightBottom={1:61,2:127})
        data.table.side_effect = lambda name: {
            'DLG_LOADING_DUNGEON_START_V2.LUA':dict(DIALOG=dict(CONTROL=controls)),
            'FONT_MANAGER.LUA':dict(FREE_TYPE_FONT={1:dict(font,m_FontID='FFI_DEFAULT'),2:dict(font,m_FontID='FFI_UI_BIG1',m_FontName='NanumGothicBold.ttf',m_FontSize=24)}),
            'GAUGE.TET':dict(TEXTURE_UV={1:uv})}[name]
        data.layout.return_value=dict(area=dict(x=23,y=24,height=640))
        data.image_id.return_value=7
        data.effects.return_value=([dict(x=8,y=647,width=64,height=64,frames=[dict(entry_id=9,duration=1)],color=[1,1,1,1],delay=0,blend='source-over')], [])
        with patch('closers.loading_card.font_data',return_value=b'font'):
            plan=info_plan(data)
        self.assertEqual(plan['height'],80)
        self.assertEqual([(v['key'],v['x'],v['y'],v['size']) for v in plan['fields']],
            [('level',92,672,13),('character',140,672,13),('name',92,692,13),('progress',442,682,24)])
        self.assertEqual(plan['fields'][2]['color'],[1,.8,0,1])
        self.assertEqual(plan['fields'][3]['align'],'right')
        self.assertEqual((plan['pictures'][0]['x'],plan['pictures'][0]['y']),(0,641))
        self.assertEqual(plan['pictures'][1]['crop'],dict(x=43,y=43,width=18,height=84))
        self.assertTrue(plan['pictures'][1]['gauge'])
        self.assertFalse(plan['pictures'][0]['gauge'])
        self.assertEqual([v['name'] for v in plan['emblems']],['D','C','B','A','S','SS','SSS','X'])
        self.assertEqual(data.effects.call_count,8)
        self.assertEqual(data.effects.call_args.args[0]['positions'],'{{40,679}}')
        self.assertEqual(data.effects.call_args.args[0]['scales'],'{{0.5,0.5}}')

    def test_font_endpoint_only_accepts_known_game_fonts(self):
        data=Mock()
        for name in ('../CW.EXE','CW.EXE','other.ttf'):
            with self.subTest(name=name),self.assertRaises(ValueError):
                font_data(data,name)
        data.body.assert_not_called()

