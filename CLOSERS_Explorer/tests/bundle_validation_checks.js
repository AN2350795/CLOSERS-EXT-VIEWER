import {setupPicker} from '/model-picker.js';
const $=id=>document.getElementById(id),state={page:1,busy:false,ids:[]};
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+fn);};
const candidate=id=>({id,name:'model-'+id+'.X',archive:'fixture',ordinal:id});
const api=async url=>url.startsWith('/api/model-bundle')?{
  label:'검증용 의상',character:'STRIKER',evidence:'fixture',defaults:[],face:{candidates:[]},motion:{candidates:[]},
  slots:[
    {part:'HAIR',label:'헤어',checked:true,candidates:[candidate(1),candidate(2)]},
    {part:'UPBODY',label:'상의',checked:true,selected:10,candidates:[{...candidate(10),components:[{name:'alpha.X',candidates:[candidate(11),candidate(12)]}]}]},
    {part:'FOOT',label:'신발',checked:false,candidates:[]}
  ]
}:{total:0,items:[],facets:{}};
let loaded=null,operations=0;
const picker=setupPicker({state,api,element,operation:async fn=>{operations++;return fn();},loadModel:async ids=>{loaded=ids;}});
const change=(control,value)=>{if(control.type==='checkbox')control.checked=value;else control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));};
try{
  $('model-character').value='STRIKER';await picker.search();$('basic-avatar').click();
  await until(()=>!$('avatar-bundle').hidden);
  const bundle=$('avatar-bundle'),rows=[...bundle.querySelectorAll('.bundle-slot')];
  const hair=rows[0].querySelector('select'),component=rows[1].querySelector('.bundle-components select'),foot=rows[2].querySelector('input');
  const open=[...bundle.querySelectorAll('button')].find(b=>b.textContent==='묶음 열기');
  rows[1].querySelector('details').open=false;
  document.querySelector('.model-layout').classList.add('info-collapsed');
  $('show-wardrobe').click();const before=operations;open.click();
  check(operations===before&&!loaded,'validation does not start an operation or load a model');
  check(hair.checkVisibility()&&document.activeElement===hair,'first missing model is revealed and focused');
  check(bundle.querySelectorAll('[aria-invalid=true]').length===2,'all missing model and component inputs are marked');
  change(hair,'1');
  check(!hair.hasAttribute('aria-invalid')&&component.hasAttribute('aria-invalid'),'choosing one model clears only its guidance');
  open.click();
  check(rows[1].querySelector('details').open&&document.activeElement===component,'nested missing component is expanded and focused');
  change(component,'11');change(foot,true);open.click();
  check(rows[2].querySelector('.bundle-selection-error').textContent.includes('선택할 모델이 없습니다'),'missing files explain how to recover');
  change(foot,false);check(!bundle.querySelector('.bundle-selection-error'),'excluding an unavailable part clears guidance');
  for(const row of rows)change(row.querySelector('input'),false);
  open.click();check(document.activeElement===rows[0].querySelector('input')&&bundle.textContent.includes('하나 이상 선택'),'empty bundle focuses the include checkbox');
  change(rows[0].querySelector('input'),true);
  check(!bundle.querySelector('.bundle-selection-error'),'including a part clears empty-bundle guidance');
  open.click();await until(()=>loaded);
  check(loaded.join(',')==='1','corrected selection loads only included parts');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(element('pre',e.stack));}
