import {setupPicker} from '/model-picker.js';
const $=id=>document.getElementById(id),state={page:1,ids:[],busy:false};
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const check=(v,message)=>{if(!v)throw Error(message);};
const api=async url=>({total:20,items:url.includes('/api/model-eyes')?[]:Array.from({length:20},(_,i)=>({id:i+1,name:'Avatar '+i,label:'Outfit '+i,key:'STRIKER|BASIC',character:'STRIKER',archive:'fixture',parts:['HAIR'],count:1})),facets:Object.fromEntries(['character','kind','family','part','variant'].map(k=>[k,k==='part'?[{value:'HAIR',label:'헤어',count:20}]:[]]))});
const picker=setupPicker({state,api,element,operation:async fn=>fn(),loadModel:async()=>{}});
window.checkPickerLayout=async()=>{
 const rect=()=>$('model-results').getBoundingClientRect();
 $('model-character').value='STRIKER';await picker.search();
 const top=rect().top,height=rect().height;
 const fixed=message=>check(Math.abs(rect().top-top)<1&&Math.abs(rect().height-height)<1,message);
 for(const mode of ['parts','accessories','eyes','sets']){$('model-mode').value=mode;await picker.search();fixed('list moved after '+mode);}
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
