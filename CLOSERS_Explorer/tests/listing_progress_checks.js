import {readListingResponse,createListingStatus} from '/model-list-progress.js';
const check=(value,message)=>{if(!value)throw Error(message);};
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
try{
  let clock=0,cancelled=0,retried=0;
  const status=createListingStatus({anchor:document.getElementById('picker-status'),element,now:()=>clock,onCancel:()=>cancelled++,onRetry:()=>retried++});
  status.start();status.update({label:'의상 정보 연결 중',done:12400,total:18000,last_progress_age:0});
  check(document.getElementById('model-list-stage').textContent==='의상 정보 연결 중','actual server stage is not shown');
  check(document.getElementById('model-list-progress').querySelector('progress').value===12400,'measured count was lost');
  clock=11000;status.render();
  check(!document.getElementById('model-list-warning').hidden&&!document.getElementById('model-list-retry').hidden,'no warning/retry after missing progress');
  check(!document.getElementById('model-list-warning').textContent.includes('정지'),'delay incorrectly claims the server stopped');
  document.getElementById('model-list-retry').click();document.getElementById('model-list-cancel').click();
  check(retried===1&&cancelled===1,'recovery controls do not dispatch');
  status.update({label:'캐시 확인 중',done:null,total:null,last_progress_age:0});
  check(!document.getElementById('model-list-progress').querySelector('progress').hasAttribute('value'),'unknown totals show a fabricated percentage');
  check(document.getElementById('model-list-warning').hidden,'fresh progress did not clear the warning');
  status.finish();
  document.dispatchEvent(new CustomEvent('model-preview-progress',{detail:{requested:4,done:2,unavailable:1}}));
  check(document.getElementById('model-list-progress').hidden&&!document.getElementById('model-icon-progress').hidden,'image status was mixed with list status');
  check(document.getElementById('model-icon-progress').textContent.includes('2 / 4'),'visible image counts are missing');
  status.failed('목록 요청 취소');check(!document.getElementById('model-list-retry').hidden,'cancel/failure cannot be retried');
  status.finish();
  let source,received=[],settled=false;
  const stream=new ReadableStream({start(controller){source=controller;}}),encoder=new TextEncoder();
  const result=readListingResponse(new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}}),p=>received.push(p)).then(value=>{settled=true;return value;});
  const progress=encoder.encode(JSON.stringify({progress:{label:'의상 연결 중',done:3,total:5}})+'\n');
  for(const byte of progress)source.enqueue(new Uint8Array([byte]));
  for(let i=0;i<100&&!received.length;i++)await new Promise(r=>setTimeout(r,1));
  check(received[0]?.label==='의상 연결 중'&&!settled,'UTF-8 progress was buffered until the final result');
  source.enqueue(encoder.encode(JSON.stringify({result:{total:1,items:[{name:'의상'}]}})+'\n'));source.close();
  check((await result).items[0].name==='의상','listing result did not survive chunk boundaries');
  let failed=false;
  try{await readListingResponse(new Response('{"progress":{"done":1}}\n',{headers:{'Content-Type':'application/x-ndjson'}}));}catch(e){failed=e.message.includes('연결이 끊겼습니다');}
  check(failed,'truncated responses masquerade as successful empty lists');
  const fallback=await readListingResponse(new Response('{"total":2}',{headers:{'Content-Type':'application/json'}}));
  check(fallback.total===2,'ordinary JSON API compatibility was broken');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(element('pre',e.stack));}
