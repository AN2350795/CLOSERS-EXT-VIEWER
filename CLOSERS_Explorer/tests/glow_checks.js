import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarGlow,setAvatarGlowMap,setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
import {setMaterialPreviewMap} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
function fixture(count=0){return {frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[0,1].map(k=>({name:'mesh'+k,source_id:k+1,frame:-1,vertices:[-1.7+k*2,-.7,0,-.3+k*2,-.7,0,-1+k*2,.7,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,1,0,0,1],groups:[[0,3,0]],materials:[{color:[.1,.08,.05,1],...(!k?{glow_preview:{kind:'surface-glow',status:'approximate',source_texture:'BASE.PNG',texture:'BASE_GLOW.PNG'}}:{})}],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}))};}
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(96,96);renderer.setClearColor(0);renderer.outputColorSpace=T.SRGBColorSpace;let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext(),capture=scene=>{renderer.render(scene,camera);const p=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},srgb=x=>Math.round(255*(x<=.0031308?x*12.92:1.055*Math.pow(x,1/2.4)-.055));
const map=new T.DataTexture(new Uint8Array([32,64,128,0]),1,1);map.needsUpdate=true;
const light={color:[.3,.3,.3,1],direction:[-30,10,-100],intensity:1.025};
try{
  for(const count of [0,4,5]){
    const data=fixture(count),model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0],index=(48*96+24)*4,base=capture(scene);
    setAvatarGlow(m,true,light);check(capture(scene).every((v,i)=>v===base[i]),'missing GLOW changed base');setAvatarGlowMap(m,map);const on=capture(scene);
    for(let c=0;c<3;c++)check(Math.abs(on[index+c]-srgb([.1,.08,.05][c]+[32,64,128][c]/255*light.intensity))<=1,'GLOW source intensity/RGB oracle');
    for(let i=0;i<on.length;i++)if(i%4===3||(i/4|0)%96>=48)check(on[i]===base[i],'GLOW affected alpha or unrelated surface');
    setAvatarGlow(m,true,{...light,color:[1,.2,.8,0]});check(capture(scene).every((v,i)=>v===on[i]),'GLOW must not multiply light color or alpha');
    const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{bloom:true});const bloom=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,bloom);check(bloom.every((v,i)=>v===on[i]),'surface GLOW became a bloom source');fx.render(scene,camera,model,{solo:true,bloom:true});const solo=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,solo);check(solo.every((v,i)=>i%4===3||v===0),'surface GLOW leaked into emission-only pass');fx.dispose();
    if(count){
      model.bones.forEach(b=>b.rotation.y=.4);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());const rigid=buildModel({...fixture(),meshes:data.meshes.map(v=>({...v,skin:[]}))}),reference=new T.Scene();rigid.root.scale.z=1;rigid.root.rotation.y=.4;reference.add(rigid.root);setAvatarGlowMap(rigid.materials[0],map);setAvatarGlow(rigid.materials[0],true,light);const actual=capture(scene),expected=capture(reference);check(actual.every((v,i)=>Math.abs(v-expected[i])<=2),'GLOW full skinning differs from rigid');rigid.dispose();model.bones.forEach(b=>b.rotation.y=0);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
    }
    setAvatarGlow(m,false,light);check(capture(scene).every((v,i)=>v===base[i]),'GLOW OFF did not restore pixels');setAvatarGlow(m,true,{...light,intensity:0});check(capture(scene).every((v,i)=>v===base[i]),'zero intensity left GLOW contribution');setAvatarGlow(m,true,null);check(capture(scene).every((v,i)=>v===base[i]),'missing light left stale GLOW');model.dispose();
  }
  {
    const data=fixture(),v=data.meshes[0].materials[0];v.toon_preview={kind:'toon',status:'approximate'};v.material_preview={kind:'emissive',status:'approximate',color:[1,.5,.25,1],strength:.2};const model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0],index=(48*96+24)*4;
    setAvatarToonMap(m,map);setAvatarToon(m,true,light,.5);setAvatarGlowMap(m,map);setAvatarGlow(m,true,light);setMaterialPreviewMap(m,map);const combined=capture(scene);
    for(let c=0;c<3;c++){const tex=[32,64,128][c]/255;check(Math.abs(combined[index+c]-srgb([.1,.08,.05][c]*tex*.5*.3*1.025+tex*1.025+tex*[1,.5,.25][c]*.2))<=1,'GLOW must be added after toon, separately from emission');}
    const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{solo:true,bloom:false});const solo=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,solo);for(let c=0;c<3;c++)check(Math.abs(solo[index+c]-srgb([32,64,128][c]/255*[1,.5,.25][c]*.2))<=1,'GLOW contaminated an existing emissive map');fx.dispose();model.dispose();
  }
  check(!shaderError,'GLOW shader compilation failed');
  const originalFetch=window.fetch;let missing=false,fail=false;
  window.fetch=async(url,options)=>{
    const path=String(url);
    if(path.startsWith('/api/model-browser'))return Response.json({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}});
    if(path.startsWith('/api/composition-source/'))return Response.json({width:4,height:4,image_sha256:'glow-fixture'});
    if(path.startsWith('/api/model-lighting')){if(fail)throw Error('glow light changed');return Response.json({profiles:[{...light,key:'source',label:'원본 조명'}]});}
    if(path.startsWith('/api/model-scene')){const data=fixture();data.meshes[0].materials[0].image={name:'BASE.PNG',candidates:[{id:71,archive:'fixture',ordinal:0}],selected:71};data.meshes[0].materials[0].glow_preview.image={name:'BASE_GLOW.PNG',candidates:missing?[]:[{id:71,archive:'fixture',ordinal:0}],selected:missing?null:71};return Response.json({...data,sources:[{name:'fixture.X',entry_id:1}],skeleton_source:{name:'fixture.X',entry_id:1},motion:{candidates:[]},animation:{candidates:[]},warnings:[]});}
    return originalFetch(url,options);
  };
  await import('/model.js');await modelViewer.loadModel([1]);const $=id=>document.getElementById(id),toggle=$('avatar-glow-enabled'),toon=$('avatar-toon-enabled'),select=$('avatar-lighting-profile'),u=()=>modelViewer.state.model.materials[0].userData.avatarLighting;
  check(!toon.disabled&&!toggle.checked&&toggle.disabled,'GLOW-only model must support an opt-in comparison');$('open-avatar-lighting').click();for(let i=0;i<100&&!select.querySelector('option[value="source"]');i++)await new Promise(r=>setTimeout(r,5));toon.click();select.value='source';select.dispatchEvent(new Event('change'));toggle.click();check(u().avatarGlowEnabled.value===1&&u().avatarLightEnabled.value===0,'GLOW comparison did not enable or was double shaded');
  const glow=modelViewer.state.textures.get('glow:71'),base=modelViewer.state.textures.get('base:71');check(glow!==base&&glow.wrapS===T.RepeatWrapping&&glow.wrapT===T.RepeatWrapping&&glow.colorSpace===T.SRGBColorSpace,'GLOW cache role or sampling invalid');check($('material-preview').disabled,'surface GLOW incorrectly enabled emission controls');
  await modelViewer.loadModel([1]);check(toggle.checked&&u().avatarGlowEnabled.value===1,'GLOW preference lost on model reload');toggle.click();check(u().avatarGlowEnabled.value===0,'GLOW toggle did not disable');toggle.click();
  document.querySelector('#avatar-lighting-dialog button').click();fail=true;$('open-avatar-lighting').click();for(let i=0;i<100&&!$('avatar-lighting-status').textContent.includes('glow light changed');i++)await new Promise(r=>setTimeout(r,5));check(u().avatarGlowEnabled.value===0,'failed light kept stale GLOW');document.querySelector('#avatar-lighting-dialog button').click();fail=false;$('open-avatar-lighting').click();for(let i=0;i<100&&u().avatarGlowEnabled.value===0;i++)await new Promise(r=>setTimeout(r,5));check(u().avatarGlowEnabled.value===1,'GLOW retry after light failure failed');document.querySelector('#avatar-lighting-dialog button').click();
  missing=true;await modelViewer.loadModel([1]);check(u().avatarGlowEnabled.value===0&&$('avatar-glow-status').textContent.includes('텍스처 확인 필요'),'missing map left stale GLOW');$('clear-model').click();check(toggle.disabled&&toon.disabled,'clear left GLOW controls enabled');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{map.dispose();renderer.dispose();renderer.forceContextLoss();}
