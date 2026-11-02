import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {createEmissionRenderer} from '/model-emission.js';
import {createSourceBloom} from '/model-bloom.js';
import {setMaterialPreviewMap,setMaterialPreview} from '/model-materials.js';
const check=(v,m)=>{if(!v)throw Error(m);};
const renderer=new T.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.setClearColor(0,0);
const gl=renderer.getContext(),live=new Map(),duplicates=[],originals=[];
// Count actual API objects, including depth/MSAA renderbuffers that Three.js's
// texture counter alone cannot see. Driver-side delayed frees are not measured.
for(const kind of ['Texture','Framebuffer','Renderbuffer','Buffer','VertexArray','Program','Shader']){
 const active=new Set(),created=new Set();live.set(kind,active);
 for(const operation of ['create','delete']){const name=operation+kind,original=gl[name];originals.push([name,original]);gl[name]=function(...args){const result=original.apply(this,args);if(operation==='create'&&result){active.add(result);created.add(result);}else if(operation==='delete'&&args[0]&&created.has(args[0])){if(!active.delete(args[0]))duplicates.push(kind);}return result;};}
}
const snapshot=()=>Object.fromEntries([...live].map(([k,v])=>[k,v.size]));
const sameCounts=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]);
const camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const grade={enabled:true,rgb:[.7,.8,.6],bcs:[-.1,.15,.8]},sharpen={enabled:true,radius:1.55},dof={enabled:true,focus:4,range:4,strength:.65};
const cases=[{bloom:false},{bloom:true},{bloom:true,bloomMode:'source'},{bloom:false,colorGrading:grade},{bloom:false,sharpen},{bloom:false,dof},{bloom:true,colorGrading:grade,sharpen,dof},{bloom:true,bloomMode:'source',colorGrading:grade,sharpen,dof},{bloom:true,bloomMode:'source',colorGrading:grade},{bloom:true,bloomMode:'source',solo:true},{bloom:true,colorGrading:grade,sharpen,dof,emission:false}];
const sizes=[[65,49],[96,64],[31,29],[3,3]];
let model,fx,map,output,stage,source,inside=false,renderCount=0;
const targets=new Map(),setTarget=renderer.setRenderTarget;renderer.setRenderTarget=function(target,...rest){if(inside&&target&&target!==output&&!targets.has(target)){const info={disposals:0};target.addEventListener('dispose',()=>info.disposals++);targets.set(target,info);}return setTarget.call(this,target,...rest);};
const errors=[];renderer.debug.onShaderError=()=>errors.push('shader');
try{
 for(let cycle=0;cycle<3;cycle++){
  const initial=snapshot(),initialInfo={...renderer.info.memory},initialPrograms=renderer.info.programs.length;targets.clear();
  model=buildModel({frames:[],meshes:[{name:'lifecycle',frame:-1,vertices:[-.9,-.8,0,.8,-.7,0,.1,.9,0],indices:[0,1,2],uv:[0,0,1,0,.5,1],skin:[],groups:[[0,3,0]],materials:[{color:[.3,.2,.1,.7],material_preview:{kind:'emissive',status:'approximate',color:[1,.5,.2,1],strength:2}}]}]});model.root.scale.z=1;
  map=new T.DataTexture(new Uint8Array([255,128,32,255]),1,1);map.needsUpdate=true;setMaterialPreviewMap(model.materials[0],map);
  const scene=new T.Scene();scene.background=new T.Color(.03,.04,.05);scene.add(model.root);stage=new T.Mesh(new T.PlaneGeometry(2,2),new T.MeshBasicMaterial({color:new T.Color(.2,.2,.2)}));stage.position.z=-1;scene.add(stage);fx=createEmissionRenderer(renderer);
  const baseline=new Map();
  function suite(size,remember=false){
   const [w,h]=size;renderer.setSize(w,h);
   for(let i=0;i<cases.length;i++){
    const options=cases[i];setMaterialPreview(model.materials[0],options.emission!==false);inside=true;try{fx.render(scene,camera,model,options);}finally{inside=false;}renderCount++;
    const p=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);const key=w+':'+h+':'+i;
    if(remember)baseline.set(key,p);else check(p.every((v,j)=>v===baseline.get(key)[j]),'pixels changed after toggles/resize '+key);
    check(renderer.getRenderTarget()===null&&stage.visible&&scene.background!==null&&!model.materials[0].userData.avatarLighting.avatarEmissionPass.value,'transient renderer/scene state leaked');
    check(!model.materials[0].userData.dofDepth?.avatarDofDepthPass.value,'depth flag remained active');
   }
  }
  // Warm every lazy branch and small-screen fallback before comparing counts.
  for(const size of sizes)suite(size,true);suite(sizes[0]);const warm=snapshot(),warmInfo={...renderer.info.memory},programs=renderer.info.programs.length;
  check(targets.size===25,'not all lazy render targets exercised: '+targets.size);
  for(let round=0;round<8;round++){
   suite(sizes[round%sizes.length]);suite(sizes[0]);
   check(sameCounts(snapshot(),warm),'live WebGL objects grew after resize '+JSON.stringify({warm,actual:snapshot()}));check(renderer.info.memory.textures===warmInfo.textures&&renderer.info.memory.geometries===warmInfo.geometries&&renderer.info.programs.length===programs,'renderer counters grew after warm-up');
  }
  output=new T.WebGLRenderTarget(65,49);renderer.setRenderTarget(output);renderer.setClearColor(0x123456,.4);renderer.autoClear=false;const clear=renderer.getClearColor(new T.Color()).clone();inside=true;try{fx.render(scene,camera,model,{bloom:true,bloomMode:'source',colorGrading:grade,sharpen,dof});}finally{inside=false;}
  check(renderer.getRenderTarget()===output&&!renderer.autoClear&&renderer.getClearAlpha()===.4&&renderer.getClearColor(new T.Color()).equals(clear),'caller render state changed');renderer.setRenderTarget(null);output.dispose();output=null;renderer.autoClear=true;renderer.setClearColor(0,0);
  const before=new Map([...targets].map(([t,info])=>[t,info.disposals]));fx.dispose();for(const [t,info] of targets)check(info.disposals===before.get(t)+1,'owned target not disposed exactly once');const after=[...targets.values()].map(v=>v.disposals);fx.dispose();check([...targets.values()].every((v,i)=>v.disposals===after[i]),'repeated disposal re-released target');
  const closed=snapshot();let refused=false;try{fx.render(scene,camera,model,{bloom:false});}catch{refused=true;}check(refused&&sameCounts(snapshot(),closed),'disposed renderer accepted another frame or allocated resources');fx=null;
  scene.remove(model.root,stage);model.dispose();model=null;map.dispose();map=null;stage.geometry.dispose();stage.material.dispose();stage=null;
  check(sameCounts(snapshot(),initial),'disposed cycle leaked WebGL objects '+JSON.stringify({initial,actual:snapshot()}));check(renderer.info.memory.textures===initialInfo.textures&&renderer.info.memory.geometries===initialInfo.geometries&&renderer.info.programs.length===initialPrograms,'disposed cycle leaked renderer memory/programs');
 }
 // Standalone source helper follows the same lifecycle contract as DOF.
 source=createSourceBloom();source.resize(65,49);const owned=new Set([source.base,source.mask]);source.render((_m,t)=>owned.add(t));let events=0;for(const t of owned)t.addEventListener('dispose',()=>events++);source.dispose();check(events===12,'source targets not disposed');source.dispose();check(events===12,'source dispose not idempotent');
 for(const run of [()=>source.resize(65,49),()=>source.render(()=>{throw Error('draw called after disposal');})]){let refused=false;try{run();}catch(e){refused=e.message!=='draw called after disposal';}check(refused,'disposed source helper reused');}
 check(renderCount===693&&duplicates.length===0&&errors.length===0&&gl.getError()===gl.NO_ERROR,'lifecycle count/GL error '+JSON.stringify({renderCount,duplicates,errors}));document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{inside=false;renderer.setRenderTarget(null);output?.dispose();fx?.dispose();model?.dispose();map?.dispose();if(stage){stage.geometry.dispose();stage.material.dispose();}source?.dispose();renderer.setRenderTarget=setTarget;renderer.dispose();renderer.forceContextLoss();for(const [name,original] of originals)gl[name]=original;}
