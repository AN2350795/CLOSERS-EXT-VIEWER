import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
 const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.setClearColor(0x202630);renderer.outputColorSpace=T.LinearSRGBColorSpace;
 const loader=new T.TextureLoader(),maps=new Map(),fx=createEmissionRenderer(renderer);window.testCaptures=[];
 for(const [id,file] of Object.entries(extFixture.images)){
  const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
  try{maps.set(Number(id),await loader.loadAsync(url));}finally{URL.revokeObjectURL(url);}
 }
 for(const test of extFixture.scenes){
  const model=buildModel(test.data),scene=new T.Scene(),owned=[];scene.add(model.root);
  for(const m of model.materials)for(const [role,info] of [['base',m.userData.input.image],['toon',m.userData.input.toon_preview?.image]]){
   if(!info)continue;const map=maps.get(info.selected).clone();owned.push(map);map.flipY=false;map.colorSpace=T.NoColorSpace;map.wrapS=map.wrapT=role==='toon'?T.ClampToEdgeWrapping:T.RepeatWrapping;map.needsUpdate=true;
   if(role==='base'){m.map=map;m.color.set(0xffffff);m.needsUpdate=true;}else setAvatarToonMap(m,map);
  }
  const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),camera=new T.PerspectiveCamera(40,1,.1,100000);
  camera.position.copy(center).add(new T.Vector3(0,0,box.getSize(new T.Vector3()).length()*1.45));camera.lookAt(center);camera.updateMatrixWorld(true);model.materials.forEach(m=>setAvatarToon(m,true,extFixture.profiles[0]));
  const capture=(name,sharpen)=>{fx.render(scene,camera,model,{bloom:false,sharpen});window.testCaptures.push({name:'sharpen-'+test.character+'-'+name,body:renderer.domElement.toDataURL('image/png')});const p=new Uint8Array(512*512*4),gl=renderer.getContext();gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
  const before=capture('off',null);
  for(const radius of [1.55,5]){const on=capture('probe'+radius,{enabled:true,radius});let changed=0;for(let i=0;i<on.length;i++){if(i%4===3)check(on[i]===before[i],'source sharpen alpha changed');else if(on[i]!==before[i])changed++;}check(changed>50,'sharpen did not affect original '+test.character+'/'+radius);}
  check(capture('zero',{enabled:true,radius:0}).every((v,i)=>v===before[i]),'source radius zero did not restore pixels');
  check(capture('restored',{enabled:false,radius:1.55}).every((v,i)=>v===before[i]),'source OFF did not restore pixels');
  model.dispose();owned.forEach(m=>m.dispose());
 }
 maps.forEach(m=>m.dispose());fx.dispose();renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
