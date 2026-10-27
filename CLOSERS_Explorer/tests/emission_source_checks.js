import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMaterialPreview,setMaterialPreviewMap} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
  const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.setClearColor(0x202630);let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const fx=createEmissionRenderer(renderer),loader=new T.TextureLoader(),maps=new Map(),gl=renderer.getContext();window.testCaptures=[];
  for(const [id,file] of Object.entries(emissionFixture.images)){const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));try{const map=await loader.loadAsync(url);map.flipY=false;map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;maps.set(Number(id),map);}finally{URL.revokeObjectURL(url);}}
  for(const test of emissionFixture.scenes){
    const model=buildModel(test.data),scene=new T.Scene();scene.background=new T.Color(0x202630);scene.add(model.root);
    for(const m of model.materials){const input=m.userData.input;if(input.image?.selected){m.map=maps.get(input.image.selected);m.color.set(0xffffff);m.needsUpdate=true;}if(m.userData.materialPreview){check(input.material_preview.image?.selected,'real emission map is resolved');setMaterialPreviewMap(m,maps.get(input.material_preview.image.selected));}}
    const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3()),distance=size.length()*1.45,camera=new T.PerspectiveCamera(40,1,.1,100000);camera.position.copy(center).add(new T.Vector3(0,distance*.12,distance));camera.lookAt(center);camera.updateMatrixWorld(true);
    const capture=(mode,options)=>{fx.render(scene,camera,model,options);window.testCaptures.push({name:test.label+'-'+mode,body:renderer.domElement.toDataURL('image/png')});const p=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
    const plain=capture('surface',{bloom:false}),bloom=capture('bloom',{bloom:true,strength:1}),solo=capture('emission-only',{solo:true,bloom:false,exposure:4});
    const pixels=solo.reduce((n,v,i)=>n+(i%4!==3&&v>10?1:0),0);check(pixels>50,'real visible emission exists on '+test.label+': '+pixels);
    let halo=0;for(let i=0;i<plain.length;i+=4)if(bloom[i]+bloom[i+1]+bloom[i+2]>plain[i]+plain[i+1]+plain[i+2]+10)halo++;
    check(halo>20,'real emission creates a visible bloom change on '+test.label+': '+halo);
    model.materials.forEach(m=>setMaterialPreview(m,false));const off=capture('emission-off',{solo:true,bloom:true});check(off.every((v,i)=>i%4===3||v===0),'emission off removes all real glow on '+test.label);
    check(!shaderError,'native avatar emission shaders compile');model.dispose();
  }
  maps.forEach(m=>m.dispose());fx.dispose();renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
