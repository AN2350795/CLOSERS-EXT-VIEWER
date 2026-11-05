import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setupAvatarLighting,setAvatarToon,setAvatarToonMap,setAvatarFaceSdf} from '/model-lighting.js';
import {normalizeViewerLights,viewerSourceProfile} from '/model-viewer-light.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id),identity=new T.Matrix4().toArray();
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const change=(id,value)=>{const e=$(id);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
const vector=(name,values)=>['x','y','z'].forEach((axis,i)=>change('viewer-light-'+name+'-'+axis,values[i]));
const fixture=count=>({frames:Array.from({length:Math.max(1,count)},(_,i)=>({name:i?'b'+i:'BIP01_HEAD',parent:-1,matrix:identity})),meshes:[0,1,2].map(k=>({name:k===1?'TEST_FACE_SDF_MC':'mesh'+k,source_id:k+1,frame:-1,vertices:[-2.9+k*2,-.8,0,-1.1+k*2,-.8,0,-2+k*2,.8,0],indices:[0,1,2],normals:[0,0,1,.4,0,.9165,0,.4,.9165],uv:[0,0,1,0,.5,1],groups:[[0,3,0]],materials:[{color:[.5,.4,.3,1],texture:k===1?'BASIC_FACE.TGA':'BODY.PNG',...(k===0?{toon_preview:{status:'approximate'}}:k===1?{face_sdf_preview:{kind:'face-sdf',status:'approximate',head_bone:'BIP01_HEAD',texture:'BASIC_FACE.TGA'}}:{})}],skin:Array.from({length:count},(_,i)=>({bone:i?'b'+i:'BIP01_HEAD',offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}))});
try{
 localStorage.clear();check(normalizeViewerLights(null).mode==='source','source shading is not default');
 const base={key:'base',label:'원본',color:[.8,.7,.6,1],direction:[1,0,0],intensity:.8,global_rim:{width:1,power:2}};
 const rig=normalizeViewerLights({enabled:true,lights:[{enabled:true,type:'point',position:[0,0,10],distance:20,intensity:.5}]});
 const snapshot=JSON.stringify(base),profile=viewerSourceProfile(rig,base);
 check(Math.abs(profile.intensity-.1)<1e-6&&profile.direction.join()==='0,0,-1'&&profile.global_rim===base.global_rim&&JSON.stringify(base)===snapshot,'source inheritance, attenuation or coordinate reflection');
 check(viewerSourceProfile({...rig,enabled:false},base)===null&&viewerSourceProfile({...rig,mode:'diffuse'},base)===null,'OFF/mode gate');
 const ramp=new T.DataTexture(new Uint8Array([32,32,32,255,64,64,64,255,128,128,128,255,224,224,224,255]),4,1);ramp.needsUpdate=true;ramp.minFilter=ramp.magFilter=T.NearestFilter;ramp.wrapS=ramp.wrapT=T.ClampToEdgeWrapping;
 const face=new T.DataTexture(new Uint8Array([128,128,128,0,128,128,128,255]),2,1);face.needsUpdate=true;face.wrapS=face.wrapT=T.ClampToEdgeWrapping;
 const make=count=>{const model=buildModel(fixture(count));model.root.scale.z=1;setAvatarToonMap(model.materials[0],ramp);model.materials[1].map=face;model.materials[1].needsUpdate=true;return model;};
 const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(96,64);renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.setClearColor(0);
 const camera=new T.OrthographicCamera(-3,3,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
 const capture=scene=>{renderer.render(scene,camera);const gl=renderer.getContext(),p=new Uint8Array(96*64*4);gl.readPixels(0,0,96,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
 const initial=make(0),state={model:initial,data:{sources:[]}};
 const ui=setupAvatarLighting({state,api:async()=>({profiles:[base]}),element,getEmissionEnabled:()=>false});
 vector('position',[.3,.2,1]);vector('target',[0,0,0]);
 for(const count of [0,4,5]){
   const actual=count?make(count):initial,reference=make(count),world=new T.Scene(),expected=new T.Scene();world.add(actual.root);expected.add(reference.root);state.model=actual;change('viewer-light-enabled',false);ui.refresh();const off=capture(world);
   for(const position of [[.3,.2,1],[-1,.5,-.2]]){
     vector('position',position);change('viewer-light-enabled',true);
     const refProfile={direction:[position[0],position[1],-position[2]],color:[1,1,1,1],intensity:1};
     setAvatarToon(reference.materials[0],true,refProfile);setAvatarFaceSdf(reference.materials[1],true,refProfile);
     const result=capture(world),oracle=capture(expected);
     check(result.every((v,i)=>Math.abs(v-oracle[i])<=1),'source ramp/SDF differs from original shader '+count);
     check(actual.materials.every(m=>m.userData.viewerLight.viewerLightEnabled.value===0),'Lambert overlay still active');
     check(!$('avatar-toon-enabled').checked&&state.viewerSourceLighting,'source mode overwrote original effect selection');
     change('viewer-light-ambient',2);check(capture(world).every((v,i)=>v===result[i]),'source mode applied generic ambient');
     change('viewer-light-enabled',false);check(capture(world).every((v,i)=>v===off[i]),'OFF failed to restore original material '+count);
   }
   if(count)actual.dispose();reference.dispose();
 }
 state.model=initial;ui.refresh();change('viewer-light-enabled',true);const mainProfile=initial.materials[0].userData.toonPreview.profile;
 $('viewer-light-add').click();change('viewer-light-color','#ff0000');check(initial.materials[0].userData.toonPreview.profile.direction.join()===mainProfile.direction.join()&&initial.materials[0].userData.toonPreview.profile.color[0]===1,'extra light affected source main light');
 vector('position',[3,0,5]);change('viewer-light-source-index',1);check(initial.materials[0].userData.toonPreview.profile.color[1]===0,'main light selector not connected');
 change('viewer-light-item-enabled',false);check(!state.viewerSourceLighting&&initial.materials[0].userData.avatarLighting.avatarToonEnabled.value===0,'disabled main failed to restore original shading');
 $('viewer-light-gizmo-use-source').click();const used=JSON.parse(localStorage.getItem('closers-viewer-light-v2'));check(used.enabled&&used.sourceIndex===1&&used.lights[1].enabled&&state.viewerSourceLighting,'viewport primary-light action');
 change('viewer-light-shading','diffuse');check(!state.viewerSourceLighting&&initial.materials[0].userData.viewerLight.viewerLightEnabled.value===1,'comparison mode');
 $('open-avatar-lighting').click();for(let i=0;i<100&&$('avatar-lighting-profile').options.length<2;i++)await new Promise(r=>setTimeout(r,10));
 change('viewer-light-enabled',false);change('avatar-lighting-profile','base');change('avatar-toon-enabled',true);change('avatar-face-sdf-enabled',true);
 const restoredWorld=new T.Scene();restoredWorld.add(initial.root);const originalPixels=capture(restoredWorld),originalSettings=localStorage.getItem('closers-avatar-lighting-v2');
 change('viewer-light-shading','source');change('viewer-light-source-index',0);change('viewer-light-enabled',true);capture(restoredWorld);change('viewer-light-enabled',false);
 check(capture(restoredWorld).every((v,i)=>v===originalPixels[i])&&localStorage.getItem('closers-avatar-lighting-v2')===originalSettings,'source override failed to restore selected original profile');
 ui.dispose();initial.dispose();ramp.dispose();face.dispose();renderer.dispose();document.body.dataset.checks='passed';
}catch(error){document.body.dataset.checks='failed';document.body.append(element('pre',error.stack));}
