import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarToon,setAvatarToonMap,setAvatarExtMap,setAvatarExtSurface,validExtSurfaceFactor,setupAvatarLighting} from '/model-lighting.js';
import {setMaterialPreviewMap} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id),identity=new T.Matrix4().toArray();
const make=count=>buildModel({frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[{name:'surface',source_id:1,frame:-1,vertices:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,1,0,0,1],groups:[[0,3,0]],materials:[{color:[.1,.08,.05,1],toon_preview:{status:'approximate'},ext_preview:{status:'approximate',texture:'BASE_EXT.PNG',source_texture:'BASE.PNG'},material_preview:{kind:'emissive',status:'approximate',color:[1,1,1,1],strength:.1}}],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}]});
const map=(r,g,b,a=255)=>{const t=new T.DataTexture(new Uint8Array([r,g,b,a]),1,1);t.needsUpdate=true;return t;},toon=map(128,64,32),emission=map(32,16,8),owned=[toon,emission];
const light={key:'fixture',label:'B surface',direction:[0,0,-1],color:[.3,.4,.5,1],intensity:.4,near_intensity:1.2};
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.outputColorSpace=T.SRGBColorSpace;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=15;camera.lookAt(0,0,0);
const pixels=scene=>{renderer.render(scene,camera);const p=new Uint8Array(64*64*4),gl=renderer.getContext();gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},srgb=v=>Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055));let current,fx;
try{
 for(const v of [undefined,null,'1',-1,NaN,Infinity,4.1])check(!validExtSurfaceFactor(v),'invalid factor accepted');
 for(const count of [0,4,5]){
  const model=make(count),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0];setAvatarToonMap(m,toon);setMaterialPreviewMap(m,emission);setAvatarToon(m,true,light,.5);const original=pixels(scene);
  for(const blue of [0,64,128,255])for(const factor of [0,.25,1,4]){
   const ext=map(213,255,blue,0);owned.push(ext);setAvatarExtMap(m,ext);setAvatarExtSurface(m,true,factor);const p=pixels(scene),index=(32*64+32)*4;
   for(let c=0;c<3;c++){const surface=[.1,.08,.05][c],expected=surface*[128,64,32][c]/255*.5*light.color[c]*light.intensity+surface*blue/255*factor+[32,16,8][c]/255*.1;check(Math.abs(p[index+c]-srgb(expected))<=1,'B GPU order/channel oracle '+count+'/'+blue+'/'+factor+'/'+c);}
   check(p[index+3]===255,'EXT B changed alpha');if(blue===0||factor===0)check(p.every((v,i)=>v===original[i]),'B zero/factor zero changed pixels');
   const isolated=map(0,0,blue,255);owned.push(isolated);setAvatarExtMap(m,isolated);check(pixels(scene).every((v,i)=>v===p[i]),'B depends on R/G/alpha');
  }
  fx=createEmissionRenderer(renderer);const solo=()=>{fx.render(scene,camera,model,{solo:true,bloom:true});const p=new Uint8Array(64*64*4),gl=renderer.getContext();gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};const a=solo();setAvatarExtSurface(m,false,4);check(solo().every((v,i)=>v===a[i]),'B leaked into emission/bloom');fx.dispose();fx=null;check(pixels(scene).every((v,i)=>v===original[i]),'B OFF did not restore pixels');
  setAvatarExtSurface(m,true,null);check(pixels(scene).every((v,i)=>v===original[i]),'missing factor guessed');m.userData.faceSdfPreview={};setAvatarExtSurface(m,true,1);check(m.userData.avatarLighting.avatarExtSurfaceEnabled.value===0,'unverified face branch enabled');delete m.userData.faceSdfPreview;
  model.dispose();
 }
 current=make(5);current.root.scale.z=1;const m=current.materials[0],u=m.userData.avatarLighting;setAvatarToonMap(m,toon);const ext=map(0,0,128);owned.push(ext);setAvatarExtMap(m,ext);
 const state={model:current,data:{sources:[{model_group:{kind:'avatar',character:'REAPER'}}]}};
 localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({selected:light.key,toon:true,extSurfaceVersion:1,extSurface:!!window.restoreExtSurface,extSurfaceFactor:window.restoreExtSurface?.75:null}));
 const ui=setupAvatarLighting({state,api:async()=>({profiles:[light],color_grading_presets:[]}),element:(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;},getEmissionEnabled:()=>false});
 $('open-avatar-lighting').click();for(let i=0;i<100&&$('avatar-lighting-profile').value!==light.key;i++)await new Promise(r=>setTimeout(r,10));
 const toggle=$('avatar-ext-surface-enabled'),factor=$('avatar-ext-surface-factor'),change=value=>{factor.value=value;factor.dispatchEvent(new Event('change'));};
 check(toggle.checked===!!window.restoreExtSurface,'B default/restoration');
 if(!window.restoreExtSurface){check(factor.value===''&&u.avatarExtSurfaceEnabled.value===0,'default invented a factor');toggle.click();check(u.avatarExtSurfaceEnabled.value===0,'ON without factor enabled B');change('.75');}
 check(u.avatarExtSurfaceEnabled.value===1&&u.avatarExtSurfaceFactor.value===.75&&!$('avatar-ext-enabled').checked,'B coupled to R or saved state lost');
 setAvatarExtMap(m,null);check(u.avatarExtSurfaceEnabled.value===0,'missing map retained B');setAvatarExtMap(m,ext);check(u.avatarExtSurfaceEnabled.value===1,'late texture did not restore B');
 change('5');check(factor.value===''&&u.avatarExtSurfaceEnabled.value===0,'out of range factor not held');change('0');check(u.avatarExtSurfaceFactor.value===0,'explicit zero lost');change('1');
 $('avatar-toon-enabled').click();check(u.avatarExtSurfaceEnabled.value===0,'toon OFF retained B');$('avatar-toon-enabled').click();
 const before=localStorage.getItem('closers-avatar-lighting-v2');for(let i=0;i<20;i++)ui.updateCamera(camera);check(before===localStorage.getItem('closers-avatar-lighting-v2'),'frame persisted manual B');
 toggle.click();check(u.avatarExtSurfaceEnabled.value===0,'B toggle did not turn off');toggle.click();
 check(!$('avatar-second-enabled').checked,'B enabled hyper tint');state.model=null;ui.refresh();check(toggle.disabled,'clear retained B availability');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{fx?.dispose();current?.dispose();owned.forEach(t=>t.dispose());renderer.dispose();renderer.forceContextLoss();}
