"""Check clipping consistency when postprocess effects follow strong emission."""
from pathlib import Path
import test_picker_browser


class PostprocessHdrBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'postprocess_hdr_checks.js'
    script_prefix = Path(__file__).with_name('postprocess_reference.js').read_text(encoding='utf-8') + '\n'
