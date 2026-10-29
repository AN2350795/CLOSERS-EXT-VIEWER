import copy
import unittest

from closers.model_items import AvatarItems
from closers.model_materials import plan,matcap_preview,normal_texture,glow_texture


class MaterialPlanTests(unittest.TestCase):
    def test_glow_texture_follows_type_three_insertion_rule(self):
        self.assertEqual(glow_texture('folder/Base.png'),'BASE_GLOW.PNG')
        self.assertEqual(glow_texture('Base.TGA'),'BASE_GLOW.TGA')
        for value in (None,'','BASE','BASE.JPEG'):self.assertIsNone(glow_texture(value))

    def test_specular_preview_requires_explicit_valid_material_values(self):
        inputs=dict(m_MultiTexName='CAP.PNG',SpecularColor={1:1,2:.5,3:.25,4:0},SpecularPower=300)
        specular=matcap_preview(inputs)['specular']
        self.assertEqual(specular['color'],[1,.5,.25,0])
        self.assertEqual(specular['power'],300)
        self.assertEqual(specular['light_source'],'viewer-camera')
        for field in ('SpecularColor','SpecularPower'):
            missing=dict(inputs);missing.pop(field)
            self.assertNotIn('specular',matcap_preview(missing))
        for power in (-1,float('nan'),float('inf'),True,'300',1e39):
            self.assertNotIn('specular',matcap_preview(dict(inputs,SpecularPower=power)))
        for color in ({1:1,2:1,3:1},{1:-1,2:1,3:1,4:1},{1:float('nan'),2:1,3:1,4:1}):
            self.assertNotIn('specular',matcap_preview(dict(inputs,SpecularColor=color)))
        self.assertIsNone(matcap_preview({k:v for k,v in inputs.items() if k!='m_MultiTexName'}))

    def test_normal_texture_follows_verified_bump_insertion_rule(self):
        self.assertEqual(normal_texture('folder/Base.tga'),'BASE_BUMP.TGA')
        self.assertEqual(normal_texture('Base.PNG'),'BASE_BUMP.PNG')
        self.assertIsNone(normal_texture(None))
        self.assertIsNone(normal_texture('BASE'))
        self.assertIsNone(normal_texture('BASE.JPEG'))

    def test_matcap_requires_an_explicit_auxiliary_binding(self):
        self.assertIsNone(matcap_preview({}))
        for value in (None,12,'','  '):self.assertIsNone(matcap_preview({'m_MultiTexName':value}))
        preview=matcap_preview({'m_MultiTexName':'folder/Mat_cloth_158.png'})
        self.assertEqual(preview['texture'],'MAT_CLOTH_158.PNG')
        self.assertEqual(preview['status'],'approximate')
        self.assertEqual(preview['normal_source'],'vertex')
        self.assertIn('normal_map_alpha_not_bound',preview['limitations'])

    def row(self):
        return dict(m_DeviceID='A.XET',m_mapTexChange={1:dict(m_OrgTexName='BASE.TGA',m_ChangeTexName='A.PNG')},
                    m_mapEmissiveMaterial={1:dict(OrgTexName='BASE.TGA',EmissiveTexName='LIGHT.PNG',
                                                 EmissiveColor={4:1,2:.5,1:1,3:.25},fEmissiveStrength=.9)},
                    m_mapToonTexChange={1:dict(m_OrgToonTex='CTT_BASIC0',m_ChangeToonTex='CTT_BASIC_BLUE7')})

    def test_emission_uses_original_material_before_type_substitution(self):
        row=self.row();rule=AvatarItems.parse_texture_rule(row)
        report,preview=plan(dict(texture='folder/BASE.TGA'),rule)
        self.assertEqual(preview['texture'],'LIGHT.PNG')
        self.assertEqual(preview['color'],[1,.5,.25,1])
        self.assertEqual(preview['strength'],.9)
        self.assertEqual(preview['status'],'approximate')
        self.assertIn('toon_changes',report['unsupported'])
        self.assertIsNone(plan(dict(texture='A.PNG'),rule)[1])
        self.assertIsNone(plan(dict(texture='OTHER.PNG'),rule)[1])
        self.assertIsNotNone(plan(dict(texture='BASE.PNG'),rule)[1])

    def test_missing_invalid_and_ambiguous_emission_cannot_create_an_effect(self):
        for value in (None,{},dict(OrgTexName='BASE.TGA'),dict(OrgTexName='BASE.TGA',EmissiveTexName='X.PNG',
                       EmissiveColor={1:1,2:1,3:1,4:1},fEmissiveStrength=float('nan'))):
            row=self.row();row['m_mapEmissiveMaterial']={1:value}
            self.assertIsNone(plan(dict(texture='BASE.TGA'),AvatarItems.parse_texture_rule(row))[1])
        row=self.row();row['m_mapEmissiveMaterial'][2]=copy.deepcopy(row['m_mapEmissiveMaterial'][1])
        self.assertIsNone(plan(dict(texture='BASE.TGA'),AvatarItems.parse_texture_rule(row))[1])

    def test_skin_masks_and_reflection_are_retained_without_claiming_support(self):
        row=self.row();row['m_mapTexChange'][1].update(m_MultiTexName='ANY.PNG',m_MaskTexName='MASK.PNG',
                m_strDyeingMaskTexName='DYE.PNG',SpecularPower=150,SpecularColor={1:1,2:1,3:1,4:1})
        report,_=plan(dict(texture='BASE.TGA'),AvatarItems.parse_texture_rule(row))
        self.assertEqual(set(report['unsupported']),{'m_MultiTexName','m_MaskTexName','m_strDyeingMaskTexName',
                                                    'SpecularColor','SpecularPower','toon_changes'})
        self.assertEqual(len(report['textures']),3)
        self.assertEqual(report['inputs']['SpecularPower'],150)
        other=AvatarItems.parse_texture_rule(dict(m_DeviceID='B.XET'))
        self.assertEqual(plan(dict(texture='BASE.TGA'),other)[0]['unsupported'],[])
        self.assertNotIn('emissive_materials',other)
