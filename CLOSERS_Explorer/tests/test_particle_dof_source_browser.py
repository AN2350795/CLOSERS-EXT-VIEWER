"""Use a real motion particle definition/texture in the controlled GPU checks."""
import base64
import hashlib
import json
from pathlib import Path

import test_picker_browser
from audit_particle_depth import DEFINITIONS
from closers.catalog import Catalog
from closers.composition import CompositionImages
from closers.loading import LoadingData
from closers.lua_literals import tables
from closers.model_library import Models
from closers.motion_extras import particle_rule


class ParticleDofSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'particle_dof_checks.js'

    def test_picker(self):
        workspace = Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():
            self.skipTest('Local game source unavailable')
        catalog = Catalog(workspace)
        filename = 'PARTICLE_SYSTEM_MAIN_EF1.LUA'
        body = LoadingData(catalog).body(filename)
        self.assertEqual(hashlib.sha256(body).hexdigest(), DEFINITIONS[filename][0])
        rows = tables(body)['PARTICLE_SYSTEM']
        matches = [row for row in rows.values() if isinstance(row, dict) and row.get('m_SeqName') == 'PE_RARE_7_BLAMB_BIKE_SKID_MARK']
        self.assertEqual(len(matches), 1)
        rule = particle_rule(dict(matches[0], source=filename))
        self.assertTrue(rule['dof_plane'])
        texture = Models(catalog).matches(rule['frames'][0]['name'])
        self.assertEqual(len(texture), 1)
        path, _ = CompositionImages(catalog).prepare(texture[0]['id'])
        image = 'data:image/png;base64,'+base64.b64encode(path.read_bytes()).decode('ascii')
        additive=particle_rule(dict(matches[0],source=filename,m_DestBlend='ONE'))
        self.script_prefix = 'window.particleDofRule='+json.dumps(rule)+';window.particleDofAdditiveRule='+json.dumps(additive)+';window.particleDofTexture='+json.dumps(image)+';\n'
        super().test_picker()
