import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {rotateAvatarToonLight,normalizeToonRotation,composeAvatarLight,setAvatarToon,setAvatarToonMap,setAvatarFaceSdf,setAvatarExt,setAvatarRim,setupAvatarLighting} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);},close=(a,b)=>Math.abs(a-b)<1e-6,$=id=>document.getElementById(id),identity=new T.Matrix4().toArray();
// Independent scalar Z, X, Y rotations, in game coordinates before the Z reflection.
function oracle(v,degrees){let [x,y,z]=v;const [a,b,c]=degrees.map(d=>d*Math.PI/180);[x,y]=[x*Math.cos(c)-y*Math.sin(c),x*Math.sin(c)+y*Math.cos(c)];[y,z]=[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];[x,z]=[x*Math.cos(b)+z*Math.sin(b),-x*Math.sin(b)+z*Math.cos(b)];const n=Math.hypot(x,y,z);return [x/n,y/n,z/n];}
const profile={key:'fixture',label:'Rotation fixture',direction:[.2,.3,-1],color:[.8,.7,.6,1],intensity:.9,near_intensity:1.3,position:[100,200,-300],global_specular:{color:[1,1,1,1],intensity:1,power:3},global_rim:{width:1,power:1}};
const angles=[23,-41,67],on=angles=>({enabled:true,angles}),srgb=v=>Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055));
const make=count=>buildModel({frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[{name:'mesh',source_id:1,frame:-1,vertices:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,1,0,0,1],groups:[[0,3,0]],materials:[{color:[.2,.1,.05,1],toon_preview:{status:'approximate'},ext_preview:{status:'approximate'},rim_preview:{status:'approximate'}}],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}]});
const ramp=new T.DataTexture(new Uint8Array([32,32,32,255,64,64,64,255,128,128,128,255,224,224,224,255]),4,1);ramp.needsUpdate=true;ramp.minFilter=ramp.magFilter=T.NearestFilter;
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.outputColorSpace=T.SRGBColorSpace;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=15;camera.lookAt(0,0,0);let current;
try{
 for(const bad of [null,{angles:[NaN,0,0]},{angles:[0,0]},{angles:['1',0,0]},{angles:[361,0,0]}])check(normalizeToonRotation(bad).angles.every(v=>v===0),'invalid saved angles');
 check(rotateAvatarToonLight(profile,{enabled:false,angles})===profile&&rotateAvatarToonLight(profile,on([0,0,0]))===profile&&rotateAvatarToonLight(null,on(angles))===null,'default or zero changed profile');
 const snapshot=JSON.stringify(profile);
 for(const count of [0,4,5]){
  const model=make(count),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0];setAvatarToonMap(m,ramp);let baseline;
  for(const rotation of [[0,0,0],[90,0,0],[0,90,0],[0,0,90],angles,[-37,12,-82]]){
   const p=rotateAvatarToonLight(profile,on(rotation)),expected=oracle(profile.direction,rotation);setAvatarToon(m,true,p);
   const u=m.userData.avatarLighting;check(u.avatarToonDirection.value.toArray().every((v,i)=>close(v,expected[i]*(i===2?-1:1))),'source order/handedness');
   renderer.render(scene,camera);const gl=renderer.getContext(),pixels=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   const tex=[32,64,128,224][Math.min(3,Math.max(0,Math.floor(-expected[2]*4)))],index=(32*64+32)*4;
   for(let c=0;c<3;c++)check(Math.abs(pixels[index+c]-srgb([.2,.1,.05][c]*tex/255*profile.color[c]*profile.intensity))<=1,'rotation GPU oracle '+count+'/'+rotation+'/'+c);
   check(pixels[index+3]===255,'rotation changed alpha');if(!baseline)baseline=pixels;
  }
  setAvatarToon(m,true,profile);renderer.render(scene,camera);const pixels=new Uint8Array(64*64*4),gl=renderer.getContext();gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);check(pixels.every((v,i)=>v===baseline[i]),'rotation OFF pixels not restored');model.dispose();
 }
 check(JSON.stringify(profile)===snapshot,'source profile mutated');
 const merged=composeAvatarLight({...profile,key:'world:fixture'},{...profile,key:'skin',group_id:211,light_id:4,selection_binding:{status:'source-verified',type:5,value:211,light_data_id:4},direction:[1,0,0]});
 check(rotateAvatarToonLight(merged,on(angles)).toon_direction.every((v,i)=>close(v,oracle(profile.direction,angles)[i])),'rotation used skin direction after composition');
 current=make(5);current.root.scale.z=1;setAvatarToonMap(current.materials[0],ramp);const state={model:current,data:{sources:[{model_group:{kind:'avatar',character:'REAPER'}}]}};
 localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({selected:profile.key,toon:true,nearMix:.2,toonRotationVersion:1,toonRotation:{enabled:!!window.restoreRotation,angles}}));
 const ui=setupAvatarLighting({state,api:async()=>({profiles:[profile,{...profile,key:'second',direction:[0,0,-1]}],color_grading_presets:[]}),element:(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;},getEmissionEnabled:()=>false});
 $('open-avatar-lighting').click();for(let i=0;i<100&&$('avatar-lighting-profile').value!==profile.key;i++)await new Promise(r=>setTimeout(r,10));
 const toggle=$('avatar-toon-rotation-enabled'),m=current.materials[0],u=m.userData.avatarLighting;check(toggle.checked===!!window.restoreRotation,'default/saved activation');if(!toggle.checked)toggle.click();
 check(u.avatarToonDirection.value.toArray().every((v,i)=>close(v,oracle(profile.direction,angles)[i]*(i===2?-1:1))),'UI angle not applied');
 // General directions and position must ignore the toon-only rotation.
 const p=m.userData.toonPreview.profile;setAvatarExt(m,true,p);setAvatarRim(m,true,p);
 const general=oracle(profile.direction,[0,0,0]).map((v,i)=>v*(i===2?1:-1));
 check(u.avatarExtDirection.value.toArray().every((v,i)=>close(v,general[i]))&&u.avatarRimDirection.value.toArray().every((v,i)=>close(v,general[i]))&&p.position===profile.position,'toon rotation leaked into general light');
 m.userData.faceSdfPreview={headReady:true};setAvatarFaceSdf(m,true,p);check(u.avatarFaceDirection.value.toArray().every((v,i)=>close(v,-general[i])),'toon rotation leaked into separate face direction');delete m.userData.faceSdfPreview;
 setAvatarToonMap(m,ramp);check(close(u.avatarToonDirection.value.x,oracle(profile.direction,angles)[0]),'late map load lost rotation');
 const change=(e,v)=>{e.value=v;e.dispatchEvent(new Event('change'));};change($('avatar-toon-rotation-x'),'invalid');check($('avatar-toon-rotation-x').value==='23','invalid input replaced prior angle');
 change($('avatar-camera-mix-near'),'10');change($('avatar-camera-mix-far'),'20');$('avatar-camera-mix-enabled').click();ui.updateCamera(camera);
 check(close(u.avatarToonIntensity.value,1.1)&&close(u.avatarToonDirection.value.x,oracle(profile.direction,angles)[0]),'camera mix lost rotation');
 const saved=localStorage.getItem('closers-avatar-lighting-v2');for(let i=0;i<20;i++){camera.position.z=10+i/2;ui.updateCamera(camera);}check(saved===localStorage.getItem('closers-avatar-lighting-v2'),'camera saved transient rotation');
 toggle.click();check(close(u.avatarToonDirection.value.x,oracle(profile.direction,[0,0,0])[0]),'OFF did not restore direction');toggle.click();
 change($('avatar-lighting-profile'),'second');check(u.avatarToonDirection.value.toArray().every((v,i)=>close(v,oracle([0,0,-1],angles)[i]*(i===2?-1:1))),'profile change reused old direction');
 $('avatar-toon-rotation-reset').click();check(['x','y','z'].every(axis=>$('avatar-toon-rotation-'+axis).value==='0')&&u.avatarToonDirection.value.z===1,'reset did not restore zero rotation');
 $('avatar-toon-enabled').click();check(u.avatarToonEnabled.value===0&&!$('avatar-second-enabled').checked,'rotation enabled disabled effect');
 state.model=null;ui.refresh();check($('avatar-toon-rotation-status').textContent.includes('아바타를 선택'),'clear retained rotation status');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{current?.dispose();ramp.dispose();renderer.dispose();renderer.forceContextLoss();}
