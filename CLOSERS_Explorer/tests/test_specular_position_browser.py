import test_picker_browser


class SpecularPositionBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='specular_position_checks.js'
    extra_images=('/api/composition-image/71',)


class SpecularPositionSavedBrowserTests(SpecularPositionBrowserTests):
    script_prefix='window.restoreRegionalSettings=true;\n'
