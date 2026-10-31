import test_ext_source_browser


class LightCompositionSourceBrowserTests(test_ext_source_browser.ExtSourceBrowserTests):
    checks_script='light_composition_source_checks.js'
    include_skin_profiles=True
