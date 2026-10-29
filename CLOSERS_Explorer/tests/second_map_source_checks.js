import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarSecond,setAvatarSecondMap,setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
  const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.setClearColor(0x202630);renderer.outputColorSpace=T.SRGBColorSpace;
  const maps=new Map(),loader=new T.TextureLoader();window.testCaptures=[];
  for(const [id,file] of Object.entries(extFixture.images)){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{maps.set(Number(id),await loader.loadAsync(url));}finally{URL.revokeObjectURL(url);}
  }
  for(const test of extFixture.scenes){
    const model=buildModel(test.data),scene=new T.Scene(),owned=[];scene.add(model.root);
    for(const m of model.materials)for(const [role,info] of [['base',m.userData.input.image],['toon',m.userData.input.toon_preview?.image],['second',m.userData.input.second_preview?.image]]){
      if(!info)continue;const map=maps.get(info.selected).clone();owned.push(map);map.flipY=false;map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=role==='toon'?T.ClampToEdgeWrapping:T.RepeatWrapping;map.needsUpdate=true;
      if(role==='base'){m.map=map;m.color.set(0xffffff);m.needsUpdate=true;}else if(role==='toon')setAvatarToonMap(m,map);else setAvatarSecondMap(m,map);
    }
    const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),distance=box.getSize(new T.Vector3()).length()*1.45,camera=new T.PerspectiveCamera(40,1,.1,100000);
    camera.position.copy(center).add(new T.Vector3(0,0,distance));camera.lookAt(center);camera.updateMatrixWorld(true);const gl=renderer.getContext(),pixels=()=>{const a=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
    const capture=name=>{renderer.render(scene,camera);window.testCaptures.push({name:'second-'+test.character+'-'+name,body:renderer.domElement.toDataURL('image/png')});return pixels();};
    model.materials.forEach(m=>setAvatarToon(m,true,extFixture.profiles[0]));const off=capture('off');let changes=0,shifted=0;
    model.materials.forEach(m=>setAvatarSecond(m,true));const on=capture('on-zero-uv');model.materials.forEach(m=>setAvatarSecond(m,true,[.25,.1]));const shift=capture('on-shifted-uv');
    for(let k=0;k<off.length;k++){if(k%4===3){check(off[k]===on[k]&&off[k]===shift[k],'source SecondMap changed alpha');continue;}if(off[k]!==on[k])changes++;if(on[k]!==shift[k])shifted++;}
    check(changes>50&&shifted>50,'source SecondMap/UV did not affect '+test.character+': '+changes+'/'+shifted);
    const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{bloom:true});check(pixels().every((v,k)=>v===shift[k]),'source SecondMap entered bloom');fx.render(scene,camera,model,{solo:true,bloom:true});check(pixels().every((v,k)=>k%4===3||v===0),'source SecondMap entered emission-only');fx.dispose();
    model.materials.forEach(m=>setAvatarSecond(m,false));check(capture('restored').every((v,k)=>v===off[k]),'source SecondMap OFF restoration');model.dispose();owned.forEach(m=>m.dispose());
  }
  maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
