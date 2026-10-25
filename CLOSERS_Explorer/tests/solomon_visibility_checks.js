import * as THREE from '/vendor/three/three.module.min.js';
import {setupMotionExtras} from '/model-motion-extras.js';
import {MotionSequencePlayer} from '/motion-sequence-player.js';
const check=(value,message)=>{if(!value)throw Error(message);};
try{
  localStorage.setItem('closers-motion-extras',JSON.stringify({effects:true}));
  const scene=new THREE.Scene(),root=new THREE.Group();root.scale.z=-1;scene.add(root);scene.updateMatrixWorld(true);
  const packets=solomonFixture.clips,definition={steps:packets.map(p=>({state:p.extras[0].state,speed:1,start_time:0,cancel_time:.2})),loop_index:1,end_index:2};
  const sequence=new MotionSequencePlayer(definition,packets),state={model:{root,bones:[]},clip:sequence.clip,time:0,sequence,playing:true};
  const api=async url=>{
    if(url.startsWith('/api/model-scene'))return solomonFixture.scene;
    if(url.startsWith('/api/model-animations'))return solomonFixture.metadata;
    if(url.startsWith('/api/model-clip'))return solomonFixture.own[Number(new URL(url,location.href).searchParams.get('clip'))];
    throw Error('Unexpected API '+url);
  };
  const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const extras=setupMotionExtras({state,api,getScene:()=>scene,element});extras.select(packets,definition.steps);
  for(let i=0;i<500&&extras.assets.size!==3;i++)await new Promise(r=>setTimeout(r,5));
  check(extras.assets.size===3,'all three real Harpy summon animation stages load');
  const maps=[];
  for(const encoded of solomonFixture.images){
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
    try{const texture=await new THREE.TextureLoader().loadAsync(url);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;maps.push(texture);}finally{URL.revokeObjectURL(url);}
  }
  for(const group of extras.assets.values())group[0].model.materials.forEach((m,i)=>{m.map=maps[i];m.needsUpdate=true;});
  const renderer=new THREE.WebGLRenderer();renderer.setSize(96,96);document.body.append(renderer.domElement);
  const camera=new THREE.PerspectiveCamera(40,1,.1,2000);camera.position.set(0,160,900);camera.lookAt(0,150,0);
  const gl=renderer.getContext(),pixels=new Uint8Array(96*96*4);let loops=0,lastTime=0,loopFrames=0;
  for(let frame=0;frame<220;frame++){
    sequence.advance(.1);state.clip=sequence.clip;state.time=sequence.time;extras.update(.1);renderer.render(scene,camera);
    if(sequence.index===1){
      if(sequence.time<lastTime)loops++;lastTime=sequence.time;loopFrames++;
      const active=[...extras.assets.values()].find(g=>g[0].packet===state.clip)[0];check(active.anchor.visible&&active.model.materials.every(m=>m.opacity>0),'summon stays enabled throughout the loop');
      gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,pixels);check(pixels.some((v,i)=>i%4!==3&&v>8),'real summon remains visible at loop time '+sequence.time);
    }
  }
  check(loops>=2&&loopFrames>100,'real Harpy summon crosses multiple complete loop boundaries');
  sequence.requestFinish();for(let i=0;i<30&&!sequence.completed;i++){sequence.advance(.1);state.clip=sequence.clip;state.time=sequence.time;extras.update(.1);renderer.render(scene,camera);}
  check(sequence.completed,'summon exit animation completes');extras.dispose();maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
