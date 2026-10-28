import test_picker_browser


class ToonBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='toon_checks.js'
    extra_images=('/api/composition-image/71',)
