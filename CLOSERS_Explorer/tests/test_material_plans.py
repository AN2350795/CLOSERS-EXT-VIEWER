import copy
import unittest

from closers.model_items import AvatarItems
from closers.model_materials import plan,matcap_preview


class MaterialPlanTests(unittest.TestCase):
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
