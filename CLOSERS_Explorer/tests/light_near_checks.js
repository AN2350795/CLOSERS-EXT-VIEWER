import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {interpolateAvatarLight,setAvatarToon,setAvatarToonMap,setAvatarFaceSdf,setAvatarGlow,setAvatarGlowMap} from '/model-lighting.js';
import {createEmissionRenderer} from '/model-emission.js';
import {setMaterialPreviewMap} from '/model-materials.js';
const check=(v,m)=>{if(!v)throw Error(m);},close=(a,b)=>Math.abs(a-b)<1e-10,identity=new T.Matrix4().toArray();
const light={key:'region',label:'지역',color:[.3,.4,.5,1],direction:[0,0,1],intensity:.4,near_intensity:1.2,global_rim:{width:1,power:0}};
function fixture(face=false){return {frames:face?[{name:'BIP01_HEAD',parent:-1,matrix:identity}]:[],meshes:[{name:face?'TEST_FACE_SDF_MC':'mesh',source_id:1,frame:-1,vertices:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,1,0,0,1],groups:[[0,3,0]],materials:[{color:face?[1,1,1,1]:[.1,.08,.05,1],...(face?{texture:'BASIC_FACE.TGA',face_sdf_preview:{kind:'face-sdf',status:'approximate',head_bone:'BIP01_HEAD',texture:'BASIC_FACE.TGA'}}:{toon_preview:{kind:'toon',status:'approximate'}}),glow_preview:{kind:'surface-glow',status:'approximate'},material_preview:{kind:'emissive',status:'approximate',color:[1,1,1,1],strength:.1}}],skin:[]}]};}
function map(r,g,b,a=255){const t=new T.DataTexture(new Uint8Array([r,g,b,a]),1,1);t.needsUpdate=true;return t;}
const toon=map(255,255,255),faceMap=map(128,128,128,0),glow=map(10,20,30),emissive=map(32,16,8);
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor(0);
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext();
const pixels=scene=>{renderer.render(scene,camera);const p=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},srgb=x=>Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055));
try{
  check(interpolateAvatarLight(null,.5)===null,'null profile');
  check(interpolateAvatarLight(light,0)===light,'far endpoint must preserve original profile');
  for(const weight of [0,.25,.5,1])check(close(interpolateAvatarLight(light,weight).intensity,.4*(1-weight)+1.2*weight),'source interpolation');
  check(interpolateAvatarLight(light,2).intensity===1.2&&interpolateAvatarLight(light,-1)===light,'clamp');
  check(interpolateAvatarLight(light,NaN)===light,'invalid weight');
  check(interpolateAvatarLight({...light,near_intensity:0},1).intensity===0,'zero near was lost');
  for(const near of [undefined,null,-1,NaN,Infinity,'1']){const p={...light,near_intensity:near};check(interpolateAvatarLight(p,.5)===p,'missing/invalid near must not invent a value');}
  check(light.intensity===.4,'source mutated');
  for(const face of [false,true]){
    const model=buildModel(fixture(face)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0];
    if(face){m.map=faceMap;m.needsUpdate=true;}else setAvatarToonMap(m,toon);
    setAvatarGlowMap(m,glow);setMaterialPreviewMap(m,emissive);
    const apply=p=>{setAvatarToon(m,true,p,.5);setAvatarFaceSdf(m,true,p,1);setAvatarGlow(m,true,p);};apply(light);const far=pixels(scene),index=(32*64+32)*4;
    for(const weight of [.5,1]){const p=interpolateAvatarLight(light,weight);apply(p);const on=pixels(scene);
      for(let c=0;c<3;c++){const surface=face?128/255*[1,.878,.784][c]:[.1,.08,.05][c]*.5;
        const expected=surface*light.color[c]*p.intensity+[10,20,30][c]/255*p.intensity+[32,16,8][c]/255*.1;
        check(Math.abs(on[index+c]-srgb(expected))<=1,'near GPU intensity/order mismatch '+face+'/'+weight+'/'+c);}
      for(let i=3;i<on.length;i+=4)check(on[i]===far[i],'alpha changed');
    }
    const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{solo:true,bloom:true});const a=new Uint8Array(far.length);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,a);
    apply(light);check(pixels(scene).every((v,i)=>v===far[i]),'far endpoint did not restore exact pixels');fx.render(scene,camera,model,{solo:true,bloom:true});const b=new Uint8Array(far.length);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,b);check(a.every((v,i)=>v===b[i]),'near intensity leaked into emission/bloom source');fx.dispose();model.dispose();
  }
  const originalFetch=window.fetch;let fail=false;
  window.fetch=async(url,options)=>{const path=String(url);
    if(path.startsWith('/api/model-browser'))return Response.json({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}});
    if(path.startsWith('/api/composition-source/'))return Response.json({width:4,height:4,image_sha256:'near-fixture'});
    if(path.startsWith('/api/model-lighting')){if(fail)throw Error('near source failed');return Response.json({profiles:[light,{...light,key:'missing',near_intensity:undefined},{...light,key:'zero',near_intensity:0}]});}
    if(path.startsWith('/api/model-scene')){const data=fixture();data.meshes[0].materials[0].toon_preview.image={name:'TOON.PNG',candidates:[{id:71,archive:'fixture',ordinal:0}],selected:71};return Response.json({...data,sources:[{name:'fixture.X',entry_id:1}],skeleton_source:{name:'fixture.X',entry_id:1},motion:{candidates:[]},animation:{candidates:[]},warnings:[]});}
    return originalFetch(url,options);
  };
  await import('/model.js');await modelViewer.loadModel([1]);const $=id=>document.getElementById(id),mix=$('avatar-lighting-near-mix'),select=$('avatar-lighting-profile'),u=()=>modelViewer.state.model.materials[0].userData.avatarLighting;
  check(mix.value==='0'&&mix.disabled,'manual near must default to far and disabled');$('open-avatar-lighting').click();for(let i=0;i<100&&!select.querySelector('option[value="region"]');i++)await new Promise(r=>setTimeout(r,5));
  $('avatar-toon-enabled').click();select.value='region';select.dispatchEvent(new Event('change'));check(!mix.disabled&&close(u().avatarToonIntensity.value,.4),'near availability');
  mix.value='.5';mix.dispatchEvent(new Event('input'));check(close(u().avatarToonIntensity.value,.8),'DOM mix did not reach renderer');check($('avatar-lighting-near-status').textContent.includes('수동 혼합 50%'),'manual status');check(JSON.parse($('avatar-lighting-source').textContent).intensity===.4,'source inspector changed');
  await modelViewer.loadModel([1]);check(mix.value==='0.5'&&close(u().avatarToonIntensity.value,.8),'reload lost mix');check(JSON.parse(localStorage.getItem('closers-avatar-lighting-v2')).nearMix===.5,'mix not persisted');
  select.value='missing';select.dispatchEvent(new Event('change'));check(mix.disabled&&u().avatarToonIntensity.value===.4,'missing near left stale intensity');select.value='zero';select.dispatchEvent(new Event('change'));mix.value='1';mix.dispatchEvent(new Event('input'));check(u().avatarToonIntensity.value===0,'DOM zero near lost');
  $('avatar-toon-enabled').click();check(mix.disabled&&u().avatarToonEnabled.value===0,'OFF still applies near');$('avatar-toon-enabled').click();select.value='region';select.dispatchEvent(new Event('change'));
  document.querySelector('#avatar-lighting-dialog button').click();fail=true;$('open-avatar-lighting').click();for(let i=0;i<100&&!$('avatar-lighting-status').textContent.includes('near source failed');i++)await new Promise(r=>setTimeout(r,5));check(mix.disabled&&u().avatarToonEnabled.value===0,'source failure kept stale near');
  document.querySelector('#avatar-lighting-dialog button').click();fail=false;$('open-avatar-lighting').click();for(let i=0;i<100&&u().avatarToonEnabled.value===0;i++)await new Promise(r=>setTimeout(r,5));check(u().avatarToonIntensity.value===1.2,'retry did not restore selected mix');$('clear-model').click();check(mix.disabled,'clear left near control active');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{for(const m of [toon,faceMap,glow,emissive])m.dispose();renderer.dispose();renderer.forceContextLoss();}
