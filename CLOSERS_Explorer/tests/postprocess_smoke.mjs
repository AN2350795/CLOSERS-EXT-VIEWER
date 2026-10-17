import fs from 'node:fs';
import path from 'node:path';
const [base,cdp,output]=process.argv.slice(2);
let pages;
for(let i=0;i<100;i++){try{pages=await(await fetch(cdp+'/json')).json();if(pages.some(p=>p.url.startsWith(base)))break;}catch{}await new Promise(r=>setTimeout(r,100));}
const page=pages?.find(p=>p.type==='page'&&p.url.startsWith(base));if(!page)throw Error('test page missing');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
function call(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(body){const r=await call('Runtime.evaluate',{expression:`(async()=>{${body}})()`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression){for(let i=0;i<150;i++){if(await evaluate(`return (${expression});`))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);}
function assert(value,label){if(!value)throw Error(label);}
try{
  await call('Runtime.enable');await call('Page.reload');
  await wait(`typeof initialized!=='undefined'&&initialized&&document.querySelectorAll('tbody tr').length===60`);
  assert(await evaluate(`return $('postprocess-enabled').checked;`),'enabled by default');
  await evaluate(`$('search').value='readme.lua';page=1;await refresh();$('extract-filtered').click();`);
  await wait(`!running&&$('job-current').textContent.includes('후처리 완료')`);
  assert(await evaluate(`return items[0].saved_exists&&$('job-label').textContent.includes('확인 필요');`),'extracted asset survives postprocess error');
  assert(await evaluate(`return !$('postprocess-result').hidden&&$('postprocess-result').open&&$('postprocess-steps').textContent.includes('CW.EXE');`),'actionable step error');
  await evaluate(`$('game-executable').value='missing/CW.EXE';$('game-executable').dispatchEvent(new Event('change'));$('postprocess-run').click();`);
  await wait(`!running&&$('job-current').textContent.startsWith('데이터 후처리 종료')`);
  assert(await evaluate(`return $('job-scope').textContent.includes('데이터 후처리')&&items[0].saved_exists;`),'standalone retry');
  await evaluate(`$('postprocess-enabled').checked=false;$('postprocess-enabled').dispatchEvent(new Event('change'));`);
  await call('Page.reload');await wait(`typeof initialized!=='undefined'&&initialized&&document.querySelectorAll('tbody tr').length===60`);
  assert(await evaluate(`return !$('postprocess-enabled').checked&&$('game-executable').value==='missing/CW.EXE';`),'workspace options restored');
  await evaluate(`$('search').value='readme.lua';page=1;await refresh();$('extract-filtered').click();`);
  await wait(`!running&&$('job-label').textContent==='작업 완료'&&$('job-scope').textContent.includes('readme.lua')`);
  assert(await evaluate(`return $('postprocess-result').hidden;`),'disabled extraction omits postprocess');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  assert(await evaluate(`return document.documentElement.scrollWidth<=window.innerWidth;`),'mobile overflow');
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(output,'postprocess-mobile.png'),Buffer.from(shot.data,'base64'));
  if(errors.length)throw Error(errors.join(';'));
  console.log('PASS: automatic postprocess, preserved extraction, actionable error, standalone retry, persisted options, disabled extraction, mobile; zero JS exceptions');
}finally{await call('Browser.close').catch(()=>{});ws.close();}
