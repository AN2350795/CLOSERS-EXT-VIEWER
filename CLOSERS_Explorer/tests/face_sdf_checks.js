import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarFaceSdf} from '/model-lighting.js';
import {setMaterialPreviewMap} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
function fixture(count=0){return {frames:Array.from({length:Math.max(1,count)},(_,i)=>({name:i?'bone'+i:'BIP01_HEAD',parent:-1,matrix:identity})),meshes:[0,1].map(k=>({name:k?'EYE_MC':'TEST_FACE_SDF_MC',source_id:1,frame:-1,vertices:[-1.7+k*2,-.7,0,-.3+k*2,-.7,0,-1+k*2,.7,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,1,0,0,1],groups:[[0,3,0]],materials:[{color:[1,1,1,1],texture:k?'BASIC_FACE_EYE.TGA':'BASIC_FACE.TGA',...(!k?{face_sdf_preview:{kind:'face-sdf',status:'approximate',head_bone:'BIP01_HEAD',texture:'BASIC_FACE.TGA'}}:{})}],skin:Array.from({length:count},(_,i)=>({bone:i?'bone'+i:'BIP01_HEAD',offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}))};}
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(96,96);renderer.setClearColor(0);renderer.outputColorSpace=T.SRGBColorSpace;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext();let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
const capture=scene=>{renderer.render(scene,camera);const p=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},srgb=x=>Math.round(255*(x<=.0031308?x*12.92:1.055*Math.pow(x,1/2.4)-.055));
const map=new T.DataTexture(new Uint8Array([128,128,128,0,128,128,128,255]),2,1);map.needsUpdate=true;map.wrapS=map.wrapT=T.ClampToEdgeWrapping;
const profile=(x,y,z)=>({color:[1,1,1,1],direction:[x,y,-z],intensity:1});
try{
  for(const count of [0,4,5]){
    const model=buildModel(fixture(count)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0],index=(48*96+24)*4;
    m.map=map;m.needsUpdate=true;const base=capture(scene);
    check(m.userData.faceShadingAlpha&&m.opacity===1&&!m.transparent&&m.alphaTest===0,'SDF alpha must remain shading data, not a cutout');
    for(const [light,lit] of [[profile(0,1,0),0],[profile(0,-1,0),1],[profile(0,0,1),1],[profile(0,0,-1),0]]){
      setAvatarFaceSdf(m,true,light);const on=capture(scene);
      for(let c=0;c<3;c++){const factor=lit?1:[1,.878,.784][c];check(Math.abs(on[index+c]-srgb(128/255*factor))<=1,'face mirror/angle/shadow oracle: '+count+'/'+c);}
      for(let i=0;i<on.length;i++)if(i%4===3||(i/4|0)%96>=48)check(on[i]===base[i],'face SDF changed opacity or eye surface');
    }
    const transition={...profile(1,0,0),color:[.8,.7,.6,1],intensity:1.025};setAvatarFaceSdf(m,true,transition);const blended=capture(scene);
    const t=Math.max(0,Math.min(1,(.5-(1.570729*.318310-.01))/.02)),lit=t*t*(3-2*t);
    for(let c=0;c<3;c++)check(Math.abs(blended[index+c]-srgb(128/255*([1,.878,.784][c]+(1-[1,.878,.784][c])*lit)*transition.color[c]*transition.intensity))<=1,'face angular transition/color/intensity oracle');
    setAvatarFaceSdf(m,true,profile(0,0,1),0);const zero=capture(scene);check([0,1,2].every(c=>zero[index+c]===0)&&zero[index+3]===255,'zero face power changed opacity or left RGB');
    if(count){
      const light=profile(.6,.2,1);setAvatarFaceSdf(m,true,light);model.bones.forEach(b=>b.rotation.y=.4);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
      const rigid=buildModel(fixture()),reference=new T.Scene();rigid.root.scale.z=1;rigid.root.rotation.y=.4;reference.add(rigid.root);rigid.materials[0].map=map;rigid.materials[0].needsUpdate=true;setAvatarFaceSdf(rigid.materials[0],true,light);
      const actual=capture(scene),expected=capture(reference);check(actual.every((v,i)=>Math.abs(v-expected[i])<=2),'head/face SDF skinning differs from rigid transform: '+count);rigid.dispose();
      model.bones.forEach(b=>b.rotation.y=0);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
    }
    setAvatarFaceSdf(m,false,null);check(capture(scene).every((v,i)=>v===base[i]),'face SDF OFF did not restore exact pixels');
    // Rotate only the bound head in a rigid fixture: shading must follow it.
    if(!count){setAvatarFaceSdf(m,true,profile(0,1,0));model.bones[0].rotation.z=Math.PI;model.root.updateMatrixWorld(true);check(Math.abs(capture(scene)[index+2]-base[index+2])<=1,'face SDF did not follow head rotation');model.bones[0].rotation.z=0;model.bones[0].scale.y=0;model.root.updateMatrixWorld(true);check(capture(scene).every((v,i)=>v===base[i]),'degenerate head frame must fall back to base');model.bones[0].scale.y=1;model.root.updateMatrixWorld(true);}
    setAvatarFaceSdf(m,true,profile(0,1,0));const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{solo:true,bloom:true});const solo=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,solo);check(solo.every((v,i)=>i%4===3||v===0),'SDF face leaked into emission-only render');fx.dispose();
    setAvatarFaceSdf(m,true,null);check(capture(scene).every((v,i)=>v===base[i]),'missing light kept stale face shading');model.dispose();
  }
  {
    const data=fixture();data.meshes[0].materials[0].material_preview={kind:'emissive',status:'approximate',color:[1,.5,.25,1],strength:.2};const model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0],index=(48*96+24)*4;m.map=map;m.needsUpdate=true;setMaterialPreviewMap(m,map);setAvatarFaceSdf(m,true,profile(0,1,0));const on=capture(scene);
    for(let c=0;c<3;c++)check(Math.abs(on[index+c]-srgb(128/255*([1,.878,.784][c]+[1,.5,.25][c]*.2)))<=1,'face shading must precede independent emission');model.dispose();
  }
  for(const headNames of [['MISSING'],['BIP01_HEAD','BIP01_HEAD']]){
    const data=fixture();data.frames=headNames.map(name=>({name,parent:-1,matrix:identity}));const model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0];m.map=map;m.needsUpdate=true;const base=capture(scene);setAvatarFaceSdf(m,true,profile(0,1,0));check(capture(scene).every((v,i)=>v===base[i]),'missing/ambiguous head guessed a shading frame');model.dispose();
  }
  check(!shaderError,'face SDF shader compilation failed');
  const originalFetch=window.fetch;let missing=false,fail=false;
  window.fetch=async(url,options)=>{
    const path=String(url);
    if(path.startsWith('/api/model-browser'))return Response.json({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}});
    if(path.startsWith('/api/composition-source/'))return Response.json({width:4,height:4,image_sha256:'sdf-fixture'});
    if(path.startsWith('/api/model-lighting')){if(fail)throw Error('face source changed');return Response.json({profiles:[{...profile(0,1,0),key:'source',label:'얼굴 시험 조명'}]});}
    if(path.startsWith('/api/model-scene')){const data=fixture();data.meshes[0].materials[0].image={name:'BASIC_FACE.TGA',candidates:missing?[]:[{id:71,archive:'fixture',ordinal:0}],selected:missing?null:71};return Response.json({...data,sources:[{name:'FACE.X',entry_id:1}],skeleton_source:{name:'FACE.X',entry_id:1},motion:{candidates:[]},animation:{candidates:[]},warnings:[]});}
    return originalFetch(url,options);
  };
  await import('/model.js');await modelViewer.loadModel([1]);const $=id=>document.getElementById(id),face=$('avatar-face-sdf-enabled'),toon=$('avatar-toon-enabled'),select=$('avatar-lighting-profile'),u=()=>modelViewer.state.model.materials[0].userData.avatarLighting;
  check(!toon.disabled&&!face.checked&&face.disabled,'face-only model must expose opt-in SDF mode');$('open-avatar-lighting').click();for(let i=0;i<100&&!select.querySelector('option[value="source"]');i++)await new Promise(r=>setTimeout(r,5));
  toon.click();select.value='source';select.dispatchEvent(new Event('change'));face.click();check(u().avatarFaceEnabled.value===1&&u().avatarToonEnabled.value===0&&u().avatarLightEnabled.value===0,'face SDF was double shaded or not enabled');
  await modelViewer.loadModel([1]);check(face.checked&&u().avatarFaceEnabled.value===1,'face preference lost on model reload');face.click();check(u().avatarFaceEnabled.value===0,'face toggle did not restore base');face.click();
  document.querySelector('#avatar-lighting-dialog button').click();fail=true;$('open-avatar-lighting').click();for(let i=0;i<100&&!$('avatar-lighting-status').textContent.includes('face source changed');i++)await new Promise(r=>setTimeout(r,5));check(u().avatarFaceEnabled.value===0,'failed light retained stale SDF');document.querySelector('#avatar-lighting-dialog button').click();fail=false;
  $('open-avatar-lighting').click();for(let i=0;i<100&&u().avatarFaceEnabled.value===0;i++)await new Promise(r=>setTimeout(r,5));check(u().avatarFaceEnabled.value===1,'face SDF retry failed');document.querySelector('#avatar-lighting-dialog button').click();
  missing=true;await modelViewer.loadModel([1]);check(u().avatarFaceEnabled.value===0,'missing face map retained stale SDF');$('clear-model').click();check(face.disabled&&toon.disabled,'clear left face controls enabled');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{map.dispose();renderer.dispose();renderer.forceContextLoss();}
