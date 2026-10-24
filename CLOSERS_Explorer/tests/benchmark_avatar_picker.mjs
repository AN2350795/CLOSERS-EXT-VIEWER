import {spawn} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const label=process.argv[2],base=process.argv[3]||'http://127.0.0.1:8765';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'picker-perf-'));
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-proxy-server','--enable-unsafe-swiftshader','--user-data-dir='+profile,'--remote-debugging-port=0',base+'/model'],{stdio:'ignore'});
let ws;
try{
 const file=path.join(profile,'DevToolsActivePort');for(let i=0;i<150&&!fs.existsSync(file);i++)await new Promise(r=>setTimeout(r,100));
 const port=fs.readFileSync(file,'utf8').split('\n')[0],pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map(),errors=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)(m);pending.delete(m.id);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params);};
 const call=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1512,height:1000,deviceScaleFactor:1,mobile:false});
 for(let i=0;i<600;i++){if(await evaluate('!!window.modelViewer&&!modelViewer.state.busy'))break;await new Promise(r=>setTimeout(r,50));}
 await evaluate(`window.listRequests=[];const original=fetch;window.fetch=async(...args)=>{const start=performance.now(),r=await original(...args),row={url:String(args[0]),start,headers:performance.now(),server:r.headers.get('Server-Timing')};listRequests.push(row);const json=r.json.bind(r);r.json=async()=>{const value=await json();row.end=performance.now();return value;};return r;};window.listDone=0;new MutationObserver(()=>{if(document.getElementById('model-results').getAttribute('aria-busy')==='false')window.listDone=performance.now();}).observe(document.getElementById('model-results'),{attributes:true,attributeFilter:['aria-busy']});`);
 const results=[];
 for(const [name,mode,action] of [['sets-first','sets','mode'],['sets-page2','sets','next'],['sets-return','sets','first'],['parts-first','parts','mode'],['accessories-first','accessories','mode'],['eyes-first','eyes','mode']]){
   await evaluate(`window.listStart=performance.now();window.listDone=0;listRequests=[];performance.clearResourceTimings();document.getElementById('model-character').value='ROGUE';document.getElementById('model-saved').value='';document.getElementById('model-limit').value='20';${action==='next'?`document.getElementById('model-next').click();`:action==='first'?`document.getElementById('model-first').click();`:`document.getElementById('model-mode').value=${JSON.stringify(mode)};document.getElementById('model-character').dispatchEvent(new Event('change'));`}`);
   let done=false;
   for(let i=0;i<2400;i++){if(await evaluate(`!!listDone&&document.getElementById('model-results').getAttribute('aria-busy')==='false'`)){done=true;break;}await new Promise(r=>setTimeout(r,50));}
   if(!done)throw Error('list timeout '+name);
   const list=await evaluate(`({ms:listDone-listStart,total:document.getElementById('model-page').textContent,status:document.getElementById('picker-status').textContent,requests:listRequests.map(r=>({...r,start:r.start-listStart,end:r.end-listStart,headers:r.headers-listStart}))})`);
   if(list.status)throw Error(list.status);
   let thumbs;
   for(let i=0;i<2400;i++){
     thumbs=await evaluate(`(()=>{const root=document.getElementById('model-results').getBoundingClientRect(),targets=[...document.querySelectorAll('.model-thumbnail')].filter(t=>{const r=t.getBoundingClientRect();return r.bottom>root.top&&r.top<root.bottom&&r.right>root.left&&r.left<root.right;});return {count:targets.length,ready:targets.filter(t=>t.querySelector('img')?.complete||t.textContent.includes('아이콘 없음')).length,images:targets.map(t=>t.querySelector('img')?.src||t.textContent),elapsed:performance.now()-listStart};})()`);
     if(thumbs.count&&thumbs.ready===thumbs.count)break;await new Promise(r=>setTimeout(r,50));
   }
   if(thumbs.count!==thumbs.ready)throw Error('thumbnail timeout '+name);
   const resources=await evaluate(`performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/media/')||r.name.includes('/api/model-icon/')||r.name.includes('/api/model-thumbnail/')).map(r=>({url:r.name,start:r.startTime-listStart,end:r.responseEnd-listStart,transfer:r.transferSize}))`);
   results.push({name,list,thumbs,resources});console.log(JSON.stringify({name,listMs:list.ms,thumbnailMs:thumbs.elapsed,visible:thumbs.count,requests:resources.length}));fs.writeFileSync('diagnostics/picker-'+label+'-browser.json',JSON.stringify({results,errors},null,2));
 }
 await call('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync('diagnostics/picker-'+label+'.png',Buffer.from(r.result.data,'base64')));
 await call('Browser.close');
}finally{ws?.close();browser.kill();}
