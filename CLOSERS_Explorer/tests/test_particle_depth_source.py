from pathlib import Path
import struct
import unittest

import audit_particle_depth


class ParticleDepthSourceTests(unittest.TestCase):
    def test_reflection_ranges_binding_and_variable_extent(self):
        buffer_name = b'CBPerQuad\0'
        variable_name = b'g_v4UseTextureMaskMap\0'
        reflection = (struct.pack('<7I', 1, 28, 1, 92, 0xffff0500, 0, 0)
            + struct.pack('<6I', 124, 1, 52, 128, 0, 0)
            + struct.pack('<10I', 124+len(buffer_name), 0, 16, 2, 0, 0, 0xffffffff, 0, 0xffffffff, 0)
            + struct.pack('<8I', 124, 0, 0, 0, 0, 6, 1, 1)+buffer_name+variable_name)

        def container(payload):
            rdef = b'RDEF'+struct.pack('<I', len(payload))+payload
            osgn = b'OSGN'+struct.pack('<3I', 8, 0, 8)
            return b'DXBC'+bytes(20)+struct.pack('<4I', 40+len(rdef)+len(osgn), 2, 40, 40+len(rdef))+rdef+osgn

        result = audit_particle_depth.constant_variable(container(reflection), 'CBPerQuad', 'g_v4UseTextureMaskMap')
        self.assertEqual(result['slot'], 6)
        self.assertEqual(result['offset'], 0)
        for offset in (0, 4, 8, 12, 16, 28, 32, 36, 40, 52, 56, 60, 92, 116):
            bad = bytearray(reflection)
            struct.pack_into('<I', bad, offset, 0 if offset == 40 else 0xffffffff)
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                audit_particle_depth.constant_variable(container(bad), 'CBPerQuad', 'g_v4UseTextureMaskMap')

    def test_installed_shader_outputs_and_literal_depth_flags(self):
        workspace = Path(__file__).resolve().parents[2] / 'results'
        if not (workspace / 'catalog.sqlite3').exists():
            self.skipTest('Local game source unavailable')
        report = audit_particle_depth.audit(workspace)
        self.assertEqual([s['targets'] for s in report['shaders']], [[0, 1, 2], [0, 1, 2], [0]])
        self.assertEqual(report['shaders'][0]['alpha_mode_layout'], dict(buffer='CBPerQuad', variable='g_v4UseTextureMaskMap', slot=6, offset=0, size=16, buffer_size=128))
        self.assertEqual(report['shaders'][1]['alpha_mode_layout'], dict(buffer='CBPerMaterial', variable='g_v4MatUseTextureMaskMap', slot=5, offset=304, size=16, buffer_size=480))
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
