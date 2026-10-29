import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarRim,setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
  const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.setClearColor(0x202630);renderer.outputColorSpace=T.SRGBColorSpace;let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const loader=new T.TextureLoader(),maps=new Map();window.testCaptures=[];
  for(const [id,file] of Object.entries(extFixture.images)){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{maps.set(Number(id),await loader.loadAsync(url));}finally{URL.revokeObjectURL(url);}
  }
  check(extFixture.profiles.every(p=>p.global_rim?.power===0),'audited regional rim values changed; re-audit source');
  for(const test of extFixture.scenes){
    const model=buildModel(test.data),scene=new T.Scene(),owned=[];scene.add(model.root);
    for(const m of model.materials){const input=m.userData.input;
      for(const [role,info] of [['base',input.image],['toon',input.toon_preview?.image]]){if(!info)continue;const map=maps.get(info.selected).clone();owned.push(map);map.flipY=false;map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=role==='toon'?T.ClampToEdgeWrapping:T.RepeatWrapping;map.needsUpdate=true;if(role==='base'){m.map=map;m.color.set(0xffffff);m.needsUpdate=true;}else setAvatarToonMap(m,map);}
    }
    const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),distance=box.getSize(new T.Vector3()).length()*1.45,camera=new T.PerspectiveCamera(40,1,.1,100000),gl=renderer.getContext();
    const pixels=()=>{const p=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},capture=label=>{renderer.render(scene,camera);window.testCaptures.push({name:'rim-'+test.character+'-'+label,body:renderer.domElement.toDataURL('image/png')});return pixels();};
    let changed=0;
    for(const [angle,yaw] of [['front',0],['side',.7],['back',Math.PI]])for(const [i,light] of extFixture.profiles.entries()){
      camera.position.copy(center).add(new T.Vector3(Math.sin(yaw)*distance,0,Math.cos(yaw)*distance));camera.lookAt(center);camera.updateMatrixWorld(true);
      model.materials.forEach(m=>{setAvatarToon(m,true,light);setAvatarRim(m,false,light);});const off=capture(angle+'-'+i+'-off');model.materials.forEach(m=>setAvatarRim(m,true,light));const original=capture(angle+'-'+i+'-original-zero');check(original.every((v,k)=>v===off[k]),'original zero rim created a fake effect');
      // This is a controlled shader probe, not an original game light value.
      const probe={...light,global_rim:{...light.global_rim,power:1}};model.materials.forEach(m=>setAvatarRim(m,true,probe));const on=capture(angle+'-'+i+'-probe-power1');
      for(let k=0;k<on.length;k++){if(k%4===3)check(on[k]===off[k],'controlled rim changed source alpha');else if(on[k]!==off[k])changed++;}
      const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{bloom:true});check(pixels().every((v,k)=>v===on[k]),'rim became bloom source');fx.render(scene,camera,model,{solo:true,bloom:true});check(pixels().every((v,k)=>k%4===3||v===0),'rim leaked into emission-only');fx.dispose();
      model.materials.forEach(m=>setAvatarRim(m,false,probe));check(capture(angle+'-'+i+'-restored').every((v,k)=>v===off[k]),'source geometry rim OFF restoration failed');
    }
    check(changed>50,'controlled rim probe not visible on '+test.character+': '+changed);model.dispose();owned.forEach(m=>m.dispose());
  }
  check(!shaderError,'source-geometry rim shader failed');maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
