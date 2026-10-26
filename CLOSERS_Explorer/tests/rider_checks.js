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
  const camera=new THREE.PerspectiveCamera(40,1,.1,4000);camera.position.set(600,250,1000);camera.lookAt(0,100,0);
  for(const test of data.cases){
    const scene=new THREE.Scene(),model=buildModel(test.actor);scene.background=new THREE.Color(0x404650);scene.add(model.root);
    const sequence=new MotionSequencePlayer(test.definition,test.clips),state={model,sequence,clip:sequence.clip,time:0,playing:false};
    const extras=setupMotionExtras({state,api,getScene:()=>scene,getCamera:()=>camera,element});extras.select(test.clips,test.definition.steps);
    const expected=test.clips.flatMap(p=>p.extras).filter(e=>e.status==='ready'&&e.kind!=='equipment').length;
    for(let i=0;i<600&&extras.assets.size!==expected;i++)await new Promise(r=>setTimeout(r,5));
    check(extras.assets.size===expected,'all Rider Call models load: '+document.getElementById('motion-extra-items').textContent);
    const seek=(index,time)=>{sequence.index=index;sequence.seek(time);state.clip=sequence.clip;state.time=sequence.time;applyPose(model,state.clip,state.time);scene.updateMatrixWorld(true);extras.seek();extras.update();renderer.render(scene,camera);};
    for(let index=0;index<3;index++){
      const entry=test.clips[index].extras.find(e=>e.kind==='effect'&&e.animation?.includes('_BIKE')&&!e.label.includes('SHINE')&&!e.label.includes('MOTIONBLUR'));
      check(entry,'bike definition exists');const bike=extras.assets.get(index+':'+entry.key)?.[0];
      check(bike&&(bike.clip||bike.embedded),'bike has a verified source animation');let maximum=0;
      if(test.character==='KNIVES'&&index===0)check(bike.textureAnimations.length>=2&&bike.textureAnimations.every(s=>s.name.includes('KNIVES')&&s.name.includes('EMOTION')),'Aeri reveal selects its own emotion textures rather than victory or other character variants');
      for(const fraction of [.05,.25,.5,.75,.9]){
        seek(index,test.clips[index].clip.duration*fraction);
        if(fraction===.75)window.testCaptures.push({name:test.character+'_'+index,body:renderer.domElement.toDataURL('image/png')});
        if(test.character==='ROGUE'&&index===0&&fraction===.75){
          check(bike.textureAnimations.length>=2,'both bike material sequences are connected');
          check(bike.textureAnimations.every(s=>s.material.map===s.frames.at(-1).map),'bike reveal reaches the solid body texture, including the dual pass');
        }
        if(!bike.anchor.visible)continue;
        bike.model.meshes.forEach(m=>{if(m.isSkinnedMesh)m.computeBoundingBox();});
        const size=new THREE.Box3().setFromObject(bike.model.root).getSize(new THREE.Vector3());
        check(size.toArray().every(Number.isFinite),'bike geometry remains finite');maximum=Math.max(maximum,size.length());
      }
      check(maximum>20,'bike appears during '+test.character+' phase '+index+'; maximum size '+maximum);
      if(test.character==='ROGUE'&&index===0){
        seek(0,.05);
        check(bike.textureAnimations.every(s=>s.material.map===s.frames[0].map),'rewinding restores the initial reveal textures');
        seek(0,3);
        check(bike.textureAnimations.every(s=>s.material.map===s.frames.at(-1).map),'forward seeking restores the solid bike');
      }
      check(!shaderError,'Rider Call shaders compile');
    }
    extras.dispose();model.dispose();document.getElementById('motion-extras-dialog').remove();document.getElementById('motion-extras-settings').remove();
  }
  textures.forEach(t=>t.dispose());renderer.dispose();THREE.TextureLoader.prototype.loadAsync=original;document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
