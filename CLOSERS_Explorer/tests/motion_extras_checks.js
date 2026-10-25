import * as THREE from '/vendor/three/three.module.min.js';
import {setupMotionExtras} from '/model-motion-extras.js';
const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
const $=id=>document.getElementById(id),element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
try{
  localStorage.removeItem('closers-motion-extras');
  const scene=new THREE.Scene(),root=new THREE.Group(),bone=new THREE.Bone();root.scale.z=-1;bone.name='HAND';bone.position.x=2;root.add(bone);scene.add(root);scene.updateMatrixWorld(true);
  const common={state:'S1',source:'state.LUA',status:'ready',error:'',bone:'HAND',offset:[3,0,0],at:0,anim_time:true,follow:true,state_end:true,animation:null,speed:1,loop:false,life:10,color:[1,1,1,1],fades:[],additive:false,depth_test:true,depth_write:true};
  const prop={...common,key:'prop',kind:'model',label:'휴대폰',resources:[{selected:10}]};
  const effect={...common,key:'fx',kind:'effect',label:'효과',animation:'FX',at:.2,state_end:false,resources:[{selected:11}],fades:[{start:0,end:1,color:[1,1,1,0]}]};
  const packet={clip:{duration:1},extras:[prop,effect],extras_index_available:true},state={model:{root,bones:[bone]},clip:packet,time:0,playing:false};
  let release,defer=false,loadedAnimation=false;
  const api=async url=>{
    if(url.startsWith('/api/model-scene')){
      if(defer)await new Promise(r=>release=r);
      const id=Number(new URL(url,location.href).searchParams.get('entries'));
      return {frames:[],meshes:[{name:'prop',frame:-1,vertices:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,1,1,1]}]}],skeleton_source:{sha256:'resource'},animation:{selected:id===11?8:null}};
    }
    if(url.startsWith('/api/model-animations'))return {skeleton_source:{sha256:'resource'},animation_source:{sha256:'fx'},clips:[{index:0,name:'FX',duration:1}]};
    if(url.startsWith('/api/model-clip')){loadedAnimation=true;return {skeleton_source:{sha256:'resource'},clip:{duration:1},keys:[],mapping:{frames:[]}};}
    throw Error('Unexpected API '+url);
  };
  const extras=setupMotionExtras({state,api,getScene:()=>scene,element});extras.select([packet]);
  check(extras.assets.size===0,'motion extras are opt-in');
  $('show-motion-props').checked=true;$('show-motion-props').dispatchEvent(new Event('change'));await until(()=>extras.assets.size===1);
  let asset=[...extras.assets.values()][0][0];let disposed=0;asset.model.meshes[0].geometry.addEventListener('dispose',()=>disposed++);
  extras.update();scene.updateMatrixWorld(true);check(asset.anchor.visible&&asset.anchor.matrixWorld.elements[12]===5,'prop uses the declared bone and offset');
  bone.position.x=4;scene.updateMatrixWorld(true);extras.update();scene.updateMatrixWorld(true);check(asset.anchor.matrixWorld.elements[12]===7,'prop follows moving bones');
  $('show-motion-props').checked=false;$('show-motion-props').dispatchEvent(new Event('change'));await until(()=>!extras.assets.size);check(disposed===1,'disabling props disposes GPU geometry');
  $('show-motion-effects').checked=true;$('show-motion-effects').dispatchEvent(new Event('change'));await until(()=>extras.assets.size===1);asset=[...extras.assets.values()][0][0];
  extras.update();check(!asset.anchor.visible&&loadedAnimation,'effect prepares its own verified clip and waits for event time');
  state.playing=true;state.time=.3;extras.update(.3);check(asset.anchor.visible&&asset.model.materials[0].opacity<1,'effect appears at its event time and fades');
  const opacity=asset.model.materials[0].opacity;state.time=.7;extras.update(.4);check(asset.model.materials[0].opacity<opacity,'effect timeline progresses');
  state.playing=false;state.time=.1;extras.seek();extras.update();check(!asset.anchor.visible,'seeking before an event hides it');
  const next={clip:{duration:1},extras:[]};extras.select([packet,next],[{state:'S1',speed:1},{state:'S2',speed:1}]);await until(()=>extras.assets.size===1);
  asset=[...extras.assets.values()][0][0];state.clip=packet;state.time=.3;state.playing=true;extras.update(.3);state.clip=next;state.time=0;extras.update(.1);
  check(asset.anchor.visible,'effects without state-end cleanup can continue across sequence stages');
  defer=true;release=null;$('show-motion-props').checked=true;$('show-motion-props').dispatchEvent(new Event('change'));await until(()=>release);
  extras.reset();release();await new Promise(r=>setTimeout(r,40));check(!extras.assets.size&&scene.children.length===1,'old resource loads cannot reappear after reset');
  extras.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
