import * as THREE from '/vendor/three/three.module.min.js';
import {buildModel,applyPose} from '/model-core.js';
import {setupMotionExtras} from '/model-motion-extras.js';
import {MotionSequencePlayer} from '/motion-sequence-player.js';
const check=(value,message)=>{if(!value)throw Error(message);};
try{
  localStorage.setItem('closers-motion-extras',JSON.stringify({effects:true,models:true}));
  const scene=new THREE.Scene(),model=buildModel(cubeFixture.actor);scene.add(model.root);
  const weapon=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());weapon.userData.part='WEAPON';model.root.add(weapon);model.meshes.push(weapon);
  const textures=new Map(),loader=new THREE.TextureLoader(),original=THREE.TextureLoader.prototype.loadAsync;
  for(const [id,image] of Object.entries(cubeFixture.images)){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(image.body),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{textures.set(Number(id),await loader.loadAsync(url));}finally{URL.revokeObjectURL(url);}
  }
  THREE.TextureLoader.prototype.loadAsync=async function(url){const match=url.match(/composition-image\/(\d+)/);return match?textures.get(Number(match[1])).clone():original.call(this,url);};
  const packets=cubeFixture.clips,sequence=new MotionSequencePlayer(cubeFixture.definition,packets),state={model,sequence,clip:sequence.clip,time:0,playing:false};
  const api=async url=>{
    if(url.startsWith('/api/model-scene'))return cubeFixture.scenes[Number(new URL(url,location.href).searchParams.get('entries'))];
    if(url.startsWith('/api/composition-source/'))return cubeFixture.images[Number(url.split('/').at(-1))];
    throw Error('Unexpected API '+url);
  };
  const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const extras=setupMotionExtras({state,api,getScene:()=>scene,element});extras.select(packets,cubeFixture.definition.steps);
  const expected=packets.flatMap(p=>p.extras).filter(e=>e.status==='ready'&&e.kind!=='equipment').length;
  for(let i=0;i<600&&extras.assets.size!==expected;i++)await new Promise(r=>setTimeout(r,5));
  check(extras.assets.size===expected,'all cube-chair props, models and particles prepare: '+document.getElementById('motion-extra-items').textContent);
  const assets=[...extras.assets.values()].flat(),initial=packets[0].extras;
  const assetFor=label=>{const entry=initial.find(e=>e.label===label);return extras.assets.get('0:'+entry.key)[0];};
  const stable=assetFor('DE_COMMON_EMOTION_GOMORI_CUBE_SIT_START_NEW_2'),light=assetFor('DE_COMMON_EMOTION_GOMORI_CUBE_SIT_START_NEW_LIGHT'),dissolve=assetFor('DE_COMMON_EMOTION_GOMORI_CUBE_SIT_START_NEW_1');
  const seek=time=>{sequence.seek(time);state.time=sequence.time;state.clip=sequence.clip;applyPose(model,state.clip,state.time);scene.updateMatrixWorld(true);extras.seek();extras.update();};
  seek(.3);check(stable.anchor.visible,'slow-motion seek activates the cube at 0.46 seconds of real time');check(!weapon.visible,'cube-chair state hides equipped weapons');
  check(Math.abs(new THREE.Vector3().setFromMatrixScale(light.anchor.matrix).x-.4)<1e-6,'cube glow uses the source 0.4 scale');
  check(dissolve.dissolve?.length>0,'the real cube dissolve mask is bound to the effect materials');
  seek(.01);check(!stable.anchor.visible&&!dissolve.anchor.visible,'seeking before creation hides both cube models');
  seek(.15);check(dissolve.anchor.visible&&!stable.anchor.visible,'progressive cube appears before the solid cube');
  const renderer=new THREE.WebGLRenderer();renderer.setSize(96,96);document.body.append(renderer.domElement);let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const camera=new THREE.PerspectiveCamera(40,1,.1,3000);camera.position.set(0,130,650);camera.lookAt(0,70,0);
  const gl=renderer.getContext(),pixels=new Uint8Array(96*96*4);state.playing=true;let loopFrames=0,wraps=0,lastTime=0;
  for(let i=0;i<170;i++){
    sequence.advance(.1);state.clip=sequence.clip;state.time=sequence.time;applyPose(model,state.clip,state.time);scene.updateMatrixWorld(true);extras.update(.1);renderer.render(scene,camera);
    check(!weapon.visible&&!shaderError,'cube animation, weapon visibility and shaders remain valid');
    if(sequence.index===1){loopFrames++;if(sequence.time<lastTime)wraps++;lastTime=sequence.time;check(assets.some(a=>a.packet===state.clip&&a.anchor.visible),'cube remains present in the loop');gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,pixels);check(pixels.some((v,i)=>i%4!==3&&v>8),'real cube remains rendered throughout the loop');}
  }
  check(loopFrames>100&&wraps>=2,'cube chair survives multiple slow-motion loops');
  sequence.requestFinish();for(let i=0;i<35&&!sequence.completed;i++){sequence.advance(.1);state.clip=sequence.clip;state.time=sequence.time;applyPose(model,state.clip,state.time);scene.updateMatrixWorld(true);extras.update(.1);renderer.render(scene,camera);}
  check(sequence.completed&&!shaderError,'cube-chair exit and dissolve complete');
  sequence.restart();state.clip=sequence.clip;state.time=sequence.time;extras.seek();extras.update();check(!stable.anchor.visible,'returning to selection clears end effects and prepares the intro');
  extras.reset();check(weapon.visible,'leaving cube chair restores equipment visibility');extras.dispose();model.dispose();weapon.geometry.dispose();weapon.material.dispose();textures.forEach(t=>t.dispose());renderer.dispose();THREE.TextureLoader.prototype.loadAsync=original;document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
