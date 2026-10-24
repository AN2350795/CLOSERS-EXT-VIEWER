"""Search, select and reset the motion library in a real browser."""
import test_picker_browser


class MotionLibraryBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'motion_library_checks.js'
