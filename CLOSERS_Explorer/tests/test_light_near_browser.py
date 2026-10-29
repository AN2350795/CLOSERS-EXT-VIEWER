import test_picker_browser


class LightNearBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='light_near_checks.js'
    extra_images=('/api/composition-image/71',)
