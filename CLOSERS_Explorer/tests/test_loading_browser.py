"""Verify animation pixels and APNG decoding in Chromium."""
import test_picker_browser


class LoadingBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'loading_checks.js'
