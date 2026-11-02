from pathlib import Path
import unittest

import audit_particle_render_state as source


class ParticleRenderStateTests(unittest.TestCase):
    def test_installed_normal_plane_shader_and_blend_state_chain(self):
        executable = Path('C:/Program Files (x86)/NaddicGames/Closers/CW.EXE')
        if not executable.exists():
            self.skipTest('Local game source unavailable')
        report = source.audit(executable)
        self.assertEqual(len(report['cpu']['checks']), 25)
        self.assertTrue(all(check['matches'] for check in report['cpu']['checks']))
        self.assertIn('group 4', report['scope'])
        self.assertEqual(report['blend']['additive']['target0']['rgb'], [5, 2])
        self.assertEqual(report['blend']['additive']['target2']['rgb'], [5, 6])
        self.assertEqual(report['blend']['ordinary']['target2']['write_mask'], 15)
        self.assertIsNone(report['blend']['ordinary']['alpha_mode_write'])
        self.assertIn('write zero', report['restore']['saved_blend_found'])
        self.assertIn('Skip both', report['restore']['saved_blend_missing'])
        self.assertIn('not restored', report['restore']['nested_state'])
        self.assertEqual(report['initial_pe_zero_fill'], {'0x142f9ac94': True, '0x142f9ab14': True})
        self.assertTrue(report['unresolved'])
        self.assertFalse(report['game_executed'])
        self.assertFalse(report['rendering_enabled'])

    def test_all_basic_blend_factor_pairs_and_shared_state_boundary(self):
        rewritten = []
        for src in range(1, 12):
            for dst in range(1, 12):
                result = source.blend_description(src, dst)
                self.assertEqual(result['target0']['rgb'], [src, dst])
                self.assertEqual(result['target1'], result['target0'])
                for key in ('target0', 'target1', 'target2'):
                    self.assertEqual(result[key]['write_mask'], 15)
                    self.assertEqual(result[key]['alpha'], [2, 2])
                if result['independent']:
                    rewritten.append((src, dst))
                    self.assertEqual(result['target2']['rgb'], [5, 6])
                    self.assertEqual(result['alpha_mode_write'], 1)
                else:
                    self.assertEqual(result['target2'], result['target0'])
                    self.assertIsNone(result['alpha_mode_write'])
        self.assertEqual(rewritten, [(1, 4), (2, 2), (5, 2), (5, 7)])
        for value in (True, 0, 12, 1.5, '5'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                source.blend_description(value, 6)
