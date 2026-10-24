import {spawn} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:8771',report={cases:[],errors:[]};
const html=await(await fetch(base+'/model')).text(),token=html.match(/name="explorer-token" content="([^"]+)"/)[1],bundles=[];
for(const key of ['STRIKER|CLOTH_229_B','STRIKER|CLOTH_229_C','ROGUE|CLOTH_232_B','ROGUE|CLOTH_232_C']){
 const response=await fetch(base+'/api/model-bundle?'+new URLSearchParams({key,saved:'',items:'1'}),{headers:{'X-Explorer-Token':token}});
 const bundle=await response.json();if(!response.ok)throw Error(JSON.stringify(bundle));
 const hair=bundle.slots.find(s=>s.part==='HAIR');if(!hair?.shared_hair)throw Error('Shared hair missing: '+key);
 bundles.push({key,hair,motion:bundle.motion});
}
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'shared-hair-'));
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-proxy-server','--enable-unsafe-swiftshader','--user-data-dir='+profile,'--remote-debugging-port=0',base+'/model'],{stdio:'ignore'});
let ws;
try{
 const file=path.join(profile,'DevToolsActivePort');for(let i=0;i<150&&!fs.existsSync(file);i++)await new Promise(r=>setTimeout(r,100));
 const port=fs.readFileSync(file,'utf8').split('\n')[0],pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)(m);pending.delete(m.id);}else if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params);};
 const call=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 const until=async expression=>{for(let i=0;i<1200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout: '+expression+' '+await evaluate('document.getElementById("model-status").textContent'));};
 await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1512,height:1000,deviceScaleFactor:1,mobile:false});
 await until('!!window.modelViewer&&!modelViewer.state.busy');
 for(const [character,code,another] of [['STRIKER','CLOTH_229_B',false],['STRIKER','CLOTH_229_C',false],['ROGUE','CLOTH_232_B',false],['ROGUE','CLOTH_232_C',false],['ROGUE','CLOTH_232_C',true]]){
   const key=character+'|'+code,bundle=bundles.find(b=>b.key===key),hair=bundle.hair.candidates.find(c=>c.display_name.includes('어나더')===another);
   await evaluate(`(()=>{for(const [id,value] of Object.entries(${JSON.stringify({'model-character':character,'model-mode':'sets','model-search':code,'model-saved':'','model-costume_type':'','model-part':''})})){document.getElementById(id).value=value;}document.getElementById('model-character').dispatchEvent(new Event('change'));})()`);
   await until(`document.getElementById('model-results').getAttribute('aria-busy')==='false'&&!!document.querySelector('[data-set="${key}"] .model-open')`);
   await evaluate(`document.querySelector('[data-set="${key}"] .model-open').click()`);
   await until(`!modelViewer.state.busy&&!!document.querySelector('#avatar-bundle [data-shared-set="${character}|${code.slice(0,-1)}A"]')`);
   const choice=await evaluate(`(()=>{const row=document.querySelector('#avatar-bundle [data-shared-set]'),select=row.querySelector(':scope>select'),before=select.value;select.value=${JSON.stringify(hair.id+'|'+hair.appearance_key)};select.dispatchEvent(new Event('change'));return {before,options:select.options.length,shared:row.textContent.includes('A타입 공용 헤어'),components:row.querySelectorAll('.bundle-components select').length};})()`);
   if(!choice.shared||character==='ROGUE'&&choice.before)throw Error('shared hair disclosure or explicit choices failed');
   await evaluate(`(()=>{for(const select of document.querySelectorAll('#avatar-bundle select')){if(!select.value&&select.options.length===2){select.value=select.options[1].value;select.dispatchEvent(new Event('change'));}}[...document.querySelectorAll('#avatar-bundle button')].find(b=>b.textContent==='묶음 열기').click();})()`);
   await until(`!modelViewer.state.busy&&modelViewer.state.data?.sources.some(s=>s.entry_id===${hair.id}&&s.appearance_key===${JSON.stringify(hair.appearance_key)})&&modelViewer.state.data.sources.some(s=>s.item_set===${JSON.stringify(code)})`);
   await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   const state=await evaluate(`(()=>{const s=modelViewer.state,hair=s.data.sources.filter(r=>r.model_group.part==='HAIR'),body=s.data.sources.filter(r=>r.model_group.part==='UPBODY'),hairIds=new Set(hair.map(r=>r.entry_id)),bodyIds=new Set(body.map(r=>r.entry_id)),hairInputs=new Set(s.data.meshes.filter(m=>hairIds.has(m.source_id)).flatMap(m=>m.materials));return {sources:s.data.sources.map(r=>({id:r.entry_id,key:r.appearance_key,set:r.item_set,part:r.model_group.part,sha256:r.sha256})),hairTextures:s.model.materials.filter(m=>hairInputs.has(m.userData.input)).map(m=>({name:m.userData.input.texture,uuid:m.map?.uuid})),bodyTextures:s.data.meshes.filter(m=>bodyIds.has(m.source_id)).flatMap(m=>m.materials.map(t=>t.texture)),vertices:s.data.meshes.reduce((n,m)=>n+m.vertices.length/3,0),status:document.getElementById('model-status').textContent};})()`);
   const actualHair=state.sources.filter(s=>s.part==='HAIR');
   if(!state.hairTextures.length||state.hairTextures.some(t=>!t.uuid))throw Error('actual hair texture missing');
   if(actualHair.some(s=>s.key!==hair.appearance_key)||actualHair.length!==(hair.components.length||1))throw Error('actual hair composition/item mismatch');
   const filename=character+'-'+code+(another?'-another':'-normal');
   const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('diagnostics/shared-hair-'+filename+'.png',Buffer.from(shot.result.data,'base64'));
   report.cases.push({key,another,choice,state});console.log(JSON.stringify({key,another,hair:actualHair,choice}));
 }
 for(const character of ['STRIKER','ROGUE']){
  const cases=report.cases.filter(c=>c.key.startsWith(character+'|')&&!c.another);
  if(JSON.stringify(cases[0].state.hairTextures)!==JSON.stringify(cases[1].state.hairTextures))throw Error('shared hair GPU/texture changed across B/C');
  if(JSON.stringify(cases[0].state.bodyTextures)===JSON.stringify(cases[1].state.bodyTextures))throw Error('B/C body materials were mixed');
 }
 await until('!!modelViewer.state.animation');
 report.animation=await evaluate(`(async()=>{const s=modelViewer.state,c=s.animation.clips.find(c=>c.name==='ASTAND')||s.animation.clips[0];await modelViewer.chooseClip(c.index);document.getElementById('play-animation').click();await new Promise(r=>setTimeout(r,350));document.getElementById('play-animation').click();return {clip:s.clip.clip.name,time:s.time,bones:s.model.bones.length,keys:s.clip.keys.length};})()`);
 if(!(report.animation.time>0)||report.errors.length)throw Error('actual animation or browser failed');
 fs.writeFileSync('diagnostics/shared-hair-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.animation));
 await call('Browser.close');
}finally{ws?.close();browser.kill();}
