import * as THREE from '/vendor/three/three.module.min.js';
import {buildModel,applyPose} from '/model-core.js';
import {applyEmbeddedPose} from '/model-x-animation.js';
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
  const renderer=new THREE.WebGLRenderer();renderer.setSize(96,96);document.body.append(renderer.domElement);let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const camera=new THREE.PerspectiveCamera(40,1,.1,3000);camera.position.set(0,180,850);camera.lookAt(0,110,0);
  for(const test of data.cases){
    const scene=new THREE.Scene(),model=buildModel(test.actor);scene.add(model.root);
    const packets=test.clips,sequence=new MotionSequencePlayer(test.definition,packets),state={model,sequence,clip:sequence.clip,time:0,playing:false};
    const extras=setupMotionExtras({state,api,getScene:()=>scene,getCamera:()=>camera,element});extras.select(packets,test.definition.steps);
    const expected=packets.flatMap(p=>p.extras).filter(e=>e.status==='ready'&&e.kind!=='equipment').length;
    for(let i=0;i<600&&extras.assets.size!==expected;i++)await new Promise(r=>setTimeout(r,5));
    check(extras.assets.size===expected,'all Christmas models and particles load: '+document.getElementById('motion-extra-items').textContent);
    const assets=[...extras.assets.values()].flat();
    packets.forEach((p,i)=>{for(const entry of p.extras)if(entry.animation&&entry.animation!=='BASE'){
      const group=extras.assets.get(i+':'+entry.key);
      check(group?.every(a=>a.clip?.clip.name===entry.animation||a.embedded?.clip.name===entry.animation),'animated tree, gift or teddy bear has an exact source clip: '+entry.animation);
    }});
    const seek=(index,time)=>{sequence.index=index;sequence.seek(time);state.clip=sequence.clip;state.time=sequence.time;applyPose(model,state.clip,state.time);scene.updateMatrixWorld(true);extras.seek();extras.update();renderer.render(scene,camera);};
    seek(0,1);check(assets.some(a=>a.packet===state.clip&&a.clip&&a.anchor.visible),'tree intro is animated');
    seek(1,9.2);
    if(test.character==='STRIKER'){
      const entry=packets[1].extras.find(e=>e.bone==='TREE_STAR_DUMMY01'),star=extras.assets.get('1:'+entry.key)[0];
      check(star.anchor.visible&&star.boneTarget?.name==='TREE_STAR_DUMMY01','tree star attaches to the animated effect bone');
      const box=assets.find(a=>a.embedded?.clip.name.endsWith('_BOX_LOOP'));check(box?.anchor.visible,'male gift uses its embedded X animation');
      const source=data.scenes[box.embedded.skeleton_source.entry_id];applyEmbeddedPose(box.model,box.embedded,0);
      box.model.bones.forEach((bone,i)=>{bone.updateMatrix();check(bone.matrix.elements.every((v,j)=>Math.abs(v-source.frames[i].matrix[j])<.005),'embedded first pose agrees with original frame, including quaternion convention');});
    }
    state.playing=true;let wraps=0,lastTime=state.time,latePasses=0;
    for(let i=0;i<260;i++){
      sequence.advance(.1);state.clip=sequence.clip;state.time=sequence.time;applyPose(model,state.clip,state.time);scene.updateMatrixWorld(true);extras.update(.1);
      if(state.time<lastTime)wraps++;lastTime=state.time;
      if(state.time>12&&state.time<12.2){
        latePasses++;
        if(test.character==='STRIKER'){
          const entry=packets[1].extras.find(e=>e.label==='PE_EMOTION_SANTABUNNY_FEMALE_START_SMOKE_SEQ'),smoke=extras.assets.get('1:'+entry.key)[0];
          check(smoke.anchor.visible&&smoke.model.meshes.some(m=>m.count>0),'delayed smoke emits again on each parent loop');
        }
      }
      if(i%10===0)renderer.render(scene,camera);
    }
    check(wraps>=2&&latePasses>=2&&!shaderError,'Christmas loop survives two wraps with valid shaders');
    sequence.requestFinish();for(let i=0;i<60&&!sequence.completed;i++){sequence.advance(.1);state.clip=sequence.clip;state.time=sequence.time;applyPose(model,state.clip,state.time);scene.updateMatrixWorld(true);extras.update(.1);if(i%5===0)renderer.render(scene,camera);}
    check(sequence.completed&&!shaderError,'Christmas exit completes');
    sequence.restart();state.clip=sequence.clip;state.time=sequence.time;extras.seek();extras.update();
    check(assets.filter(a=>a.packet!==state.clip).every(a=>!a.anchor.visible),'restart clears old loop and exit models');
    extras.dispose();model.dispose();document.getElementById('motion-extras-dialog').remove();document.getElementById('motion-extras-settings').remove();
  }
  textures.forEach(t=>t.dispose());renderer.dispose();THREE.TextureLoader.prototype.loadAsync=original;document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
