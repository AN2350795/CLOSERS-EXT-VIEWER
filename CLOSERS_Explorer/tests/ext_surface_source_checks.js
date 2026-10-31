import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarToon,setAvatarToonMap,setAvatarExtMap,setAvatarExtSurface} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
 const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.setClearColor(0x202630);renderer.outputColorSpace=T.SRGBColorSpace;
 const maps=new Map(),loader=new T.TextureLoader();window.testCaptures=[];
 for(const [id,file] of Object.entries(extSurfaceFixture.images)){
  const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
  try{maps.set(Number(id),await loader.loadAsync(url));}finally{URL.revokeObjectURL(url);}
 }
 for(const [index,test] of extSurfaceFixture.scenes.entries()){
  const model=buildModel(test.data),scene=new T.Scene(),owned=[];scene.add(model.root);
  for(const m of model.materials)for(const [role,info] of [['base',m.userData.input.image],['toon',m.userData.input.toon_preview?.image],['ext',m.userData.input.ext_preview?.image]]){
   if(!info)continue;const map=maps.get(info.selected).clone();owned.push(map);map.flipY=false;map.colorSpace=role==='base'?T.SRGBColorSpace:T.NoColorSpace;map.wrapS=map.wrapT=role==='toon'?T.ClampToEdgeWrapping:T.RepeatWrapping;map.needsUpdate=true;
   if(role==='base'){m.map=map;m.color.set(0xffffff);m.needsUpdate=true;}else if(role==='toon')setAvatarToonMap(m,map);else setAvatarExtMap(m,map);
  }
  const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),distance=box.getSize(new T.Vector3()).length()*1.45,camera=new T.PerspectiveCamera(40,1,.1,100000);
  const light={direction:[1,2,-3],color:[1,1,1,1],intensity:1};model.materials.forEach(m=>setAvatarToon(m,true,light));let changed=0;
  const capture=(label,factor)=>{model.materials.forEach(m=>setAvatarExtSurface(m,factor!==null,factor));renderer.render(scene,camera);window.testCaptures.push({name:'ext-b-'+index+'-'+label,body:renderer.domElement.toDataURL('image/png')});const p=new Uint8Array(512*512*4),gl=renderer.getContext();gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
  for(const [view,yaw] of [0,Math.PI/2,Math.PI,Math.PI*1.5].entries()){
   camera.position.copy(center).add(new T.Vector3(Math.sin(yaw)*distance,0,Math.cos(yaw)*distance));camera.lookAt(center);camera.updateMatrixWorld(true);
   const before=capture(view+'-off',null),on=capture(view+'-probe1',1),zero=capture(view+'-zero',0);
   check(zero.every((v,i)=>v===before[i]),'source B zero did not restore pixels '+test.name);
   for(let i=0;i<before.length;i++){if(i%4===3)check(on[i]===before[i],'source B changed alpha');else {check(on[i]>=before[i],'B surface subtraction '+test.name);if(on[i]!==before[i])changed++;}}
  }
  check(test.maximum?changed>0:changed===0,'source B signal mismatch '+test.name+'/'+changed);
  model.dispose();owned.forEach(m=>m.dispose());
 }
 maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
