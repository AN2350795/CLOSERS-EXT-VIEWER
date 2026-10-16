import {setupPicker} from '/model-picker.js';
const $=id=>document.getElementById(id),state={page:1,busy:false,ids:[]};
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
let calls=[],fail=false,delay=null;
async function api(url){
  const p=new URL(url,location.href).searchParams;calls.push(p);
  if(delay){const wait=delay;delay=null;await wait;}
  if(fail)throw Error('test network error');
  const count=125,limit=Number(p.get('limit')),page=Number(p.get('page'));
  return {total:count,page,limit,facets:Object.fromEntries(['character','kind','family','part','variant'].map(k=>[k,[]])),items:Array.from({length:Math.min(limit,Math.max(0,count-(page-1)*limit))},(_,i)=>({id:(page-1)*limit+i+1,name:'file '+((page-1)*limit+i+1),archive:'fixture',saved_exists:true,label:'Outfit '+i,key:'STRIKER|CLOTH_'+i,parts:['HAIR','UPBODY'],count:2}))};
}
const picker=setupPicker({state,api,element,operation:async fn=>{if(!state.busy)await fn();},loadModel:async()=>{}});
try{
 await picker.search();
 check($('model-results').children.length===40,'40 results by default');
 state.busy=true;$('model-next').click();await until(()=>$('model-page').textContent.startsWith('2 /'));
 check(calls.at(-1).get('page')==='2','pagination works while model busy');
 $('model-last').click();await until(()=>$('model-page').textContent.startsWith('4 /'));
 check($('model-results').children.length===5&&$('model-next').disabled,'last page bounds');
 $('model-jump').value='2';$('model-jump-form').dispatchEvent(new Event('submit',{cancelable:true}));await until(()=>$('model-page').textContent.startsWith('2 /'));
 $('model-limit').value='60';$('model-limit').dispatchEvent(new Event('change'));await until(()=>$('model-results').children.length===60);
 check(state.page===1&&$('model-page').textContent.includes('/ 3'),'limit resets page');
 let release;delay=new Promise(r=>release=r);$('model-next').click();$('model-first').click();await until(()=>$('model-page').textContent.startsWith('1 /'));release();await new Promise(r=>setTimeout(r,20));
 check($('model-page').textContent.startsWith('1 /'),'stale response ignored');
 fail=true;$('model-next').click();await until(()=>$('picker-status').textContent.includes('test network error'));
 check($('model-results').children.length===60,'failure preserves results');fail=false;state.busy=false;
 document.querySelector('[data-mode="accessories"]').click();await until(()=>calls.at(-1).get('mode')==='accessories'&&!$('picker-status').textContent);
 check(document.querySelector('[data-mode="accessories"]').getAttribute('aria-pressed')==='true','mode selected');
 state.ids=[1];document.dispatchEvent(new Event('model-selection'));
 check($('model-results').firstChild.classList.contains('is-selected'),'selected file badge');
 $('picker-expand').click();check(document.querySelector('.model-layout').classList.contains('picker-wide'),'expand picker');
 check($('avatar-bundle').closest('.model-info'),'bundle detail separated from list');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(element('pre',e.stack));}
