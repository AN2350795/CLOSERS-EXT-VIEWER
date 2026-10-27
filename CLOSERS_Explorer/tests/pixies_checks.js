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
    check(extras.assets.size===expected,'all Aura Pixies models load: '+document.getElementById('motion-extra-items').textContent);
    sequence.index=1;
    const baseEntry=test.clips[1].extras.find(e=>e.particle_name==='PE_RARE_PIXI_EMOTION_BASE_LOOP');
    check(Boolean(baseEntry)===(test.definition.key==='SI_COMMON_EMOTION_AURA_PIXIES'),'only the ordinary action has the original dark floor effect');
    if(baseEntry){const base=extras.assets.get('1:'+baseEntry.key)[0];check(baseEntry.particle.layer==='ROL_EFFECT_0'&&base.model.meshes.every(m=>m.renderOrder===100),'the dark floor is drawn in the original bottom effect layer');}
    const gl=renderer.getContext(),pixels=new Uint8Array(384*384*4);
    const whiteCount=()=>{gl.readPixels(0,0,384,384,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let n=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>=250&&pixels[i+1]>=250&&pixels[i+2]>=250)n++;return n;};
    for(const time of [1,3,6,10,14]){
      sequence.seek(time);state.clip=sequence.clip;state.time=sequence.time;applyPose(model,state.clip,state.time);scene.updateMatrixWorld(true);extras.seek();extras.update();renderer.render(scene,camera);
      window.testCaptures.push({name:test.definition.key+'_'+time,body:renderer.domElement.toDataURL('image/png')});
      check(!shaderError,'Pixies shaders compile');
      if(time===6&&baseEntry){
        const darkCount=()=>{gl.readPixels(0,0,384,384,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let n=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]+pixels[i+1]+pixels[i+2]<15)n++;return n;};
        const corrected=darkCount(),materials=[...extras.assets.values()].flat().flatMap(a=>[...a.model.materials,...a.owned.filter(v=>v.isMaterial)]).filter(m=>m.blending===THREE.CustomBlending);
        const factors=materials.map(m=>[m.blendSrcAlpha,m.blendDstAlpha]);
        materials.forEach(m=>{m.blendSrcAlpha=null;m.blendDstAlpha=null;});renderer.render(scene,camera);const broken=darkCount();
        materials.forEach((m,i)=>{[m.blendSrcAlpha,m.blendDstAlpha]=factors[i];});renderer.render(scene,camera);
        check(broken>corrected+50,'separate alpha prevents black erasure in the ordinary action: '+corrected+' corrected, '+broken+' old blending');
        check(darkCount()===corrected,'restoring alpha coverage restores the same image');
      }
      if(time===3){
        const masked=[...extras.assets.values()].flat().filter(a=>a.packet===state.clip).flatMap(a=>a.model.materials).filter(m=>m.alphaMap);
        check(masked.length>=2,'both ring and hexagon masks are connected');
        const covered=whiteCount(),maps=masked.map(m=>m.alphaMap);
        masked.forEach(m=>{m.alphaMap=null;m.needsUpdate=true;});renderer.render(scene,camera);const unmasked=whiteCount();
        masked.forEach((m,i)=>{m.alphaMap=maps[i];m.needsUpdate=true;});renderer.render(scene,camera);
        check(unmasked>covered+100,'real masks reduce the large overexposed prism area: '+covered+' masked, '+unmasked+' unmasked');
        check(whiteCount()===covered,'restoring masks restores the same rendered brightness');
      }
    }
    extras.dispose();model.dispose();document.getElementById('motion-extras-dialog').remove();document.getElementById('motion-extras-settings').remove();
  }
  textures.forEach(t=>t.dispose());renderer.dispose();THREE.TextureLoader.prototype.loadAsync=original;document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
