import test_picker_browser


class AuxiliaryOcclusionBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'auxiliary_occlusion_checks.js'


class AuxiliaryOcclusionMsaaBrowserTests(AuxiliaryOcclusionBrowserTests):
    script_prefix = 'window.occlusionAntialias=true;\n'
