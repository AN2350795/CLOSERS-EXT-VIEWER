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
  check(status.textContent.startsWith('머리 · 기본 메시: 사용할 출처를 선택하세요.')&&status.classList.contains('is-notice'),'missing source uses shared notification');
  check(getComputedStyle(status).position==='fixed'&&status.getBoundingClientRect().top===20&&!status.classList.contains('is-loading')&&!requested,'source notice appears at loading position without spinner or model request');
  status.querySelector('.notice-close').click();
  check(!status.classList.contains('is-notice')&&!status.querySelector('.notice-close')&&getComputedStyle(status).position!=='fixed','dismiss button closes the top notice');
  open.click();await until(()=>!modelViewer.state.busy);check(status.classList.contains('is-notice'),'notice can be shown again');
  await new Promise(r=>setTimeout(r,6100));
  check(!status.classList.contains('is-notice')&&!status.querySelector('.notice-close'),'notice closes automatically after six seconds');
  open.click();await until(()=>!modelViewer.state.busy);
  bundle.querySelector('.bundle-slot select').value='1';fail=false;open.click();await until(()=>requested);
  check(status.classList.contains('is-loading')&&!status.classList.contains('is-notice'),'retry replaces notice with loading');
  release();await until(()=>!modelViewer.state.busy);
  check(!status.classList.contains('is-loading')&&!status.classList.contains('is-notice'),'successful retry clears notification');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
