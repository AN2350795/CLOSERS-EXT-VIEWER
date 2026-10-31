import test_picker_browser


class ExtSurfaceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='ext_surface_checks.js'


class ExtSurfaceSavedBrowserTests(ExtSurfaceBrowserTests):
    script_prefix='window.restoreExtSurface=true;\n'
