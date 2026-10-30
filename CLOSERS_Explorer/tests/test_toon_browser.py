import test_picker_browser


class ToonBrowserTests(test_picker_browser.PickerBrowserTests):
    image_color=(128,64,32,255)
    checks_script='toon_checks.js'
    extra_images=('/api/composition-image/71',)
