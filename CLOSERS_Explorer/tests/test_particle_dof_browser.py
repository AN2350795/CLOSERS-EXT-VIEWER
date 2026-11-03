import json

import test_picker_browser
from closers.motion_extras import particle_rule


class ParticleDofBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'particle_dof_checks.js'
    script_prefix = 'window.particleDofRule='+json.dumps(particle_rule(dict(
        m_TexName='WHITE.PNG',m_Layer='ROL_EFFECT_0',m_LifeTime=2,m_EmitRateInstant=1)))+';\n'
