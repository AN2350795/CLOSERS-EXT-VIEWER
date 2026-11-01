import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import audit_bloom


class BloomSourceTests(unittest.TestCase):
    def test_installed_shader_associations_and_comparison_scope(self):
        workspace = Path(__file__).resolve().parents[2] / 'results'
        executable = Path('C:/Program Files (x86)/NaddicGames/Closers/CW.EXE')
        if not (workspace / 'catalog.sqlite3').exists() or not executable.exists():
            self.skipTest('Local game source unavailable')
        report = audit_bloom.audit(workspace, executable)
        self.assertEqual(report['cpu']['established_checks'], 42)
        self.assertEqual(len(report['cpu']['checks']), 49)
        self.assertTrue(all(c['matches'] for c in report['cpu']['checks']))
        self.assertEqual({s['name'] for s in report['shaders']}, set(audit_bloom.SHADERS))
        self.assertTrue(all(s['sources'] for s in report['shaders']))
        self.assertEqual(report['source_glow']['maximum_levels'], 5)
        self.assertEqual(report['viewer']['levels'], 1)
        self.assertFalse(report['viewer']['original_glow_or_hdr'])
        self.assertIn('unresolved', report['hdr_shader']['active_dispatch'])
        self.assertEqual(report['graphic_parameters']['rows'][0]['key'], 0)
        self.assertAlmostEqual(report['graphic_parameters']['rows'][0]['values'][1], 1.1)
        self.assertEqual(report['blur_path']['reset_values'], dict(level_count=5, sigma=1, mode=0))
        self.assertEqual(report['blur_path']['direct_glow_call_mode'], 1)
        self.assertEqual(report['blur_path']['examples'][0]['scope'], 'diagnostic-inputs-only')
        self.assertEqual(report['first_input']['slot'], 1)
        self.assertEqual(report['first_input']['status'], 'slot-association-verified')
        self.assertIn('t9', report['first_input']['exception'])
        self.assertFalse(report['first_input']['example']['blending_applied'])
        for flag in ('game_executed', 'rendering_enabled', 'viewer_defaults_changed'):
            self.assertFalse(report[flag])

    def test_unknown_executable_is_rejected_before_address_checks(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'unknown.exe'
            path.write_bytes(b'not the investigated executable')
            with self.assertRaisesRegex(ValueError, 'Unrecognized CW.EXE'):
                audit_bloom.cpu_evidence(path)

    def test_missing_shader_is_not_reported_as_verified(self):
        with patch.object(audit_bloom, 'Catalog'), patch.object(audit_bloom, 'LoadingData') as data:
            data.return_value.rows.return_value = []
            with self.assertRaisesRegex(ValueError, 'unavailable'):
                audit_bloom.shader_sources('unused')

    def test_conflicting_duplicate_source_is_rejected(self):
        original = b'inspected shader fixture'
        rows = [dict(id=i, archive='fixture.cmf', ordinal=i) for i in (1, 2)]
        with patch.object(audit_bloom, 'SHADERS', {'fixture': hashlib.sha256(original).hexdigest()}), \
                patch.object(audit_bloom, 'Catalog') as catalog, \
                patch.object(audit_bloom, 'LoadingData') as data, \
                patch.object(audit_bloom, 'Archive') as archive:
            data.return_value.rows.return_value = rows
            archive.return_value.__enter__.return_value.chunks.side_effect = [[original], [b'changed duplicate']]
            catalog.return_value.entry = MagicMock(side_effect=lambda row: row)
            with self.assertRaisesRegex(ValueError, 'conflicting shader'):
                audit_bloom.shader_sources('unused')
            self.assertEqual(catalog.return_value.verify_source.call_count, 4)
