import test_picker_browser


class ToonRotationBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='toon_rotation_checks.js'


class ToonRotationSavedBrowserTests(ToonRotationBrowserTests):
    script_prefix='window.restoreRotation=true;\n'
