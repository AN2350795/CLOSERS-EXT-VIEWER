import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {composeAvatarLight,interpolateAvatarLight,setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
 const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor(0x202630);
 let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;const maps=new Map(),loader=new T.TextureLoader();window.testCaptures=[];const results=[];
 for(const [id,file] of Object.entries(extFixture.images)){const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));try{maps.set(Number(id),await loader.loadAsync(url));}finally{URL.revokeObjectURL(url);}}
 check(extFixture.skinProfiles.length===2,'original skin light inputs unavailable');
 for(const test of extFixture.scenes){
  const model=buildModel(test.data),scene=new T.Scene(),owned=[];scene.add(model.root);
  for(const material of model.materials)for(const [role,info] of [['base',material.userData.input.image],['toon',material.userData.input.toon_preview?.image]]){
   if(!info)continue;const map=maps.get(info.selected).clone();owned.push(map);map.flipY=false;map.colorSpace=role==='toon'?T.NoColorSpace:T.SRGBColorSpace;map.wrapS=map.wrapT=role==='toon'?T.ClampToEdgeWrapping:T.RepeatWrapping;map.needsUpdate=true;
   if(role==='base'){material.map=map;material.color.set(0xffffff);material.needsUpdate=true;}else setAvatarToonMap(material,map);
  }
  const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),distance=box.getSize(new T.Vector3()).length()*1.45,camera=new T.PerspectiveCamera(40,1,.1,100000);camera.position.copy(center).add(new T.Vector3(0,0,distance));camera.lookAt(center);camera.updateMatrixWorld(true);
  const gl=renderer.getContext(),capture=(name,profile)=>{model.materials.forEach(m=>setAvatarToon(m,true,profile));renderer.render(scene,camera);window.testCaptures.push({name:'composition-'+test.character+'-'+name,body:renderer.domElement.toDataURL('image/png')});const a=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
  for(const [i,base] of extFixture.profiles.entries())for(const skin of extFixture.skinProfiles){
   const snapshot=JSON.stringify([base,skin]),prefix=i+'-'+skin.group_id,original=capture(prefix+'-region',base),merged=composeAvatarLight(base,skin,'maximum');
   check(merged&&merged.intensity===Math.max(base.intensity,skin.intensity)&&merged.near_intensity===skin.near_intensity,'source merge values');
   check(merged.direction===base.direction&&merged.position===base.position&&merged.global_specular===base.global_specular,'source base fields lost');
   const composed=capture(prefix+'-maximum',merged),direct=capture(prefix+'-direct',composeAvatarLight(base,skin,'replace')),near=capture(prefix+'-near',interpolateAvatarLight(merged,1));let changes=0;
   for(let k=0;k<composed.length;k++){if(k%4===3)check(original[k]===composed[k]&&composed[k]===near[k],'original source alpha changed');else if(original[k]!==composed[k])changes++;}
   check(changes>50,'original composition did not affect source model');
   if(base.intensity<=skin.intensity)check(composed.every((v,k)=>v===direct[k]),'weaker regional intensity should produce identical merge paths');
   check(capture(prefix+'-restored',composeAvatarLight(base,null)).every((v,k)=>v===original[k]),'source region restoration not exact');
   check(JSON.stringify([base,skin])===snapshot,'original light sources mutated');results.push({character:test.character,base:base.key,skin:skin.key,far:merged.intensity,near:merged.near_intensity,changed_channels:changes});
  }
  model.dispose();owned.forEach(m=>m.dispose());
 }
 check(!shaderError,'original composition shader error');window.compositionVerification=results;maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
