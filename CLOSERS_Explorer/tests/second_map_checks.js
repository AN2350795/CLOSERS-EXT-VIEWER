import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarSecond,setAvatarSecondMap,setAvatarToon,setAvatarToonMap,setAvatarFaceSdf} from '/model-lighting.js';
import {setMaterialPreviewMap} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
function fixture(count=0,face=false,emission=false){return {frames:Array.from({length:Math.max(count,face?1:0)},(_,i)=>({name:i?'b'+i:'BIP01_HEAD',parent:-1,matrix:identity})),meshes:[0,1].map(k=>({name:!k&&face?'TEST_FACE_SDF_MC':'mesh'+k,source_id:k+1,frame:-1,vertices:[-1.7+k*2,-.7,0,-.3+k*2,-.7,0,-1+k*2,.7,0],normals:[.8,0,.6,.8,0,.6,.8,0,.6],indices:[0,1,2],uv:[0,0,0,0,0,0],groups:[[0,3,0]],materials:[{color:face&&!k?[1,1,1,1]:[.1,.08,.05,1],...(!k?{second_preview:{kind:'hyper-second-map',status:'approximate',texture:'SECOND.DDS',source:'GUST_USER_TEST.LUA',speed:[3,3]},...(face?{texture:'BASIC_FACE.TGA',face_sdf_preview:{kind:'face-sdf',status:'approximate',head_bone:'BIP01_HEAD',texture:'BASIC_FACE.TGA'}}:{toon_preview:{kind:'toon',status:'approximate'}}),...(emission?{material_preview:{kind:'emissive',status:'approximate',color:[1,1,1,1],strength:.1}}:{})}:{})}],skin:Array.from({length:count},(_,i)=>({bone:i?'b'+i:'BIP01_HEAD',offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}))};}
function map(r,g,b,a=255){const t=new T.DataTexture(new Uint8Array([r,g,b,a]),1,1);t.needsUpdate=true;return t;}
const second=new T.DataTexture(new Uint8Array([16,0,0,0,0,0,32,255]),2,1);second.wrapS=second.wrapT=T.RepeatWrapping;second.needsUpdate=true;
const toon=map(255,255,255),faceMap=map(128,128,128,0),emissive=map(32,16,8),light={color:[.3,.4,.5,1],direction:[0,0,1],intensity:0};
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(96,96);renderer.setClearColor(0);renderer.outputColorSpace=T.SRGBColorSpace;let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext(),pixels=scene=>{renderer.render(scene,camera);const p=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},srgb=x=>Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055));
try{
  for(const count of [0,4,5])for(const face of [false,true])for(const emission of [false,true]){
    const model=buildModel(fixture(count,face,emission)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0],unrelated=model.materials[1],index=(48*96+24)*4;
    if(face){m.map=faceMap;m.needsUpdate=true;setAvatarFaceSdf(m,true,light);}else{setAvatarToonMap(m,toon);setAvatarToon(m,true,light,.5);}if(emission)setMaterialPreviewMap(m,emissive);
    const off=pixels(scene);setAvatarSecond(m,true);check(pixels(scene).every((v,i)=>v===off[i]),'missing SecondMap changed pixels');setAvatarSecondMap(m,second);setAvatarSecondMap(unrelated,second);setAvatarSecond(unrelated,true);const on=pixels(scene);
    for(let c=0;c<3;c++)check(Math.abs(on[index+c]-srgb([16,0,0][c]/255+(emission?[32,16,8][c]/255*.1:0)))<=1,'SecondMap source addition/light-independent equation');
    for(let i=0;i<on.length;i++)if(i%4===3||(i/4|0)%96>=48)check(on[i]===off[i],'SecondMap affected alpha or unrelated material');
    setAvatarSecond(m,true,[.5,0]);const shifted=pixels(scene);for(let c=0;c<3;c++)check(Math.abs(shifted[index+c]-srgb([0,0,32][c]/255+(emission?[32,16,8][c]/255*.1:0)))<=1,'SecondMap UV offset failed');setAvatarSecond(m,true,[-.5,0]);check(pixels(scene).every((v,i)=>v===shifted[i]),'SecondMap wrap failed');
    const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{solo:true,bloom:true});const solo=new Uint8Array(on.length);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,solo);setAvatarSecond(m,false);check(pixels(scene).every((v,i)=>v===off[i]),'SecondMap OFF restoration');fx.render(scene,camera,model,{solo:true,bloom:true});const soloOff=new Uint8Array(on.length);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,soloOff);check(solo.every((v,i)=>v===soloOff[i]),'SecondMap leaked into emission/bloom');fx.dispose();model.dispose();
  }
  check(!shaderError,'SecondMap shader failed');
  const originalFetch=window.fetch;let missing=false;
  window.fetch=async(url,options)=>{const path=String(url);
    if(path.startsWith('/api/model-browser'))return Response.json({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}});
    if(path.startsWith('/api/composition-source/'))return Response.json({width:4,height:4,image_sha256:'second-fixture'});
    if(path.startsWith('/api/model-lighting'))return Response.json({profiles:[]});
    if(path.startsWith('/api/model-scene')){const data=fixture();const image={name:'SHARED.PNG',candidates:missing?[]:[{id:71,archive:'fixture',ordinal:0}],selected:missing?null:71};data.meshes[0].materials[0].image=image;data.meshes[0].materials[0].second_preview.image=image;return Response.json({...data,sources:[{name:'fixture.X',entry_id:1}],skeleton_source:{name:'fixture.X',entry_id:1},motion:{candidates:[]},animation:{candidates:[]},warnings:[]});}
    return originalFetch(url,options);
  };
  localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({second:true}));
  await import('/model.js');await modelViewer.loadModel([1]);const $=id=>document.getElementById(id),toggle=$('avatar-second-enabled'),u=()=>modelViewer.state.model.materials[0].userData.avatarLighting;
  check(toggle.closest('details')?.id==='avatar-state-experiments'&&!$('avatar-state-experiments').open,'state effect must be separate and collapsed');check(u().avatarSecondEnabled.value===0,'old misleading light preference reactivated blue effect');
  check(!toggle.checked&&!toggle.disabled,'SecondMap must start opt-in');check(document.querySelector('[data-texture-role="second"]'),'missing texture source row');
  const m=modelViewer.state.model.materials[0];check(m.map!==u().avatarSecondMap.value,'SecondMap replaced/shared base texture role');check(u().avatarSecondMap.value.wrapS===T.RepeatWrapping&&u().avatarSecondMap.value.colorSpace===T.SRGBColorSpace,'SecondMap texture role');
  toggle.click();check(u().avatarSecondEnabled.value===1,'manual SecondMap requires unrelated light profile');$('avatar-second-u').value='.5';$('avatar-second-u').dispatchEvent(new Event('input'));check(u().avatarSecondOffset.value.x===.5,'UV control');
  await modelViewer.loadModel([1]);check(toggle.checked&&u().avatarSecondEnabled.value===1&&u().avatarSecondOffset.value.x===.5,'SecondMap reload lost settings');const saved=JSON.parse(localStorage.getItem('closers-avatar-lighting-v2'));check(saved.second&&saved.secondOffset[0]===.5,'SecondMap storage');
  missing=true;await modelViewer.loadModel([1]);check(u().avatarSecondEnabled.value===0&&$('avatar-second-status').textContent.includes('출처'),'missing source left stale SecondMap');missing=false;await modelViewer.loadModel([1]);check(u().avatarSecondEnabled.value===1,'source recovery');$('clear-model').click();check(toggle.disabled&&$('avatar-second-u').disabled,'clear left SecondMap active');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{for(const m of [second,toon,faceMap,emissive])m.dispose();renderer.dispose();renderer.forceContextLoss();}
