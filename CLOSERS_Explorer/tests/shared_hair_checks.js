import {setupPicker} from '/model-picker.js';
const $=id=>document.getElementById(id),state={page:1,busy:false,ids:[]},calls=[];
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const check=(v,message)=>{if(!v)throw Error(message);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
const shared={source_set_key:'STRIKER|CLOTH_900_A',source_set_name:'CLOTH_900_A',target_set_key:'STRIKER|CLOTH_900_B',source_type:'A'};
const child={id:2,name:'HAIR_ALPHA.X',archive:'fixture',ordinal:1};
const normal={id:1,name:'HAIR.X',display_name:'시험 공용 헤어',character:'STRIKER',part:'HAIR',archive:'fixture',ordinal:0,appearance_key:'STRIKER:101:0',item_id:101,item_ids:[101,102],set_key:'STRIKER|CLOTH_900_B',set_name:'CLOTH_900_B',costume_type:'B',type_label:'CLOTH_900_B',shared_hair:shared,components:[{name:'HAIR.X',appearance_key:'STRIKER:101:0',selected:1,candidates:[{id:1,name:'HAIR.X',archive:'fixture',ordinal:0}]},{name:child.name,appearance_key:'STRIKER:101:0',selected:2,candidates:[child]}]};
const another={...normal,display_name:'시험 어나더 헤어',appearance_key:'STRIKER:103:0',item_id:103,item_ids:[103],components:[]};
const body={id:3,name:'BODY.X',display_name:'시험 상의 [B타입]',archive:'fixture',ordinal:2,appearance_key:'STRIKER:202:0',item_id:202,item_ids:[202]};
const api=async url=>{
 const u=new URL(url,location.href);
 if(u.pathname==='/api/model-bundle')return {key:normal.set_key,label:'시험 의상 · CLOTH_900_B',character:'STRIKER',slots:[{part:'HAIR',variant:'BASE',label:'머리 · 기본 메시',checked:true,selected:null,candidates:[normal,another],shared_hair:shared},{part:'UPBODY',variant:'BASE',label:'상의',checked:true,selected:3,candidates:[body]}],face:{candidates:[]},motion:{candidates:[]},defaults:[]};
 const mode=u.searchParams.get('mode'),items=mode==='sets'?[{key:normal.set_key,label:'시험 의상 [B타입] · CLOTH_900_B',character:'STRIKER',costume_types:['B'],parts:['HAIR','UPBODY'],count:2}]:[normal];
 return {items,total:items.length,facets:{}};
};
const picker=setupPicker({state,api,element,operation:fn=>fn(),loadModel:async(ids,skeleton,eye,items)=>calls.push({ids,items})});
try{
 $('model-character').value='STRIKER';$('model-mode').value='sets';await picker.search();
 document.querySelector('#model-results .model-open').click();await until(()=>!$('avatar-bundle').hidden);
 const hair=$('avatar-bundle').querySelector('[data-shared-set]'),select=hair.querySelector(':scope>select');
 check(hair.textContent.includes('A타입 공용 헤어')&&hair.dataset.sharedSet===shared.source_set_key,'bundle hides shared source');
 check(!select.value&&select.options.length===3,'normal/another hair was silently selected');
 select.value='1|STRIKER:101:0';select.dispatchEvent(new Event('change'));
 check(hair.textContent.includes('A타입과 공유')&&hair.querySelectorAll('.bundle-components select').length===1,'shared composition or explanation missing');
 [...$('avatar-bundle').querySelectorAll('button')].find(b=>b.textContent==='묶음 열기').click();await until(()=>calls.length===1);
 check(calls[0].ids.join(',')==='1,2,3'&&calls[0].items[1]==='STRIKER:101:0'&&calls[0].items[2]==='STRIKER:101:0'&&calls[0].items[3]==='STRIKER:202:0','shared hair item was replaced by body type or lost components');
 select.value='1|STRIKER:103:0';select.dispatchEvent(new Event('change'));
 check(!hair.querySelector('.bundle-components select'),'another hair retained normal-only components');
 [...$('avatar-bundle').querySelectorAll('button')].find(b=>b.textContent==='묶음 열기').click();await until(()=>calls.length===2);
 check(calls[1].ids.join(',')==='1,3'&&calls[1].items[1]==='STRIKER:103:0','another shared hair lost its item selection');
 $('model-mode').value='parts';await picker.search();
 const row=$('model-results').firstElementChild;
 check(row.dataset.sharedSet===shared.source_set_key&&row.querySelector('.model-card-context').textContent.includes('A타입 공용 헤어'),'parts list hides shared hair');
 row.querySelector('[data-action="preview"]').click();await until(()=>calls.length===3);
 check(calls[2].ids.join(',')==='1,2'&&calls[2].items[1]==='STRIKER:101:0','standalone shared hair lost original selection');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(element('pre',e.stack));}
