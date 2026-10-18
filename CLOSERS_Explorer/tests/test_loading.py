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
    def test_localized_names_strip_game_color_codes_and_cache_decoding(self):
        from test_game_names import table
        data=LoadingData(Mock());data.keys=(b'',b'')
        body=table((5,8,8),[(1,'ST_SKIN_NAME_7','#CFFCC00암흑의 광휘#CX'),(2,'ST_FRAME_NAME_67','알로하 아일랜드'),(3,'UNRELATED','기타')])
        data.body=lambda name:body
        with patch('closers.loading.ntf.decrypt',side_effect=lambda payload,*args:payload) as decrypt:
            names=data.strings();data.strings()
        self.assertEqual(names,{'ST_SKIN_NAME_7':'암흑의 광휘','ST_FRAME_NAME_67':'알로하 아일랜드'})
        decrypt.assert_called_once()
    def test_thumbnails_assemble_frame_and_crop_single_mark(self):
        from PIL import Image
        import hashlib
        from io import BytesIO
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'sheet.png'
            image = Image.new('RGBA',(450,256));image.paste((255,0,0,255),(0,0,450,170));image.paste((0,0,255,255),(0,172,450,256));image.save(path)
            metadata = dict(width=450,height=256,image_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
            composition = Mock();composition.prepare.return_value = path,metadata
            data = LoadingData(MagicMock())
            data._plan = Mock(return_value=dict(width=450,height=640,effects=[],layers=[
                dict(entry_id=1,crop=dict(x=0,y=0,width=450,height=170),x=0,y=0,width=450,height=170),
                dict(entry_id=1,crop=dict(x=0,y=172,width=450,height=84),x=0,y=556,width=450,height=84)],
                mark=dict(entry_id=1,crop=dict(x=0,y=172,width=84,height=84))))
            frame = data.thumbnail(1,'frame',composition)
            with Image.open(BytesIO(frame)) as preview:
                self.assertEqual(preview.size,(144,205))
                self.assertEqual(preview.getpixel((0,0)),(255,0,0,255))
                self.assertEqual(preview.getpixel((0,204)),(0,0,255,255))
                self.assertEqual(preview.getpixel((72,100))[3],0)
            with Image.open(BytesIO(data.thumbnail(1,'mark',composition))) as mark:
                self.assertEqual(mark.size,(128,128));self.assertEqual(mark.getpixel((64,64)),(0,0,255,255))
            with self.assertRaises(ValueError): data.thumbnail(1,'invalid',composition)

    def test_illustration_menu_filters_names_and_excludes_other_images(self):
        from closers.catalog import Catalog
        from test_explorer import fixture
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp);catalog = Catalog(root/'work')
            catalog.scan([fixture(root/'a.cmf',[(name,b'image',0) for name in (
                'DLG_PVP_LOADING_ALPHA.PNG','DLG_PVP_LOADING_BETA.PNG','DLG_FRAME_1.PNG','OTHER.PNG')])])
            # Signature-free fixture data is categorized using the PNG extension.
            data = LoadingData(catalog)
            data.illustration_registry = lambda: {name:[dict(illust_id=i,character='GUST_USER_STRIKER',string_key='NAME_'+str(i))] for i,name in enumerate(('DLG_PVP_LOADING_ALPHA.PNG','DLG_PVP_LOADING_BETA.PNG'))}
            data.strings = lambda: {'NAME_0':'첫 로딩','NAME_1':'두 번째 로딩'}
            self.assertEqual(data.illustrations()['total'],2)
            self.assertEqual(data.illustrations('BETA')['items'][0]['name'],'DLG_PVP_LOADING_BETA.PNG')
            self.assertEqual(data.illustrations('두 번째')['items'][0]['display_name'],'두 번째 로딩')
            self.assertEqual(data.illustrations('%')['total'],0)

    def test_registration_excludes_portraits_and_unregistered_characters(self):
        from test_game_names import table
        data = LoadingData(Mock())
        skin = table((8,4,4,12,8,12,8,8),[('VERSION',7,1,0,'"GUST_USER_STRIKER"',0,'NAME','DESC')])
        convert = table((4,8,2,8),[(7,'GUST_USER_STRIKER',3,'loading.PNG'),(7,'GUST_USER_STRIKER',2,'portrait.PNG'),
            (7,'GUST_USER_CASTER',3,'wrong-character.PNG'),(9,'GUST_USER_STRIKER',3,'unregistered.PNG')])
        data.body = lambda name: skin if name=='ILLUST_TEMPLET.NTF' else convert
        self.assertEqual(list(data.illustration_registry()),['LOADING.PNG'])

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
        data.image_id = Mock(side_effect=lambda name: {'a.png':1,'b.png':2}[name])
        preview, warnings = data.effects(preset, preview=True)
        self.assertEqual(len(preview[0]['frames']),1)
        data.image_id.assert_called_once_with('a.png')
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
            with patch.object(data,'effects',side_effect=AssertionError('unrelated frame effects')):
                mark = data.plan(67,mark_only=True)
                self.assertIsNone(mark['mark']['placement'])
                registered = pic('SUMMER',32,42,106,106);registered['TexName']='marks.PNG'
                dialog['DIALOG']['CONTROL'][1]['m_vecPicData'][4]=registered
                positioned = data.plan(67,mark_only=True)
        self.assertEqual(result['layers'][1]['y'], 556)
        self.assertEqual(result['layers'][1]['width'], 450)
        self.assertEqual(result['mark']['crop']['x'], 322)
        self.assertEqual(result['mark']['crop']['width'], 161)
        self.assertEqual(mark['layers'],[])
        self.assertEqual(mark['mark']['entry_id'],2)
        self.assertEqual(positioned['mark']['placement'],dict(x=30,y=40,width=106,height=106))


if __name__ == '__main__': unittest.main()
