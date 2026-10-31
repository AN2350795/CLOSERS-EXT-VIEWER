import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {rotateAvatarToonLight,setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
 const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.setClearColor(0x202630);renderer.outputColorSpace=T.SRGBColorSpace;
 const loader=new T.TextureLoader(),maps=new Map();window.testCaptures=[];
 for(const [id,file] of Object.entries(extFixture.images)){
  const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
  try{maps.set(Number(id),await loader.loadAsync(url));}finally{URL.revokeObjectURL(url);}
 }
 for(const test of extFixture.scenes){
  const model=buildModel(test.data),scene=new T.Scene(),owned=[];scene.add(model.root);
  for(const m of model.materials)for(const [role,info] of [['base',m.userData.input.image],['toon',m.userData.input.toon_preview?.image]]){
   if(!info)continue;const map=maps.get(info.selected).clone();owned.push(map);map.flipY=false;map.colorSpace=role==='toon'?T.NoColorSpace:T.SRGBColorSpace;map.wrapS=map.wrapT=role==='toon'?T.ClampToEdgeWrapping:T.RepeatWrapping;map.needsUpdate=true;
   if(role==='base'){m.map=map;m.color.set(0xffffff);m.needsUpdate=true;}else setAvatarToonMap(m,map);
  }
  const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),camera=new T.PerspectiveCamera(40,1,.1,100000);
  camera.position.copy(center).add(new T.Vector3(0,0,box.getSize(new T.Vector3()).length()*1.45));camera.lookAt(center);camera.updateMatrixWorld(true);
  const capture=(name,p)=>{model.materials.forEach(m=>setAvatarToon(m,true,p));renderer.render(scene,camera);window.testCaptures.push({name:'rotation-'+test.character+'-'+name,body:renderer.domElement.toDataURL('image/png')});const pixels=new Uint8Array(512*512*4),gl=renderer.getContext();gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
  for(const [i,p] of extFixture.profiles.entries()){
   const snapshot=JSON.stringify(p),original=capture(i+'-zero',p),turned=capture(i+'-probe',rotateAvatarToonLight(p,{enabled:true,angles:[23,-41,67]}));let changes=0;
   for(let k=0;k<original.length;k++)if(k%4===3)check(original[k]===turned[k],'rotation changed source alpha');else if(original[k]!==turned[k])changes++;
   check(changes>50,'rotation did not affect original toon '+test.character+'/'+i);
   check(capture(i+'-restored',rotateAvatarToonLight(p,{enabled:false,angles:[23,-41,67]})).every((v,k)=>v===original[k]),'source rotation OFF did not restore pixels');check(snapshot===JSON.stringify(p),'source profile mutated');
  }
  model.dispose();owned.forEach(m=>m.dispose());
 }
 maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
