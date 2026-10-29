import hashlib
from pathlib import Path
import struct
import unittest

from closers.world_lighting import unit_light,comparison_profile


def chunk(value,root='WORLD_TEMPLET'):
    def string(s):
        raw=s.encode()+b'\0';return struct.pack('<Q',len(raw))+raw
    constants=[];code=[]
    def emit(op,a=0,b=0,c=0,bx=None):code.append(op|(a<<6)|((bx<<14) if bx is not None else (b<<23)|(c<<14)))
    def constant(v):constants.append(v);return len(constants)-1
    def build(v,reg):
        if isinstance(v,dict):
            emit(10,reg)
            for k,child in v.items():build(child,reg+1);emit(9,reg,b=256+constant(k),c=reg+1)
        else:emit(1,reg,bx=constant(v))
    build(value,0);emit(7,bx=constant(root));emit(30)
    body=b'\x1bLuaQ\0\x01\x04\x08\x04\x08\0'+string('@fixture')+b'\0'*12
    body+=struct.pack('<I',len(code))+struct.pack('<'+'I'*len(code),*code)+struct.pack('<I',len(constants))
    for v in constants:
        if type(v)is bool:body+=b'\x01'+bytes([v])
        elif type(v)in (int,float):body+=b'\x03'+struct.pack('<d',v)
        else:body+=b'\x04'+string(v)
    return body


