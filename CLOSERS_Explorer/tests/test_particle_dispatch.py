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
        self.assertEqual(len(report['cpu']['checks']), 36)
        self.assertTrue(all(check['matches'] for check in report['cpu']['checks']))
        self.assertEqual(report['sequence_render'], '0x1415b94a0')
        self.assertEqual(report['ui_routes'], [
            dict(flag='m_bDownUI', template_offset='0x7c', render_call='0x1415ce70e'),
            dict(flag='m_bOverUI', template_offset='0x7d', render_call='0x1415cea0e'),
            dict(flag='m_bInnerUI', template_offset='0x7e', render_call='0x1415cce7f')])
        self.assertEqual(report['keyed_route']['caller'], 'CCWCUnitViewer')
        self.assertEqual(report['keyed_route']['stage'], 'live render target unresolved')
        self.assertEqual(report['callers']['caller_class'], '.?AVCCWCUnitViewer@@')
        self.assertEqual(report['callers']['render'], '0x140a9e760')
        self.assertIn('Unresolved', report['callers']['target_status'])
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

    def test_rejects_wrong_caller_type_branch_or_call_target(self):
        snapshots = {name: (address, bytes.fromhex(raw)) for name, address, raw in source.EVIDENCE}
        # A neighboring RTTI type, another branch destination, or another
        # manager call must not silently become evidence of world rendering.
        for label, index in (('unit_viewer_vtable', 0),
                             ('unit_viewer_vtable', 24),
                             ('unit_viewer_locator', 12),
                             ('unit_viewer_collection_branch', 9),
                             ('unit_viewer_collect', 19),
                             ('unit_viewer_direct', 17),
                             ('unit_viewer_collected_render', 21),
                             ('down_ui_outer_call', 13),
                             ('over_ui_outer_call', 13)):
            modified = dict(snapshots)
            address, raw = modified[label]
            body = bytearray(raw)
            body[index] ^= 1
            modified[label] = address, bytes(body)
            with self.subTest(label=label, index=index), self.assertRaises(ValueError):
                source.caller_evidence(modified)
