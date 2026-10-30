import test_picker_browser


class GlowBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='glow_checks.js'
    extra_images=('/api/composition-image/71',)
    image_color=(16,32,64,255)
