import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMatcapPreview,setMatcapPreviewMap,setMatcapNormalMap,setSpecularPreview,setMatcapMaskPreview,setSpecularLight} from '/model-materials.js';
import {setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
import {applyAvatarColorSpace} from '/model-emission.js';
const check=(value,message)=>{if(!value)throw Error(message);};
try{
  const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.setClearColor(0x202630);renderer.outputColorSpace=T.SRGBColorSpace;
  let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const loader=new T.TextureLoader(),maps=new Map();window.testCaptures=[];
  for(const [id,file] of Object.entries(matcapFixture.images)){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{const map=await loader.loadAsync(url);map.flipY=false;map.colorSpace=T.SRGBColorSpace;maps.set(Number(id),map);}finally{URL.revokeObjectURL(url);}
  }
  const model=buildModel(matcapFixture.data),scene=new T.Scene(),owned=[];scene.add(model.root);
  for(const material of model.materials){
    const input=material.userData.input;
    if(input.image?.selected){material.map=maps.get(input.image.selected);material.map.wrapS=material.map.wrapT=T.RepeatWrapping;material.color.set(0xffffff);material.needsUpdate=true;}
    if(material.userData.matcapPreview){
      const source=maps.get(input.matcap_preview.image.selected);check(source,'original MatCap map resolved');const map=source.clone();owned.push(map);map.colorSpace=T.NoColorSpace;map.wrapS=map.wrapT=T.ClampToEdgeWrapping;map.needsUpdate=true;setMatcapPreviewMap(material,map);
      if(input.matcap_preview.normal_image?.selected){const source=maps.get(input.matcap_preview.normal_image.selected);check(source,'original normal map resolved');const bump=source.clone();owned.push(bump);bump.colorSpace=T.NoColorSpace;bump.wrapS=bump.wrapT=T.RepeatWrapping;bump.needsUpdate=true;setMatcapNormalMap(material,bump);}
    }
    if(matcapFixture.toonProfiles?.length&&material.userData.toonPreview){const source=maps.get(input.toon_preview.image.selected);check(source,'original toon map resolved');const map=source.clone();owned.push(map);map.colorSpace=T.NoColorSpace;map.wrapS=map.wrapT=T.ClampToEdgeWrapping;map.needsUpdate=true;setAvatarToonMap(material,map);}
  }
  const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);
  const center=box.getCenter(new T.Vector3()),distance=box.getSize(new T.Vector3()).length()*1.45;
  const camera=new T.PerspectiveCamera(40,1,.1,100000),gl=renderer.getContext();
  const capture=(label)=>{renderer.render(scene,camera);window.testCaptures.push({name:'matcap-'+matcapFixture.label+'-'+label,body:renderer.domElement.toDataURL('image/png')});const result=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,result);return result;};
  for(const [label,yaw] of [['front',0],['side',.7],['back',Math.PI]]){
    camera.position.copy(center).add(new T.Vector3(Math.sin(yaw)*distance,distance*.12,Math.cos(yaw)*distance));camera.lookAt(center);camera.updateMatrixWorld(true);
    model.materials.forEach(m=>setMatcapPreview(m,false));const off=capture(label+'-off');
    model.materials.forEach(m=>setMatcapPreview(m,true));const on=capture(label+'-on');
    let changed=0;for(let i=0;i<on.length;i++){if(i%4===3)check(on[i]===off[i],'real MatCap changed alpha');else if(on[i]!==off[i])changed++;}
    check(changed>100,'visible MatCap contribution missing: '+label+' '+changed);
    model.materials.forEach(m=>setMatcapMaskPreview(m,true));const mask=capture(label+'-mask-inspection');let maskChanged=0;
    for(let i=0;i<mask.length;i++){if(i%4===3)check(mask[i]===on[i],'real mask inspection changed alpha');else if(mask[i]!==on[i])maskChanged++;}
    check(maskChanged>100,'real mask inspection did not affect costume');model.materials.forEach(m=>setMatcapMaskPreview(m,false));check(capture(label+'-mask-restored').every((v,i)=>v===on[i]),'real mask OFF failed to restore costume');
    model.materials.forEach(m=>setMatcapPreview(m,true,1,false));const unmasked=capture(label+'-unmasked');
    check(unmasked.some((v,i)=>i%4!==3&&v!==on[i]),'real normal/alpha did not affect preview');
    if(matcapFixture.specular){
      model.materials.forEach(m=>{setMatcapPreview(m,true);setSpecularPreview(m,true);});const reflection=capture(label+'-reflection-on');let reflected=0;
      for(let i=0;i<reflection.length;i++){if(i%4===3)check(reflection[i]===on[i],'real reflection changed alpha');else if(reflection[i]!==on[i])reflected++;}
      check(reflected>20,'source reflection did not produce a visible highlight: '+label+' '+reflected);
      for(const [index,profile] of (matcapFixture.regionalProfiles||[]).entries()){
        model.materials.forEach(m=>{setSpecularLight(m,'region',profile.position);setSpecularPreview(m,true);});const regional=capture(label+'-regional-'+index);let changed=0;
        for(let i=0;i<regional.length;i++){if(i%4===3)check(regional[i]===on[i],'regional source reflection changed alpha');else if(regional[i]!==on[i])changed++;}
        check(changed>20,'original region position did not produce reflection: '+label+'/'+index+'/'+changed);
        model.materials.forEach(m=>setSpecularLight(m,'camera'));check(capture(label+'-camera-restored-'+index).every((v,i)=>v===reflection[i]),'regional to camera did not restore source pixels');
      }
      model.materials.forEach(m=>setSpecularPreview(m,false));check(capture(label+'-reflection-off').every((v,i)=>v===on[i]),'reflection OFF did not restore real MatCap pixels');
    }
    if(matcapFixture.toonProfiles?.length){
      model.materials.forEach(m=>{setMatcapPreview(m,true);setAvatarToon(m,true,matcapFixture.toonProfiles[0]);});const toon=capture(label+'-toon-neutral');let shaded=0;
      for(let i=0;i<toon.length;i++){if(i%4===3)check(toon[i]===on[i],'real toon changed alpha');else if(toon[i]!==on[i])shaded++;}
      check(shaded>100,'real toon texture did not change surface pixels');
      model.materials.forEach(m=>setAvatarToon(m,true,matcapFixture.toonProfiles[1]));const netherworld=capture(label+'-toon-netherworld');check(netherworld.some((v,i)=>i%4!==3&&v<toon[i]),'original netherworld profile did not change toon light color');
      model.materials.forEach(m=>setAvatarToon(m,false,null));check(capture(label+'-toon-restored').every((v,i)=>v===on[i]),'toon OFF does not restore real surface');
    }
    if(matcapFixture.colorDomain){
      const roles=new Map();let id=0;for(const m of model.materials){if(m.map)roles.set('base:'+id++,m.map);const p=m.userData.matcapPreview,u=m.userData.avatarLighting;if(p?.uniforms.avatarMatcapMap.value)roles.set('matcap:'+id++,p.uniforms.avatarMatcapMap.value);if(p?.uniforms.avatarMatcapNormalMap.value)roles.set('matcap-normal:'+id++,p.uniforms.avatarMatcapNormalMap.value);if(u?.avatarToonMap.value)roles.set('toon:'+id++,u.avatarToonMap.value);}
      model.materials.forEach(m=>{setMatcapPreview(m,true);setAvatarToon(m,true,matcapFixture.toonProfiles[0]);});applyAvatarColorSpace(renderer,roles,false);const viewer=capture(label+'-domain-viewer');applyAvatarColorSpace(renderer,roles,true);const raw=capture(label+'-domain-raw');let changed=0;
      for(let i=0;i<raw.length;i++){if(i%4===3)check(raw[i]===viewer[i],'source domain changed alpha');else{const p=i-i%4,visible=[32,38,48].some((v,c)=>Math.abs(viewer[p+c]-v)>1);if(visible&&raw[i]!==viewer[i])changed++;}}check(changed>100,'source domain did not change real costume pixels');applyAvatarColorSpace(renderer,roles,false);check(capture(label+'-domain-restored').every((v,i)=>v===viewer[i]),'source domain OFF failed real costume restoration');model.materials.forEach(m=>setAvatarToon(m,false,null));
    }
    model.materials.forEach(m=>setMatcapPreview(m,true,0));check(capture(label+'-zero').every((v,i)=>v===off[i]),'zero strength does not restore real costume');
    model.materials.forEach(m=>setMatcapPreview(m,false));check(capture(label+'-restored').every((v,i)=>v===off[i]),'OFF does not restore real costume');
  }
  check(!shaderError,'real MatCap shader compilation failed');
  model.dispose();owned.forEach(m=>m.dispose());maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
