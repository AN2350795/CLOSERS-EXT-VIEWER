import hashlib
from pathlib import Path
import unittest
from unittest.mock import patch

import audit_dof
import audit_bloom


class DofSourceTests(unittest.TestCase):
    def test_installed_dof_path_and_unresolved_runtime_boundaries(self):
        workspace = Path(__file__).resolve().parents[2] / 'results'
        executable = Path('C:/Program Files (x86)/NaddicGames/Closers/CW.EXE')
        if not (workspace / 'catalog.sqlite3').exists() or not executable.exists():
            self.skipTest('Local game source unavailable')
        report = audit_dof.audit(workspace, executable)
        self.assertEqual(len(report['cpu']['checks']), 20)
        self.assertTrue(all(v['matches'] for v in report['cpu']['checks']))
        self.assertEqual({s['name'] for s in report['shaders']}, set(audit_dof.SHADERS))
        self.assertEqual(report['activation']['bit'], 2)
        self.assertEqual(report['activation']['technique'], 15)
        self.assertIn('not hardware z-buffer', report['inputs']['depth'])
        self.assertEqual(report['shader']['sample_count'], 8)
        self.assertEqual(report['shader']['normal_alpha'], 1)
        self.assertEqual(report['source']['rows'][0]['key'], 0)
        self.assertEqual(len(report['presets']), 7)
        self.assertEqual([p['key'] for p in report['presets'] if not p['dof']['enabled']], ['4', '6'])
        self.assertFalse(report['activation']['runtime_state_read'])
        self.assertIn('not established', report['source']['row_to_runtime_vector'])
        for flag in ('game_executed', 'rendering_enabled', 'viewer_defaults_changed'):
            self.assertFalse(report[flag])

    def test_custom_shader_evidence_does_not_fall_back_to_bloom_set(self):
        body = b'dof fixture'
        row = dict(id=1, archive='fixture', ordinal=0)
        with patch.object(audit_bloom, 'Catalog'), patch.object(audit_bloom, 'LoadingData') as data, \
                patch.object(audit_bloom, 'Archive') as archive:
            data.return_value.rows.return_value = [row]
            archive.return_value.__enter__.return_value.chunks.return_value = [body]
            result = audit_dof.shader_sources('unused', {'DOF_ONLY': hashlib.sha256(body).hexdigest()})
            self.assertEqual(len(result), 1)
            data.return_value.rows.assert_called_once_with('DOF_ONLY')
