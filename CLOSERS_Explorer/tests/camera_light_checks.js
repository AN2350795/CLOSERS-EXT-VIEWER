import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {cameraLightMix,normalizeCameraMix,setupAvatarLighting,setAvatarToonMap,setAvatarGlowMap} from '/model-lighting.js';
import {setMaterialPreviewMap} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);},close=(a,b)=>Math.abs(a-b)<1e-6,$=id=>document.getElementById(id),identity=new T.Matrix4().toArray();
const light={key:'fixture',label:'거리 검사',color:[.3,.4,.5,1],direction:[0,0,1],intensity:.4,near_intensity:1.2};
const texture=(r,g,b,a=255)=>{const m=new T.DataTexture(new Uint8Array([r,g,b,a]),1,1);m.needsUpdate=true;return m;};
const toon=texture(255,255,255),faceMap=texture(128,128,128,0),glow=texture(10,20,30),emissive=texture(32,16,8);
const face=!!window.cameraFace,count=face?1:5,frames=Array.from({length:count},(_,i)=>({name:face?'BIP01_HEAD':'b'+i,parent:-1,matrix:identity}));
const model=buildModel({frames,meshes:[{name:face?'TEST_FACE_SDF_MC':'mesh',source_id:1,frame:-1,vertices:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,1,0,0,1],groups:[[0,3,0]],
 materials:[{color:face?[1,1,1,1]:[.1,.08,.05,1],...(face?{texture:'BASIC_FACE.TGA',face_sdf_preview:{status:'approximate',head_bone:'BIP01_HEAD'}}:{toon_preview:{status:'approximate'}}),glow_preview:{status:'approximate'},material_preview:{status:'approximate',kind:'emissive',color:[1,1,1,1],strength:.1}}],
 skin:frames.map(f=>({bone:f.name,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}]});
model.root.scale.z=1;const material=model.materials[0],u=material.userData.avatarLighting;if(face){material.map=faceMap;material.needsUpdate=true;}else setAvatarToonMap(material,toon);setAvatarGlowMap(material,glow);setMaterialPreviewMap(material,emissive);
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.outputColorSpace=T.SRGBColorSpace;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100),parent=new T.Group(),scene=new T.Scene();parent.add(camera);scene.add(model.root);camera.position.z=15;camera.lookAt(0,0,0);renderer.render(scene,camera);const gl=renderer.getContext();
const pixels=()=>{renderer.render(scene,camera);const p=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},srgb=v=>Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055));
let fx;
try{
 for(const [d,w] of [[0,1],[10,1],[12.5,.75],[15,.5],[20,0],[30,0]])check(cameraLightMix(d,10,20)===w,'distance scalar oracle');
 for(const args of [[15,null,20],[15,10,10],[15,20,10],[-1,10,20],[NaN,10,20],[15,0,Infinity]])check(cameraLightMix(...args)===null,'invalid calibration guessed');
 const normalized=normalizeCameraMix({enabled:true,calibrations:{REAPER:{near:NaN,far:20},CASTER:{near:0,far:30},bad:{near:1,far:2}}});check(normalized.calibrations.REAPER.near===null&&normalized.calibrations.CASTER.near===0&&!normalized.calibrations.bad,'calibration normalization');
 localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({selected:light.key,toon:true,faceSdf:face,toonPower:face?1:.5,glow:true,nearMix:.2,cameraMixVersion:1,cameraMix:{enabled:!!window.restoreCameraMix,calibrations:window.restoreCameraMix?{REAPER:{near:10,far:20}}:{}}}));
 const state={model,data:{sources:[{entry_id:1,model_group:{kind:'avatar',character:'REAPER'}}]}};
 const ui=setupAvatarLighting({state,api:async()=>({profiles:[light,{...light,key:'missing',near_intensity:undefined},{...light,key:'zero',near_intensity:0}],color_grading_presets:[]}),element:(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;},getEmissionEnabled:()=>true});
 $('open-avatar-lighting').click();for(let i=0;i<100&&$('avatar-lighting-profile').options.length<4;i++)await new Promise(r=>setTimeout(r,10));
 const enabled=$('avatar-camera-mix-enabled'),near=$('avatar-camera-mix-near'),far=$('avatar-camera-mix-far'),manual=$('avatar-lighting-near-mix'),change=(e,v)=>{e.value=v;e.dispatchEvent(new Event('change'));};
 check(enabled.checked===!!window.restoreCameraMix,'distance default/restoration');
 if(!window.restoreCameraMix){
  enabled.click();check(close((face?u.avatarFaceIntensity:u.avatarToonIntensity).value,.56),'missing points changed manual mix');
  camera.position.z=10;ui.updateCamera(camera);$('avatar-camera-mix-mark-near').click();camera.position.z=20;ui.updateCamera(camera);$('avatar-camera-mix-mark-far').click();
 }
 camera.position.z=15;let result=ui.updateCamera(camera);ui.refresh();check(result.automatic&&result.weight===.5&&near.value==='10'&&far.value==='20'&&manual.disabled&&manual.value==='0.2','two-point activation or manual backup');
 const beforeSettings=localStorage.getItem('closers-avatar-lighting-v2');
 for(const [distance,intensity] of [[10,1.2],[15,.8],[20,.4],[30,.4]]){
  camera.position.z=distance;ui.updateCamera(camera);const p=pixels(),index=(32*64+32)*4;
  check(close((face?u.avatarFaceIntensity:u.avatarToonIntensity).value,intensity)&&close(u.avatarGlowIntensity.value,intensity),'dynamic uniform intensity');
  for(let c=0;c<3;c++){const surface=face?128/255*[1,.878,.784][c]:[.1,.08,.05][c]*.5,expected=(surface*light.color[c]+[10,20,30][c]/255)*intensity+[32,16,8][c]/255*.1;check(Math.abs(p[index+c]-srgb(expected))<=1,'camera GPU oracle '+face+'/'+distance+'/'+c);}check(p[index+3]===255,'camera changed alpha');
 }
 check(localStorage.getItem('closers-avatar-lighting-v2')===beforeSettings,'animation loop changed persisted controls');
 fx=createEmissionRenderer(renderer);const solo=()=>{fx.render(scene,camera,model,{solo:true,bloom:true});const p=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
 camera.position.z=10;ui.updateCamera(camera);const nearEmission=solo();camera.position.z=20;ui.updateCamera(camera);check(solo().every((v,i)=>v===nearEmission[i]),'distance leaked into emission/bloom');
 camera.position.z=10;parent.position.z=5;result=ui.updateCamera(camera);check(close(result.distance,15)&&close(result.weight,.5),'camera parent transform ignored');
 model.root.position.x=10;result=ui.updateCamera(camera);check(close(result.distance,Math.sqrt(325)),'avatar world origin ignored');model.root.position.x=0;parent.position.z=0;
 const list=$('avatar-toon-items'),observer=new MutationObserver(()=>{});observer.observe(list,{childList:true,subtree:true});for(let i=0;i<80;i++){camera.position.z=10+i/8;ui.updateCamera(camera);}check(observer.takeRecords().length===0,'per-frame update rebuilt material lists');observer.disconnect();
 enabled.click();check(!manual.disabled&&close((face?u.avatarFaceIntensity:u.avatarToonIntensity).value,.56),'distance OFF did not restore manual intensity');enabled.click();
 change(far,'10');check(!ui.updateCamera(camera).automatic&&!manual.disabled&&close((face?u.avatarFaceIntensity:u.avatarToonIntensity).value,.56),'invalid range retained stale auto mix');change(far,'20');
 state.data.sources[0].model_group.character='CASTER';ui.refresh();result=ui.updateCamera(camera);check(!result.automatic&&near.value===''&&far.value==='','another character reused calibration');
 state.data.sources[0].model_group.character='REAPER';ui.refresh();camera.position.z=15;check(ui.updateCamera(camera).automatic,'character calibration not restored');
 change($('avatar-lighting-profile'),'missing');ui.updateCamera(camera);check((face?u.avatarFaceIntensity:u.avatarToonIntensity).value===.4&&manual.disabled,'missing near invented intensity');
 change($('avatar-lighting-profile'),'zero');camera.position.z=10;ui.updateCamera(camera);check((face?u.avatarFaceIntensity:u.avatarToonIntensity).value===0,'zero near lost');
 const oldModel=state.model;state.model={...model};ui.refresh();check(close((face?u.avatarFaceIntensity:u.avatarToonIntensity).value,.32),'new model reused old camera sample');ui.updateCamera(camera);check((face?u.avatarFaceIntensity:u.avatarToonIntensity).value===0,'new model did not resume from fresh sample');state.model=oldModel;ui.refresh();
 $('avatar-toon-enabled').click();ui.updateCamera(camera);check((face?u.avatarFaceEnabled:u.avatarToonEnabled).value===0&&!$('avatar-second-enabled').checked,'distance enabled disabled effect or hyper tint');
 state.model=null;ui.refresh();check(!ui.updateCamera(camera).automatic&&near.disabled&&far.disabled,'clear retained distance link');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{fx?.dispose();model.dispose();for(const t of [toon,faceMap,glow,emissive])t.dispose();renderer.dispose();renderer.forceContextLoss();}
