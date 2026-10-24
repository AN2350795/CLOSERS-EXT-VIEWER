const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<600;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
const original=fetch,pending=new Map(),motions=[];
let deferScenes=false,deferMotion=false,deferTextures=false,sha='first',metadataCalls=0;
const textureWaiters=[];
const scene=id=>({frames:[],meshes:[{name:'triangle',frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,2,1],uv:[0,0,1,0,.5,1],skin:[],groups:[[0,3,0]],materials:[{color:[1,1,1,1],texture:'same.PNG',image:{name:'same.PNG',selected:71,candidates:[{id:71,archive:'fixture',ordinal:0}]}}]}],sources:[{name:'test.X',entry_id:id}],skeleton_source:{name:'test.X',entry_id:id,sha256:'skeleton'},motion:{candidates:[]},animation:{name:'motion',selected:9,candidates:[{id:9,archive:'fixture',ordinal:0}]},warnings:[]});
window.fetch=async(url,options)=>{
  const text=String(url);
  if(text.startsWith('/api/model-browser'))return new Response(JSON.stringify({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}}));
  if(text.startsWith('/api/model-scene')){
    const id=Number(new URL(text,location.href).searchParams.get('entries'));
    if(deferScenes)await new Promise(r=>pending.set(id,r)); // Ignore AbortSignal to test the generation guard itself.
    return new Response(JSON.stringify(scene(id)));
  }
  if(text.startsWith('/api/model-animations')){
    if(deferMotion)await new Promise(r=>motions.push(r));
    return new Response(JSON.stringify({skeleton_source:{sha256:'skeleton'},animation_source:{sha256:'motion'},clips:[],mapping:{verified_bones:0,verified_keys:0,maximum_error:0}}));
  }
  if(text.startsWith('/api/composition-source/')){metadataCalls++;if(deferTextures)await new Promise(r=>textureWaiters.push(r));return new Response(JSON.stringify({width:4,height:4,image_sha256:sha}));}
  return original(url,options);
};
try{
  await import('/model.js');await until(()=>window.modelViewer&&!modelViewer.state.busy);
  deferMotion=true;await modelViewer.loadModel([1]);
  check(!modelViewer.state.busy&&!modelViewer.state.animation&&modelViewer.state.model,'visible readiness waited for animation');
  check(document.getElementById('viewport').getAttribute('aria-busy')==='false'&&modelViewer.state.timings.readyMs>0,'visible readiness was not rendered');
  const canvas=document.getElementById('model-canvas'),visibleModel=modelViewer.state.model;
  document.getElementById('expand-viewer').click();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  check(modelViewer.state.model===visibleModel&&document.getElementById('viewer-dialog').contains(canvas)&&!canvas.getContext('webgl2').isContextLost(),'expanding lost the active scene or WebGL context');
  document.getElementById('viewer-dialog').close();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  check(modelViewer.state.model===visibleModel&&document.querySelector('.model-layout').contains(canvas)&&!canvas.getContext('webgl2').isContextLost(),'restoring lost the active scene or WebGL context');
  const first=modelViewer.state.textures.get('base:71');
  await modelViewer.loadModel([1]);check(modelViewer.state.textures.get('base:71')===first&&metadataCalls===2,'reopen failed to validate metadata or reuse texture');
  sha='changed';await modelViewer.loadModel([1]);check(modelViewer.state.textures.get('base:71')!==first,'changed texture digest reused stale GPU data');
  check([...modelViewer.textureCache.entries.values()].filter(e=>e.refs>0).length===1,'old model retained texture references');
  deferScenes=true;
  const old=modelViewer.loadModel([2]);await until(()=>pending.has(2));
  const latest=modelViewer.loadModel([3]);await until(()=>pending.has(3));
  pending.get(2)();await old;
  check(modelViewer.state.busy&&document.getElementById('viewport').getAttribute('aria-busy')==='true','stale request cleared newest loading state');
  pending.get(3)();await latest;check(modelViewer.state.ids[0]===3,'latest scene was overwritten');
  const activeModel=modelViewer.state.model;let disposed=0;const dispose=activeModel.dispose;activeModel.dispose=()=>{disposed++;dispose();};
  document.getElementById('clear-model').click();check(disposed===1&&!modelViewer.state.model,'geometry and skeleton disposal was skipped');
  for(const finish of motions)finish();await new Promise(r=>setTimeout(r,50));
  check(!modelViewer.state.animation&&!modelViewer.state.model,'stale animation restored cleared model');
  check([...modelViewer.textureCache.entries.values()].every(e=>e.refs===0),'clear leaked GPU texture references');
  deferScenes=false;deferMotion=false;deferTextures=true;
  const olderTexture=modelViewer.loadModel([4]);await until(()=>textureWaiters.length===1);
  const newerTexture=modelViewer.loadModel([5]);await until(()=>textureWaiters.length===2);
  textureWaiters[1]();await newerTexture;textureWaiters[0]();await olderTexture;
  check(modelViewer.state.ids[0]===5&&modelViewer.state.textures.size===1,'stale texture preparation overwrote newest model');
  document.getElementById('clear-model').click();
  check([...modelViewer.textureCache.entries.values()].every(e=>e.refs===0),'stale texture preparation leaked references');
  modelViewer.textureCache.clear();check(modelViewer.textureCache.entries.size===0&&modelViewer.textureCache.pixels===0,'GPU cache teardown failed');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
