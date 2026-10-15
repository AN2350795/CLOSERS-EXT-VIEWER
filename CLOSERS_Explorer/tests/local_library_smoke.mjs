import fs from 'node:fs';
import path from 'node:path';
const [base,cdp,output]=process.argv.slice(2);
let pages;
for(let i=0;i<100;i++){try{pages=await(await fetch(cdp+'/json')).json();if(pages.some(p=>p.url.startsWith(base)))break;}catch{}await new Promise(r=>setTimeout(r,100));}
const page=pages?.find(p=>p.type==='page'&&p.url.startsWith(base));if(!page)throw Error('test page missing');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
ws.onclose=()=>{for(const p of pending.values())p.reject(Error('Browser disconnected'));pending.clear();};
function call(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(body){const r=await call('Runtime.evaluate',{expression:`(async()=>{${body}})()`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression){for(let i=0;i<150;i++){if(await evaluate(`return (${expression});`))return;await new Promise(r=>setTimeout(r,100));}const state=await evaluate(`return {name:$('preview-name').textContent,state:$('preview-state').textContent,content:$('preview-content').innerHTML,info:$('preview-info').textContent,rows:items.map(i=>({id:i.id,name:i.name})),errors:${JSON.stringify(errors)}};`);fs.writeFileSync(path.join(output,'ui-failure.json'),JSON.stringify({expression,state},null,2));throw Error('Timed out: '+expression);}
async function check(expression,label){if(!await evaluate(`return (${expression});`)){const state=await evaluate(`return {name:$('preview-name').textContent,resource:activeResource?.name,download:$('download-one').outerHTML,stored:$('download-stored').outerHTML,job:$('job-label').textContent,info:$('preview-info').textContent};`);fs.writeFileSync(path.join(output,'ui-check-failure.json'),JSON.stringify({expression,state,errors},null,2));throw Error(label);}}
async function search(value){await evaluate(`$('search').value=${JSON.stringify(value)};page=1;await refresh()`);}
try{
  await call('Runtime.enable');await call('Page.reload');
  await wait(`document.querySelectorAll('tbody tr').length===60`);
  await search('.unknown');await wait(`$('result-count').textContent==='3개 항목'`);
  await check(`$('scope-preview').textContent.includes('.unknown')`,'scope preview');
  await evaluate(`$('extract-filtered').click()`);
  await wait(`$('job-label').textContent==='작업 완료'&&$('job-numbers').textContent.includes('3 / 3개')`);
  await check(`$('job-scope').textContent.includes('.unknown')&&$('job-numbers').textContent.includes('실패 아님')`,'fixed job scope and excluded count');
  await check(`items.every(i=>i.saved_exists)&&new Set(items.map(i=>i.output)).size===3`,'all source items saved independently');
  await evaluate(`$('search').value='';$('duplicate').value='name';page=1;await refresh()`);
  await wait(`$('result-count').textContent==='2개 항목'`);
  await check(`$('job-scope').textContent.includes('.unknown')`,'job scope survives browsing filter change');
  await check(`$('results').textContent.includes('같은 이름 2')`,'name duplicate badges');
  await evaluate(`$('search').value='.unknown';$('duplicate').value='content';page=1;await refresh()`);
  await wait(`$('result-count').textContent==='2개 항목'`);
  await check(`items.some(i=>i.name==='alias.unknown')`,'content comparison differs from names');
  await evaluate(`await preview(items[0].id)`);
  await check(`$('preview-info').textContent.includes('같은 내용')&&$('preview-info').textContent.includes('원본 형식 파일 있음')`,'metadata and saved file status');
  await check(`$('download-one').getAttribute('aria-disabled')==='false'&&$('download-one').href.includes('/api/download/')`,'original download action');
  await check(`await (await fetch($('download-one').href)).text()==='same saved bytes'`,'exact saved download payload');
  await evaluate(`$('close-preview').click();$('duplicate').value='';await refresh()`);
  await search('unsupported.lua');await wait(`items.length===1`);await evaluate(`await preview(items[0].id)`);
  await check(`$('preview-info').textContent.includes('보존 파일 1개 있음')&&$('preview-info').textContent.includes('원문 미복원')`,'preservation and decode failure remain separate');
  await check(`$('download-one').getAttribute('aria-disabled')==='true'&&$('download-stored').getAttribute('aria-disabled')==='false'`,'stored bytes are a separate action');
  await check(`await (await fetch($('download-stored').href)).text()==='YWJjZGVm'`,'exact preserved bytes download');
  await evaluate(`$('close-preview').click()`);await search('unsupported-image');
  await evaluate(`$('extract-filtered').click()`);
  await wait(`$('job-label').textContent==='작업 완료'&&$('job-numbers').textContent.includes('1 / 1개')`);
  await evaluate(`await preview(items[0].id)`);
  await wait(`$('preview-state').textContent.includes('미리보기 오류')`);
  await check(`$('preview-info').textContent.includes('unsupported-image.dds')&&$('download-one').getAttribute('aria-disabled')==='false'`,'preview failure retains metadata and original access');
  await evaluate(`$('close-preview').click()`);await search('image.png');await evaluate(`await preview(items[0].id)`);
  await wait(`document.querySelector('#preview-content img')?.naturalWidth===1`);
  await call('Emulation.setDeviceMetricsOverride',{width:1512,height:1100,deviceScaleFactor:1,mobile:false});
  const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,'local-library.png'),Buffer.from(screenshot.data,'base64'));
  await evaluate(`$('close-preview').click()`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await check(`document.documentElement.scrollWidth<=window.innerWidth`,'mobile viewport overflow');
  if(errors.length)throw Error(errors.join(';'));
  console.log('PASS: source-preserving duplicates, exact original/stored downloads, scope, saved existence, preview failure metadata, PNG display, mobile; zero JS exceptions');
}finally{
  await call('Browser.close').catch(()=>{});ws.close();
}
