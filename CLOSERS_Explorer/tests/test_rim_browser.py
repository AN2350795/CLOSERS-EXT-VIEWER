import test_picker_browser


class RimBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='rim_checks.js'
    extra_images=('/api/composition-image/71',)
