import * as THREE from '/vendor/three/three.module.min.js';
import {createTracks,ParticleTimeline} from '/effect-timeline.js';
import {createParticleModel} from '/particle-model.js';
const check=(value,message)=>{if(!value)throw Error(message);};
try{
  const tracks=createTracks([{property:'velocity',mode:'initial',value:[2,0,0]},{property:'size',mode:'initial',value:[1,1,1]},
    {property:'size',mode:'fade',start:0,end:1,value:[3,3,3]}, {property:'color',mode:'final',start:0,value:[1,1,1,0]}],1,2);
  check(tracks.value('size',.5)[0]===2,'timed size interpolation');check(tracks.integral('velocity',2)[0]===4,'velocity integral');
  check(tracks.value('color',1)[3]===.5,'fade final uses particle lifetime');
  const rule={seed:12,max_particles:16,rate:4,instant:2,life:2,emitter_life:1,deaths:0,radius:[0,0,0],radius_min:0,gravity:[0,-1,0],
    billboard:'BBT_SCREEN',depth_test:true,depth_write:false,blend:['SRCALPHA','ONE'],dual:true,frames:[{duration:.1},{duration:.1}],tracks:[
    {property:'size',mode:'initial',value:[2,2,2]}, {property:'velocity',mode:'initial',value:[1,0,0]},
    {property:'color',mode:'final',start:0,value:[1,1,1,0]}]};
  const timeline=new ParticleTimeline(rule),expected=JSON.stringify(timeline.at(.5));
  check(timeline.at(.5).length===4,'continuous and instant emissions');timeline.at(2);check(JSON.stringify(timeline.at(.5))===expected,'seeking is deterministic');
  check(timeline.at(4).length===0,'finite emitter and particles expire');
  const oneShot=new ParticleTimeline({...rule,max_particles:1,rate:100,instant:0,life:1,emitter_life:100,deaths:1,frames:[{duration:.2},{duration:.2},{duration:.2}],tracks:[{property:'velocity',mode:'initial',value:[1,0,0]}]});
  const single=oneShot.at(.55);check(single.length===1&&single[0].position[0]>.5&&single[0].frame===2,'full emitter keeps the first particle and advances its animation');
  check(oneShot.at(2).length===0,'die count stops high-rate one-shot emitters after the particle dies');
  check(JSON.stringify(oneShot.at(.55))===JSON.stringify(single),'capped emitter rewinds deterministically');
  const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(64,64);document.body.append(renderer.domElement);
  let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.z=10;
  const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
  const model=createParticleModel(rule,null,[white,white]);scene.add(model.root);scene.updateMatrixWorld(true);
  const anchor=new THREE.Group();anchor.updateMatrixWorld(true);model.update(.5,camera,anchor);renderer.render(scene,camera);
  check(!shaderError,'particle opacity and UV shaders compile');check(renderer.info.render.calls>0,'instanced dual-pass particles draw');
  const gl=renderer.getContext(),pixels=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  check(pixels.some((v,i)=>i%4!==3&&v>0),'particles produce visible pixels');
  let disposed=0;model.meshes[0].geometry.addEventListener('dispose',()=>disposed++);model.dispose();check(disposed===1,'particle geometry cleanup');white.dispose();renderer.dispose();
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
