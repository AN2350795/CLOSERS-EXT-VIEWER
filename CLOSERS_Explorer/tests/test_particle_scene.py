from pathlib import Path
import unittest

import audit_particle_scene as source


class ParticleSceneTests(unittest.TestCase):
    def test_installed_registration_queue_and_secondary_target_selection(self):
        executable = Path('C:/Program Files (x86)/NaddicGames/Closers/CW.EXE')
        if not executable.exists():
            self.skipTest('Local game source unavailable')
        report = source.audit(executable)
        self.assertEqual(len(report['cpu']['checks']), 40)
        self.assertTrue(all(check['matches'] for check in report['cpu']['checks']))
        self.assertEqual(len(report['links']), 23)
        # The initial target bind is followed by another selection before
        # queued particle rendering. Losing this edge changes the conclusion.
        scene = [link for link in report['links'] if 0x140d71077 <= int(link['source'], 16) <= 0x140d710b6]
        self.assertEqual(scene, [
            dict(source='0x140d7107a', target='0x1415f95a0'),
            dict(source='0x140d7108a', target='0x141609030'),
            dict(source='0x140d710a8', target='0x14159ac10'),
            dict(source='0x140d710b6', target='0x1409522b0')])
        self.assertIn('does not prove', report['targets']['warning'])
        self.assertIn('CUnitSelfieUI::OnSelfieCapture', report['targets']['caller_scope'])
        self.assertEqual(report['gameplay']['states'], ['.?AVCCWCStateTown@@', '.?AVCCWCStateGamePVP@@'])
        self.assertEqual(report['gameplay']['construction'], dict(
            function='0x141574290', target_store='owner[0]', requested_slots=3,
            descriptor_offset='0x54', target_count_offset='0x21c'))
        self.assertIn('not a live GPU', report['gameplay']['limits'])
        self.assertIn('does not explicitly remove', report['registration']['boundary'])
        self.assertTrue(report['unresolved'])
        self.assertFalse(report['game_executed'])
        self.assertFalse(report['rendering_enabled'])

    def test_rejects_changed_call_targets_and_removed_secondary_selection(self):
        snapshots = {name: (address, bytes.fromhex(raw)) for name, address, raw in source.EVIDENCE}
        links = source.resolve_links(snapshots)
        for link in links:
            address = int(link['source'], 16)
            name, (start, raw) = next((name, value) for name, value in snapshots.items()
                                     if value[0] <= address < value[0]+len(value[1]))
            for delta in (0, 1):  # Opcode removal and wrong relative destination.
                changed = dict(snapshots)
                body = bytearray(raw)
                body[address-start+delta] ^= 1
                changed[name] = start, bytes(body)
                with self.subTest(address=hex(address), delta=delta), self.assertRaises(ValueError):
                    source.resolve_links(changed)

    def test_rejects_capture_scope_string_misassociation(self):
        snapshots = {name: (address, bytes.fromhex(raw)) for name, address, raw in source.EVIDENCE}
        for name in ('capture_name_reference', 'selfie_reference'):
            changed = dict(snapshots)
            address, raw = changed[name]
            body = bytearray(raw)
            body[3] ^= 1
            changed[name] = address, bytes(body)
            with self.subTest(name=name), self.assertRaises(ValueError):
                source.resolve_links(changed)

    def test_rejects_wrong_gameplay_state_target_count_or_owner(self):
        snapshots = {name: (address, bytes.fromhex(raw)) for name, address, raw in source.EVIDENCE}
        for name, index in (('town_locator_pointer', 0), ('pvp_locator', 12),
                            ('town_render_slot', 0), ('pvp_render_slot', 0),
                            ('screen_target_allocation', 6),  # Three outputs must not become one.
                            ('screen_target_allocation', 33),  # Descriptor base association.
                            ('target_count_copy', 2), ('target_count_copy', 5),
                            ('screen_target_getter', 3)):
            changed = dict(snapshots)
            address, raw = changed[name]
            body = bytearray(raw)
            body[index] ^= 1
            changed[name] = address, bytes(body)
            with self.subTest(name=name, index=index), self.assertRaises(ValueError):
                source.gameplay_evidence(changed)
