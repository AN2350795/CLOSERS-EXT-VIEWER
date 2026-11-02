import json

import test_picker_browser
from particle_mrt_reference import cases


class ParticleMrtBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'particle_mrt_checks.js'
    script_prefix = 'window.particleMrtCases='+json.dumps(cases())+';\n'
