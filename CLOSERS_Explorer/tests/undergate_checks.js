import * as THREE from '/vendor/three/three.module.min.js';
import {buildModel,applyPose} from '/model-core.js';
import {setupMotionExtras} from '/model-motion-extras.js';
import {MotionSequencePlayer} from '/motion-sequence-player.js';
const check=(value,message)=>{if(!value)throw Error(message);};
try{
  localStorage.setItem('closers-motion-extras',JSON.stringify({effects:true,models:true}));
  const data=christmasFixture,textures=new Map(),loader=new THREE.TextureLoader(),original=THREE.TextureLoader.prototype.loadAsync;
  for(const [id,image] of Object.entries(data.images)){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(image.body),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{textures.set(Number(id),await loader.loadAsync(url));}finally{URL.revokeObjectURL(url);}
  }
  THREE.TextureLoader.prototype.loadAsync=async function(url){const match=url.match(/composition-image\/(\d+)/);return match?textures.get(Number(match[1])).clone():original.call(this,url);};
  const api=async url=>{
    const params=new URL(url,location.href).searchParams,id=Number(params.get('skeleton'));
    if(url.startsWith('/api/model-scene'))return data.scenes[Number(params.get('entries'))];
    if(url.startsWith('/api/composition-source/'))return data.images[Number(url.split('/').at(-1))];
    const packet=url.startsWith('/api/model-animations')?data.metadata[id]:url.startsWith('/api/model-effect-clip')?data.embedded[id+':'+params.get('name')]:data.own[id+':'+params.get('clip')];
    if(!packet)throw Error('No matching source animation');return packet;
  };
  const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  window.testCaptures=[];
  const renderer=new THREE.WebGLRenderer();renderer.setSize(384,384);document.body.append(renderer.domElement);let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const camera=new THREE.PerspectiveCamera(40,1,.1,4000);camera.position.set(400,250,1200);camera.lookAt(0,150,0);
  for(const test of data.cases){
    const scene=new THREE.Scene(),model=buildModel(test.actor);scene.background=new THREE.Color(0x404650);scene.add(model.root);
    const sequence=new MotionSequencePlayer(test.definition,test.clips),state={model,sequence,clip:sequence.clip,time:0,playing:false};
    const extras=setupMotionExtras({state,api,getScene:()=>scene,getCamera:()=>camera,element});extras.select(test.clips,test.definition.steps);
    const expected=test.clips.flatMap(p=>p.extras).filter(e=>e.status==='ready'&&e.kind!=='equipment').length;
    for(let i=0;i<600&&extras.assets.size!==expected;i++)await new Promise(r=>setTimeout(r,5));
    check(extras.assets.size===expected,'all Underworld Gate models load: '+document.getElementById('motion-extra-items').textContent);
    check([...extras.assets.values()].flat().reduce((n,a)=>n+a.vertices,0)<1_000_000,'all stages fit the corrected render budget');
    for(let index=0;index<3;index++)for(const fraction of [.25,.75]){
      sequence.index=index;sequence.seek(test.clips[index].clip.duration*fraction);state.clip=sequence.clip;state.time=sequence.time;applyPose(model,state.clip,state.time);scene.updateMatrixWorld(true);extras.seek();extras.update();renderer.render(scene,camera);
      window.testCaptures.push({name:'gate_'+test.character+'_'+index+'_'+fraction,body:renderer.domElement.toDataURL('image/png')});
      const entry=state.clip.extras.find(e=>e.kind==='particle'&&e.models?.includes('XE_REAPER_RARE_8_ASTART_UNDERGATE.X'));
      const gate=entry&&extras.assets.get(index+':'+entry.key)[0];
      if(gate)check(gate.model.meshes.every(m=>m.geometry.hasAttribute('particleDissolveParams')),'gate mask and per-particle threshold are installed');
      if(test.character==='BEAST'&&index===1){
        const animated=[...extras.assets.values()].flat().filter(a=>a.packet===state.clip&&a.embedded);
        check(animated.some(a=>a.embedded.clip.name==='XE_BEAST_RARE_8_EMOTION_HANDFAN_LOOP')&&animated.some(a=>a.embedded.clip.name==='XE_BEAST_RARE_8_EMOTION_SPIRIT_LOOP'),'both Luna models with duplicated bone names animate');
      }
      check(!shaderError,'Underworld Gate shaders compile');
    }
    extras.dispose();model.dispose();document.getElementById('motion-extras-dialog').remove();document.getElementById('motion-extras-settings').remove();
  }
  textures.forEach(t=>t.dispose());renderer.dispose();THREE.TextureLoader.prototype.loadAsync=original;document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
