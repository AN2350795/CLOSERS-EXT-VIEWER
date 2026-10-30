import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarGlow,setAvatarGlowMap,setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
import {setMaterialPreview} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
  const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor(0x202630);let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const loader=new T.TextureLoader(),maps=new Map();window.testCaptures=[];
  for(const [id,file] of Object.entries(glowFixture.images)){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{const map=await loader.loadAsync(url);map.flipY=false;map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;maps.set(Number(id),map);}finally{URL.revokeObjectURL(url);}
  }
  const light={color:[.3,.3,.3,1],direction:[-30,10,-100],intensity:1.024999976158142};
  for(const test of glowFixture.scenes){
    const model=buildModel(test.data),scene=new T.Scene();scene.add(model.root);
    const owned=[];
    for(const m of model.materials){const input=m.userData.input;if(input.image?.selected){m.map=maps.get(input.image.selected);m.color.set(0xffffff);m.needsUpdate=true;}if(input.glow_preview){const map=maps.get(input.glow_preview.image.selected).clone();owned.push(map);map.colorSpace=T.NoColorSpace;map.needsUpdate=true;setAvatarGlowMap(m,map);}if(input.toon_preview){const map=maps.get(input.toon_preview.image.selected).clone();owned.push(map);map.wrapS=map.wrapT=T.ClampToEdgeWrapping;map.needsUpdate=true;setAvatarToonMap(m,map);}setMaterialPreview(m,false);}
    const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3()),camera=new T.PerspectiveCamera(40,1,.1,100000);camera.position.copy(center).add(new T.Vector3(0,0,size.length()*1.45));camera.lookAt(center);camera.updateMatrixWorld(true);
    const gl=renderer.getContext(),pixels=()=>{const p=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},capture=label=>{renderer.render(scene,camera);window.testCaptures.push({name:'glow-'+test.character+'-'+label,body:renderer.domElement.toDataURL('image/png')});return pixels();};
    const base=capture('off');model.materials.forEach(m=>setAvatarGlow(m,true,light));const on=capture('on');let changed=0;
    for(let i=0;i<on.length;i++){if(i%4===3)check(on[i]===base[i],'GLOW changed source alpha');else if(on[i]!==base[i])changed++;}check(changed>50,'source GLOW not visible: '+test.character+' '+changed);
    const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{bloom:true});check(pixels().every((v,i)=>v===on[i]),'source GLOW leaked into bloom');fx.render(scene,camera,model,{solo:true,bloom:true});check(pixels().every((v,i)=>i%4===3||v===0),'source GLOW leaked into emission-only');fx.dispose();
    model.materials.forEach(m=>setAvatarGlow(m,false,light));check(capture('restored').every((v,i)=>v===base[i]),'source GLOW OFF failed');
    model.materials.forEach(m=>setAvatarToon(m,true,light,1));const toon=capture('toon');model.materials.forEach(m=>setAvatarGlow(m,true,light));const combined=capture('toon-glow');check(combined.some((v,i)=>i%4!==3&&v!==toon[i]),'GLOW disappeared with source toon');model.dispose();owned.forEach(map=>map.dispose());
  }
  check(!shaderError,'source GLOW shader compilation failed');maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
