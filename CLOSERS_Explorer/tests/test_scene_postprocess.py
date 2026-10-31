from pathlib import Path
import unittest
from closers.scene_postprocess import screen_effects
from test_world_lighting import chunk


class ScenePostprocessTests(unittest.TestCase):
    def test_screen_literals_are_not_color_preset_bindings(self):
        row=dict(m_TexName='SCREEN.DDS',m_UVSpeed={1:.2,2:0},m_Color={1:1,2:.5,3:0,4:0},m_SrcBlend='CON_D3DBLEND_SRCALPHA')
        report=screen_effects(chunk(dict(m_vecWorldScreenEffect={1:row})))
        self.assertEqual(report['effects'][0]['values'],row)
        self.assertEqual(report['color_preset_binding'],'not-established');self.assertFalse(report['rendering_enabled'])
        self.assertEqual(report['scope'],'world-screen-effect-input');self.assertEqual(len(report['sha256']),64)

    def test_missing_empty_and_unknown_fields_do_not_invent_defaults(self):
        missing=screen_effects(chunk({}));self.assertFalse(missing['container_present']);self.assertEqual(missing['effects'],[])
        report=screen_effects(chunk(dict(m_vecWorldScreenEffect={1:{},2:dict(ColorGrading=5)})))
        self.assertEqual(report['effects'][0]['values'],{})
        self.assertIn('m_TexName',report['effects'][0]['missing'])
        self.assertEqual(report['effects'][1]['unknown_fields'],['ColorGrading'])
        self.assertEqual(report['color_preset_binding'],'not-established')

    def test_invalid_structures_and_executable_lua_are_rejected(self):
        for body in (b'os.execute("anything")',chunk({},root='OTHER'),chunk(dict(m_vecWorldScreenEffect='function()'))):
            with self.assertRaises(ValueError):screen_effects(body)
        report=screen_effects(chunk(dict(m_vecWorldScreenEffect={1:'expression'})))
        self.assertEqual(report['effects'][0]['status'],'unresolved')

    def test_original_regions_and_presets_have_distinct_selection_scopes(self):
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        from audit_scene_postprocess import audit
        report=audit(workspace)
        self.assertEqual(report['preset_selection_scope'],'graphics-option')
        self.assertEqual(report['applied_scope'],'color-grading-only');self.assertEqual(len(report['presets']),7)
        self.assertFalse(report['rendering_enabled']);self.assertFalse(report['game_executed'])
        for world,count in zip(report['worlds'],(0,1)):
            self.assertEqual(world['status'],'source-only');self.assertEqual(len(world['effects']),count)
            self.assertTrue(world['sources']);self.assertEqual(world['color_preset_binding'],'not-established')
            self.assertTrue(all(not e['values'] for e in world['effects']))
