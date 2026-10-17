const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
const originalFetch=window.fetch;
let release,requested=false,fail=false;
window.fetch=async (url,options)=>{
  if(String(url).startsWith('/api/model-browser'))return new Response(JSON.stringify({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}}));
  if(String(url).startsWith('/api/model-scene')){
    requested=true;await new Promise(r=>release=r);
    if(fail)return new Response(JSON.stringify({error:'시험 모델 열기 실패'}),{status:409});
    return new Response(JSON.stringify({frames:[],meshes:[{name:'triangle',frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,0,0,1],image:null}]}],sources:[{name:'test.X',entry_id:1}],skeleton_source:{name:'test.X',entry_id:1},motion:{candidates:[]},animation:{name:'동작 없음',candidates:[]},warnings:[]}));
  }
  return originalFetch(url,options);
};
try{
  await import('/model.js');
  const status=document.getElementById('model-status'),viewport=document.getElementById('viewport');
  let pending=modelViewer.loadModel([1]);await until(()=>requested);
  check(!modelViewer.state.model&&status.classList.contains('is-loading')&&status.textContent.includes('모델 여는 중'),'opening appears before model response');
  check(viewport.getAttribute('aria-busy')==='true'&&getComputedStyle(status).position==='fixed','opening is fixed and viewport announces busy');
  window.scrollTo(0,document.body.scrollHeight);await new Promise(requestAnimationFrame);
  check(status.getBoundingClientRect().top===20,'opening stays visible after scrolling');
  release();await pending;
  check(modelViewer.state.model&&!status.classList.contains('is-loading')&&viewport.getAttribute('aria-busy')==='false'&&!modelViewer.state.busy,'success clears loading and busy state');
  check(status.textContent.includes('메시 1개')&&status.parentElement.firstElementChild===status,'result stays above viewport controls');
  fail=true;requested=false;pending=modelViewer.loadModel([2]);await until(()=>requested);release();await pending;
  check(!status.classList.contains('is-loading')&&viewport.getAttribute('aria-busy')==='false'&&status.textContent.includes('시험 모델 열기 실패'),'failure clears loading and explains error');
  check(modelViewer.state.ids[0]===1,'failed opening preserves previous model');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
