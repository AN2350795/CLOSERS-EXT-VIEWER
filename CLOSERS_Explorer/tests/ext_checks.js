import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarExt,setAvatarExtMap,setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
import {createEmissionRenderer} from '/model-emission.js';
import {setMaterialPreviewMap} from '/model-materials.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
function fixture(count=0,emission=false){return {frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[0,1].map(k=>({name:'mesh'+k,source_id:k+1,frame:-1,vertices:[-1.7+k*2,-.7,0,-.3+k*2,-.7,0,-1+k*2,.7,0],normals:[.6,0,.8,.6,0,.8,.6,0,.8],indices:[0,1,2],uv:[0,0,1,0,0,1],groups:[[0,3,0]],materials:[{color:[.1,.08,.05,1],...(!k?{toon_preview:{kind:'toon',status:'approximate'},ext_preview:{kind:'global-specular',status:'approximate',texture:'BASE_EXT.PNG'},...(emission?{material_preview:{kind:'emissive',status:'approximate',color:[1,1,1,1],strength:.1}}:{})}:{})}],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}))};}
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(96,96);renderer.setClearColor(0);renderer.outputColorSpace=T.SRGBColorSpace;let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext(),pixels=scene=>{renderer.render(scene,camera);const p=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},srgb=x=>Math.round(255*(x<=.0031308?x*12.92:1.055*x**(1/2.4)-.055));
function map(r,g,b,a=255){const t=new T.DataTexture(new Uint8Array([r,g,b,a]),1,1);t.needsUpdate=true;return t;}
const ext=map(128,255,255,0),redOnly=map(128,0,0),black=map(0,255,255),toon=map(255,255,255),emissive=map(32,16,8);
const light={color:[.3,.3,.3,1],direction:[0,0,-1],intensity:1.025,global_specular:{color:[1,.5,.25,0],intensity:2,power:3}};
try{
  for(const count of [0,4,5])for(const emission of [false,true]){
    const model=buildModel(fixture(count,emission)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0],index=(48*96+24)*4;
    setAvatarToonMap(m,toon);setAvatarToon(m,true,light,.5);if(emission)setMaterialPreviewMap(m,emissive);const off=pixels(scene);
    setAvatarExt(m,true,light);check(pixels(scene).every((v,i)=>v===off[i]),'missing EXT changed surface');setAvatarExtMap(m,ext);const on=pixels(scene);
    const red=128/255,weight=red*2*.8*.28**(red*3);
    for(let c=0;c<3;c++){const expected=[.1,.08,.05][c]*.5*(.3*1.025+[1,.5,.25][c]*weight)+(emission?[32,16,8][c]/255*.1:0);check(Math.abs(on[index+c]-srgb(expected))<=1,'source EXT R equation/channel/order mismatch '+count+'/'+emission+'/'+c+': '+on[index+c]+' expected '+srgb(expected));}
    for(let i=0;i<on.length;i++)if(i%4===3||(i/4|0)%96>=48)check(on[i]===off[i],'EXT affected alpha or unrelated material');
    setAvatarExtMap(m,redOnly);check(pixels(scene).every((v,i)=>v===on[i]),'EXT green/blue/alpha affected global reflection');setAvatarExtMap(m,black);check(pixels(scene).every((v,i)=>v===off[i]),'zero red created reflection');setAvatarExtMap(m,ext);
    const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{solo:true,bloom:true});const solo=new Uint8Array(on.length);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,solo);setAvatarExt(m,false,light);check(pixels(scene).every((v,i)=>v===off[i]),'EXT OFF did not restore pixels');fx.render(scene,camera,model,{solo:true,bloom:true});const soloOff=new Uint8Array(on.length);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,soloOff);check(solo.every((v,i)=>v===soloOff[i]),'EXT leaked into emission-only/bloom source');fx.dispose();
    if(count){
      const rigid=buildModel(fixture(0,emission)),reference=new T.Scene();rigid.root.scale.z=1;rigid.root.rotation.y=.4;reference.add(rigid.root);const rm=rigid.materials[0];setAvatarToonMap(rm,toon);setAvatarToon(rm,true,light,.5);setAvatarExtMap(rm,ext);setAvatarExt(rm,true,light);if(emission)setMaterialPreviewMap(rm,emissive);
      model.bones.forEach(b=>b.rotation.y=.4);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());setAvatarExt(m,true,light);const a=pixels(scene),b=pixels(reference);check(a.every((v,i)=>Math.abs(v-b[i])<=2),'EXT normal did not follow full skinning');rigid.dispose();model.bones.forEach(b=>b.rotation.y=0);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
    }
    setAvatarExt(m,true,{...light,global_specular:{...light.global_specular,intensity:0}});check(pixels(scene).every((v,i)=>v===off[i]),'zero intensity created reflection');setAvatarExt(m,true,{...light,global_specular:null});check(pixels(scene).every((v,i)=>v===off[i]),'missing parameters kept stale reflection');model.dispose();
  }
  check(!shaderError,'EXT shader compilation failed');
  const fetchOriginal=window.fetch;let missing=false,fail=false;
  window.fetch=async(url,options)=>{
    const path=String(url);
    if(path.startsWith('/api/model-browser'))return Response.json({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}});
    if(path.startsWith('/api/composition-source/'))return Response.json({width:4,height:4,image_sha256:'ext-fixture'});
    if(path.startsWith('/api/model-lighting')){if(fail)throw Error('ext light failed');return Response.json({profiles:[{...light,key:'region',label:'지역 조명'},{...light,key:'costume',global_specular:null,label:'의상 조명'}]});}
    if(path.startsWith('/api/model-scene')){const data=fixture();for(const m of data.meshes.flatMap(m=>m.materials)){if(m.toon_preview)m.toon_preview.image={name:'TOON.PNG',candidates:[{id:71,archive:'fixture',ordinal:0}],selected:71};if(m.ext_preview)m.ext_preview.image={name:'BASE_EXT.PNG',candidates:missing?[]:[{id:71,archive:'fixture',ordinal:0}],selected:missing?null:71};}return Response.json({...data,sources:[{name:'fixture.X',entry_id:1}],skeleton_source:{name:'fixture.X',entry_id:1},motion:{candidates:[]},animation:{candidates:[]},warnings:[]});}
    return fetchOriginal(url,options);
  };
  await import('/model.js');await modelViewer.loadModel([1]);const $=id=>document.getElementById(id),toggle=$('avatar-ext-enabled'),select=$('avatar-lighting-profile'),u=()=>modelViewer.state.model.materials[0].userData.avatarLighting;
  check(!toggle.checked&&toggle.disabled,'EXT should start opt-in');$('open-avatar-lighting').click();for(let i=0;i<100&&!select.querySelector('option[value="region"]');i++)await new Promise(r=>setTimeout(r,5));$('avatar-toon-enabled').click();select.value='region';select.dispatchEvent(new Event('change'));toggle.click();check(u().avatarExtEnabled.value===1,'EXT comparison did not enable');const texture=modelViewer.state.textures.get('ext:71');check(texture.colorSpace===T.NoColorSpace&&texture.wrapS===T.RepeatWrapping&&texture!==modelViewer.state.textures.get('toon:71'),'EXT data texture role/sampling invalid');
  await modelViewer.loadModel([1]);check(toggle.checked&&u().avatarExtEnabled.value===1,'EXT preference lost on reload');select.value='costume';select.dispatchEvent(new Event('change'));check(u().avatarExtEnabled.value===0,'costume without specular kept EXT');select.value='region';select.dispatchEvent(new Event('change'));
  document.querySelector('#avatar-lighting-dialog button').click();fail=true;$('open-avatar-lighting').click();for(let i=0;i<100&&!$('avatar-lighting-status').textContent.includes('ext light failed');i++)await new Promise(r=>setTimeout(r,5));check(u().avatarExtEnabled.value===0,'light failure kept stale EXT');document.querySelector('#avatar-lighting-dialog button').click();fail=false;$('open-avatar-lighting').click();for(let i=0;i<100&&u().avatarExtEnabled.value===0;i++)await new Promise(r=>setTimeout(r,5));check(u().avatarExtEnabled.value===1,'EXT retry failed');document.querySelector('#avatar-lighting-dialog button').click();
  missing=true;await modelViewer.loadModel([1]);check(u().avatarExtEnabled.value===0,'missing map kept EXT');$('clear-model').click();check(toggle.disabled,'reset left EXT enabled');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{for(const m of [ext,redOnly,black,toon,emissive])m.dispose();renderer.dispose();renderer.forceContextLoss();}
