import {setupPicker} from '/model-picker.js';
const $=id=>document.getElementById(id),state={page:1,ids:[],busy:false};
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const check=(v,message)=>{if(!v)throw Error(message);};
const api=async url=>({total:20,items:url.includes('/api/model-eyes')?[{key:'STRIKER:basic',label:'이세하 기본 눈동자',character:'STRIKER',basic:true,available:true,face_id:1,face_candidates:[{id:1,name:'FACE.X',archive:'fixture',ordinal:0}],texture_candidates:[]}]:Array.from({length:20},(_,i)=>({id:i+1,name:'Avatar '+i,display_name:'이세하 긴 이름의 아바타 헤어 [SP타입]',costume_type:'SP',label:'Outfit '+i,key:'STRIKER|BASIC',character:'STRIKER',archive:'fixture',parts:['HAIR'],count:1})),facets:Object.fromEntries(['character','kind','family','part','variant'].map(k=>[k,k==='part'?[{value:'HAIR',label:'헤어',count:20}]:[]]))});
const picker=setupPicker({state,api,element,operation:async fn=>fn(),loadModel:async()=>{}});
window.checkPickerLayout=async()=>{
 const rect=()=>$('model-results').getBoundingClientRect();
 $('model-character').value='STRIKER';await picker.search();
 const top=rect().top,height=rect().height;
 const fixed=message=>check(Math.abs(rect().top-top)<1&&Math.abs(rect().height-height)<1,message);
 for(const mode of ['parts','accessories','eyes','sets']){
  $('model-mode').value=mode;await picker.search();fixed('list moved after '+mode);
  if(mode==='parts'){
   const tabs=$('part-tabs'),bounds=tabs.getBoundingClientRect(),header=document.querySelector('.picker-top').getBoundingClientRect();
   check(tabs.children.length===8,'all part filters exist');
   check(tabs.scrollWidth<=tabs.clientWidth+1&&tabs.scrollHeight<=tabs.clientHeight+1,'part filters require scrolling');
   for(const button of tabs.children){const b=button.getBoundingClientRect();check(button.checkVisibility()&&b.left>=bounds.left-1&&b.right<=bounds.right+1&&b.top>=bounds.top-1&&b.bottom<=bounds.bottom+1&&b.bottom<=header.bottom,'part filter button is clipped: '+button.textContent);}
   [...tabs.children].find(b=>b.textContent==='헤어').click();await new Promise(requestAnimationFrame);fixed('selecting a part moves list');
   check([...tabs.children].find(b=>b.textContent==='헤어').getAttribute('aria-pressed')==='true','part selection is applied');
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
 check(rect().height>=180,'list is too short');
 check(document.documentElement.scrollWidth<=innerWidth+1,'horizontal page overflow');
 const panel=document.querySelector('.model-picker').getBoundingClientRect();
 for(const control of document.querySelectorAll('.picker-pagination button,#model-jump')){
  if(!control.checkVisibility())continue;const b=control.getBoundingClientRect();check(b.left>=panel.left&&b.right<=panel.right&&b.bottom<=panel.bottom,'pagination control clipped');
 }
 return {width:innerWidth,top,height};
};
try{await picker.search();await window.checkPickerLayout();document.body.dataset.checks='passed';}
catch(e){document.body.dataset.checks='failed';document.body.append(element('pre',e.stack));}
