import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMaterialPreview,setMaterialPreviewMap,setMatcapPreview,setMatcapPreviewMap,setMatcapNormalMap,setSpecularPreview} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
import {setAvatarLight} from '/model-lighting.js';
const check=(value,message)=>{if(!value)throw Error(message);};
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
renderer.setSize(96,96);renderer.setClearColor(0x000000);renderer.outputColorSpace=T.SRGBColorSpace;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const gl=renderer.getContext(),errors=[];renderer.debug.onShaderError=()=>errors.push('shader compilation failed');
const pixels=scene=>{renderer.render(scene,camera);const result=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,result);return result;};
const sphere=new T.DataTexture(new Uint8Array([100,100,100,255,200,80,50,255,80,80,80,255,240,100,60,255]),2,2);
sphere.needsUpdate=true;sphere.colorSpace=T.SRGBColorSpace;sphere.flipY=false;
const identity=new T.Matrix4().toArray();
function fixture(count){
  return {frames:Array.from({length:count},(_,i)=>({name:'bone'+i,parent:-1,matrix:identity})),meshes:[0,1].map(k=>({
    name:'mesh'+k,frame:-1,vertices:[-1.7+k*2,-.7,0,-.3+k*2,-.7,0,-1+k*2,.7,0],indices:[0,1,2],uv:[0,0,1,0,0,1],normals:[0,0,1,0,0,1,0,0,1],groups:[[0,3,0]],
    materials:[{color:[.2,.1,.05,1],...(k?{}:{material_preview:{kind:'emissive',status:'approximate',color:[1,.5,.25,1],strength:.9}})}],
    skin:Array.from({length:count},(_,i)=>({bone:'bone'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]})),
  }))};
}
try{
  // Numerical shader oracle: emission is independent of the diffuse color.
  const constant=new T.DataTexture(new Uint8Array([128,64,32,255]),1,1);constant.needsUpdate=true;
  const linearToSrgb=x=>x<=.0031308?x*12.92:1.055*Math.pow(x,1/2.4)-.055;
  for(const base of [.02,.2]){
    const data=fixture(0);data.meshes[0].materials[0].color=[base,base,base,1];
    const model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);
    setMaterialPreviewMap(model.materials[0],constant);const actual=pixels(scene),index=(48*96+24)*4;
    for(let c=0;c<3;c++){
      const expected=Math.round(255*linearToSrgb(base+[128,64,32][c]/255*[1,.5,.25][c]*.9));
      check(Math.abs(actual[index+c]-expected)<=1,'emission equation or color channel changed: '+c);
    }
    model.dispose();
  }
  constant.dispose();
  // Source values audited from LIGHT_CONVERT_DATA.NTF. These verify the
  // viewer's comparison formula, not the game's toon lighting appearance.
  {
    const model=buildModel(fixture(0)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);
    const material=model.materials[0],index=(48*96+24)*4,original=pixels(scene);
    setAvatarLight(material,{color:[1,1,1,1],direction:[-30,10,-100],intensity:1});
    check(pixels(scene).every((v,i)=>v===original[i]),'unit white source lighting must leave diffuse unchanged');
    setAvatarLight(material,{color:[.3,.3,.3,1],direction:[-30,10,-100],intensity:1.024999976158142});
    const actual=pixels(scene),directional=100/Math.hypot(30,10,100);
    const factor=1+(.3*1.024999976158142-1)*directional*.5;
    for(let c=0;c<3;c++){
      const expected=Math.round(255*linearToSrgb([.2,.1,.05][c]*factor));
      check(Math.abs(actual[index+c]-expected)<=1,'netherworld comparison must darken diffuse by the source formula: '+c);
      check(actual[index+c]<original[index+c],'netherworld comparison unexpectedly brightened diffuse');
    }
    setAvatarLight(material,null);
    check(pixels(scene).every((v,i)=>v===original[i]),'netherworld comparison off must restore exact pixels');
    model.dispose();
  }
  const lightMap=new T.DataTexture(new Uint8Array([128,64,32,255]),1,1);lightMap.needsUpdate=true;
  for(const count of [0,4,5]){
    const model=buildModel(fixture(count)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);setMaterialPreviewMap(model.materials[0],lightMap);
    const original=pixels(scene),profile={color:[.7,.8,1,1],direction:[0,0,-1],intensity:.8};setAvatarLight(model.materials[0],profile);
    for(const angle of count?[0,.4]:[0]){
      model.bones.forEach(b=>b.rotation.y=angle);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());const actual=pixels(scene),index=(48*96+24)*4;
      for(let c=0;c<3;c++){const value=[.2,.1,.05][c]*(1+(profile.color[c]*.8-1)*Math.cos(angle)*.5)+[128,64,32][c]/255*[1,.5,.25][c]*.9;check(Math.abs(actual[index+c]-Math.round(255*linearToSrgb(value)))<=2,'lighting comparison preserves independent emission and skinned normals: '+count+'/'+c);}
    }
    model.bones.forEach(b=>b.rotation.y=0);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());setAvatarLight(model.materials[0],null);const restored=pixels(scene);check(restored.every((v,i)=>v===original[i]),'lighting off restores exact pixels');model.dispose();
  }
  lightMap.dispose();
  // Reflection oracle uses a camera-position inspection light (L=V), the
  // source RGB/exponent and normal alpha, independent of diffuse and emission.
  for(const count of [0,4,5]){
    const data=fixture(count),source=data.meshes[0].materials[0];
    source.matcap_preview={kind:'matcap',status:'approximate',texture:'CAP.PNG',specular:{status:'approximate',color:[1,.5,.25,0],power:300}};
    const model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);
    const material=model.materials[0],u=material.userData.matcapPreview.uniforms,index=(48*96+24)*4;
    const cap=new T.DataTexture(new Uint8Array([0,0,0,255]),1,1),bump=new T.DataTexture(new Uint8Array([128,128,255,128]),1,1);cap.needsUpdate=bump.needsUpdate=true;
    setMatcapPreviewMap(material,cap);setMatcapPreview(material,true);const original=pixels(scene);
    setSpecularPreview(material,true);check(u.avatarSpecularEnabled.value===0,'reflection must wait for the normal mask');
    setMatcapNormalMap(material,bump);const actual=pixels(scene);
    const normal=new T.Vector3(1/255,1/255,1).normalize();
    const half=new T.Vector3(-((24.5/96)*4-2),-((48.5/96)*4-2),10).normalize();
    const term=Math.pow(Math.max(0,normal.dot(half)),300)*128/255;
    for(let c=0;c<3;c++)check(Math.abs(actual[index+c]-Math.round(255*linearToSrgb([.2,.1,.05][c]+[1,.5,.25][c]*term)))<=2,'reflection color/exponent/mask oracle: '+count+'/'+c);
    for(let i=0;i<actual.length;i++)if(i%4===3||(i/4|0)%96>=48)check(actual[i]===original[i],'reflection changed alpha or an unrelated surface');
    u.avatarSpecularPower.value=800;const narrow=pixels(scene);check(narrow[index]<actual[index],'higher source exponent must narrow the highlight');u.avatarSpecularPower.value=300;
    bump.image.data[3]=0;bump.needsUpdate=true;check(pixels(scene).every((v,i)=>v===original[i]),'zero normal alpha failed to suppress reflection');
    bump.image.data.set([0,0,0,255]);bump.needsUpdate=true;check(pixels(scene).every((v,i)=>v===original[i]),'zero normal RGB failed to suppress reflection');bump.image.data.set([128,128,255,128]);bump.needsUpdate=true;
    setMatcapPreview(material,true,1,false);check(u.avatarSpecularEnabled.value===0&&pixels(scene).every((v,i)=>v===original[i]),'reflection cannot use an unmasked vertex-normal fallback');setMatcapPreview(material,true);
    const emission=createEmissionRenderer(renderer);emission.render(scene,camera,model,{solo:true,bloom:true});const mask=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,mask);check(mask.every((v,i)=>i%4===3||v===0),'reflection leaked into emission/bloom');emission.dispose();
    if(count){
      model.bones.forEach(b=>b.rotation.y=.2);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
      const rigid=buildModel({...fixture(0),meshes:data.meshes.map(m=>({...m,skin:[]}))}),reference=new T.Scene();rigid.root.scale.z=1;rigid.root.rotation.y=.2;reference.add(rigid.root);
      setMatcapPreviewMap(rigid.materials[0],cap);setMatcapNormalMap(rigid.materials[0],bump);setMatcapPreview(rigid.materials[0],true);setSpecularPreview(rigid.materials[0],true);
      const posed=pixels(scene),expected=pixels(reference);check(posed.filter((v,i)=>Math.abs(v-expected[i])>2).length<12,'reflection skinned normal/view position mismatch: '+count);rigid.dispose();
      model.bones.forEach(b=>b.rotation.y=0);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
    }
    setSpecularPreview(material,false);check(pixels(scene).every((v,i)=>v===original[i]),'reflection OFF did not restore exact base');
    setSpecularPreview(material,true);setMatcapPreview(material,false);check(u.avatarSpecularEnabled.value===0&&pixels(scene).every((v,i)=>v===original[i]),'master gloss toggle left reflection active');
    setMatcapPreview(material,true,0);check(pixels(scene).every((v,i)=>v===original[i]),'zero strength left reflection visible');
    model.dispose();cap.dispose();bump.dispose();
  }
  // Vertex-normal MatCap: explicit binding, isolated surface, unchanged alpha,
  // numerical additive color, full skinning, and no emission-mask leakage.
  for(const count of [0,4,5]){
    const data=fixture(count);data.meshes[0].materials[0].matcap_preview={kind:'matcap',status:'approximate',texture:'CAP.PNG'};
    const model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);
    const material=model.materials[0],original=pixels(scene),index=(48*96+24)*4;
    setMatcapPreview(material,true);
    check(pixels(scene).every((v,i)=>v===original[i]),'missing MatCap changed base');
    const cap=new T.DataTexture(new Uint8Array([32,64,128,255]),1,1);cap.needsUpdate=true;
    setMatcapPreviewMap(material,cap);check(pixels(scene).every((v,i)=>v===original[i]),'missing BUMP mask must defer gloss instead of coating the whole surface');
    setMatcapPreview(material,true,1,false);const actual=pixels(scene);
    for(let c=0;c<3;c++)check(Math.abs(actual[index+c]-Math.round(255*linearToSrgb([.2,.1,.05][c]+[32,64,128][c]/255)))<=1,'MatCap numerical contribution: '+count+'/'+c);
    for(let i=0;i<actual.length;i++)if(i%4===3||(i/4|0)%96>=48)check(actual[i]===original[i],'MatCap changed alpha or unrelated surface');
    setMaterialPreviewMap(material,cap);const both=pixels(scene);
    for(let c=0;c<3;c++)check(Math.abs(both[index+c]-Math.round(255*linearToSrgb([.2,.1,.05][c]+[32,64,128][c]/255*(1+[1,.5,.25][c]*.9))))<=1,'MatCap and emission did not compose');
    setMaterialPreview(material,false);
    const bump=new T.DataTexture(new Uint8Array([128,128,255,0]),1,1);bump.needsUpdate=true;
    setMatcapPreview(material,true);
    setMatcapNormalMap(material,bump);check(pixels(scene).every((v,i)=>v===original[i]),'zero normal alpha must suppress MatCap without hiding diffuse');
    bump.image.data[3]=128;bump.needsUpdate=true;const masked=pixels(scene);
    for(let c=0;c<3;c++)check(Math.abs(masked[index+c]-Math.round(255*linearToSrgb([.2,.1,.05][c]+[32,64,128][c]/255*128/255)))<=1,'normal alpha mask equation: '+count+'/'+c);
    setMatcapNormalMap(material,null);check(pixels(scene).every((v,i)=>v===original[i]),'lost BUMP mask left full-surface gloss active');setMatcapNormalMap(material,bump);check(pixels(scene).every((v,i)=>v===masked[i]),'recovered BUMP mask did not restore gloss');
    setMatcapPreview(material,true,1,false);check(pixels(scene).every((v,i)=>v===actual[i]),'normal mask comparison did not restore unmasked preview');
    setMatcapPreview(material,true);bump.image.data.set([0,0,0,255]);bump.needsUpdate=true;
    check(pixels(scene).every((v,i)=>v===original[i]),'zero normal RGB must suppress the normal branch');
    bump.image.data.set([200,128,230,128]);bump.needsUpdate=true;
    const emission=createEmissionRenderer(renderer);emission.render(scene,camera,model,{solo:true,bloom:false});
    const mask=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,mask);
    check(mask.every((v,i)=>i%4===3||v===0),'MatCap leaked into emission-only render');emission.dispose();
    setMatcapPreview(material,true,0);check(pixels(scene).every((v,i)=>v===original[i]),'zero MatCap strength did not restore base');
    setMatcapPreview(material,true);setMatcapPreviewMap(material,sphere);
    if(count){
      model.bones.forEach(b=>b.rotation.y=.4);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
      const rigid=buildModel({...fixture(0),meshes:data.meshes.map(m=>({...m,skin:[]}))}),reference=new T.Scene();rigid.root.scale.z=1;rigid.root.rotation.y=.4;reference.add(rigid.root);setMatcapPreviewMap(rigid.materials[0],sphere);setMatcapNormalMap(rigid.materials[0],bump);setMatcapPreview(rigid.materials[0],true);
      const posed=pixels(scene),expected=pixels(reference);check(posed.filter((v,i)=>Math.abs(v-expected[i])>2).length<12,'MatCap skinned normal mismatch: '+count);rigid.dispose();
    }
    model.bones.forEach(b=>b.rotation.y=0);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
    setMatcapPreview(material,false);check(pixels(scene).every((v,i)=>v===original[i]),'MatCap OFF failed to restore base');
    setMatcapPreviewMap(model.materials[1],cap);check(!model.materials[1].userData.matcapPreview,'unbound surface acquired MatCap');
    model.dispose();cap.dispose();bump.dispose();
  }
  const unverified=fixture(0);unverified.meshes[0].materials[0].material_preview={kind:'skin-sphere',status:'unsupported'};
  const unsupported=buildModel(unverified);setMaterialPreviewMap(unsupported.materials[0],sphere);
  check(!unsupported.materials[0].userData.materialPreview,'unverified skin equation was installed');unsupported.dispose();
  for(const count of [0,4,5]){
    const data=fixture(count),model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;model.root.updateMatrixWorld(true);scene.add(model.root);
    const before=pixels(scene);setMaterialPreviewMap(model.materials[0],sphere);const after=pixels(scene);
    let changed=0;for(let i=0;i<before.length;i++){
      const x=(i/4|0)%96;if(x>=48)check(before[i]===after[i],'preview affected unrelated material');
      else if(before[i]!==after[i])changed++;
      if(i%4===3)check(before[i]===after[i],'preview changed alpha');
    }
    check(changed>100,'empty highlight: '+count);
    setMaterialPreview(model.materials[0],false);const restored=pixels(scene);
    check(restored.every((v,i)=>v===before[i]),'toggle did not restore base pixels: '+count);
    setMaterialPreview(model.materials[0],true);
    if(count){
      model.bones.forEach(b=>b.rotation.y=.4);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
      const reference=buildModel(fixture(0)),expectedScene=new T.Scene();reference.root.scale.z=1;reference.root.rotation.y=.4;reference.root.updateMatrixWorld(true);expectedScene.add(reference.root);setMaterialPreviewMap(reference.materials[0],sphere);
      const posed=pixels(scene),expected=pixels(expectedScene);
      check(posed.filter((v,i)=>Math.abs(v-expected[i])>2).length<12,'animated normals differ from rigid reference: '+count);
      reference.dispose();
    }
    const saved=model.materials[0].userData.materialPreview.uniforms.avatarEmissiveMap.value;
    setMaterialPreviewMap(model.materials[1],sphere);check(!model.materials[1].userData.materialPreview,'unrelated material acquired preview');
    check(saved===sphere,'map reference lost');model.dispose();
  }
  check(!errors.length,errors.join('\n'));
  const shared=fixture(0);shared.meshes[1].materials[0].material_preview={kind:'emissive',status:'approximate',color:[1,.5,.25,1],strength:.9};
  const pair=buildModel(shared);setMaterialPreviewMap(pair.materials[0],sphere);
  check(pair.materials[1].userData.materialPreview.uniforms.avatarMaterialEnabled.value===0,'two items share mutable uniforms');pair.dispose();

  // Exercise the real loader, role-specific cache, checkbox and missing maps.
  const originalFetch=window.fetch;let missing=false,missingNormal=false,paired=false,failLighting=false,glossy=false;
  window.fetch=async (url,options)=>{
    const path=String(url);
    if(path.startsWith('/api/model-browser'))return new Response(JSON.stringify({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}}));
    if(path.startsWith('/api/composition-source/'))return new Response(JSON.stringify({width:4,height:4,image_sha256:'fixture'}));
    if(path.startsWith('/api/model-lighting')){if(failLighting)throw Error('조명 원본 변경');return Response.json({profiles:[{key:'light-test',label:'시험 조명',color:[1,.5,.25,1],direction:[0,0,-1],intensity:1,characters:[],sources:['LIGHT_CONVERT_DATA.NTF']}]});}
    if(path.startsWith('/api/model-scene')){
      const data=fixture(0);data.meshes[0].materials[0].image={name:'BASE.PNG',candidates:[{id:71,archive:'fixture',ordinal:0}],selected:71};
      data.meshes[0].materials[0].material_preview.image={name:'MAT_209_SKIN.PNG',candidates:missing?[]:[{id:71,archive:'fixture',ordinal:0}],selected:missing?null:71};
      if(paired){data.meshes.forEach((m,i)=>m.source_id=i+1);data.meshes[1].materials[0].material_preview=JSON.parse(JSON.stringify(data.meshes[0].materials[0].material_preview));}
      if(glossy){for(const m of data.meshes)m.materials[0].matcap_preview={kind:'matcap',status:'approximate',texture:'CAP.PNG',image:{name:'CAP.PNG',candidates:missing?[]:[{id:71,archive:'fixture',ordinal:0}],selected:missing?null:71},normal_texture:'BASE_BUMP.PNG',normal_image:{name:'BASE_BUMP.PNG',candidates:missing?[]:[{id:71,archive:'fixture',ordinal:0}],selected:missing?null:71}};}
      if(glossy)data.meshes[0].materials[0].matcap_preview.specular={status:'approximate',color:[1,.5,.25,1],power:300};
      if(glossy&&missingNormal)for(const m of data.meshes){m.materials[0].matcap_preview.normal_image.candidates=[];m.materials[0].matcap_preview.normal_image.selected=null;}
      return new Response(JSON.stringify({...data,sources:[{name:'fixture.X',entry_id:1}],skeleton_source:{name:'fixture.X',entry_id:1},motion:{candidates:[]},animation:{name:'none',candidates:[]},warnings:[]}));
    }
    return originalFetch(url,options);
  };
  await import('/model.js');await modelViewer.loadModel([1]);
  const checkbox=document.getElementById('material-preview'),note=document.getElementById('material-preview-note');
  check(!checkbox.disabled&&checkbox.checked&&!note.hidden,'preview control not available');
  check(modelViewer.state.textures.size===2,'base and sphere texture roles share mutable wrapping');
  const [base,aux]=[modelViewer.state.textures.get('base:71'),modelViewer.state.textures.get('auxiliary:71')];
  check(base!==aux&&base.wrapS===T.RepeatWrapping&&aux.wrapS===T.RepeatWrapping,'role wrapping invalid');
  check(document.querySelectorAll('#model-textures [data-texture-role]').length===2,'texture roles missing');
  document.getElementById('open-avatar-lighting').click();for(let i=0;i<100&&!document.querySelector('#avatar-lighting-profile option[value="light-test"]');i++)await new Promise(r=>setTimeout(r,5));
  const lightChoice=document.getElementById('avatar-lighting-profile'),lightToggle=document.getElementById('avatar-lighting-enabled');lightChoice.value='light-test';lightChoice.dispatchEvent(new Event('change'));
  check(!lightToggle.checked&&modelViewer.state.model.materials.every(m=>m.userData.avatarLighting.avatarLightEnabled.value===0),'light selection silently enabled legacy color comparison');lightToggle.click();
  check(modelViewer.state.model.materials.every(m=>m.userData.avatarLighting.avatarLightEnabled.value===1),'selected light applies to avatar materials');lightToggle.click();check(modelViewer.state.model.materials.every(m=>m.userData.avatarLighting.avatarLightEnabled.value===0),'light toggle disables only scene lighting');
  lightToggle.click();await modelViewer.loadModel([1]);check(modelViewer.state.model.materials.every(m=>m.userData.avatarLighting.avatarLightEnabled.value===1),'selected lighting survives avatar reload');
  document.querySelector('#avatar-lighting-dialog button').click();
  failLighting=true;document.getElementById('open-avatar-lighting').click();for(let i=0;i<100&&!document.getElementById('avatar-lighting-status').textContent.includes('조명 원본 변경');i++)await new Promise(r=>setTimeout(r,5));
  check(modelViewer.state.model.materials.every(m=>m.userData.avatarLighting.avatarLightEnabled.value===0),'changed/missing source cannot leave a stale light active');document.querySelector('#avatar-lighting-dialog button').click();failLighting=false;
  document.getElementById('open-avatar-lighting').click();for(let i=0;i<100&&lightChoice.disabled;i++)await new Promise(r=>setTimeout(r,5));check(modelViewer.state.model.materials.every(m=>m.userData.avatarLighting.avatarLightEnabled.value===1),'lighting can retry after source failure');lightToggle.click();document.querySelector('#avatar-lighting-dialog button').click();
  checkbox.click();check(modelViewer.state.model.materials[0].userData.materialPreview.uniforms.avatarMaterialEnabled.value===0,'checkbox did not disable');
  await modelViewer.loadModel([1]);check(!checkbox.checked&&modelViewer.state.model.materials[0].userData.materialPreview.uniforms.avatarMaterialEnabled.value===0,'reload lost toggle preference');
  paired=true;checkbox.click();await modelViewer.loadModel([1]);const individual=document.querySelectorAll('#avatar-emission-items input');check(individual.length===2,'emission sources are listed by avatar/material');individual[0].click();
  check(modelViewer.state.model.materials[0].userData.materialPreview.uniforms.avatarMaterialEnabled.value===0&&modelViewer.state.model.materials[1].userData.materialPreview.uniforms.avatarMaterialEnabled.value===1,'individual emission toggle does not affect another avatar material');
  checkbox.click();checkbox.click();check(modelViewer.state.model.materials[0].userData.materialPreview.uniforms.avatarMaterialEnabled.value===0,'global emission toggle preserves individual exclusions');
  glossy=true;await modelViewer.loadModel([1]);
  const capToggle=document.getElementById('avatar-matcap-enabled'),capSlider=document.getElementById('avatar-matcap-strength');
  check(!capToggle.disabled&&!capToggle.checked,'MatCap must be opt-in');
  check(modelViewer.state.textures.size===4,'MatCap/normal texture roles not isolated from base/emission');
  const capMap=modelViewer.state.textures.get('matcap:71');check(capMap!==modelViewer.state.textures.get('base:71')&&capMap.wrapS===T.ClampToEdgeWrapping&&capMap.wrapT===T.ClampToEdgeWrapping,'MatCap clamp/cache invalid');
  capToggle.click();check(modelViewer.state.model.materials.every(m=>m.userData.matcapPreview.uniforms.avatarMatcapEnabled.value===1),'MatCap toggle did not enable loaded maps');
  const normalToggle=document.getElementById('avatar-matcap-normal'),normalMap=modelViewer.state.textures.get('matcap-normal:71');
  check(normalMap!==capMap&&normalMap!==modelViewer.state.textures.get('base:71')&&normalMap.colorSpace===T.NoColorSpace&&normalMap.wrapS===T.RepeatWrapping,'normal texture role changed data color/wrapping');
  check(!normalToggle.disabled&&normalToggle.checked&&modelViewer.state.model.materials.every(m=>m.userData.matcapPreview.uniforms.avatarMatcapNormalEnabled.value===1),'normal source was not enabled');
  const specularToggle=document.getElementById('avatar-matcap-specular');check(!specularToggle.disabled&&!specularToggle.checked,'reflection comparison must be opt-in');
  specularToggle.click();check(modelViewer.state.model.materials[0].userData.matcapPreview.uniforms.avatarSpecularEnabled.value===1&&modelViewer.state.model.materials[1].userData.matcapPreview.uniforms.avatarSpecularEnabled.value===0,'reflection must require source parameters on each surface');
  normalToggle.click();check(modelViewer.state.model.materials.every(m=>m.userData.matcapPreview.uniforms.avatarMatcapNormalEnabled.value===0),'normal comparison did not disable source');
  check(specularToggle.disabled&&modelViewer.state.model.materials.every(m=>m.userData.matcapPreview.uniforms.avatarSpecularEnabled.value===0),'reflection must stop when normal comparison is disabled');
  capSlider.value='.35';capSlider.dispatchEvent(new Event('input'));check(modelViewer.state.model.materials.every(m=>m.userData.matcapPreview.uniforms.avatarMatcapStrength.value===.35),'MatCap strength not applied');
  document.querySelector('#avatar-matcap-items input').click();
  check(modelViewer.state.model.materials[0].userData.matcapPreview.uniforms.avatarMatcapEnabled.value===0&&modelViewer.state.model.materials[1].userData.matcapPreview.uniforms.avatarMatcapEnabled.value===1,'MatCap individual exclusion lost isolation');
  capToggle.click();capToggle.click();await modelViewer.loadModel([1]);
  check(!normalToggle.checked&&modelViewer.state.model.materials.every(m=>m.userData.matcapPreview.uniforms.avatarMatcapNormalEnabled.value===0),'reload lost normal comparison preference');normalToggle.click();
  check(specularToggle.checked&&modelViewer.state.model.materials.every(m=>m.userData.matcapPreview.uniforms.avatarSpecularEnabled.value===0),'reflection preference or individual surface exclusion lost on reload');
  document.querySelector('#avatar-matcap-items input').click();check(modelViewer.state.model.materials[0].userData.matcapPreview.uniforms.avatarSpecularEnabled.value===1,'excluded reflection cannot be restored');document.querySelector('#avatar-matcap-items input').click();
  check(modelViewer.state.model.materials[0].userData.matcapPreview.uniforms.avatarMatcapEnabled.value===0&&modelViewer.state.model.materials[1].userData.matcapPreview.uniforms.avatarMatcapEnabled.value===1,'MatCap reload lost individual preferences');
  missingNormal=true;await modelViewer.loadModel([1]);
  check(modelViewer.state.model.materials.every(m=>m.userData.matcapPreview.uniforms.avatarMatcapMap.value&&m.userData.matcapPreview.uniforms.avatarMatcapEnabled.value===0),'missing only BUMP must defer loaded MatCap');
  check(document.getElementById('avatar-matcap-status').textContent.includes('현재 표시 0개')&&document.getElementById('avatar-matcap-status').textContent.includes('마스크 확인 필요'),'missing mask status/count incorrect');
  check(!normalToggle.disabled&&normalToggle.checked,'user cannot choose explicit unmasked comparison');normalToggle.click();
  check(modelViewer.state.model.materials[1].userData.matcapPreview.uniforms.avatarMatcapEnabled.value===1&&document.getElementById('avatar-matcap-items').textContent.includes('마스크 없는 비교'),'explicit unmasked comparison/notice missing');normalToggle.click();
  missingNormal=false;await modelViewer.loadModel([1]);check(modelViewer.state.model.materials[1].userData.matcapPreview.uniforms.avatarMatcapEnabled.value===1,'mask recovery did not restore saved gloss');
  missing=true;await modelViewer.loadModel([1]);
  check(modelViewer.state.model.materials.every(m=>m.userData.matcapPreview.uniforms.avatarMatcapEnabled.value===0),'missing MatCap left a stale map enabled');
  check(specularToggle.disabled&&modelViewer.state.model.materials.every(m=>m.userData.matcapPreview.uniforms.avatarSpecularEnabled.value===0),'missing textures left a stale reflection enabled');
  check(modelViewer.state.model.materials[0].map&&document.getElementById('model-status').textContent.includes('텍스처 확인 필요'),'missing auxiliary lost base or notice');
  document.getElementById('clear-model').click();check(checkbox.disabled&&note.hidden&&capToggle.disabled&&capSlider.disabled&&specularToggle.disabled&&modelViewer.state.textures.size===0,'clear left preview enabled');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
finally{sphere.dispose();renderer.dispose();renderer.forceContextLoss();}
