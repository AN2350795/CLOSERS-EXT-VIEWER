import {setupPicker} from '/model-picker.js';
const $=id=>document.getElementById(id),check=(v,message)=>{if(!v)throw Error(message);};
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const requests=[],state={page:1,busy:false,ids:[]};let resets=0,connected=null,opened=0;
const data=label=>({total:1,items:[{key:'ROGUE|CLOTH_1_A',label,character:'ROGUE',parts:[],part_labels:[],count:1,costume_types:['A']}],facets:{}});
const picker=setupPicker({state,element,api:(url,signal)=>new Promise((resolve,reject)=>requests.push({url,signal,resolve,reject})),operation:fn=>fn(),connectAnimation:async id=>{connected=id;},loadModel:async()=>{opened++;},previews:{reset(){resets++;},attach(){}}});
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
  $('model-mode').value='files';$('model-format').append(new Option('모션 · XMD','xmd'));$('model-format').value='xmd';$('model-search').value='';
  state.model={};const motions=picker.search();
  check(new URL(requests[4].url,location.href).searchParams.get('format')==='xmd','source format filter does not reach API');
  requests[4].resolve({total:1,facets:{format:[{value:'xmd',label:'모션 · XMD',count:1}]},items:[{
    id:41,name:'MOTION_STRIKER_SKILL.XMD',display_name:'실제 명칭',format:'xmd',kind:'motion',kind_label:'공용 뼈·동작',
    character:'STRIKER',archive:'fixture',ordinal:1,saved_exists:true}]});await motions;
  check(!$('model-format').closest('label').hidden&&$('model-results').textContent.includes('실제 명칭'),'source format and official name are not visible');
  [...$('model-results').querySelectorAll('button')].find(b=>b.textContent==='현재 모델에 동작 연결').click();
  await Promise.resolve();check(connected===41&&opened===0,'XMD was opened as a mesh instead of connected as animation');
  check($('model-results').querySelector('a').getAttribute('href').includes('/api/download/41'),'source download lost the source ID');
  check(document.querySelector('.source-tools a[download="model-catalog.json"]'),'full classification report download is missing');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(element('pre',e.stack));}
