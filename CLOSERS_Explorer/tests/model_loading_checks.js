const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
const originalFetch=window.fetch;
let release,requested=false,fail=false;
window.fetch=async (url,options)=>{
  if(String(url).startsWith('/api/model-browser'))return new Response(JSON.stringify({total:1,items:[{key:'CASTER|CLOTH_225_A',label:'시험 의상',character:'CASTER',count:1,parts:['HAIR']}],facets:{character:[],kind:[],family:[],part:[],variant:[]}}));
  if(String(url).startsWith('/api/model-bundle'))return new Response(JSON.stringify({label:'시험 의상',character:'CASTER',evidence:'fixture',slots:[{part:'HAIR',variant:'BASE',label:'머리 · 기본 메시',checked:true,selected:null,candidates:[{id:1,name:'hair A',archive:'fixture',ordinal:0},{id:2,name:'hair B',archive:'fixture',ordinal:1}]}],face:{candidates:[]},motion:{candidates:[]},defaults:[]}));
  if(String(url).startsWith('/api/model-scene')){
    requested=true;await new Promise(r=>release=r);
    if(fail)return new Response(JSON.stringify({error:'시험 모델 열기 실패'}),{status:409});
    return new Response(JSON.stringify({frames:[],meshes:[{name:'triangle',frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,0,0,1],image:null}]}],sources:[{name:'test.X',entry_id:1}],skeleton_source:{name:'test.X',entry_id:1},motion:{candidates:[]},animation:{name:'동작 없음',candidates:[]},warnings:[]}));
  }
  return originalFetch(url,options);
};
try{
  await import('/model.js');document.querySelector('#model-character').value='CASTER';document.querySelector('#model-character').dispatchEvent(new Event('change'));await until(()=>document.querySelector('#model-results button'));
  const status=document.getElementById('model-status'),viewport=document.getElementById('viewport');
  let pending=modelViewer.loadModel([1]);await until(()=>requested);
  check(!modelViewer.state.model&&status.classList.contains('is-loading')&&status.textContent.includes('모델 여는 중'),'opening appears before model response');
  check(viewport.getAttribute('aria-busy')==='true'&&getComputedStyle(status).position==='fixed','opening is fixed and viewport announces busy');
  window.scrollTo(0,document.body.scrollHeight);await new Promise(requestAnimationFrame);
  check(status.getBoundingClientRect().top===20,'opening stays visible after scrolling');
  release();await pending;
  check(modelViewer.state.model&&!status.classList.contains('is-loading')&&viewport.getAttribute('aria-busy')==='false'&&!modelViewer.state.busy,'success clears loading and busy state');
  check(status.textContent.includes('메시 1개')&&status.parentElement===viewport&&getComputedStyle(status).position==='absolute','result stays inside scene without moving controls');
  fail=true;requested=false;pending=modelViewer.loadModel([2]);await until(()=>requested);release();await pending;
  check(!status.classList.contains('is-loading')&&viewport.getAttribute('aria-busy')==='false'&&status.textContent.includes('시험 모델 열기 실패'),'failure clears loading and explains error');
  check(modelViewer.state.ids[0]===1,'failed opening preserves previous model');
  document.querySelector('#model-results button').click();await until(()=>!document.getElementById('avatar-bundle').hidden&&!modelViewer.state.busy);
  const bundle=document.getElementById('avatar-bundle'),open=[...bundle.querySelectorAll('button')].find(b=>b.textContent==='묶음 열기');
  requested=false;open.click();await until(()=>!modelViewer.state.busy);
  const select=bundle.querySelector('.bundle-slot select');
  check(!status.classList.contains('is-notice')&&!requested,'missing source stays local and makes no model request');
  check(select.getAttribute('aria-invalid')==='true'&&select.classList.contains('needs-selection'),'missing source is highlighted');
  check(document.activeElement===select&&select.checkVisibility(),'missing source receives focus in a visible panel');
  const note=document.getElementById(select.getAttribute('aria-describedby'));
  check(note?.textContent.includes('사용할 모델을 선택')&&note.checkVisibility(),'selection guidance describes the missing input');
  open.click();check(bundle.querySelectorAll('.bundle-selection-error').length===1,'repeated validation does not duplicate messages');
  select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));
  check(!select.hasAttribute('aria-invalid')&&!select.classList.contains('needs-selection')&&!bundle.querySelector('.bundle-selection-error'),'selection clears its guidance');
  fail=false;open.click();await until(()=>requested);
  check(status.classList.contains('is-loading')&&!status.classList.contains('is-notice'),'valid selection begins loading');
  release();await until(()=>!modelViewer.state.busy);
  check(!status.classList.contains('is-loading')&&!status.classList.contains('is-notice'),'successful retry clears loading');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
