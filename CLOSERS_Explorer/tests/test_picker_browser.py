"""Exercise the real picker DOM in Chromium, with deterministic API responses."""
import functools
import http.server
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest


class PickerBrowserTests(unittest.TestCase):
    def test_picker(self):
        browser = next((p for p in [shutil.which('chromium'), shutil.which('google-chrome'),
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'] if p and Path(p).exists()), None)
        if not browser:
            self.skipTest('Chromium browser unavailable')
        web = Path(__file__).resolve().parents[1] / 'web'
        script = (Path(__file__).parent / 'picker_checks.js').read_text(encoding='utf-8-sig')

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == '/checks':
                    html = (web / 'model.html').read_text(encoding='utf-8')
                    html = html.replace('<script type="module" src="/model.js"></script>',
                        '<script type="module">' + script + '</script>')
                    data = html.encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                else:
                    super().do_GET()

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(web)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory() as profile:
                result = subprocess.run([browser, '--headless=new', '--no-sandbox', '--disable-gpu',
                    '--no-first-run', '--disable-background-networking', '--no-proxy-server',
                    '--user-data-dir=' + profile, '--dump-dom', '--virtual-time-budget=15000',
                    f'http://127.0.0.1:{server.server_port}/checks'], capture_output=True, timeout=45)
                output = result.stdout.decode('utf-8', errors='replace')
                self.assertIn('data-checks="passed"', output, output[-12000:] + result.stderr.decode(errors='replace')[-1000:])
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
