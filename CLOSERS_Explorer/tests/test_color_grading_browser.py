import test_picker_browser


class ColorGradingBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'color_grading_checks.js'


class ColorGradingSavedBrowserTests(ColorGradingBrowserTests):
    script_prefix = 'window.restoreColorGrading=true;\n'
