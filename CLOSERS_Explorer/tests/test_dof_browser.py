import test_picker_browser


class DofBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'dof_checks.js'


class DofRestoreBrowserTests(DofBrowserTests):
    script_prefix = 'window.restoreDof=true;\n'
