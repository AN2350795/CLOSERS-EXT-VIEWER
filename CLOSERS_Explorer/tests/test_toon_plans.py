import unittest
from closers.model_toon import NAMES,toon_preview


class ToonPlanTests(unittest.TestCase):
    def test_shininess_truncation_and_runtime_resource_aliases(self):
        for index in range(15):
            p=toon_preview({'power':index+.25})
            self.assertEqual(p['source_index'],index)
            self.assertEqual(p['texture'],toon_preview({'power':index%5})['texture'])
        self.assertEqual(toon_preview({'power':2})['texture'],'CTT_BASIC_WHITE_BLUE2.BMP')
        self.assertEqual(toon_preview({'power':15})['texture'],'CTT_DAMAGE.BMP')
        for value in (None,True,'2',-1,16,float('nan'),float('inf')):
            self.assertIsNone(toon_preview({'power':value}))
        self.assertIsNone(toon_preview({}))

    def test_item_changes_are_single_step_and_match_original_enum(self):
        item={'toon_changes':{1:dict(m_OrgToonTex=NAMES[0],m_ChangeToonTex=NAMES[7]),2:dict(m_OrgToonTex=NAMES[7],m_ChangeToonTex=NAMES[4])}}
        self.assertEqual(toon_preview({'power':0},item)['index'],7)
        self.assertEqual(toon_preview({'power':1},item)['index'],1)
        self.assertEqual(toon_preview({'power':7},item)['texture'],'CTT_BASIC_YELLOW4.BMP')

    def test_nested_item_and_texture_rows_preserve_matching(self):
        row=dict(m_OrgToonTex=NAMES[0],m_ChangeToonTex=NAMES[3])
        p=toon_preview({'power':0},{'toon_changes':{'texture_rows':{1:row},'item_rows':{1:row}}})
        self.assertEqual(p['index'],3)

    def test_incomplete_unknown_and_conflicting_changes_do_not_guess(self):
        for changes in (None,[],{1:{}},{1:dict(m_OrgToonTex=NAMES[0])},
                {1:dict(m_OrgToonTex='CTT_BASIC_BLEU2',m_ChangeToonTex=NAMES[0])},
                {1:dict(m_OrgToonTex=NAMES[0],m_ChangeToonTex='CTT_BASIC_WHITE_BLUE2')},
                {1:dict(m_OrgToonTex=NAMES[0],m_ChangeToonTex=NAMES[1]),2:dict(m_OrgToonTex=NAMES[0],m_ChangeToonTex=NAMES[2])}):
            p=toon_preview({'power':0},{'toon_changes':changes})
            self.assertEqual(p['status'],'unsupported');self.assertNotIn('texture',p)
        self.assertEqual(toon_preview({'power':0},{'material_conflicts':['toon_changes']})['status'],'unsupported')
        self.assertEqual(toon_preview({'power':1},{'toon_changes':{1:dict(m_OrgToonTex=NAMES[0])}})['status'],'approximate')
