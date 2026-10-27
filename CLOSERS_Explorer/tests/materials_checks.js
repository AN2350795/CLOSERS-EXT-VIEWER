import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMaterialPreview,setMaterialPreviewMap} from '/model-materials.js';
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
  const lightMap=new T.DataTexture(new Uint8Array([128,64,32,255]),1,1);lightMap.needsUpdate=true;
  for(const count of [0,4,5]){
    const model=buildModel(fixture(count)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);setMaterialPreviewMap(model.materials[0],lightMap);
    const original=pixels(scene),profile={color:[.7,.8,1,1],direction:[0,0,-1],intensity:.8};setAvatarLight(model.materials[0],profile);
    for(const angle of count?[0,.4]:[0]){
      model.bones.forEach(b=>b.rotation.y=angle);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());const actual=pixels(scene),index=(48*96+24)*4;
      for(let c=0;c<3;c++){const value=[.2,.1,.05][c]*profile.color[c]*.8*Math.cos(angle)+[128,64,32][c]/255*[1,.5,.25][c]*.9;check(Math.abs(actual[index+c]-Math.round(255*linearToSrgb(value)))<=2,'directional lighting preserves independent emission and skinned normals: '+count+'/'+c);}
    }
    model.bones.forEach(b=>b.rotation.y=0);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());setAvatarLight(model.materials[0],null);const restored=pixels(scene);check(restored.every((v,i)=>v===original[i]),'lighting off restores exact pixels');model.dispose();
  }
  lightMap.dispose();
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
  const originalFetch=window.fetch;let missing=false,paired=false,failLighting=false;
  window.fetch=async (url,options)=>{
    const path=String(url);
    if(path.startsWith('/api/model-browser'))return new Response(JSON.stringify({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}}));
    if(path.startsWith('/api/composition-source/'))return new Response(JSON.stringify({width:4,height:4,image_sha256:'fixture'}));
    if(path.startsWith('/api/model-lighting')){if(failLighting)throw Error('조명 원본 변경');return Response.json({profiles:[{key:'light-test',label:'시험 조명',color:[1,.5,.25,1],direction:[0,0,-1],intensity:1,characters:[],sources:['LIGHT_CONVERT_DATA.NTF']}]});}
    if(path.startsWith('/api/model-scene')){
      const data=fixture(0);data.meshes[0].materials[0].image={name:'BASE.PNG',candidates:[{id:71,archive:'fixture',ordinal:0}],selected:71};
      data.meshes[0].materials[0].material_preview.image={name:'MAT_209_SKIN.PNG',candidates:missing?[]:[{id:71,archive:'fixture',ordinal:0}],selected:missing?null:71};
      if(paired){data.meshes.forEach((m,i)=>m.source_id=i+1);data.meshes[1].materials[0].material_preview=JSON.parse(JSON.stringify(data.meshes[0].materials[0].material_preview));}
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
  missing=true;await modelViewer.loadModel([1]);
  check(modelViewer.state.model.materials[0].map&&document.getElementById('model-status').textContent.includes('텍스처 확인 필요'),'missing auxiliary lost base or notice');
  document.getElementById('clear-model').click();check(checkbox.disabled&&note.hidden&&modelViewer.state.textures.size===0,'clear left preview enabled');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
finally{sphere.dispose();renderer.dispose();renderer.forceContextLoss();}
