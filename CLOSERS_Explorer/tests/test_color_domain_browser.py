import test_picker_browser


class ColorDomainBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='color_domain_checks.js'
    extra_images=('/api/composition-image/71',)
    image_color=(128,64,32,255)


class ColorDomainSavedBrowserTests(ColorDomainBrowserTests):
    script_prefix='window.restoreRawColor=true;\n'
