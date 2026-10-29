import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {interpolateAvatarLight,setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
  const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.setClearColor(0x202630);renderer.outputColorSpace=T.SRGBColorSpace;
  const loader=new T.TextureLoader(),maps=new Map();window.testCaptures=[];const results=[];
  for(const [id,file] of Object.entries(extFixture.images)){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{maps.set(Number(id),await loader.loadAsync(url));}finally{URL.revokeObjectURL(url);}
  }
  for(const test of extFixture.scenes){
    const model=buildModel(test.data),scene=new T.Scene(),owned=[];scene.add(model.root);
    for(const m of model.materials)for(const [role,info] of [['base',m.userData.input.image],['toon',m.userData.input.toon_preview?.image]]){
      if(!info)continue;const map=maps.get(info.selected).clone();owned.push(map);map.flipY=false;map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=role==='toon'?T.ClampToEdgeWrapping:T.RepeatWrapping;map.needsUpdate=true;
      if(role==='base'){m.map=map;m.color.set(0xffffff);m.needsUpdate=true;}else setAvatarToonMap(m,map);
    }
    const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),distance=box.getSize(new T.Vector3()).length()*1.45,camera=new T.PerspectiveCamera(40,1,.1,100000);
    camera.position.copy(center).add(new T.Vector3(0,0,distance));camera.lookAt(center);camera.updateMatrixWorld(true);
    const gl=renderer.getContext(),capture=(name,p)=>{model.materials.forEach(m=>setAvatarToon(m,true,p));renderer.render(scene,camera);window.testCaptures.push({name:'near-'+test.character+'-'+name,body:renderer.domElement.toDataURL('image/png')});const a=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
    for(const [i,profile] of extFixture.profiles.entries()){
      check(Number.isFinite(profile.near_intensity),'original regional near intensity missing');const source=JSON.stringify(profile),far=capture(i+'-far',profile),mid=capture(i+'-mid',interpolateAvatarLight(profile,.5)),near=capture(i+'-near',interpolateAvatarLight(profile,1));let changes=0;
      for(let k=0;k<far.length;k++){if(k%4===3){check(far[k]===near[k]&&far[k]===mid[k],'source near changed alpha');continue;}
        if(far[k]!==near[k])changes++;check(mid[k]>=Math.min(far[k],near[k])-1&&mid[k]<=Math.max(far[k],near[k])+1,'source interpolation exceeded endpoints');}
      check(changes>50,'source near intensity did not affect '+test.character+'/'+i);check(capture(i+'-restored',interpolateAvatarLight(profile,0)).every((v,k)=>v===far[k]),'source far endpoint restoration');check(JSON.stringify(profile)===source,'original source modified');results.push({character:test.character,profile:profile.key,far:profile.intensity,near:profile.near_intensity,changed_channels:changes});
    }
    model.dispose();owned.forEach(m=>m.dispose());
  }
  window.nearVerification=results;maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
