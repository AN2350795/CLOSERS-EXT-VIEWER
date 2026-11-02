from pathlib import Path
import unittest
from unittest.mock import patch

import audit_particle_dispatch as source


class ParticleDispatchTests(unittest.TestCase):
    def test_installed_ui_routes_and_unresolved_target_boundary(self):
        executable = Path('C:/Program Files (x86)/NaddicGames/Closers/CW.EXE')
        if not executable.exists():
            self.skipTest('Local game source unavailable')
        report = source.audit(executable)
        self.assertEqual(len(report['cpu']['checks']), 19)
        self.assertTrue(all(check['matches'] for check in report['cpu']['checks']))
        self.assertEqual(report['sequence_render'], '0x1415b94a0')
        self.assertEqual(report['ui_routes'], [
            dict(flag='m_bDownUI', template_offset='0x7c', render_call='0x1415ce70e'),
            dict(flag='m_bOverUI', template_offset='0x7d', render_call='0x1415cea0e'),
            dict(flag='m_bInnerUI', template_offset='0x7e', render_call='0x1415cce7f')])
        self.assertEqual(report['keyed_route']['stage'], 'unresolved')
        self.assertIn('not a render-target', report['state_id'])
        self.assertIn('neither live RTV', report['scope'])
        self.assertTrue(report['unresolved'])
        self.assertFalse(report['game_executed'])
        self.assertFalse(report['rendering_enabled'])

    def test_rejects_wrong_loader_string_or_filter_field(self):
        # Isolate cross-reference checks from the executable fingerprint check.
        # Neither swapped names nor a neighboring UI flag is valid evidence.
        for label, index in (('down_ui_loader', 7), ('down_ui_filter', 9)):
            evidence = []
            for name, address, raw in source.EVIDENCE:
                body = bytearray.fromhex(raw)
                if name == label:
                    body[index] ^= 1
                evidence.append((name, address, body.hex()))
            with self.subTest(label=label), patch.object(source, 'EVIDENCE', evidence), \
                    patch.object(source, 'cpu_evidence', return_value={}), self.assertRaises(ValueError):
                source.audit('unused')
