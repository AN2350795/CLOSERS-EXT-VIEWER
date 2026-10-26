import * as THREE from '/vendor/three/three.module.min.js';
import {setupMotionExtras} from '/model-motion-extras.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
  localStorage.setItem('closers-motion-extras',JSON.stringify({effects:true}));
  const data=heartbeatFixture,textures=new Map(),loader=new THREE.TextureLoader(),original=THREE.TextureLoader.prototype.loadAsync;
  for(const [id,image] of Object.entries(data.images)){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(image.body),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{textures.set(Number(id),await loader.loadAsync(url));}finally{URL.revokeObjectURL(url);}
  }
  THREE.TextureLoader.prototype.loadAsync=async function(url){const match=url.match(/composition-image\/(\d+)/);return match?textures.get(Number(match[1])).clone():original.call(this,url);};
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x404650);
  const root=new THREE.Group();root.scale.z=-1;scene.add(root);scene.updateMatrixWorld(true);
  const packet={clip:{name:'EMOTION_DEMONIC_HEARTBEAT_START',duration:4},extras:data.entries},state={model:{root,bones:[]},clip:packet,time:1.6,playing:false};
  const api=async url=>{
    if(url.startsWith('/api/model-scene'))return data.scenes[Number(new URL(url,location.href).searchParams.get('entries'))];
    if(url.startsWith('/api/composition-source/'))return data.images[Number(url.split('/').at(-1))];
    throw Error('Unexpected API '+url);
  };
  const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const extras=setupMotionExtras({state,api,getScene:()=>scene,element});extras.select([packet],[{state:'USN_EMOTION_DEMONIC_HEARTBEAT_BGM_START',speed:1}]);
  for(let i=0;i<500&&extras.assets.size!==4;i++)await new Promise(r=>setTimeout(r,5));
  check(extras.assets.size===4,'all real Heartbeat floor effects load: '+document.getElementById('motion-extra-items').textContent);
  const traced=[...extras.assets.values()].flat().find(a=>a.traceReceiver);check(traced,'the gradient has a unique floor-heart mask');
  const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(384,384);document.body.append(renderer.domElement);let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const camera=new THREE.OrthographicCamera(-300,300,300,-300,.1,2000);camera.up.set(0,0,1);
  window.testCaptures=[];
  const gl=renderer.getContext(),shown=new Uint8Array(384*384*4),hidden=new Uint8Array(shown.length);
  for(const side of [1,-1]){
    camera.position.set(0,side*800,0);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    extras.seek();extras.update();renderer.render(scene,camera);
    check([...extras.assets.values()].flat().some(a=>a.anchor.visible&&a.model.meshes.some(m=>m.count>0)),'active floor particles produce instances');
    window.testCaptures.push({name:side>0?'heartbeat_above':'heartbeat_below',body:renderer.domElement.toDataURL('image/png')});
    gl.readPixels(0,0,384,384,gl.RGBA,gl.UNSIGNED_BYTE,shown);
    const receiver=traced.traceReceiver.model.meshes[0],matrix=new THREE.Matrix4();receiver.getMatrixAt(0,matrix);matrix.premultiply(receiver.matrixWorld);
    traced.anchor.visible=false;renderer.render(scene,camera);gl.readPixels(0,0,384,384,gl.RGBA,gl.UNSIGNED_BYTE,hidden);
    for(const x of [-.45,.45])for(const y of [-.45,.45]){
      const p=new THREE.Vector3(x,y,0).applyMatrix4(matrix).project(camera),px=Math.round((p.x+1)*192),py=Math.round((p.y+1)*192),i=(py*384+px)*4;
      check([0,1,2].every(c=>Math.abs(shown[i+c]-hidden[i+c])<=2),'the opaque gradient does not change pixels outside the heart from either side');
    }
    traced.anchor.visible=true;
    check(!shaderError,'floor effect shaders compile from both camera sides');
  }
  state.time=.1;extras.seek();extras.update();check(!traced.anchor.visible,'rewinding before emission hides the traced overlay');
  state.time=1.3;extras.seek();extras.update();check(!traced.anchor.visible,'a zero-size receiver at creation does not reveal an unmasked quad');
  state.time=1.6;extras.seek();extras.update();check(traced.anchor.visible,'seeking forward restores the projected heart mask');
  extras.dispose();textures.forEach(t=>t.dispose());renderer.dispose();THREE.TextureLoader.prototype.loadAsync=original;document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
