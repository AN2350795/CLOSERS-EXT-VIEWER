import test_picker_browser


class ExtBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='ext_checks.js'
    extra_images=('/api/composition-image/71',)
