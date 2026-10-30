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
    extra_images = ('/api/media/71','/api/media/72')
    image_color = (0,200,0,255)
    animation_export = False
    responsive_checks = False
    script_prefix = ''

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
        script = self.script_prefix+(Path(__file__).parent / self.checks_script).read_text(encoding='utf-8-sig')
        page_file, entry_script, extra_images = self.page_file, self.entry_script, self.extra_images
        animation_export = self.animation_export
        image_color = self.image_color

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                if not animation_export or self.path!='/api/composition-animation/webp':
                    self.send_error(404);return
                from closers.animation_export import encode_webp
                data=encode_webp(self.rfile.read(int(self.headers['Content-Length'])))
                self.send_response(200);self.send_header('Content-Type','image/webp');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

            def do_GET(self):
                if self.path.split('?')[0]=='/model-layout.js':
                    # Existing servers have a fixed asset allowlist from before UI updates.
                    self.send_error(404)
                elif self.path.startswith('/api/model-icon/'+'a'*64) or self.path.split('?')[0] in extra_images:
                    from test_composition import png
                    data=png(4,4,lambda x,y:image_color)
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
                        '<script type="module" nonce="explorer-test">' + script + '</script>')
                    data = html.encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    # Allow only our injected checks inline; application code follows
                    # the production policy that requires external script modules.
                    self.send_header('Content-Security-Policy', "script-src 'self' 'nonce-explorer-test'")
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
 const result=await call('Runtime.evaluate',{expression:'JSON.stringify({status:document.body?.dataset.checks,errors:(document.querySelector("body > pre:last-of-type")||document.querySelector("pre"))?.textContent,thumbnails:[...document.querySelectorAll(".model-thumbnail")].map(e=>e.textContent)})',returnByValue:true});
 value=JSON.parse(result.result.value);if(value.status)break;await new Promise(r=>setTimeout(r,50));
}
if(value.status==='passed'&&process.argv[2]==='responsive'){
 const setup=await call('Runtime.evaluate',{expression:'(async()=>{await addImage(9);await applyGameFrame(false,2);$("editor-status").hidden=true;$("editor-toast").hidden=true;$("layer-edit").open=true;$("animation-settings").open=true;})()',awaitPromise:true});
 if(setup.exceptionDetails)value={status:'failed',errors:JSON.stringify(setup.exceptionDetails)};
 for(const [width,height] of [[1512,1000],[1024,900],[390,844],[320,800]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<760});
  const result=await call('Runtime.evaluate',{expression:'(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));selectInspector(innerWidth<=1180?"assets":"design");$("composition-menu").open=true;const rect=s=>{const b=document.querySelector(s).getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom};};return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,picker:rect(".image-picker"),canvas:rect(".canvas-panel"),inspector:rect(".editor-inspector"),stage:rect("#canvas-stage"),menu:rect(".menu-actions")};})()',awaitPromise:true,returnByValue:true});
  const layout=result.result.value,ordered=width<=760?layout.canvas.y<layout.inspector.y:width>1180?layout.picker.x<layout.canvas.x&&layout.canvas.x<layout.inspector.x:layout.canvas.x<layout.inspector.x&&layout.picker.x>=layout.inspector.x;
  if(layout.overflow||!ordered||layout.menu.x<0||layout.menu.right>width+1){value={status:'failed',errors:'Responsive layout '+JSON.stringify(layout)};break;}
 }
}
if(value.status==='passed'&&['picker-layout','viewer-layout','motion-layout'].includes(process.argv[2])){
 for(const [width,height] of [[1920,1080],[1512,1000],[1440,900],[1280,720],[1024,900],[390,844],[320,800],[844,390]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<760});
  const result=await call('Runtime.evaluate',{expression:'(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return await '+(process.argv[2]==='motion-layout'?'checkMotionLayout':process.argv[2]==='viewer-layout'?'checkViewerLayout':'checkPickerLayout')+'();})()',awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails){value={status:'failed',errors:JSON.stringify(result.exceptionDetails)};break;}
 }
}
if(value.status==='passed'&&process.argv[2]==='viewer-layout'){
 await call('Runtime.evaluate',{expression:'document.getElementById("expand-viewer").click()'});
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 const result=await call('Runtime.evaluate',{expression:'!document.getElementById("viewer-dialog").open&&document.activeElement===document.getElementById("expand-viewer")',returnByValue:true});
 if(!result.result.value)value={status:'failed',errors:'Escape did not restore viewer and focus'};
}
if(process.env.CLOSERS_TEST_CAPTURES){
 const captures=await call('Runtime.evaluate',{expression:'window.testCaptures||[]',returnByValue:true});
 const fs=await import('node:fs/promises'),path=await import('node:path');await fs.mkdir(process.env.CLOSERS_TEST_CAPTURES,{recursive:true});
 for(const image of captures.result.value||[])await fs.writeFile(path.join(process.env.CLOSERS_TEST_CAPTURES,image.name.replace(/[^a-zA-Z0-9_-]/g,'_')+'.png'),Buffer.from(image.body.split(',')[1],'base64'));
}
console.log(JSON.stringify(value));ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();
if(value.status!=='passed')process.exitCode=1;
''',port,'motion-layout' if self.checks_script in ('motion_library_checks.js','motion_sequence_checks.js','motion_loading_checks.js','animation_controls_checks.js') else 'viewer-layout' if self.checks_script=='viewer_layout_checks.js' else 'picker-layout' if self.checks_script=='picker_layout_checks.js' else 'responsive' if self.responsive_checks else 'standard'],capture_output=True,timeout=30)
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
