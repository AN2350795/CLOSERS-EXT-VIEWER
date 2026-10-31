import test_picker_browser


class SharpenBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='sharpen_checks.js'


class SharpenSavedBrowserTests(SharpenBrowserTests):
    script_prefix='window.restoreSharpen=true;\n'
