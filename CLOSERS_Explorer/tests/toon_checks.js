import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
import {setMaterialPreviewMap,setMatcapPreview,setMatcapPreviewMap} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
function fixture(count=0){return {frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[0,1].map(k=>({name:'mesh'+k,source_id:k+1,frame:-1,vertices:[-1.7+k*2,-.7,0,-.3+k*2,-.7,0,-1+k*2,.7,0],indices:[0,1,2],uv:[0,0,1,0,0,1],normals:[0,0,1,0,0,1,0,0,1],groups:[[0,3,0]],materials:[{color:[.2,.1,.05,1],...(k?{}:{toon_preview:{kind:'toon',status:'approximate',source_index:0,index:0,source_name:'CTT_BASIC0',name:'CTT_BASIC0',texture:'CTT_BASIC0.BMP'}})}],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}))};}
const profile={color:[.8,.7,.6,1],direction:[0,0,-1],intensity:1.025},srgb=x=>Math.round(255*(x<=.0031308?x*12.92:1.055*Math.pow(x,1/2.4)-.055));
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(96,96);renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor(0);let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext(),capture=scene=>{renderer.render(scene,camera);const p=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
const map=new T.DataTexture(new Uint8Array([128,64,32,255]),1,1);map.needsUpdate=true;
try{
  const ramp=new T.DataTexture(new Uint8Array([32,32,32,255,64,64,64,255,128,128,128,255,224,224,224,255]),4,1);ramp.needsUpdate=true;ramp.wrapS=ramp.wrapT=T.ClampToEdgeWrapping;ramp.minFilter=ramp.magFilter=T.NearestFilter;
  for(const count of [0,4,5]){
    const model=buildModel(fixture(count)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0],index=(48*96+24)*4;
    setAvatarToonMap(m,ramp);setAvatarToon(m,true,{color:[1,1,1,1],direction:[Math.sqrt(.96),0,-.2],intensity:1});
    let p=capture(scene);check(Math.abs(p[index]-srgb(.2*32/255))<=1,'toon uses raw dot, not half-Lambert');
    if(count){model.bones.forEach(b=>b.rotation.y=.4);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());p=capture(scene);check(Math.abs(p[index]-srgb(.2*128/255))<=1,'toon ramp lookup ignored skinned normals');}
    model.dispose();
  }
  {
    const data=fixture();data.meshes[0].normals=[1,0,0,0,1,0,0,0,1];const model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);setAvatarToonMap(model.materials[0],ramp);setAvatarToon(model.materials[0],true,{color:[1,1,1,1],direction:[0,0,-1],intensity:1});
    check(Math.abs(capture(scene)[(48*96+24)*4]-srgb(.2*128/255))<=1,'toon coordinate must interpolate vertex dot products, not renormalize in the fragment');model.dispose();
  }
  ramp.dispose();
  for(const count of [0,4,5]){
    const data=fixture(count),model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0],index=(48*96+24)*4,base=capture(scene);
    setAvatarToon(m,true,profile);check(capture(scene).every((v,i)=>v===base[i]),'missing toon changed base');setAvatarToonMap(m,map);const on=capture(scene);
    for(let c=0;c<3;c++)check(Math.abs(on[index+c]-srgb([.2,.1,.05][c]*[128,64,32][c]/255*profile.color[c]*profile.intensity))<=1,'toon source RGB/intensity oracle: '+count+'/'+c);
    for(let i=0;i<on.length;i++)if(i%4===3||(i/4|0)%96>=48)check(on[i]===base[i],'toon affected alpha or unbound material');
    setAvatarToon(m,true,profile,2);const bright=capture(scene);for(let c=0;c<3;c++)check(Math.abs(bright[index+c]-srgb([.2,.1,.05][c]*Math.min(1,[128,64,32][c]/255*2)*profile.color[c]*profile.intensity))<=1,'toon power saturation oracle');
    if(count){model.bones.forEach(b=>b.rotation.y=.4);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());const rigid=buildModel({...fixture(),meshes:data.meshes.map(v=>({...v,skin:[]}))}),reference=new T.Scene();rigid.root.scale.z=1;rigid.root.rotation.y=.4;reference.add(rigid.root);setAvatarToonMap(rigid.materials[0],map);setAvatarToon(rigid.materials[0],true,profile,2);const posed=capture(scene),expected=capture(reference);check(posed.every((v,i)=>Math.abs(v-expected[i])<=2),'toon extended skinning differs from rigid');rigid.dispose();}
    model.bones.forEach(b=>b.rotation.y=0);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());setAvatarToon(m,false,profile);check(capture(scene).every((v,i)=>v===base[i]),'toon OFF does not restore exact pixels');setAvatarToon(m,true,null);check(capture(scene).every((v,i)=>v===base[i]),'missing profile leaves stale toon');model.dispose();
  }
  // Toon modulates the completed surface while emission bypasses its shade.
  {
    const data=fixture(),v=data.meshes[0].materials[0];v.material_preview={kind:'emissive',status:'approximate',color:[1,.5,.25,1],strength:.5};v.matcap_preview={kind:'matcap',status:'approximate'};
    const model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0],index=(48*96+24)*4;
    setMaterialPreviewMap(m,map);setMatcapPreviewMap(m,map);setMatcapPreview(m,true,1,false);setAvatarToonMap(m,map);setAvatarToon(m,true,profile);const on=capture(scene);
    for(let c=0;c<3;c++){const tex=[128,64,32][c]/255,value=([.2,.1,.05][c]+tex)*tex*profile.color[c]*profile.intensity+tex*[1,.5,.25][c]*.5;check(Math.abs(on[index+c]-srgb(value))<=1,'toon must shade MatCap before independent emission');}
    const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{solo:true,bloom:false});const solo=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,solo);for(let c=0;c<3;c++)check(Math.abs(solo[index+c]-srgb([128,64,32][c]/255*[1,.5,.25][c]*.5))<=1,'toon leaked into emission-only render');fx.dispose();model.dispose();
  }
  check(!shaderError,'toon shader compilation failed');
  // Exercise the actual texture loader, mutually exclusive modes and saved state.
  const originalFetch=window.fetch;let missing=false,failProfiles=false;
  window.fetch=async(url,options)=>{
    const path=String(url);
    if(path.startsWith('/api/model-browser'))return Response.json({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}});
    if(path.startsWith('/api/composition-source/'))return Response.json({width:4,height:4,image_sha256:'toon-fixture'});
    if(path.startsWith('/api/model-lighting')){if(failProfiles)throw Error('toon source changed');return Response.json({profiles:[{...profile,key:'source',label:'원본 시험 조명'}]});}
    if(path.startsWith('/api/model-scene')){const data=fixture(),info={name:'CTT_BASIC0.BMP',candidates:missing?[]:[{id:71,archive:'fixture',ordinal:0}],selected:missing?null:71};data.meshes[0].materials[0].image={...info,name:'BASE.PNG'};data.meshes[0].materials[0].toon_preview.image=info;return Response.json({...data,sources:[{name:'fixture.X',entry_id:1}],skeleton_source:{name:'fixture.X',entry_id:1},motion:{candidates:[]},animation:{candidates:[]},warnings:[]});}
    return originalFetch(url,options);
  };
  localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({enabled:true,legacyExplicit:true,selected:'source'}));
  await import('/model.js');await modelViewer.loadModel([1]);
  const $=id=>document.getElementById(id),toggle=$('avatar-toon-enabled'),legacy=$('avatar-lighting-enabled'),select=$('avatar-lighting-profile');check(!toggle.checked&&!toggle.disabled,'toon must be opt-in');
  check(!legacy&&modelViewer.state.model.materials[0].userData.avatarLighting.avatarLightEnabled.value===0,'retired legacy setting or control restored');
  $('open-avatar-lighting').click();for(let i=0;i<100&&!select.querySelector('option[value="source"]');i++)await new Promise(r=>setTimeout(r,5));
  select.value='source';select.dispatchEvent(new Event('change'));check(!legacy&&modelViewer.state.model.materials[0].userData.avatarLighting.avatarLightEnabled.value===0,'choosing a toon light silently enabled hidden legacy tint');toggle.click();
  let uniforms=()=>modelViewer.state.model.materials[0].userData.avatarLighting;
  check(!legacy&&uniforms().avatarLightEnabled.value===0&&uniforms().avatarToonEnabled.value===1,'toon and old comparison were double applied');
  const texture=modelViewer.state.textures.get('toon:71');check(texture!==modelViewer.state.textures.get('base:71')&&texture.wrapS===T.ClampToEdgeWrapping&&texture.wrapT===T.ClampToEdgeWrapping,'toon role uses mutable base map or wrong wrapping');
  {
    const data=fixture();data.meshes[0].materials[0].material_preview={kind:'emissive',status:'approximate',color:[1,.5,.25,1],strength:.2};const model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0],index=(48*96+24)*4,off=capture(scene);
    setAvatarToonMap(m,texture);setAvatarToon(m,true,profile);setMaterialPreviewMap(m,map);const actual=capture(scene);
    for(let c=0;c<3;c++){const tex=[128,64,32][c]/255,expected=[.2,.1,.05][c]*tex*profile.color[c]*profile.intensity+tex*[1,.5,.25][c]*.2;check(Math.abs(actual[index+c]-srgb(expected))<=1,'loaded toon PNG must use UNORM lookup values without sRGB decode: '+c);}
    const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{bloom:true,strength:0});const composite=new Uint8Array(actual.length);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,composite);check(composite.every((v,i)=>Math.abs(v-actual[i])<=1),'toon composite applied an extra color transform');fx.dispose();
    setAvatarToon(m,false,null);setMaterialPreviewMap(m,null);check(capture(scene).every((v,i)=>v===off[i]),'loaded toon OFF did not restore base');check(texture.colorSpace===T.NoColorSpace&&modelViewer.state.textures.get('base:71').colorSpace===T.SRGBColorSpace,'toon/base color roles not isolated');model.dispose();
  }
  $('avatar-toon-power').value='1.25';$('avatar-toon-power').dispatchEvent(new Event('input'));await modelViewer.loadModel([1]);check(toggle.checked&&uniforms().avatarToonEnabled.value===1&&uniforms().avatarToonPower.value===1.25,'toon preference lost on model reload');
  check(!('legacyExplicit' in JSON.parse(localStorage.getItem('closers-avatar-lighting-v2'))),'retired preference still saved');
  select.value='';select.dispatchEvent(new Event('change'));check(uniforms().avatarLightEnabled.value===0&&uniforms().avatarToonEnabled.value===0,'clearing light did not disable toon');select.value='source';select.dispatchEvent(new Event('change'));check(uniforms().avatarLightEnabled.value===0&&uniforms().avatarToonEnabled.value===1,'reselecting light reenabled legacy');
  document.querySelector('#avatar-lighting-dialog button').click();failProfiles=true;$('open-avatar-lighting').click();for(let i=0;i<100&&!$('avatar-lighting-status').textContent.includes('toon source changed');i++)await new Promise(r=>setTimeout(r,5));check(uniforms().avatarToonEnabled.value===0,'failed source kept stale toon active');document.querySelector('#avatar-lighting-dialog button').click();failProfiles=false;
  $('open-avatar-lighting').click();for(let i=0;i<100&&uniforms().avatarToonEnabled.value===0;i++)await new Promise(r=>setTimeout(r,5));check(uniforms().avatarToonEnabled.value===1,'toon cannot retry after source failure');document.querySelector('#avatar-lighting-dialog button').click();
  missing=true;await modelViewer.loadModel([1]);check(uniforms().avatarToonEnabled.value===0&&$('avatar-toon-status').textContent.includes('텍스처 확인 필요'),'missing toon texture left a stale effect');
  $('clear-model').click();check(toggle.disabled&&$('avatar-toon-power').disabled&&modelViewer.state.textures.size===0,'clear did not reset toon controls');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{map.dispose();renderer.dispose();renderer.forceContextLoss();}
