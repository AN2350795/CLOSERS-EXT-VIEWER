import {setupPicker} from '/model-picker.js';
const $=id=>document.getElementById(id),state={page:1,ids:[],busy:false};
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const check=(v,message)=>{if(!v)throw Error(message);};
const requests=[];
const api=async url=>{requests.push(new URL(url,location.href));return ({total:20,items:url.includes('/api/model-eyes')?[{key:'STRIKER:basic',label:'이세하 기본 눈동자',character:'STRIKER',basic:true,available:true,face_id:1,face_candidates:[{id:1,name:'FACE.X',archive:'fixture',ordinal:0}],texture_candidates:[]}]:Array.from({length:20},(_,i)=>({id:i+1,name:'Avatar '+i,display_name:'이세하 긴 이름의 아바타 헤어 [SP타입]',costume_type:'SP',label:'Outfit '+i,key:'STRIKER|BASIC',character:'STRIKER',archive:'fixture',parts:['HAIR'],count:1})),facets:Object.fromEntries(['character','kind','family','part','variant'].map(k=>[k,k==='part'?[{value:'HAIR',label:'헤어',count:20}]:[]]))});};
const picker=setupPicker({state,api,element,operation:async fn=>fn(),loadModel:async()=>{}});
window.checkPickerLayout=async()=>{
 const rect=()=>$('model-results').getBoundingClientRect();
 $('model-character').value='STRIKER';await picker.search();
 const top=rect().top,height=rect().height;
 const fixed=message=>check(Math.abs(rect().top-top)<1&&Math.abs(rect().height-height)<1,message);
 for(const mode of ['parts','accessories','eyes','sets']){
  $('model-mode').value=mode;await picker.search();fixed('list moved after '+mode);
  const modeBounds=$('wardrobe-tabs').getBoundingClientRect(),toolsBounds=document.querySelector('.picker-tools').getBoundingClientRect();
  check(toolsBounds.top-modeBounds.bottom<=8,'no reserved blank row between mode and tools');
  check(document.querySelector('.picker-tools').contains($('model-sort')),'sort remains directly available');
  if(mode!=='parts')check(!document.querySelector('.picker-tools').contains($('model-part')),'other modes give toolbar space back to sorting');
  if(mode==='parts'){
   const part=$('model-part'),sort=$('model-sort'),tools=document.querySelector('.picker-tools');
   check(part.checkVisibility()&&tools.contains(part)&&tools.contains(sort),'part and sort controls share the toolbar');
   const bounds=tools.getBoundingClientRect();
   for(const control of [part,sort,$('open-picker-options')]){const b=control.getBoundingClientRect();check(b.left>=bounds.left&&b.right<=bounds.right+1&&Math.abs(b.top-bounds.top)<1,'toolbar controls fit on one row');}
   check([...part.options].some(o=>o.value==='HAIR'),'available parts exist');
   part.value='HAIR';part.dispatchEvent(new Event('change'));await new Promise(requestAnimationFrame);fixed('selecting a part moves list');
   check(part.value==='HAIR','part selection is retained');
   check(requests.at(-1).searchParams.get('part')==='HAIR','inline selection reaches the search API');
  }
  {
   const row=$('model-results').firstElementChild,name=row.querySelector('.model-open').getBoundingClientRect(),date=row.querySelector('.model-source-date').getBoundingClientRect(),actions=row.querySelector('.actions').getBoundingClientRect(),bounds=row.getBoundingClientRect();
   check(date.top>=name.bottom-1&&actions.top>=date.bottom-1,'set name, date and actions are ordered');
   const buttons=[...row.querySelectorAll('.actions button')].map(b=>b.getBoundingClientRect());
   check(buttons.length===(['sets','eyes'].includes(mode)?2:3)&&buttons.every(b=>Math.abs(b.top-buttons[0].top)<1&&b.left>=bounds.left&&b.right<=bounds.right&&b.bottom<=bounds.bottom),'card actions align without clipping: '+mode);
   if(mode!=='sets'){const context=row.querySelector('.model-card-context').getBoundingClientRect();check(context.top>=name.bottom-1&&date.top>=context.bottom-1,'card classification stays between name and date: '+mode);}
  }
 }
 $('model-results').scrollTop=40;const scroll=$('model-results').scrollTop;
 $('open-picker-options').click();check($('picker-options').open,'filter dialog opens');fixed('filter dialog moves list');
 document.querySelector('#model-favorites').parentElement.open=true;fixed('favorites move list');
 $('close-picker-options').click();check(!$('picker-options').open,'filter dialog closes');check($('model-results').scrollTop===scroll,'dialog changes list scroll');
 $('picker-status').textContent='상태 안내 '.repeat(30);fixed('long status moves list');$('picker-status').textContent='';
 $('model-filter-summary').textContent='매우 긴 검색 조건 '.repeat(30);fixed('long summary moves list');
 check(rect().height>=180,'list is too short: '+rect().height+' at '+innerWidth+'x'+innerHeight);
 check(document.documentElement.scrollWidth<=innerWidth+1,'horizontal page overflow');
 const pickerPanel=document.querySelector('.model-picker'),pickerScroll=pickerPanel.scrollTop;
 pickerPanel.scrollTop=pickerPanel.scrollHeight;
 const panel=document.querySelector('.model-picker').getBoundingClientRect();
 for(const control of document.querySelectorAll('.picker-pagination button,#model-jump')){
  if(!control.checkVisibility())continue;const b=control.getBoundingClientRect();check(b.left>=panel.left&&b.right<=panel.right&&b.bottom<=panel.bottom,'pagination control clipped');
 }
 pickerPanel.scrollTop=pickerScroll;
 return {width:innerWidth,top,height};
};
try{await picker.search();await window.checkPickerLayout();document.body.dataset.checks='passed';}
catch(e){document.body.dataset.checks='failed';document.body.append(element('pre',e.stack));}
