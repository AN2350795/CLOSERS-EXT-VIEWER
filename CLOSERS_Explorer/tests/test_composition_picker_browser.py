import test_picker_browser


class CompositionPickerBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'composition_picker_checks.js'
    page_file = 'compose.html'
    entry_script = '<script src="/compose.js"></script>'
    extra_images = tuple('/api/loading-thumbnail/'+kind+'/'+str(i) for kind in ('frame','mark','illustration') for i in range(1,16))
