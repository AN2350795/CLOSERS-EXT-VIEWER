import test_picker_browser


class LightCompositionBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='light_composition_checks.js'


class LightCompositionSavedBrowserTests(LightCompositionBrowserTests):
    script_prefix='window.restoreLightComposition=true;\n'
