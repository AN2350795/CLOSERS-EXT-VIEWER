// Run with a test Chrome CDP session on 9223 and Explorer on 8765.
// Uses Node 22's built-in WebSocket; no npm dependencies.
import fs from 'node:fs';
import path from 'node:path';
const pages=await (await fetch('http://127.0.0.1:9223/json')).json();
const page=pages.find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:8765'));
if(!page)throw new Error('Explorer browser tab missing');
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(msg.error):p.resolve(msg.result);}else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);};
function call(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function wait(expression){await evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+20000;const check=()=>{if(${expression})resolve(true);else if(Date.now()>end)reject(new Error('Timed out: '+${JSON.stringify(expression)}));else setTimeout(check,100)};check()})`);}
function assert(value,message){if(!value)throw new Error(message);}
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride',{width:1512,height:1100,deviceScaleFactor:1,mobile:false});
await call('Page.reload');
await wait(`document.querySelectorAll('tbody tr').length===60`);
assert(await evaluate(`document.getElementById('entry-count').textContent==='936'`),'sample count');
await evaluate(`document.getElementById('next').click()`);
await wait(`document.getElementById('page-label').textContent==='2 / 16'`);
await evaluate(`document.querySelectorAll('#categories button')[1].click()`);
await wait(`document.getElementById('result-count').textContent==='297개 항목'`);
await evaluate(`document.querySelector('tbody tr').click()`);
await wait(`document.querySelector('#preview-content img')?.naturalWidth>0`);
assert(await evaluate(`document.querySelectorAll('#preview-info dd').length>=10`),'image metadata');
await evaluate(`document.getElementById('close-preview').click();document.getElementById('format').value='dds';document.getElementById('format').dispatchEvent(new Event('change'))`);
await wait(`document.querySelectorAll('tbody tr').length===5`);
await evaluate(`document.querySelector('tbody tr').click()`);
await wait(`document.querySelector('#preview-content img')?.naturalWidth>0`);
await evaluate(`document.getElementById('close-preview').click();document.querySelectorAll('#categories button')[2].click();document.getElementById('format').value='wav';document.getElementById('format').dispatchEvent(new Event('change'))`);
await wait(`document.querySelectorAll('tbody tr').length===6`);
await evaluate(`document.querySelector('tbody tr').click()`);
await wait(`document.querySelector('#preview-content audio')?.readyState>=1`);
assert(await evaluate(`Number.isFinite(document.querySelector('audio').duration)`),'audio duration');
await evaluate(`document.getElementById('close-preview').click();document.querySelector('tbody input[type=checkbox]').click();document.getElementById('extract-selected').click()`);
await wait(`document.getElementById('job-label').textContent==='작업 완료'`);
assert(await evaluate(`document.getElementById('job-numbers').textContent.includes('1 / 1개')`),'selected extraction');
await evaluate(`document.getElementById('format').value='';document.querySelectorAll('#categories button')[1].click();document.getElementById('grid-mode').click()`);
await wait(`document.querySelectorAll('.card').length===60`);
await wait(`[...document.querySelectorAll('.card-art img')].slice(0,4).every(i=>i.naturalWidth>0)`);
const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
const out=path.resolve('CLOSERS_Explorer/docs');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'explorer.png'),Buffer.from(screenshot.data,'base64'));
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
assert(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`),'mobile viewport overflow');
const mobile=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,'explorer-mobile.png'),Buffer.from(mobile.data,'base64'));
assert(errors.length===0,'browser JS errors: '+errors.join('; '));
console.log('PASS: sample catalog, pagination, category filters, PNG and DDS previews, WAV metadata, selected extraction, gallery, responsive layout; zero JS exceptions');
ws.close();
