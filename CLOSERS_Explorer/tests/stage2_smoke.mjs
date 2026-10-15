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
async function check(expression,label){if(!await evaluate(`return (${expression});`))throw Error(label);}
async function search(value){await evaluate(`$('search').value=${JSON.stringify(value)};page=1;await refresh()`);}
try{
  await call('Runtime.enable');await call('Page.reload');
  await wait(`document.querySelectorAll('tbody tr').length===60`);
  await search('unsupported.lua');
  await evaluate(`$('extract-filtered').click()`);
  await wait(`$('job-label').textContent.includes('오류 확인')&&$('job-numbers').textContent.includes('복원 실패 재사용 1')`);
  await evaluate(`$('retry-errors').checked=true;$('extract-filtered').click()`);
  await wait(`!running&&$('job-numbers').textContent.includes('복원 실패 재사용 0')`);
  await evaluate(`await preview(items[0].id)`);
  await check(`activeResource.error_attempts===1&&$('preview-info').textContent.includes('재사용')`,'forced retry attempts and explanation');
  await evaluate(`$('extract-one').click()`);
  await wait(`!running&&activeResource.error_attempts===2`);
  await evaluate(`$('close-preview').click();$('retry-errors').checked=false;$('source').value=${JSON.stringify(path.join(output,'history.cmf'))};$('compare').click()`);
  await wait(`!running&&!$('update-result').hidden`);
  await check(`$('update-counts').textContent.includes('변경 1')&&$('job-scope').textContent.includes('저장 파일 유지')`,'update comparison and preserved files');
  await evaluate(`$('scan').click()`);
  await wait(`!running&&$('job-label').textContent==='작업 완료'&&$('job-scope').textContent.includes('목록 분석만')`);
  await search('history.unknown');
  await evaluate(`await preview(items[0].id);$('resource-history').open=true`);
  await wait(`document.querySelector('#resource-history a')`);
  await check(`await (await fetch(document.querySelector('#resource-history a').href)).text()==='old history bytes'`,'historical original download');
  await evaluate(`$('close-preview').click();$('workers').value='4';$('process').click()`);
  await wait(`!running&&$('job-scope').textContent.includes('history.unknown')&&items[0].saved_exists`);
  await check(`await (await fetch('/api/download/'+items[0].id+'?token='+encodeURIComponent(token))).text()==='new history bytes with change'`,'parallel process original bytes');
  await check(`(await (await fetch($('manifest').href)).text()).includes('history.unknown')`,'on demand CSV current data');
  await call('Emulation.setDeviceMetricsOverride',{width:1512,height:1100,deviceScaleFactor:1,mobile:false});
  const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,'stage2.png'),Buffer.from(screenshot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await check(`document.documentElement.scrollWidth<=window.innerWidth`,'mobile viewport overflow');
  if(errors.length)throw Error(errors.join(';'));
  console.log('PASS: cached/forced/single retries, metadata comparison, historical exact download, four workers, current CSV, mobile; zero JS exceptions');
}finally{await call('Browser.close').catch(()=>{});ws.close();}
