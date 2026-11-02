from pathlib import Path
import struct
import unittest

import audit_particle_depth


class ParticleDepthSourceTests(unittest.TestCase):
    def test_installed_shader_outputs_and_literal_depth_flags(self):
        workspace = Path(__file__).resolve().parents[2] / 'results'
        if not (workspace / 'catalog.sqlite3').exists():
            self.skipTest('Local game source unavailable')
        report = audit_particle_depth.audit(workspace)
        self.assertEqual([s['targets'] for s in report['shaders']], [[0, 1, 2], [0, 1, 2], [0]])
        rows = {r['name']: r for r in report['definitions']}
        dust = rows['FOOT_DUST']
        self.assertEqual(dust['defaults'], ['m_bZEnable', 'm_bZWriteEnable'])
        self.assertEqual(dust['viewer'], dict(depth_test=True, depth_write=False, blend=['SRCALPHA', 'INVSRCALPHA']))
        glow = rows['PE_TRANSFORM_SYSTEM_CORE_GLOW_01']
        self.assertEqual(glow['raw']['m_bZEnable'], 'FALSE')
        self.assertEqual(glow['raw']['m_bZWriteEnable'], 'TRUE')
        self.assertEqual(glow['viewer'], dict(depth_test=False, depth_write=True, blend=['SRCALPHA', 'DESTALPHA']))
        self.assertEqual(rows['PE_CUSTOM_EF_FLOOR_WATER_WAVE']['viewer']['blend'], ['SRCALPHA', 'ONE'])
        self.assertTrue(rows['PE_2026_SUMMER_DANCE_EMOTION_BG_NEON_SIGN']['viewer']['depth_write'])
        self.assertGreater(len(report['unresolved']), 0)
        for flag in ('game_executed', 'lua_executed', 'viewer_defaults_changed'):
            self.assertFalse(report[flag])

    def test_output_signature_rejects_corrupt_offsets_names_and_masks(self):
        payload = struct.pack('<2I5I2BH', 1, 8, 32, 2, 0, 3, 2, 15, 0, 0)+b'SV_Target\0'
        chunk = b'OSGN'+struct.pack('<I', len(payload))+payload
        body = bytearray(b'DXBC'+bytes(20)+struct.pack('<3I', 36+len(chunk), 1, 36)+chunk)
        self.assertEqual(audit_particle_depth.output_targets(body), [2])
        for index in (24, 28, 32, 40, 44, 48, 52, 68):
            changed = body.copy()
            struct.pack_into('<I', changed, index, 0xffffffff)
            with self.subTest(index=index), self.assertRaises(ValueError):
                audit_particle_depth.output_targets(changed)
