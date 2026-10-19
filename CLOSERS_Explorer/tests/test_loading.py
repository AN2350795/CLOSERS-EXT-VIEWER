import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

from closers.loading import LoadingData, region, image_crop
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
    def test_game_crop_intersects_source_without_transparent_padding(self):
        self.assertEqual(image_crop(dict(x=125,y=2,width=720,height=1024),1024,1024),
                         dict(x=125,y=2,width=720,height=1022))
        self.assertEqual(image_crop(dict(x=1000,y=1000,width=100,height=100),1024,1024),
                         dict(x=1000,y=1000,width=24,height=24))
        self.assertEqual(image_crop(dict(x=-2,y=-1,width=10,height=8),8,8),
                         dict(x=0,y=0,width=8,height=7))
        for crop in [dict(x=1024,y=0,width=1,height=1),dict(x=0,y=1024,width=1,height=1),
                     dict(x=0,y=0,width=float('nan'),height=1),dict(x=0,y=-1,width=1,height=1)]:
            with self.subTest(crop=crop), self.assertRaises(ValueError):
                image_crop(crop,1024,1024)

    def test_team_challenge_rectangular_frames_start_both_planes_together(self):
        from closers.loading_particles import compile_particle
        seq = dict(m_ParticleType='PCT_2D_PLANE', m_EmitRate=2,
                   m_iMaxParticleNum=2, m_LifeTime=999999, m_vecEventList={})
        for variant in ('BRONZE', 'SILVER', 'GOLD', 'SPECIAL'):
            with self.subTest(variant=variant):
                name = 'PE_UI_TEAM_CHALLENGE_VISUAL_FRAME_'+variant+'_256'
                particle, *_ = compile_particle(dict(seq, m_SeqName=name), [1,1], 1, lambda _: 1)
                self.assertEqual((particle['instant'], particle['maxParticles'], particle['rate']), (2,2,2))
        for name in ('PE_UI_TEAM_CHALLENGE_VISUAL_FRAME_GOLD_256_GLOW',
                     'PE_UI_VISUAL_FRAME_TEAM_CHALLENGE_VISUAL_FRAME_BRONZE', 'UNRELATED'):
            with self.subTest(name=name):
                particle, *_ = compile_particle(dict(seq, m_SeqName=name), [1,1], 1, lambda _: 1)
                self.assertEqual(particle['instant'], 0)

    def test_localized_names_strip_game_color_codes_and_cache_decoding(self):
        from test_game_names import table
        from closers.catalog import Catalog
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        data=LoadingData(Catalog(Path(temp.name)/'work'));data.keys=(b'',b'')
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
            from closers.catalog import Catalog
            catalog = Catalog(Path(temp)/'work')
            data = LoadingData(catalog)
            catalog.get_resource = Mock(return_value=dict(archive=str(path),output=str(path)))
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
        from closers.catalog import Catalog
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        data = LoadingData(Catalog(Path(temp.name)/'work'))
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
        data.image_id = lambda name: {'a.png':1,'b.png':2,'mask.png':3}[name]
        effects, warnings = data.effects(preset)
        self.assertEqual(warnings, [])
        self.assertEqual(effects[0]['particle']['mask_entry_id'],3)
        self.assertEqual(effects[0]['particle']['basis'],[200,200])
        seq['m_vecEventList'][5] = {1:'PCET_INITIAL',2:'UNKNOWN_EVENT','VAL':1}
        effects, warnings = data.effects(preset)
        self.assertEqual(effects, [])
        self.assertIn('EFFECT', warnings[0])

    def test_particle_compiler_preserves_ranges_and_all_loading_event_properties(self):
        from closers.loading_particles import compile_particle, PROPERTIES
        seq = dict(m_ParticleType='PCT_2D_PLANE',m_LifeTime={1:.6,2:.8},m_EmitRate={1:9,2:19},
            m_EmitRateInstant={1:2,2:6},m_iMaxParticleNum=50,m_EmitRadius={1:{1:-220,2:220},2:{1:-47,2:47}},
            m_vGravity={1:{1:-50,2:50}},m_EmitRadiusMin={1:70,2:140,3:0},m_bDualBlending='TRUE',m_DrawCount=1.5,m_DrawCountDualBlending=3,
            m_MaskTexName='mask.dds',m_SrcBlend='CON_D3DBLEND_ZERO',m_DestBlend='CON_D3DBLEND_INVSRCCOLOR',m_vecEventList={})
        for i,(prop,(_,field,count)) in enumerate(PROPERTIES.items()):
            seq['m_vecEventList'][i+1] = {1:'PCET_INITIAL',2:prop,field:{j:{1:.2,2:.4} for j in range(1,count+1)} if count>1 else {1:.2,2:.4}}
        seq['m_vecEventList'][20] = {1:'PCET_FADE_FINAL',2:'PCET_TEX0UV','XY':{1:230000,2:0}}
        seq['m_vecEventList'][21] = {1:'PCET_FADE',2:'PCET_COLOR','RGBA':{1:1,2:1,3:1,4:0},3:.3,4:1.2}
        particle,_,_,_=compile_particle(seq,(1,1),123,lambda name:99)
        self.assertEqual(particle['life'],[.6,.8])
        self.assertEqual(particle['rate'],[9,19])
        self.assertEqual(particle['radius'],[[-220,220],[-47,47],0])
        self.assertEqual(particle['gravity'],[[-50,50],0,0])
        self.assertEqual(particle['radiusMin'],[70,140])
        self.assertTrue(particle['dual'])
        self.assertEqual(particle['blend'],['ZERO','INVSRCCOLOR'])
        self.assertEqual(particle['drawCount'],1)
        self.assertEqual(particle['mask_entry_id'],99)
        self.assertEqual(particle['tracks'][-2],dict(property='uv',mode='final',value=[230000,0],start=0,end=None))
        self.assertEqual(particle['tracks'][-1]['end'],1.2)
        seq['m_vecEventList']={1:{1:'PCET_INITIAL',2:'PCET_SCALE','XYZ':10},2:{1:'PCET_INITIAL',2:'PCET_SIZE','XYZ':{1:4,2:0,3:1}}}
        particle,width,height,_=compile_particle(seq,(1,1),123,lambda name:99)
        self.assertEqual((width,height),(40,.01))
        self.assertEqual(particle['tracks'][0]['value'],[10])

    def test_mark_plan_compiles_separate_effects_without_other_screen_coordinates(self):
        data=LoadingData(MagicMock())
        data.presets=lambda:[dict(id=1,mark='mark.png',mark_key='MARK',mark_effects='"EFFECT",')]
        data.layout=lambda:dict(width=450,height=640,origin={1:2,2:2},pictures=[dict(UVKey='LOADING_DUNGEON',m_fWidth=450,m_fHeight=640)])
        data.image_id=lambda name:1
        data.atlas=lambda name:{'MARK':dict(x=0,y=0,width=161,height=161)}
        data.effects=Mock(return_value=([dict(name='EFFECT')],[]))
        result=data.plan(1,mark_only=True)
        self.assertIsNone(result['mark']['placement'])
        self.assertEqual(result['effects'],[dict(name='EFFECT')])
        data.effects.assert_called_once_with(dict(effects='"EFFECT",',positions='{0,0},',scales='{1,1},'),preview=False)

    def test_effect_thumbnail_preserves_inverse_and_dual_blending(self):
        from PIL import Image
        from closers.loading_particles import composite_preview, preview_passes
        canvas=Image.new('RGBA',(1,1),(255,0,0,255))
        mask=Image.new('RGBA',(1,1),(128,128,128,255))
        result=composite_preview(canvas,mask,['ZERO','INVSRCCOLOR'])
        self.assertEqual(result.getpixel((0,0)),(127,0,0,255))
        glow=Image.new('RGBA',(1,1),(0,0,255,128))
        result=composite_preview(result,glow,['SRCALPHA','DESTALPHA'])
        self.assertEqual(result.getpixel((0,0)),(127,0,128,255))
        transparent=Image.new('RGBA',(1,1))
        black=Image.new('RGBA',(1,1),(0,0,0,255))
        self.assertEqual(composite_preview(transparent,black,['SRCALPHA','DESTALPHA']).getpixel((0,0)),(0,0,0,0))
        passes=preview_passes(dict(color=[1,1,1,1],particle=dict(blend=['ZERO','INVSRCCOLOR'],drawCount=1,
            dual=True,dualDrawCount=2,tracks=[dict(property='dualColor',mode='initial',value=[1,1,1,[.2,.4]])])))
        self.assertAlmostEqual(passes[1][0][3],.3)
        self.assertEqual(passes[1][1:],(['SRCALPHA','DESTALPHA'],2))

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
        uv = dict(m_LeftTop={1:-2,2:-1},m_RightTop={1:8,2:-1},
                  m_LeftBottom={1:-2,2:8},m_RightBottom={1:8,2:8})
        self.assertEqual(region(uv),dict(x=-2,y=-1,width=10,height=9))

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
