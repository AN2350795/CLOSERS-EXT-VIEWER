import test_picker_browser


class EffectOcclusionBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'effect_occlusion_checks.js'


class EffectOcclusionMsaaBrowserTests(EffectOcclusionBrowserTests):
    script_prefix = 'window.occlusionAntialias=true;\n'
