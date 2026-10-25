import * as THREE from '/vendor/three/three.module.min.js';
import {setupMotionExtras} from '/model-motion-extras.js';
import {createParticleModel} from '/particle-model.js';
import {installDissolve} from '/model-effect-dissolve.js';
const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out');};
try{
  localStorage.removeItem('closers-motion-extras');
  const scene=new THREE.Scene(),root=new THREE.Group();scene.add(root);scene.updateMatrixWorld(true);
  const source={frames:[],meshes:[{name:'effect',frame:-1,vertices:[-1,-1,0,1,-1,0,1,1,0,-1,1,0],indices:[0,1,2,0,2,3],uv:[0,0,1,0,1,1,0,1],skin:[],groups:[[0,6,0]],materials:[{color:[1,1,1,1]}]}],animation:{selected:null}};
  const effect={key:'effect',kind:'effect',label:'effect',state:'',source:'fixture',status:'ready',resources:[{selected:1}],bone:'',offset:[0,0,0],at:0,anim_time:true,follow:true,state_end:true,animation:null,speed:1,loop:false,life:10,color:[1,1,1,1],fades:[],depth_test:true,depth_write:true};
  const packet={clip:{duration:1},extras:[effect]},state={model:{root,bones:[]},clip:packet,time:0,playing:false};
  const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const extras=setupMotionExtras({state,api:async()=>source,getScene:()=>scene,element});extras.select([packet]);
  document.getElementById('show-motion-effects').checked=true;document.getElementById('show-motion-effects').dispatchEvent(new Event('change'));await until(()=>extras.assets.size===1);
  const asset=[...extras.assets.values()][0][0];extras.update();asset.model.meshes[0].renderOrder=1;
  const texture=new THREE.DataTexture(new Uint8Array([255,255,255,0,255,255,255,255]),2,1);texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.needsUpdate=true;
  const material=asset.model.materials[0];material.map=texture;material.needsUpdate=true;
  // Skinned models can sort behind a moving effect even when the effect's
  // transparent texels are in front. A clear texel must never write depth.
  const background=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({color:0xff0000,transparent:true}));background.position.z=-.5;background.renderOrder=2;scene.add(background);
  const renderer=new THREE.WebGLRenderer();renderer.setSize(64,64);document.body.append(renderer.domElement);
  const camera=new THREE.OrthographicCamera(-2,2,2,-2,.1,20);camera.position.z=10;
  const pixel=(x=24)=>{const out=new Uint8Array(4),gl=renderer.getContext();gl.readPixels(x,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);return out;};
  renderer.render(scene,camera);check(pixel()[0]>240&&pixel()[1]<5,'transparent effect texels must not hide the companion model behind them');check(pixel(40)[1]>240,'opaque effect texels remain visible');
  material.opacity=0;renderer.render(scene,camera);check(pixel(40)[0]>240&&pixel(40)[1]<5,'fully faded effects do not occlude other models');
  material.opacity=.02;renderer.render(scene,camera);check(pixel(40)[1]>0,'soft fades remain visible below the old 0.1 alpha cutoff');
  extras.reset();
  const rule={seed:1,max_particles:1,rate:0,instant:1,life:1,emitter_life:1,deaths:1,radius:[0,0,0],radius_min:[0,0,0],gravity:[0,0,0],billboard:'BBT_NONE',blend:['SRCALPHA','INVSRCALPHA'],depth_test:true,depth_write:true,frames:[{duration:1}],tracks:[{property:'size',mode:'initial',value:[2,2,1]}]};
  const particles=createParticleModel(rule,null,[texture]);particles.meshes.forEach(m=>m.renderOrder=1);scene.add(particles.root);const anchor=new THREE.Group();anchor.updateMatrixWorld(true);particles.update(.1,camera,anchor);renderer.render(scene,camera);
  check(pixel()[0]>240&&pixel()[1]<5,'transparent particle texels also preserve companion visibility');
  scene.remove(particles.root);particles.dispose();
  const faded=createParticleModel({...rule,tracks:[...rule.tracks,{property:'color',mode:'initial',value:[1,1,1,0]}]},null,[texture]);faded.meshes.forEach(m=>m.renderOrder=1);scene.add(faded.root);faded.update(.1,camera,anchor);renderer.render(scene,camera);
  check(pixel(40)[0]>240&&pixel(40)[1]<5,'per-particle zero alpha does not write depth');
  scene.remove(faded.root);faded.dispose();
  const noise=new THREE.DataTexture(new Uint8Array([0,0,0,255,255,255,255,255]),2,1);noise.magFilter=noise.minFilter=THREE.NearestFilter;noise.needsUpdate=true;
  const dissolveMaterial=new THREE.MeshBasicMaterial({color:0x00ff00}),dissolvePlane=new THREE.Mesh(new THREE.PlaneGeometry(2,2),dissolveMaterial);dissolvePlane.renderOrder=1;scene.add(dissolvePlane);
  let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const dissolve=installDissolve(dissolveMaterial,noise);dissolve.update([1,1,1,0],.05,1);renderer.render(scene,camera);
  check(pixel()[0]>240&&pixel(40)[0]>240&&!shaderError,'zero dissolve coverage hides the full cube without writing depth');
  dissolve.update([1,1,1,.5],.05,1);renderer.render(scene,camera);check(pixel()[0]>240&&pixel(40)[1]>240,'dissolve mask reveals geometry progressively');
  dissolve.update([1,1,1,1],.05,1);renderer.render(scene,camera);check(pixel()[1]>240&&pixel(40)[1]>240,'full dissolve coverage restores the complete cube');
  dissolvePlane.geometry.dispose();dissolveMaterial.dispose();noise.dispose();texture.dispose();background.geometry.dispose();background.material.dispose();extras.dispose();renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
