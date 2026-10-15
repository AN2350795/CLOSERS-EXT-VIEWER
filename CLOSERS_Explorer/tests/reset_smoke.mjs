import fs from 'node:fs';
import path from 'node:path';
const [base,cdp,output]=process.argv.slice(2);
const original=fs.readFileSync(path.join(output,'input.cmf'));
let pages;
for(let i=0;i<100;i++){
  try{pages=await(await fetch(cdp+'/json')).json();if(pages.some(p=>p.url.startsWith(base)))break;}catch{}
  await new Promise(r=>setTimeout(r,100));
}
const page=pages?.find(p=>p.type==='page'&&p.url.startsWith(base));
if(!page)throw Error('test page missing');
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{
  const m=JSON.parse(e.data);
  if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}
  else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
};
ws.onclose=()=>{for(const p of pending.values())p.reject(Error('Browser disconnected'));pending.clear();};
function call(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(body){
  const r=await call('Runtime.evaluate',{expression:`(async()=>{${body}})()`,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;
}
async function wait(expression){
  for(let i=0;i<150;i++){
    try{if(await evaluate(`return (${expression});`))return;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  const state=await evaluate(`return {running,resetPending,plan:typeof resetPlan==='undefined'?null:resetPlan,open:$('data-management').open,summary:$('reset-summary').textContent,error:$('reset-error').textContent,toast:$('toast').textContent};`);
  fs.writeFileSync(path.join(output,'reset-failure.json'),JSON.stringify({expression,state,errors},null,2));
  throw Error('Timed out: '+expression);
}
async function check(expression,label){if(!await evaluate(`return (${expression});`))throw Error(label);}
function files(folder){return fs.readdirSync(folder,{recursive:true,withFileTypes:true}).filter(f=>f.isFile());}
async function openManagement(preserved=false){
  await evaluate(`$('manage-data').click()`);
  await wait(`typeof resetPlan!=='undefined'&&resetPlan&&$('data-management').open`);
  if(preserved){await evaluate(`$('reset-preserved').click()`);await wait(`resetPlan?.delete_preserved===true`);}
}
async function confirm(){
  await evaluate(`$('reset-confirmation').value='전체 초기화';$('reset-confirmation').dispatchEvent(new Event('input'));`);
  await check(`!$('confirm-reset').disabled`,'matching confirmation enables deletion');
  await evaluate(`$('confirm-reset').click()`);
  await wait(`typeof initialized!=='undefined'&&initialized&&!resetPending&&!$('data-management').open&&total===0`);
}
try{
  await call('Runtime.enable');await call('Page.reload');
  await wait(`typeof initialized!=='undefined'&&initialized&&total>0`);
  await openManagement();
  await check(`!$('reset-preserved').checked&&$('confirm-reset').disabled`,'safe default and confirmation');
  await check(`resetPlan.count>=205&&$('reset-folders').textContent.includes('assets')`,'shows external output deletion scope');
  await evaluate(`$('reset-confirmation').value='초기화';$('reset-confirmation').dispatchEvent(new Event('input'))`);
  await check(`$('confirm-reset').disabled`,'wrong confirmation cannot delete');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await check(`document.documentElement.scrollWidth<=window.innerWidth&&$('data-management').getBoundingClientRect().right<=window.innerWidth`,'mobile dialog fits');
  const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(output,'reset-mobile.png'),Buffer.from(screenshot.data,'base64'));
  await evaluate(`$('cancel-management').click()`);
  await check(`total>0&&!$('data-management').open`,'cancel retains catalog');
  await openManagement();await confirm();
  if(files(path.join(output,'assets')).length)throw Error('external extracted files remain');
  if(!fs.existsSync(path.join(output,'stored','preservation.sqlite3')))throw Error('default reset deleted preservation');
  if(!original.equals(fs.readFileSync(path.join(output,'input.cmf'))))throw Error('original changed');
  await openManagement(true);await confirm();
  if(fs.existsSync(path.join(output,'stored','preservation.sqlite3')))throw Error('optional preservation DB remains');
  if(files(path.join(output,'stored')).some(f=>f.name.endsWith('.TET')||f.name.endsWith('.stored.bin')))throw Error('optional preservation payload remains');
  await evaluate(`$('source').value=${JSON.stringify(path.join(output,'input.cmf'))};$('output').value=${JSON.stringify(path.join(output,'assets'))};$('process').click()`);
  await wait(`!running&&total>0&&stats.statuses.extracted===206`);
  if(!original.equals(fs.readFileSync(path.join(output,'input.cmf'))))throw Error('original changed after rerun');
  if(errors.length)throw Error(errors.join(';'));
  console.log('PASS: preview, cancellation, exact confirmation, mobile layout, full reset, optional preserved deletion, original preservation, reprocessing, zero JS exceptions');
}finally{
  await call('Browser.close').catch(()=>{});ws.close();
}
