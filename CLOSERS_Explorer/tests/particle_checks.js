import * as THREE from '/vendor/three/three.module.min.js';
import {createTracks,ParticleTimeline} from '/effect-timeline.js';
import {createParticleModel} from '/particle-model.js';
import {chooseTextureSequence} from '/model-texture-animation.js';
const check=(value,message)=>{if(!value)throw Error(message);};
try{
  const packet={clip:{name:'CASH_RARE_7_EMOTION'},skeleton_source:{name:'MOTION_KNIVES.X'}};
  const material={texture_animation_choices:[{name:'TEX_RARE_7_KNIVES_WIN_BIKE',characters:['KNIVES']},{name:'TEX_RARE_7_KNIVES_EMOTION_BIKE',characters:['KNIVES']},{name:'TEX_RARE_7_NONAME_EMOTION_BIKE',characters:['NONAME']}]};
  check(chooseTextureSequence(material,packet)?.name==='TEX_RARE_7_KNIVES_EMOTION_BIKE','shared first texture selects the matching character and activity');
  check(!chooseTextureSequence(material,{...packet,skeleton_source:{name:'MOTION_ROGUE.X'}}),'another character material sequence is not silently applied');
  check(!chooseTextureSequence({}, {clip:{duration:1}}),'unanimated and legacy packets need no texture context');
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
  scene.remove(model.root);
  const dissolve=createParticleModel({...rule,dual:false,rate:0,instant:1,max_particles:1,life:2,billboard:'BBT_NONE',tracks:[
    {property:'size',mode:'initial',value:[4,4,4]},
    {property:'dissolveThreshold',mode:'initial',value:[1,1]},
    {property:'dissolveThreshold',mode:'fade',start:0,end:1,value:[1,0]}]},null,[white],{dissolveMap:white});
  scene.add(dissolve.root);scene.updateMatrixWorld(true);
  const coverage=time=>{dissolve.update(time,camera,anchor);renderer.render(scene,camera);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels.filter((v,i)=>i%4!==3&&v>0).length;};
  check(coverage(0)>0&&!shaderError,'instanced dissolve composes with opacity and UV shaders');
  check(coverage(1)===0,'the second threshold component dissolves the particle at the end');
  check(coverage(0)>0,'dissolve rewinds and restores visible pixels');
  scene.remove(dissolve.root);dissolve.dispose();
  const maskBytes=new Uint8Array(16*16*4);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){const i=(y*16+x)*4;maskBytes.set([255,255,255,(x-7.5)**2+(y-7.5)**2<36?255:0],i);}
  const mask=new THREE.DataTexture(maskBytes,16,16);mask.needsUpdate=true;
  const projection=new THREE.Matrix4().makeScale(.25,.25,1);
  const traced=createParticleModel({...rule,dual:false,rate:0,instant:1,max_particles:1,life:2,billboard:'BBT_NONE',cull:'CON_D3DCULL_NONE',blend:['SRCALPHA','ONE'],tracks:[{property:'size',mode:'initial',value:[4,4,4]}]},null,[white],{traceMask:{map:mask,projection}});
  scene.add(traced.root);scene.updateMatrixWorld(true);traced.update(.1,camera,anchor);renderer.render(scene,camera);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const rgb=(x,y)=>pixels.slice((y*64+x)*4,(y*64+x)*4+3).some(v=>v>0);
  check(!shaderError&&rgb(32,32)&&!rgb(20,20),'projected trace mask keeps the center and clips the opaque square corners');
  camera.position.z=-10;camera.lookAt(0,0,0);renderer.render(scene,camera);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  check(rgb(32,32)&&!rgb(20,20),'two-sided trace mask also clips square corners from below');
  scene.remove(traced.root);traced.dispose();mask.dispose();
  const coverageBytes=maskBytes.slice();
  for(let i=0;i<coverageBytes.length;i+=4){const value=coverageBytes[i+3];coverageBytes.set([value,value,value,255],i);}
  const coverageMask=new THREE.DataTexture(coverageBytes,16,16);coverageMask.needsUpdate=true;
  const covered=createParticleModel({...rule,dual:false,rate:0,instant:1,max_particles:1,life:2,billboard:'BBT_NONE',tracks:[
    {property:'size',mode:'initial',value:[4,4,4]},{property:'uv',mode:'initial',value:[.37,.37]}]},null,[white],{coverageMap:coverageMask});
  camera.position.z=10;camera.lookAt(0,0,0);scene.add(covered.root);scene.updateMatrixWorld(true);covered.update(.3,camera,anchor);renderer.render(scene,camera);
  gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  check(!shaderError&&rgb(32,32)&&!rgb(20,20),'grayscale coverage mask clips corners independently of animated color UVs and opaque texture alpha');
  covered.dispose();coverageMask.dispose();
  let disposed=0;model.meshes[0].geometry.addEventListener('dispose',()=>disposed++);model.dispose();check(disposed===1,'particle geometry cleanup');white.dispose();renderer.dispose();
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
