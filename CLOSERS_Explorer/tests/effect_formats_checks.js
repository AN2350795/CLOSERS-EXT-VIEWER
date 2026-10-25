import * as THREE from '/vendor/three/three.module.min.js';
import {createFBXModel,createSpineModel} from '/model-effect-formats.js';
import {createParticleModel} from '/particle-model.js';
import {setupMotionExtras} from '/model-motion-extras.js';
const check=(value,message)=>{if(!value)throw Error(message);};
try{
  const renderer=new THREE.WebGLRenderer();renderer.setSize(128,128);document.body.append(renderer.domElement);
  let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,100000),anchor=new THREE.Group();
  const fit=root=>{root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());camera.position.copy(center).add(new THREE.Vector3(0,0,Math.max(...size.toArray())*2+1));camera.lookAt(center);camera.updateMatrixWorld(true);};
  const image=document.createElement('canvas');image.width=image.height=4;const context=image.getContext('2d');context.fillStyle='white';context.fillRect(0,0,4,4);
  const texture=new THREE.CanvasTexture(image);texture.needsUpdate=true;
  const rule={seed:1,max_particles:3,rate:3,instant:0,emitter_life:10,deaths:0,life:1,radius:[0,0,0],radius_min:[0,0,0],gravity:[0,0,0],billboard:'BBT_NONE',blend:['SRCALPHA','INVSRCALPHA'],frames:[{duration:1}],tracks:[]};
  const fbx=await createFBXModel(effectFixture.fbx);check(fbx.meshes.length>0,'real binary FBX geometry');
  const particles=createParticleModel(rule,fbx,[texture]);scene.add(particles.root);anchor.updateMatrixWorld(true);particles.update(.5,camera,anchor);fit(particles.root);renderer.render(scene,camera);
  check(renderer.info.render.calls>0&&!shaderError,'FBX instanced particles render');scene.remove(particles.root);particles.dispose();
  for(const packet of effectFixture.other_fbx){
    const source=await createFBXModel(packet),model=createParticleModel(rule,source,[texture]);scene.add(model.root);model.update(.5,camera,anchor);fit(model.root);renderer.render(scene,camera);
    check(renderer.info.render.calls>0&&!shaderError,'FBX particle renders: '+packet.source.name);scene.remove(model.root);model.dispose();
  }
  const spineRule={seed:1,depth_test:true,depth_write:false,spine:{clipping:'EMOTION',position:[0,0,0],scale:[1,1,1],rotation:[0,0,0],events:[{name:'MIX01',at:0,speed:1}]}};
  const spine=await createSpineModel(spineRule,effectFixture.skel,effectFixture.atlas,effectFixture.atlas.images.map(()=>texture));scene.add(spine.root);
  spine.update(2);fit(spine.root);renderer.render(scene,camera);check(spine.meshes.length>0&&renderer.info.render.calls>0&&!shaderError,'real Spine 4.2 skeleton with weighted mesh, clipping and animation renders');
  check(spine.meshes.reduce((n,m)=>n+m.geometry.drawRange.count,0)>24,'emotion preview shows the character beyond the login portrait mask');
  const gl=renderer.getContext(),pixels=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,pixels);check(pixels.some((v,i)=>i%4!==3&&v>0),'Spine produces visible pixels');
  const snapshot=()=>spine.meshes.map(m=>{const g=m.geometry,p=g.getAttribute('position');return Array.from(g.index.array.slice(0,g.drawRange.count),i=>[p.getX(i),p.getY(i),p.getZ(i)]);});
  const before=JSON.stringify(snapshot());spine.update(4);check(JSON.stringify(snapshot())!==before,'Spine animation deforms geometry');
  spine.update(2);check(JSON.stringify(snapshot())===before,'backward seek restores the same Spine pose');
  let disposed=0;spine.meshes[0].geometry.addEventListener('dispose',()=>disposed++);scene.remove(spine.root);spine.dispose();check(disposed===1,'Spine batch geometry is released');
  for(const fixture of effectFixture.others){
    const model=await createSpineModel(fixture.rule,fixture.skel,fixture.atlas,fixture.atlas.images.map(()=>texture));model.update(.2);scene.add(model.root);fit(model.root);renderer.render(scene,camera);
    check(model.vertices>24&&!shaderError,'complete Spine preview for '+fixture.rule.spine.name);scene.remove(model.root);model.dispose();
  }
  localStorage.removeItem('closers-motion-extras');
  const common={kind:'particle',state:'',status:'ready',source:'fixture',error:'',bone:'',offset:[0,0,0],rotation:[0,0,0],at:0,anim_time:true,follow:true,state_end:true,life:100,speed:1,animation:null,color:[1,1,1,1],fades:[]};
  const packet={clip:{duration:10},extras:[{...common,key:'spine',label:'Spine',particle:spineRule,resources:[],images:[],spine_sources:[{selected:1},{selected:2}]},
    {...common,key:'fbx',label:'FBX',particle:rule,resources:[{name:'FX.FBX',selected:3}],images:[]}]};
  const actor=new THREE.Group();scene.add(actor);scene.updateMatrixWorld(true);
  const state={model:{root:actor,bones:[]},clip:packet,time:2,playing:false};
  const api=async url=>{
    if(url.includes('model-effect-resource'))return url.endsWith('=3')?effectFixture.fbx:effectFixture.skel;
    if(url.includes('model-spine-atlas'))return {...effectFixture.atlas,images:effectFixture.atlas.images.map(i=>({...i,selected:71}))};
    if(url.includes('composition-source'))return {image_sha256:'fixture',width:4,height:4};
    throw Error('Unexpected API '+url);
  };
  const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  let framed=0;const extras=setupMotionExtras({state,api,getScene:()=>scene,getCamera:()=>camera,onVisible:()=>framed++,element});extras.select([packet]);
  document.getElementById('show-motion-effects').checked=true;document.getElementById('show-motion-effects').dispatchEvent(new Event('change'));
  for(let i=0;i<400&&extras.assets.size!==2;i++)await new Promise(r=>setTimeout(r,5));
  check(extras.assets.size===2,'both formats load through the motion extras controller: '+document.getElementById('motion-extra-items').textContent);
  extras.update();check([...extras.assets.values()].every(group=>group[0].anchor.visible),'both formats synchronize with the actor timeline');check(framed===1,'newly visible effects request camera framing');extras.update();check(framed===1,'continuing effects preserve the user camera');
  extras.seek();state.time=0;extras.update();extras.reset();check(!extras.assets.size&&scene.children.length===1,'motion reset releases both new formats');extras.dispose();texture.dispose();renderer.dispose();
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
