import {setupPicker} from '/model-picker.js';
import {pickerMemory} from '/model-memory.js';
const $=id=>document.getElementById(id),state={page:1,busy:false,ids:[]};
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
let calls=[],fail=false,delay=null;
async function api(url){
  const p=new URL(url,location.href).searchParams;calls.push(p);
  if(delay){const wait=delay;delay=null;await wait;}
  if(fail)throw Error('test network error');
  if(url.startsWith('/api/model-bundle'))return {label:'Test outfit',character:'STRIKER',evidence:'fixture',slots:[{part:'HAIR',variant:'BASE',label:'Hair',checked:true,selected:1,candidates:[{id:1,name:'hair',archive:'fixture',ordinal:0}]}],face:{candidates:[]},motion:{candidates:[]}};
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
 document.querySelector('[data-mode="sets"]').click();await until(()=>calls.at(-1).get('mode')==='sets'&&!$('picker-status').textContent);
 $('model-results').querySelector('button').click();await until(()=>!$('avatar-bundle').hidden);
 check($('avatar-bundle').querySelectorAll('.bundle-slot').length===2,'outfit expands into parts and face');
 check($('model-recent').textContent.includes('Test outfit'),'recent outfit recorded');
 $('avatar-bundle').querySelector('button').click();check($('avatar-bundle').hidden,'close outfit detail');
 document.querySelector('[data-mode="accessories"]').click();await until(()=>calls.at(-1).get('mode')==='accessories'&&!$('picker-status').textContent);
 check(document.querySelector('[data-mode="accessories"]').getAttribute('aria-pressed')==='true','mode selected');
 state.ids=[1];document.dispatchEvent(new Event('model-selection'));
 check($('model-results').firstChild.classList.contains('is-selected'),'selected file badge');
 $('picker-expand').click();check(document.querySelector('.model-layout').classList.contains('picker-wide'),'expand picker');
 check($('avatar-bundle').closest('.model-info'),'bundle detail separated from list');
 const star=$('model-results').querySelector('.favorite-button');star.click();
 check(star.getAttribute('aria-pressed')==='true'&&$('model-favorites').querySelector('button'),'favorite persisted and listed');
 check(pickerMemory().data.favorites.length===1,'favorite stored');
 state.data={sources:[{name:'recent-file.X',entry_id:9,model_group:{character:'STRIKER'}}]};document.dispatchEvent(new Event('model-selection'));
 check($('model-recent').textContent.includes('recent-file.X'),'recent model recorded');
 $('model-favorites').querySelector('button').click();await until(()=>!$('picker-status').textContent);
 check($('model-search').value==='file 1'&&state.page===1,'favorite finds item with reset filters');
 const saved=localStorage.getItem('closers.model-picker.v1');
 localStorage.setItem('closers.model-picker.v1','{"favorites":[null,{},1],"recent":"invalid"}');
 check(pickerMemory().data.favorites.length===0&&pickerMemory().data.recent.length===0,'invalid storage tolerated');
 localStorage.setItem('closers.model-picker.v1',saved);
 const remembered=pickerMemory().data.settings;check(remembered.limit==='60'&&remembered.q==='file 1','search settings saved');
 $('model-search').value='';setupPicker({state,api,element,operation:async fn=>fn(),loadModel:async()=>{}});
 check($('model-search').value==='file 1'&&$('model-limit').value==='60','search settings restored');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(element('pre',e.stack));}
