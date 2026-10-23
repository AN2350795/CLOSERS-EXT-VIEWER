import {setupPicker} from '/model-picker.js';
import {pickerMemory} from '/model-memory.js';
const $=id=>document.getElementById(id),check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const face={id:1,name:'FACE.X',archive:'source',ordinal:0},red={id:2,name:'RED.PNG',archive:'source',ordinal:1},blue={id:3,name:'BLUE.PNG',archive:'source',ordinal:2};
const items=[{key:'STRIKER:basic',label:'이세하 기본 눈동자',basic:true,character:'STRIKER',face_id:1,face_candidates:[face],texture_id:null,texture_candidates:[],available:true},
 {key:'STRIKER:10',label:'붉은 눈동자',basic:false,item_id:10,character:'STRIKER',face_id:1,face_candidates:[face],texture_id:2,texture_candidates:[red],available:true},
 {key:'STRIKER:11',label:'푸른 눈동자',basic:false,item_id:11,character:'STRIKER',face_id:1,face_candidates:[face],texture_id:null,texture_candidates:[red,blue],available:true},
 {key:'STRIKER:12',label:'자료 없는 눈동자',basic:false,item_id:12,character:'STRIKER',face_id:1,face_candidates:[face],texture_id:null,texture_candidates:[],available:false}];
const state={page:1,busy:false,ids:[],data:null},requests=[];let applied=null;
localStorage.clear();
const picker=setupPicker({state,element,operation:async fn=>fn(),loadModel:async()=>{},applyEye:async(item,face,texture)=>{applied={key:item.key,face,texture};state.data={eye_avatar:{key:item.key},sources:[]};document.dispatchEvent(new Event('model-selection'));},
 api:async url=>{requests.push(url);return {items:url.startsWith('/api/model-eyes')?items:[],total:url.startsWith('/api/model-eyes')?items.length:0,facets:Object.fromEntries(['character','kind','part','family','variant'].map(k=>[k,k==='character'?[{value:'STRIKER',label:'이세하',count:4}]:[]]))};}});
try{
 await picker.search();$('model-character').value='STRIKER';await picker.search();$('model-saved').value='existing';document.querySelector('[data-mode=eyes]').click();await until(()=>$('model-results').children.length===4);
 check($('model-saved').value===''&&requests.at(-1).startsWith('/api/model-eyes?'),'eye tab includes unextracted items and uses item API');
 const rows=[...$('model-results').children];check(rows[0].textContent.includes('기본 눈동자')&&rows[1].textContent.includes('붉은 눈동자')&&rows[2].textContent.includes('푸른 눈동자'),'shared face keeps separate eye names');
 rows[1].querySelector('.model-open').click();await until(()=>applied?.key==='STRIKER:10');check(applied.face===1&&applied.texture===2&&rows[1].classList.contains('is-selected'),'selected eye uses its texture and marks its row');
 rows[0].querySelector('.model-open').click();await until(()=>applied?.key==='STRIKER:basic');check(applied.texture===null,'basic eye explicitly restores original texture');
 const details=rows[2].querySelector('details');check(details.open,'ambiguous texture source needs explicit choice');const select=details.querySelector('select');check(!select.value&&rows[2].classList.contains('needs-source'),'ambiguous texture is not auto-selected');rows[2].querySelector('[data-action=apply-eye]').click();check(document.activeElement===select,'source selection action focuses the unresolved source');select.value='3';select.dispatchEvent(new Event('change'));check(!rows[2].classList.contains('needs-source'),'source status updates after choosing');rows[2].querySelector('.model-open').click();await until(()=>applied?.texture===3);
 check(rows[3].querySelector('.model-open').disabled&&rows[3].querySelector('details').textContent.includes('원본 폴더'),'missing data is visible and explained');
 rows[0].querySelector('.favorite-button').click();rows[1].querySelector('.favorite-button').click();check(pickerMemory().data.favorites.length===2,'eye favorites keep separate identities');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(element('pre',e.stack));}
