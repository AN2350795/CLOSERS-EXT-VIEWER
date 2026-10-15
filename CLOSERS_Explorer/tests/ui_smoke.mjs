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
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);}
try{
 await call('Runtime.enable');await call('Page.reload');
 await wait(`document.querySelectorAll('tbody tr').length===60`);
 await evaluate(`document.getElementById('group-axis').value='quest_candidate';document.getElementById('group-axis').dispatchEvent(new Event('change'))`);
 await wait(`document.getElementById('result-count').textContent==='1개 그룹'`);
 await evaluate(`document.querySelector('#results button').click()`);
 await wait(`document.getElementById('result-count').textContent==='205개 항목'`);
 await evaluate(`document.getElementById('group-audio').click()`);
 await wait(`document.querySelector('#preview-content p')?.textContent.startsWith('1 / 205')`);
 await evaluate(`document.querySelector('#preview-content .filters button:last-child').click()`);
 await wait(`document.querySelector('#preview-content p')?.textContent.startsWith('2 / 205')`);
 await evaluate(`document.getElementById('close-preview').click()`);
 await evaluate(`document.getElementById('group-label').value='테스트 그룹';document.getElementById('group-tags').value='확인 필요';document.getElementById('group-save').click()`);
 await wait(`document.getElementById('toast').textContent.includes('저장했습니다')`);
 await evaluate(`document.getElementById('group-back').click()`);
 await wait(`document.querySelector('#results .filename')?.textContent==='테스트 그룹'`);
 await evaluate(`document.getElementById('group-axis').value='';document.getElementById('group-axis').dispatchEvent(new Event('change'));document.getElementById('search').value='readme';document.getElementById('search').dispatchEvent(new Event('input'))`);
 await wait(`document.querySelectorAll('tbody tr').length===1`);
 await evaluate(`document.querySelector('tbody tr').click()`);
 await wait(`document.querySelector('.script-body')?.textContent.includes('한글 대사')`);
 await evaluate(`document.querySelector('#preview-content input').value='한글';document.querySelector('#preview-content input').dispatchEvent(new Event('input'))`);
 await wait(`document.querySelectorAll('.text-match').length>0`);
 await evaluate(`document.querySelector('#preview-content button').click()`);
 await wait(`document.querySelector('.script-body')?.textContent.length>5000`);
 await evaluate(`document.getElementById('close-preview').click()`);
 await call('Emulation.setDeviceMetricsOverride',{width:1512,height:1100,deviceScaleFactor:1,mobile:false});
 await evaluate(`document.getElementById('preservation-output').value=${JSON.stringify(path.join(output,'ui-stored'))};document.getElementById('preserve-filtered').click()`);
 await wait(`document.getElementById('job-current').textContent.includes('원문 복원 아님')`);
 if(!await evaluate(`document.getElementById('job-current').textContent.includes('보존 1개')`))throw Error('filtered preserve count');
 await evaluate(`document.getElementById('source').value=${JSON.stringify(path.join(output,'index-input','HEADER.CMF'))};document.getElementById('export-index').click()`);
 await wait(`document.getElementById('job-current').textContent.includes('인덱스 내보내기 완료')`);
 await evaluate(`document.getElementById('preservation-output').closest('details').open=true`);
 const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,'ui.png'),Buffer.from(screenshot.data,'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 if(!await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`))throw Error('mobile overflow');
 if(errors.length)throw Error(errors.join(';'));
 console.log('PASS: browser grouping, group audio navigation, group note, UTF-16 preview, search, more text, mobile; zero JS exceptions');
}finally{await call('Browser.close').catch(()=>{});ws.close();}
