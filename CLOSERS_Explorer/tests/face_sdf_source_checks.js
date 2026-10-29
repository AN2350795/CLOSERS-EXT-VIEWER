import * as T from '/vendor/three/three.module.min.js';
import {buildModel,applyPose,restorePose} from '/model-core.js';
import {setAvatarFaceSdf} from '/model-lighting.js';
const check=(value,message)=>{if(!value)throw Error(message);};
try{
  const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor(0x202630);let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const loader=new T.TextureLoader(),maps=new Map();window.testCaptures=[];
  for(const [id,file] of Object.entries(faceFixture.images)){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{const map=await loader.loadAsync(url);map.flipY=false;map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;maps.set(Number(id),map);}finally{URL.revokeObjectURL(url);}
  }
  const profile=(x,y,z)=>({color:[1,1,1,1],direction:[x,y,z],intensity:1});
  for(const test of faceFixture.scenes){
    const model=buildModel(test.data),scene=new T.Scene();scene.add(model.root);
    for(const material of model.materials){const input=material.userData.input;if(input.image?.selected){material.map=maps.get(input.image.selected);material.color.set(0xffffff);material.needsUpdate=true;}if(material.userData.faceSdfPreview)check(material.alphaTest===0&&!material.transparent&&material.opacity===1,'original face alpha became transparency');}
    const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3()),camera=new T.PerspectiveCamera(40,1,.1,100000);camera.position.copy(center).add(new T.Vector3(0,0,size.length()*1.45));camera.lookAt(center);camera.updateMatrixWorld(true);
    const gl=renderer.getContext(),capture=label=>{renderer.render(scene,camera);window.testCaptures.push({name:'sdf-'+test.character+'-'+label,body:renderer.domElement.toDataURL('image/png')});const p=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
    const base=capture('off');let prior=null;
    for(const [label,light] of [['front',profile(0,0,-1)],['left',profile(-1,0,0)],['right',profile(1,0,0)],['back',profile(0,0,1)]]){
      model.materials.forEach(m=>setAvatarFaceSdf(m,true,light));const on=capture(label);let changed=0;
      for(let i=0;i<on.length;i++){if(i%4===3)check(on[i]===base[i],'source SDF changed alpha on '+test.character);else if(on[i]!==base[i])changed++;}
      if(label==='left'||label==='right')check(changed>50,'source face alpha did not produce side shading: '+test.character+' '+label+' '+changed);
      if(label==='right')check(on.some((v,i)=>i%4!==3&&v!==prior[i]),'left/right SDF mirror has no effect on '+test.character);
      prior=on;
    }
    model.materials.forEach(m=>setAvatarFaceSdf(m,false,null));check(capture('restored').every((v,i)=>v===base[i]),'source face OFF did not restore original pixels');
    if(test.clip){
      model.materials.forEach(m=>setAvatarFaceSdf(m,true,profile(1,0,0)));applyPose(model,test.clip,test.clip.clip.duration*.35);capture('animated');
      const head=model.bones.find(b=>b.name==='BIP01_HEAD'),expected=new T.Vector3().setFromMatrixColumn(head.matrixWorld,2).normalize();
      check(model.materials.filter(m=>m.userData.faceSdfPreview).every(m=>m.userData.avatarLighting.avatarFaceForward.value.distanceTo(expected)<1e-6),'animated SDF head frame did not update');
      model.materials.forEach(m=>setAvatarFaceSdf(m,false,null));restorePose(model,test.data);check(capture('animation-restored').every((v,i)=>v===base[i]),'face motion reset did not restore bind pose');
    }
    model.dispose();
  }
  check(!shaderError,'source face SDF shader compilation failed');maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
