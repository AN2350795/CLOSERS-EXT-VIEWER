import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const label=process.argv[2],choice=JSON.parse(fs.readFileSync('diagnostics/material-cloth-choice.json','utf8'));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-perf-'));
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-proxy-server','--enable-unsafe-swiftshader','--user-data-dir='+profile,'--remote-debugging-port=0','http://127.0.0.1:8765/model'],{stdio:'ignore'});
let ws;
try{
 const file=path.join(profile,'DevToolsActivePort');for(let i=0;i<150&&!fs.existsSync(file);i++)await new Promise(r=>setTimeout(r,100));
 const port=fs.readFileSync(file,'utf8').split('\n')[0];const pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map(),errors=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)(m);pending.delete(m.id);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params);};
 const call=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 await call('Runtime.enable');
 for(let i=0;i<1200;i++){if(await evaluate('!!window.modelViewer&&!modelViewer.state.busy'))break;await new Promise(r=>setTimeout(r,100));}
 await evaluate(`window.perfRequests=[];const original=window.fetch;window.fetch=async(...args)=>{const start=performance.now(),r=await original(...args);const row={url:String(args[0]).split('?')[0],start,headers:performance.now(),server:r.headers.get('Server-Timing')};perfRequests.push(row);const json=r.json.bind(r);r.json=async()=>{const data=await json();row.end=performance.now();return data;};return r;};window.perfPhases=[];new MutationObserver(()=>perfPhases.push({at:performance.now(),text:document.getElementById('model-status').textContent})).observe(document.getElementById('model-status'),{childList:true,characterData:true,subtree:true});`);
 const results=[];
 const scenarios=[['single',[25986],{'25986':'ROGUE:1307012414:0'}],['single-repeat',[25986],{'25986':'ROGUE:1307012414:0'}],['full',choice.ids,choice.items],['full-repeat',choice.ids,choice.items],['replace',choice.ids,{...choice.items,'25986':'ROGUE:1307012514:0'}]];
 for(const [name,ids,items] of scenarios){
   const params=new URLSearchParams({entries:ids.join(','),skeleton:'171835',items:JSON.stringify(items)});
   const api=await evaluate(`(async()=>{const token=document.querySelector('meta[name="explorer-token"]').content,start=performance.now(),r=await fetch('/api/model-scene?'+${JSON.stringify(params.toString())},{headers:{'X-Explorer-Token':token}}),headers=performance.now(),body=await r.text();if(!r.ok)throw Error(body);return {total:performance.now()-start,headers:headers-start,characters:body.length};})()`);
   // Reload through the same public path as navigation, preserving this browser's GPU cache.
   const view=await evaluate(`(async()=>{modelViewer.state.data={...modelViewer.state.data,sources:${JSON.stringify(ids.map(entry_id=>({entry_id,appearance_key:items[String(entry_id)]})))}};perfRequests=[];perfPhases=[];const start=performance.now();await modelViewer.loadModel(${JSON.stringify(ids)},171835);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {total:performance.now()-start,requests:perfRequests.map(r=>({...r,start:r.start-start,headers:r.headers-start,end:r.end-start})),phases:perfPhases.map(p=>({...p,at:p.at-start})),metrics:modelViewer.state.timings,status:document.getElementById('model-status').textContent,ids:modelViewer.state.ids,textures:modelViewer.state.textures.size};})()`);
   // Background animation is measured separately from visible readiness.
   for(let i=0;i<1200;i++){if(await evaluate('!!modelViewer.state.animation||!modelViewer.state.data.animation.selected'))break;await new Promise(r=>setTimeout(r,50));}
   view.background=await evaluate('({timings:modelViewer.state.timings,animation:modelViewer.state.animation?{bones:modelViewer.state.animation.mapping.verified_bones,keys:modelViewer.state.animation.mapping.verified_keys}:null,requests:perfRequests.filter(r=>r.url.includes("model-animations")).map(r=>({duration:r.end-r.start}))})');
   results.push({name,api,view});fs.writeFileSync('diagnostics/viewer-'+label+'-browser.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({name,api,total:view.total,metrics:view.metrics}));
 }
 await call('Browser.close');
}finally{ws?.close();browser.kill();}
