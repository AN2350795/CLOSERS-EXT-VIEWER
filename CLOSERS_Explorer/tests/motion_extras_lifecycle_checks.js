import * as THREE from '/vendor/three/three.module.min.js';
import {setupMotionExtras} from '/model-motion-extras.js';
import {buildModel} from '/model-core.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve,entered:false};};
const sceneGates=new Map(),metadataGates=new Map(),decodeGates=new Map(),maps=[],calls=[],decodes=[];
const originalLoad=THREE.TextureLoader.prototype.loadAsync,originalAudio=window.AudioContext;
let extras,renderer,fx,avatar,audioContexts=0;
try{
  localStorage.setItem('closers-motion-extras',JSON.stringify({models:true,effects:true,colors:true}));
  window.AudioContext=class {constructor(){audioContexts++;}async close(){}};
  THREE.TextureLoader.prototype.loadAsync=async function(url){
    const id=Number(url.match(/composition-image\/(\d+)/)[1]);decodes.push(id);
    const pending=decodeGates.get(id);if(pending){pending.entered=true;await pending.promise;}
    const texture=new THREE.DataTexture(new Uint8Array([255,128,64,255]),1,1);texture.needsUpdate=true;
    const record={texture,disposed:0};texture.addEventListener('dispose',()=>record.disposed++);maps.push(record);return texture;
  };
  avatar=buildModel({frames:[],meshes:[{name:'avatar',frame:-1,vertices:[-.8,-.7,0,.8,-.7,0,0,.8,0],indices:[0,1,2],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,1,1,1]}]}]});
  const scene=new THREE.Scene(),root=avatar.root,material=avatar.materials[0],mesh=avatar.meshes[0];root.scale.z=1;
  mesh.userData.part='WEAPON';scene.add(root);scene.updateMatrixWorld(true);
  const state={model:avatar,clip:null,time:.2,playing:false};
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,preserveDrawingBuffer:true});renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.setSize(96,64);renderer.setClearColor(0,0);
  const gl=renderer.getContext(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);fx=createEmissionRenderer(renderer);
  const options={bloom:true,bloomMode:'source',colorGrading:{enabled:true,rgb:[.7,.8,.6],bcs:[-.1,.15,.8]},sharpen:{enabled:true,radius:1.55},dof:{enabled:true,focus:4,range:4,strength:.65}};
  const read=()=>{fx.render(scene,camera,state.model,options);const pixels=new Uint8Array(96*64*4);gl.readPixels(0,0,96,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
  const baseline=read(),memory={...renderer.info.memory};
  check(baseline.some((v,i)=>i%4===3&&v>0),'baseline avatar must render visible pixels');
  const unchanged=()=>{const actual=read();check(actual.every((v,i)=>v===baseline[i]),'cancelled extras changed the postprocessed avatar frame');check(renderer.info.memory.textures===memory.textures&&renderer.info.memory.geometries===memory.geometries,'cancelled extras retained GPU textures/geometry');};
  const common={state:'S',source:'fixture.LUA',status:'ready',conditions:{},bone:'',offset:[0,0,0],rotation:[0,0,0],scale:1,at:0,anim_time:true,follow:false,state_end:true,animation:null,speed:1,loop:false,life:10,color:[1,1,1,1],fades:[],depth_test:true,depth_write:true};
  const prop=(id,key=String(id))=>({...common,key,kind:'model',label:key,resources:[{selected:id,name:'fixture.X'}]});
  const packet=entries=>({clip:{duration:2},extras:entries});
  const api=async (url,signal)=>{
    calls.push({url,signal});
    if(url.startsWith('/api/model-scene')){
      const id=Number(new URL(url,location.href).searchParams.get('entries')),pending=sceneGates.get(id);
      if(pending){pending.entered=true;await pending.promise;}
      return {frames:[],meshes:[{name:'fixture',frame:-1,vertices:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],uv:[0,0,1,0,0,1],skin:[],groups:[[0,3,0]],materials:[{color:[1,1,1,1],image:{selected:id+100}}]}]};
    }
    if(url.startsWith('/api/composition-source/')){
      const id=Number(url.split('/').at(-1)),pending=metadataGates.get(id);
      if(pending){pending.entered=true;await pending.promise;}
      return {width:1,height:1,image_sha256:String(id)};
    }
    throw Error('Unexpected API '+url);
  };
  extras=setupMotionExtras({state,api,getScene:()=>scene,element});
  const active=packet([prop(1),{...common,key:'color',kind:'color',color:[1,.3,.4,.5],transition:0,emissive:0},{...common,key:'equipment',kind:'equipment',part:'WEAPON',until:1}]);
  state.clip=active;await extras.select([active]);extras.update();
  check(extras.assets.size===1&&extras.meshes.length===1&&!mesh.visible&&material.opacity===.5,'loaded extras apply visibility and color');
  read();
  const asset=[...extras.assets.values()][0][0];let geometryDisposals=0;asset.model.meshes[0].geometry.addEventListener('dispose',()=>geometryDisposals++);
  extras.reset();check(mesh.visible&&material.opacity===1&&material.color.getHex()===0xffffff&&!material.transparent,'reset restores avatar material and equipment');
  check(scene.children.length===1&&geometryDisposals===1&&maps[0].disposed===1,'reset removes anchors and disposes resources once');
  unchanged();

  const older=gate(),newer=gate();sceneGates.set(10,older);sceneGates.set(11,newer);
  const oldLoad=extras.select([packet([prop(10)])]);await until(()=>older.entered);
  const newLoad=extras.select([packet([prop(11,'latest')])]);await until(()=>newer.entered);
  older.resolve();await oldLoad;
  check(extras.loading&&!extras.assets.size&&calls.find(c=>c.url.endsWith('entries=10')).signal.aborted,'stale response cannot clear newer loading state');
  newer.resolve();await newLoad;check(extras.assets.has('0:latest')&&!extras.loading,'only newest selection is retained');extras.reset();unchanged();

  const metadata=gate();metadataGates.set(120,metadata);
  const metadataLoad=extras.select([packet([prop(20)])]);await until(()=>metadata.entered);extras.reset();
  const decodeCount=decodes.length;metadata.resolve();await metadataLoad;
  check(decodes.length===decodeCount,'cancelled metadata must not start a new texture decode');
  check(!extras.loading&&!extras.assets.size&&scene.children.length===1,'metadata cancellation leaves no anchors');
  unchanged();

  const decode=gate();decodeGates.set(121,decode);
  const decodeLoad=extras.select([packet([prop(21)])]);await until(()=>decode.entered);extras.reset();decode.resolve();await decodeLoad;
  check(maps.at(-1).disposed===1&&!extras.assets.size&&!extras.loading,'late decoded texture is disposed exactly once');
  unchanged();

  const closing=gate();metadataGates.set(130,closing);
  const closingLoad=extras.select([packet([prop(30)])]);await until(()=>closing.entered);extras.dispose();extras.dispose();
  const closingDecodes=decodes.length;closing.resolve();await closingLoad;
  check(decodes.length===closingDecodes,'shutdown prevents delayed metadata from decoding');
  const requestCount=calls.length;await extras.select([packet([prop(31)])]);extras.unlockAudio();extras.setBusy(false);extras.update();
  check(calls.length===requestCount&&audioContexts===0&&!extras.loading&&!extras.assets.size&&document.getElementById('motion-extras-settings').disabled,'disposed extras cannot load, unlock audio, or enable controls');
  check(maps.every(record=>record.disposed===1),'all acquired textures are disposed once');
  unchanged();check(gl.getError()===gl.NO_ERROR,'WebGL error after extras lifecycle checks');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{
  for(const pending of [...sceneGates.values(),...metadataGates.values(),...decodeGates.values()])pending.resolve();
  extras?.dispose();fx?.dispose();avatar?.dispose();renderer?.dispose();THREE.TextureLoader.prototype.loadAsync=originalLoad;window.AudioContext=originalAudio;
}
