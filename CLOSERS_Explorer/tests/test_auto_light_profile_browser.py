import test_picker_browser


class AutoLightProfileBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='auto_light_profile_checks.js'


class AutoLightProfileSavedBrowserTests(AutoLightProfileBrowserTests):
    script_prefix='window.restoreAutoProfile=true;\n'
