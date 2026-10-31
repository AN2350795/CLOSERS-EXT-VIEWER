import struct
import unittest
import json
import re
import tempfile
import threading
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from closers.avatar_lighting import read_profiles
from closers.loading import MissingDefinition
from test_game_names import table


def bits(value):return struct.unpack('<I',struct.pack('<f',value))[0]


class Data:
    def __init__(self,rows):self.rows=rows
    def body(self,name):
        if name not in self.rows:raise MissingDefinition(name)
        return self.rows[name]
    def strings(self):return {'NAME':'테스트 의상 조명'}


class AvatarLightingTests(unittest.TestCase):
    def test_regional_reflection_profiles_and_invalid_sources_are_isolated(self):
        from test_world_lighting import chunk
        sources=self.fixture()
        sources['WI_TOWN_SQUARE_OF_PEACE_TWILIGHT.LUA']=chunk(dict(m_LightData=dict(m_LightParamUnit=dict(
            m_LightType='LT_BASIC',m_LightPos={1:-5000,2:4000,3:0},m_LightColor={1:1,2:1,3:1,4:1},m_fLightIntensity=.9,
            m_SpecularColor={1:1,2:.5,3:.25,4:1},m_fSpecularIntensity=3.98,m_fSpecularPow=3))))
        sources['WI_TOWN_MONTMARTRE_TWILIGHT.LUA']=b'not a static Lua chunk'
        result=read_profiles(Data(sources));self.assertEqual(len(result['profiles']),2)
        self.assertEqual(result['profiles'][1]['global_specular']['intensity'],3.98)
        self.assertEqual(len(result['world_unavailable']),1)
        self.assertNotIn('global_specular',result['profiles'][0])

    def test_authenticated_endpoint_and_browser_module(self):
        from closers.catalog import Catalog
        from closers.server import create_server
        with tempfile.TemporaryDirectory() as temp:
            server=create_server(Catalog(Path(temp)/'work'),0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                base=f'http://127.0.0.1:{server.server_port}'
                html=urlopen(base+'/model').read().decode();token=re.search(r'name="explorer-token" content="([^"]+)"',html)[1]
                with self.assertRaises(HTTPError) as error:urlopen(base+'/api/model-lighting')
                self.assertEqual(error.exception.code,403)
                with urlopen(Request(base+'/api/model-lighting',headers={'X-Explorer-Token':token})) as response:
                    report=json.load(response);self.assertEqual(report['profiles'],[]);self.assertEqual(report['color_grading_presets'],[])
                with self.assertRaises(HTTPError) as error:urlopen(base+'/api/model-lighting-conditions?entries=1')
                self.assertEqual(error.exception.code,403)
                from unittest.mock import patch
                with patch('closers.model_library.Models.scene',return_value={'lighting_conditions':{'selected_items':[12],'status':'incomplete'}}) as scene:
                    with urlopen(Request(base+'/api/model-lighting-conditions?entries=1&condition_items=%5B12%5D',headers={'X-Explorer-Token':token})) as response:
                        self.assertEqual(json.load(response),{'selected_items':[12],'status':'incomplete'})
                    self.assertEqual(scene.call_args.args,([1],None,None,None,None,{},[12]))
                with urlopen(base+'/model-lighting.js') as response:self.assertIn(b'installAvatarLighting',response.read())
                with urlopen(base+'/model-color-grading.js') as response:self.assertIn(b'colorGradingFragment',response.read())
            finally:server.shutdown();server.server_close();thread.join()

    def fixture(self):
        return {'LIGHT_CONVERT_DATA.NTF':table((2,8,8,9,9,9),[(1,'1,.5,.25,1','-30,10,-100',bits(1.025),bits(1.5),bits(0))]),
                'LIGHT_CONVERT_TEMPLET.NTF':table((8,4,4,12,8,12,2,4,8,8),[('CVN_SKIN_COMMON',1411,5,0,'"GUST_USER_ROGUE",',0,1,1409,'NAME','DESC')])}

    def test_source_preset_color_direction_float_bits_and_provenance(self):
        result=read_profiles(Data(self.fixture()));p=result['profiles'][0]
        self.assertEqual(p['label'],'테스트 의상 조명');self.assertEqual(p['color'],[1,.5,.25,1]);self.assertEqual(p['direction'],[-30,10,-100])
        self.assertAlmostEqual(p['intensity'],1.025);self.assertEqual(p['near_intensity'],1.5)
        self.assertEqual(p['characters'],['ROGUE']);self.assertEqual(p['activation'],'manual');self.assertEqual(p['status'],'approximate')
        self.assertEqual(p['sources'],['LIGHT_CONVERT_TEMPLET.NTF','LIGHT_CONVERT_DATA.NTF'])

    def test_legacy_set_presets_keep_required_count(self):
        data=self.fixture();data['SET_ITEM_UNIT_LIGHT_DATA.NTF']=table((5,8,8,9,9),[(2,'1,1,1,1','1,2,3',bits(1),bits(1))]);data['SET_ITEM_EFFECT_TEMPLET.NTF']=table((5,5,8),[(202,10,'GUST_INVALID, 2')])
        p=read_profiles(Data(data))['profiles'][1];self.assertEqual(p['required_count'],10);self.assertEqual(p['direction'],[1,2,3]);self.assertEqual(p['key'],'set:202')

    def test_missing_tables_and_invalid_data_do_not_guess_lighting(self):
        self.assertEqual(read_profiles(Data({}))['profiles'],[])
        for direction,intensity in [('0,0,0',1),('1,nan,0',1),('1,2,3',float('inf'))]:
            data=self.fixture();data['LIGHT_CONVERT_DATA.NTF']=table((2,8,8,9,9,9),[(1,'1,1,1,1',direction,bits(intensity),bits(1),bits(0))])
            with self.assertRaises(ValueError):read_profiles(Data(data))
        data=self.fixture();data['LIGHT_CONVERT_DATA.NTF']=table((5,),[(1,)])
        with self.assertRaises(ValueError):read_profiles(Data(data))