class WorldLightingTests(unittest.TestCase):
    def test_comparison_near_intensity_preserves_zero_and_missing(self):
        values=dict(m_LightColor={1:1,2:1,3:1,4:1},m_fLightIntensity=.9,m_fRimLightWide=1,m_fRimLightPower=0)
        for near in (0,1.2):
            report=unit_light(chunk(self.source(**values,m_fLightIntensityNear=near)))
            self.assertEqual(comparison_profile(report,'source','region')['near_intensity'],near)
            self.assertIn('near_interpolation',report['runtime_unresolved'])
        for extra in ({},{'m_fLightIntensityNear':-1}):
            report=unit_light(chunk(self.source(**values,**extra)))
            self.assertNotIn('near_intensity',comparison_profile(report,'source','region'))

    def test_rim_does_not_require_reflection_parameters(self):
        source=self.source(m_LightColor={1:1,2:1,3:1,4:1},m_fLightIntensity=.9,m_fRimLightWide=1.5,m_fRimLightPower=.5)
        profile=comparison_profile(unit_light(chunk(source)),'source','region')
        self.assertEqual(profile['global_rim'],dict(width=1.5,power=.5));self.assertNotIn('global_specular',profile)

    def test_rim_profiles_keep_explicit_zero_and_do_not_fill_partial_values(self):
        source=self.source(m_LightColor={1:1,2:1,3:1,4:1},m_fLightIntensity=.9,m_SpecularColor={1:1,2:1,3:1,4:1},m_fSpecularIntensity=1,m_fSpecularPow=3)
        fields=source['m_LightData']['m_LightParamUnit']
        self.assertNotIn('global_rim',comparison_profile(unit_light(chunk(source)),'source','region'))
        fields['m_fRimLightWide']=0
        self.assertNotIn('global_rim',comparison_profile(unit_light(chunk(source)),'source','region'))
        fields['m_fRimLightPower']=0
        self.assertEqual(comparison_profile(unit_light(chunk(source)),'source','region')['global_rim'],dict(width=0,power=0))
        fields['m_fRimLightPower']=.5
        self.assertEqual(comparison_profile(unit_light(chunk(source)),'source','region')['global_rim'],dict(width=0,power=.5))
        fields['m_fRimLightPower']=-1
        self.assertNotIn('global_rim',comparison_profile(unit_light(chunk(source)),'source','region'))

    def test_comparison_profile_requires_explicit_reflection_inputs(self):
        source=self.source(m_LightColor={1:1,2:1,3:1,4:1},m_fLightIntensity=.9,m_SpecularColor={1:1,2:.5,3:.25,4:1},m_fSpecularIntensity=3.98,m_fSpecularPow=3)
        report=unit_light(chunk(source));profile=comparison_profile(report,'source.lua','region')
        self.assertEqual(profile['global_specular'],dict(color=[1,.5,.25,1],intensity=3.98,power=3))
        self.assertEqual(profile['direction'],[-5000,4000,0]);self.assertEqual(profile['activation'],'manual')
        self.assertEqual(profile['position'],[-5000,4000,0]);self.assertIsNot(profile['position'],report['values']['position'])
        self.assertIsNone(profile['source_cartoon_power'])
        for field in ('m_SpecularColor','m_fSpecularIntensity','m_fSpecularPow'):
            missing=self.source(**{k:v for k,v in source['m_LightData']['m_LightParamUnit'].items() if k not in (field,'m_LightType','m_LightPos')})
            self.assertIsNone(comparison_profile(unit_light(chunk(missing)),'source.lua','region'))

    def source(self,**values):
        return dict(m_LightData=dict(m_LightParamUnit=dict(m_LightType='LT_BASIC',m_LightPos={1:-5000,2:4000,3:0},**values)))

    def test_literals_preserve_position_zero_and_missing_without_defaults(self):
        body=chunk(self.source(m_fRimLightPower=0,m_fSpecularIntensity=10.1,m_fSpecularPow=3))
        report=unit_light(body)
        self.assertEqual(report['status'],'source-only');self.assertIsNone(report['activation'])
        self.assertEqual(report['values']['position'],[-5000,4000,0]);self.assertEqual(report['values']['rim_power'],0)
        self.assertNotIn('cartoon_power',report['values']);self.assertIn('m_fCartoonPow',report['missing'])
        self.assertEqual(report['sha256'],hashlib.sha256(body).hexdigest())
        self.assertIn('direction_rotation',report['runtime_unresolved']);self.assertNotIn('direction',report['values'])

    def test_activation_is_preserved_separately_from_parameter_presence(self):
        for flag in (True,False,'TRUE','FALSE'):
            source=self.source();source['m_LightData']['m_bUseLightParamUnit']=flag
            self.assertEqual(unit_light(chunk(source))['activation'],flag)
        source=self.source();source['m_LightData']['m_bUseLightParamUnit']='dynamic()'
        with self.assertRaises(ValueError):unit_light(chunk(source))

    def test_color_channels_and_signed_literals_are_not_reinterpreted(self):
        report=unit_light(chunk(self.source(m_SpecularColor={1:1,2:.889,3:.568,4:0},m_fRimLightWide=-1)))
        self.assertEqual(report['values']['specular_color'],[1,.889,.568,0]);self.assertEqual(report['values']['rim_width'],-1)

    def test_invalid_vectors_and_non_numeric_coefficients_are_rejected(self):
        for value in ({1:1,2:2},{1:1,2:2,3:3,4:4,5:5},{1:1,2:'expression',3:3,4:4}):
            with self.assertRaises(ValueError):unit_light(chunk(self.source(m_SpecularColor=value)))
        for value in (True,'3',1e39,float('nan'),float('inf')):
            with self.assertRaises(ValueError):unit_light(chunk(self.source(m_fSpecularPow=value)))

    def test_missing_structures_and_executable_lua_are_rejected(self):
        for root in ({},dict(m_LightData={}),dict(m_LightData=dict(m_LightParamUnit='function()'))):
            with self.assertRaises(ValueError):unit_light(chunk(root))
        with self.assertRaises(ValueError):unit_light(b'return os.execute("anything")')
        body=bytearray(chunk(self.source()))
        first=12+8+len('@fixture')+1+12+4
        struct.pack_into('<I',body,first,28)  # CALL must never be evaluated.
        with self.assertRaises(ValueError):unit_light(bytes(body))

    def test_installed_worlds_have_the_audited_source_values(self):
        from audit_world_lighting import audit
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        report=audit(workspace);self.assertFalse(report['rendering_enabled']);self.assertEqual(len(report['worlds']),3)
        expected=[(3.98,3,1.008),(10.1,3,2),(9.4,1.822,0)]
        for source,(intensity,power,width) in zip(report['worlds'],expected):
            self.assertEqual(source['status'],'source-only');self.assertTrue(source['sources']);values=source['values']
            self.assertEqual(values['specular_intensity'],intensity);self.assertEqual(values['specular_power'],power)
            self.assertEqual(values['rim_width'],width);self.assertEqual(values['rim_power'],0)
