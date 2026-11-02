"""Compare the full renderer's postprocess order against CPU image math."""
from pathlib import Path
import test_picker_browser


class PostprocessOrderBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'postprocess_order_checks.js'
    script_prefix = Path(__file__).with_name('postprocess_reference.js').read_text(encoding='utf-8') + '\n'
