import {setupPicker} from '/model-picker.js';
const $=id=>document.getElementById(id),check=(v,message)=>{if(!v)throw Error(message);};
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const requests=[],state={page:1,busy:false,ids:[]};let resets=0;
const data=label=>({total:1,items:[{key:'ROGUE|CLOTH_1_A',label,character:'ROGUE',parts:[],part_labels:[],count:1,costume_types:['A']}],facets:{}});
const picker=setupPicker({state,element,api:(url,signal)=>new Promise((resolve,reject)=>requests.push({signal,resolve,reject})),operation:fn=>fn(),loadModel:async()=>{},previews:{reset(){resets++;},attach(){}}});
try{
  $('model-mode').value='sets';$('model-character').value='ROGUE';
  const older=picker.search();$('model-search').value='new';const newer=picker.search();
  check(requests.length===2&&requests[0].signal.aborted&&!requests[1].signal.aborted,'new list did not cancel prior request');
  requests[1].resolve(data('Newest'));await newer;
  requests[0].resolve(data('Old response'));await older;
  check($('model-results').textContent.includes('Newest')&&!$('model-results').textContent.includes('Old response'),'stale list overwrote latest results');
  check($('model-results').getAttribute('aria-busy')==='false'&&resets>=3,'loading state or thumbnail cancellation failed');
  const failure=picker.search();requests[2].reject(Error('fixture failed'));await failure;
  check($('picker-status').textContent.includes('fixture failed')&&$('model-results').textContent.includes('Newest'),'failed list discarded existing results');
  const pending=picker.search();$('model-character').value='';await picker.search();
  check(requests[3].signal.aborted,'clearing character did not cancel list');requests[3].reject(new DOMException('aborted','AbortError'));await pending;
  check($('model-results').textContent.includes('먼저 캐릭터')&&!$('picker-status').textContent&&$('model-results').getAttribute('aria-busy')==='false','late cancellation changed cleared list');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(element('pre',e.stack));}
