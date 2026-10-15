import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [base,cdp,output]=process.argv.slice(2);
let pages;
for(let i=0;i<100;i++){try{pages=await(await fetch(cdp+'/json')).json();if(pages.some(p=>p.url.startsWith(base)))break;}catch{}await new Promise(r=>setTimeout(r,100));}
const page=pages?.find(p=>p.type==='page'&&p.url.startsWith(base));if(!page)throw Error('test page missing');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
function call(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(body){const r=await call('Runtime.evaluate',{expression:`(async()=>{${body}})()`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression){for(let i=0;i<200;i++){if(await evaluate(`return (${expression});`))return;await new Promise(r=>setTimeout(r,100));}fs.writeFileSync(path.join(output,'compose-failure.txt'),expression);throw Error('Timed out: '+expression);}
async function check(expression,label){if(!await evaluate(`return (${expression});`))throw Error(label);}
async function add(name){await evaluate(`const rows=await api('/api/entries?category=images&q='+encodeURIComponent(${JSON.stringify(name)}));await operation(()=>addImage(rows.items[0].id));`);}
async function pixel(x,y){return evaluate(`const c=makeExportCanvas();const pixel=[...c.getContext('2d').getImageData(${x},${y},1,1).data];c.width=1;c.height=1;return pixel;`);}
function same(a,b,label){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label+': '+JSON.stringify(a));}
const downloadDir=path.join(output,'downloads');fs.mkdirSync(downloadDir);
const measurements={};
async function memorySnapshot(){
  const version=await(await fetch(cdp+'/json/version')).json(),socket=new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let info;try{info=await new Promise((resolve,reject)=>{socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1)m.error?reject(m.error):resolve(m.result);};socket.send(JSON.stringify({id:1,method:'SystemInfo.getProcessInfo'}));});}finally{socket.close();}
  const pids=info.processInfo.map(p=>String(p.id)),result=spawnSync('python',[fileURLToPath(new URL('./browser_memory.py',import.meta.url)),...pids],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw Error(result.stderr);return JSON.parse(result.stdout);
}
try{
  await call('Runtime.enable');
  await wait(`document.querySelectorAll('tbody tr').length===60`);
  await check(`$('open-composer').getAttribute('href')==='/compose'`,'library editor link');
  await evaluate(`$('search').value='compose-illustration';page=1;await refresh();selected=new Set([items[0].id]);setBusy(false);await preview(items[0].id)`);
  await check(`!$('compose-selected').disabled&&$('compose-one').href.includes('/compose?entries=')`,'selected and detail compose actions');
  await call('Page.navigate',{url:base+'/compose'});await wait(`document.querySelector('#image-results button')`);
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
  await add('compose-illustration.png');await add('compose-frame.png');
  same(await pixel(1,1),[255,0,0,255],'transparent frame center');
  const border=await pixel(0,0);if(Math.abs(border[0]-127)>1||Math.abs(border[2]-128)>1||border[3]!==255)throw Error('frame alpha blend: '+border);
  await evaluate(`$('layer-down').click()`);same(await pixel(0,0),[255,0,0,255],'layer ordering');await evaluate(`$('layer-up').click()`);
  await evaluate(`$('duplicate-layer').click();$('layer-x').value='2';$('layer-x').dispatchEvent(new Event('change'));$('layer-opacity').value='50';$('layer-opacity').dispatchEvent(new Event('input'))`);
  await check(`composition.layers.length===3&&currentLayer().role==='fragment'&&currentLayer().x===2&&currentLayer().opacity===.5`,'fragment duplication and placement');
  await evaluate(`$('remove-layer').click()`);
  await add('compose-sheet.png');
  await evaluate(`$('crop-width').value='2';$('crop-width').dispatchEvent(new Event('change'));$('crop-x').value='2';$('crop-x').dispatchEvent(new Event('change'));$('native-layer').click()`);
  const selected=await evaluate(`return currentLayer()`);same(await pixel(selected.x,selected.y),[255,255,0,255],'source crop at native pixels');
  await evaluate(`$('layer-role').value='fragment';$('layer-role').dispatchEvent(new Event('change'));globalThis.savedSynthetic=projectForSave();globalThis.syntheticBefore=makeExportCanvas().toDataURL('image/png');await importProject(savedSynthetic);`);
  await check(`makeExportCanvas().toDataURL('image/png')===syntheticBefore`,'exact synthetic reconstruction');
  const valid=await evaluate(`return projectForSave()`);
  await evaluate(`const invalid=projectForSave();invalid.layers[0].width=Infinity;let rejected=false;try{Core.validate(invalid)}catch{rejected=true}if(!rejected)throw Error('invalid geometry accepted');const changed=projectForSave();changed.sources[0].image_sha256='0'.repeat(64);const before=makeExportCanvas().toDataURL();try{await importProject(changed)}catch{}if(makeExportCanvas().toDataURL()!==before)throw Error('failed import changed current project');`);
  await evaluate(`globalThis.template=projectForSave(true);$('new-project').click();`);await add('compose-illustration.png');
  await evaluate(`$('canvas-width').value='8';$('canvas-width').dispatchEvent(new Event('change'));await importProject(template,true)`);
  await check(`composition.canvas.width===8&&composition.layers.length===3&&composition.layers[1].x===2`,'multi-piece template scale and centering');
  await evaluate(`$('new-project').click();$('canvas-width').value='8';$('canvas-width').dispatchEvent(new Event('change'));$('canvas-height').value='4';$('canvas-height').dispatchEvent(new Event('change'))`);
  await add('compose-frame.png');same(await pixel(0,0),[0,0,0,0],'transparent output');
  await evaluate(`$('canvas-transparent').checked=false;$('canvas-color').value='#00ff00';$('canvas-transparent').dispatchEvent(new Event('change'))`);same(await pixel(0,0),[0,255,0,255],'solid background output');
  await evaluate(`$('new-project').click()`);await add('compose-full.dds');
  await check(`composition.sources[0].width===4096&&images.get(composition.sources[0].key).bitmap.width===4096&&composition.canvas.width===4096`,'full DDS resolution');
  const ddsPixel=await pixel(3000,1);if(Math.abs(ddsPixel[0]-12)>1||Math.abs(ddsPixel[1]-34)>1||ddsPixel[3]!==200)throw Error('full DDS color/alpha');
  await evaluate(`$('new-project').click()`);
  measurements.before_large_memory=await memorySnapshot();
  const started=performance.now();await add('compose-large.png');measurements.large_input_seconds=(performance.now()-started)/1000;
  await check(`composition.canvas.width===4096&&composition.canvas.height===1024`,'large native output dimensions');
  same(await pixel(3000,100),[184,100,176,255],'large source pixel detail');
  await evaluate(`const bad=projectForSave();bad.canvas.width=8192;bad.canvas.height=8192;let rejected=false;try{Core.validate(bad)}catch{rejected=true}if(!rejected)throw Error('canvas pixel budget not enforced')`);
  await call('Performance.enable');const memory=await call('Performance.getMetrics');measurements.large_js_heap_bytes=memory.metrics.find(m=>m.name==='JSHeapUsedSize')?.value;
  measurements.large_memory=await memorySnapshot();
  const exportStarted=performance.now();
  await evaluate(`$('canvas-width').value='8192';$('canvas-width').dispatchEvent(new Event('change'));$('canvas-height').value='2048';$('canvas-height').dispatchEvent(new Event('change'));$('fit-layer').click();globalThis.maximumCanvas=makeExportCanvas();globalThis.maximumBlob=await new Promise(resolve=>maximumCanvas.toBlob(resolve,'image/png'));if(!maximumBlob)throw Error('maximum-size PNG export failed');`);
  measurements.maximum_output_seconds=(performance.now()-exportStarted)/1000;measurements.maximum_output_memory=await memorySnapshot();
  measurements.maximum_png=await evaluate(`return {width:maximumCanvas.width,height:maximumCanvas.height,bytes:maximumBlob.size};`);
  await evaluate(`maximumCanvas.width=1;maximumCanvas.height=1;maximumCanvas=null;maximumBlob=null;`);
  await evaluate(`$('new-project').click()`);
  await add('DLG_PVP_LOADING_GUST_USER_AEGIS_DIMEN.PNG');await add('DLG_FRAME_226.PNG');
  await evaluate(`$('layer-x').value='180';$('layer-x').dispatchEvent(new Event('change'));$('layer-y').value='520';$('layer-y').dispatchEvent(new Event('change'));$('layer-width').value='640';$('layer-width').dispatchEvent(new Event('change'));globalThis.realProject=projectForSave();globalThis.realBefore=makeExportCanvas().toDataURL('image/png');`);
  const dragBox=await evaluate(`const rect=$('composition-canvas').getBoundingClientRect(),l=currentLayer();return {x:rect.left+(l.x+10)*rect.width/composition.canvas.width,y:rect.top+(l.y+10)*rect.height/composition.canvas.height,sx:rect.width/composition.canvas.width,sy:rect.height/composition.canvas.height};`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:dragBox.x,y:dragBox.y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:dragBox.x+20*dragBox.sx,y:dragBox.y+10*dragBox.sy,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:dragBox.x+20*dragBox.sx,y:dragBox.y+10*dragBox.sy,button:'left',clickCount:1});
  await check(`Math.abs(currentLayer().x-200)<1&&Math.abs(currentLayer().y-530)<1`,'pointer move in output coordinates');
  const handle=await evaluate(`const rect=$('composition-canvas').getBoundingClientRect(),l=currentLayer();return {x:rect.left+(l.x+l.width)*rect.width/composition.canvas.width,y:rect.top+(l.y+l.height)*rect.height/composition.canvas.height,sx:rect.width/composition.canvas.width,sy:rect.height/composition.canvas.height};`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:handle.x,y:handle.y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x+50*handle.sx,y:handle.y+25*handle.sy,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x+50*handle.sx,y:handle.y+25*handle.sy,button:'left',clickCount:1});
  await check(`Math.abs(currentLayer().width-690)<1&&Math.abs(currentLayer().height-345)<1`,'pointer resize preserving ratio');
  await evaluate(`await importProject(realProject);if(makeExportCanvas().toDataURL('image/png')!==realBefore)throw Error('real project restore changed pixels');$('export-png').click()`);
  await wait(`!busy&&$('editor-status').textContent.includes('PNG 저장 요청 완료')`);
  for(let i=0;i<100&&!fs.existsSync(path.join(downloadDir,'closers-composition.png'));i++)await new Promise(r=>setTimeout(r,50));
  const pngFile=fs.readFileSync(path.join(downloadDir,'closers-composition.png'));
  if(pngFile.readUInt32BE(16)!==1024||pngFile.readUInt32BE(20)!==1024)throw Error('download dimensions');
  await evaluate(`$('save-project').click()`);await wait(`!busy`);
  for(let i=0;i<100&&!fs.existsSync(path.join(downloadDir,'closers-composition.json'));i++)await new Promise(r=>setTimeout(r,50));
  const saved=JSON.parse(fs.readFileSync(path.join(downloadDir,'closers-composition.json'),'utf8'));
  const documentNode=await call('DOM.getDocument'),fileNode=await call('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector:'#project-file'});
  await evaluate(`$('new-project').click()`);await call('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[path.join(downloadDir,'closers-composition.json')]});
  await wait(`!busy&&composition.layers.length===2`);await check(`makeExportCanvas().toDataURL('image/png')===realBefore`,'downloaded JSON file restores exact pixels');
  measurements.real_rgba_sha256=await evaluate(`const c=makeExportCanvas(),rgba=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',rgba))].map(v=>v.toString(16).padStart(2,'0')).join('');c.width=1;c.height=1;return hash;`);
  fs.writeFileSync(path.join(output,'synthetic-project.json'),JSON.stringify(valid,null,2));
  measurements.real_png_sha256=crypto.createHash('sha256').update(pngFile).digest('hex');measurements.real_png_bytes=pngFile.length;measurements.real_sources=saved.sources.map(s=>({name:s.name,width:s.width,height:s.height}));
  await call('Emulation.setDeviceMetricsOverride',{width:1512,height:1100,deviceScaleFactor:1,mobile:false});
  const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,'composition.png'),Buffer.from(screenshot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await check(`document.documentElement.scrollWidth<=window.innerWidth`,'mobile viewport overflow');
  if(errors.length)throw Error(errors.join(';'));
  fs.writeFileSync(path.join(output,'composition-checks.json'),JSON.stringify(measurements,null,2));
  console.log('PASS: library links, alpha/order/crop/fragments/templates, exact synthetic and real restoration, atomic invalid import, full DDS and large PNG pixels, 16 MP export and process memory, pointer move/resize, PNG/JSON downloads, mobile; zero JS exceptions');
}finally{await call('Browser.close').catch(()=>{});ws.close();}
