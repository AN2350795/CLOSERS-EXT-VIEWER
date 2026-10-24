from pathlib import Path
import shutil
import subprocess
import unittest


class TextureCacheTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'),'Node.js unavailable')
    def test_texture_lifetime_budget_and_concurrency(self):
        result=subprocess.run(['node',str(Path(__file__).with_name('texture_cache_checks.mjs'))],
                              capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
