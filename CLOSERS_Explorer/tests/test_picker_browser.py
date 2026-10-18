"""Exercise the real picker DOM in Chromium, with deterministic API responses."""
import functools
import http.server
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest


class PickerBrowserTests(unittest.TestCase):
    checks_script = 'picker_checks.js'
    page_file = 'model.html'
    entry_script = '<script type="module" src="/model.js"></script>'
    extra_images = ()

    def test_picker(self):
        browser = next((p for p in [shutil.which('chromium'), shutil.which('google-chrome'),
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'] if p and Path(p).exists()), None)
        if not browser:
            self.skipTest('Chromium browser unavailable')
        node=shutil.which('node')
        if not node:
            self.skipTest('Node.js 22+ unavailable')
        web = Path(__file__).resolve().parents[1] / 'web'
        script = (Path(__file__).parent / self.checks_script).read_text(encoding='utf-8-sig')
        page_file, entry_script, extra_images = self.page_file, self.entry_script, self.extra_images

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path.startswith('/api/model-icon/'+'a'*64) or self.path.split('?')[0] in extra_images:
                    from test_composition import png
                    data=png(4,4,lambda x,y:(0,200,0,255))
                    self.send_response(200)
                    self.send_header('Content-Type','image/png')
                    self.send_header('Content-Length',str(len(data)))
                    self.end_headers()
                    try:
                        self.wfile.write(data)
                    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                        pass  # A tab switch can cancel an in-flight thumbnail.
                elif self.path == '/checks':
                    html = (web / page_file).read_text(encoding='utf-8')
                    html = html.replace(entry_script,
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
                process = subprocess.Popen([browser, '--headless=new', '--no-sandbox', '--disable-gpu',
                    '--no-first-run', '--disable-background-networking', '--no-proxy-server', '--enable-unsafe-swiftshader',
                    '--user-data-dir=' + profile, '--remote-debugging-port=0',
                    f'http://127.0.0.1:{server.server_port}/checks'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    port_file=Path(profile)/'DevToolsActivePort'
                    for _ in range(100):
                        if port_file.exists():break
                        time.sleep(.05)
                    port=port_file.read_text().splitlines()[0]
                    result=subprocess.run([node,'--input-type=module','-e', '''
let pages;for(let i=0;i<100;i++){
 try{pages=await (await fetch('http://127.0.0.1:'+process.argv[1]+'/json')).json();if(pages.some(p=>p.type==='page'&&p.url.includes('/checks')))break;}catch{}
 await new Promise(r=>setTimeout(r,50));
}
const ws=new WebSocket(pages.find(p=>p.type==='page'&&p.url.includes('/checks')).webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m.result);pending.delete(m.id);}};
const call=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
let value;for(let i=0;i<400;i++){
 const result=await call('Runtime.evaluate',{expression:'JSON.stringify({status:document.body?.dataset.checks,errors:document.querySelector("pre")?.textContent,thumbnails:[...document.querySelectorAll(".model-thumbnail")].map(e=>e.textContent)})',returnByValue:true});
 value=JSON.parse(result.result.value);if(value.status)break;await new Promise(r=>setTimeout(r,50));
}
console.log(JSON.stringify(value));ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();
if(value.status!=='passed')process.exitCode=1;
''',port],capture_output=True,timeout=30)
                    self.assertEqual(result.returncode,0,result.stdout.decode(errors='replace')+result.stderr.decode(errors='replace'))
                finally:
                    if process.poll() is None:
                        process.terminate()
                    process.wait(timeout=10)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
