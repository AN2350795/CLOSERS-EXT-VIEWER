import test_picker_browser


class SecondMapBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='second_map_checks.js'
    extra_images=('/api/composition-image/71',)
