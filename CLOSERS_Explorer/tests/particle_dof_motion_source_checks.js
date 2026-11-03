import * as T from '/vendor/three/three.module.min.js';
import {buildModel,applyPose,setAvatarBaseMap} from '/model-core.js';
import {setMaterialPreviewMap} from '/model-materials.js';
import {setupMotionExtras} from '/model-motion-extras.js';
import {createEmissionRenderer,applyAvatarColorSpace} from '/model-emission.js';
import {createDofDepthPass} from '/model-dof-depth.js';
import {dofFocal,supportsDofModel,measureDofFocus} from '/model-dof.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id),element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const side=256,renderer=new T.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});renderer.setSize(side,side);renderer.setClearColor(0,0);
const scene=new T.Scene(),camera=new T.PerspectiveCamera(40,1,.1,100000),model=buildModel(motionDofFixture.data);scene.add(model.root);
const state={model,clip:motionDofFixture.clip,time:0,playing:false},maps=new Map(),loader=new T.TextureLoader(),load=loader.loadAsync,errors=[];
const fx=createEmissionRenderer(renderer),depth=createDofDepthPass(renderer);let extras,grid;
renderer.debug.onShaderError=()=>errors.push('shader');window.testCaptures=[];window.motionDofResults=[];
const read=target=>{const p=new Uint8Array(side*side*4);if(target)renderer.readRenderTargetPixels(target,0,0,side,side,p);else{const gl=renderer.getContext();gl.readPixels(0,0,side,side,gl.RGBA,gl.UNSIGNED_BYTE,p);}return p;};
const changed=(a,b,alpha=false)=>{let count=0;for(let i=0;i<a.length;i+=4)if(alpha?Math.abs(a[i+3]-b[i+3])>1:Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])))>1)count++;return count;};
const capture=name=>window.testCaptures.push({name,body:renderer.domElement.toDataURL('image/png')});
function bounds(){
 const box=new T.Box3(),point=new T.Vector3(),instance=new T.Matrix4();scene.updateMatrixWorld(true);
 for(const mesh of [...model.meshes,...extras.meshes]){
  if(!mesh.visible)continue;let visible=true;for(let p=mesh.parent;p;p=p.parent)if(!p.visible)visible=false;if(!visible)continue;
  const positions=mesh.geometry.getAttribute('position');
  for(let i=0;i<(mesh.isInstancedMesh?mesh.count:1);i++){
   if(mesh.isInstancedMesh)mesh.getMatrixAt(i,instance);
   for(let j=0;j<positions.count;j++){mesh.getVertexPosition(j,point);if(mesh.isInstancedMesh)point.applyMatrix4(instance);point.applyMatrix4(mesh.matrixWorld);box.expandByPoint(point);}
  }
 }
 return box;
}
try{
 check(supportsDofModel(model),'real costume unexpectedly unsupported');
 for(const [id,image] of Object.entries(motionDofFixture.images)){
  const map=await loader.loadAsync('data:image/png;base64,'+image.body);map.flipY=false;map.wrapS=map.wrapT=T.RepeatWrapping;maps.set(Number(id),map);
 }
 for(const m of model.materials){const input=m.userData.input;if(input.image?.selected)setAvatarBaseMap(m,maps.get(input.image.selected));if(m.userData.materialPreview&&input.material_preview?.image?.selected)setMaterialPreviewMap(m,maps.get(input.material_preview.image.selected));}
 check(model.materials.some(m=>m.userData.materialPreview?.uniforms.avatarMaterialEnabled.value>0),'real costume emission must activate the bloom path');
 applyAvatarColorSpace(renderer,new Map([...model.materials.filter(m=>m.map).map((m,i)=>['base:'+i,m.map])]),true);
 loader.constructor.prototype.loadAsync=async function(url){const match=/\/api\/composition-image\/(\d+)/.exec(url);if(!match)return load.call(this,url);const map=maps.get(Number(match[1]));check(map,'unprepared real extra texture '+url);const copy=map.clone();copy.needsUpdate=true;return copy;};
 const api=async url=>{
  const u=new URL(url,location.href),q=u.searchParams;
  if(u.pathname.startsWith('/api/composition-source/'))return motionDofFixture.images[Number(u.pathname.split('/').at(-1))];
  if(u.pathname==='/api/model-scene')return motionDofFixture.scenes[q.get('entries')];
  if(u.pathname==='/api/model-animations')return motionDofFixture.animations[q.get('skeleton')+':'+q.get('animation')];
  if(u.pathname==='/api/model-clip')return motionDofFixture.clips[q.get('skeleton')+':'+q.get('animation')+':'+q.get('clip')];
  if(u.pathname==='/api/model-effect-clip')return motionDofFixture.effects[q.get('skeleton')+':'+q.get('name')];
  throw Error('unexpected motion source request '+url);
 };
 localStorage.setItem('closers-motion-extras',JSON.stringify({models:true,effects:true,sounds:false,voices:false,colors:false}));
 extras=setupMotionExtras({state,api,getScene:()=>scene,getCamera:()=>camera,element});await extras.select([state.clip],[{state:'USN_ASTART1',speed:1}]);
 check(extras.assets.size===3,'real parent/child effects failed to load: '+$('motion-extra-items').textContent);
 const assets=[...extras.assets.values()].flat(),particles=assets.filter(a=>a.particle).flatMap(a=>a.model.meshes),parent=assets.find(a=>!a.particle);
 check(particles.length===2&&particles.every(m=>m.userData.dofParticle)&&(parent.clip||parent.embedded),'source particles or own bike animation not connected');
 let positive=0,occlusion=0;
 for(const time of [.4,.9,1.2]){
  state.time=time;applyPose(model,state.clip,time);scene.updateMatrixWorld(true);extras.seek();extras.update();scene.updateMatrixWorld(true);
  const active=particles.filter(m=>m.count&&m.parent.visible&&m.parent.parent.visible).length;
  check(time<.6?active===0:active===2,'original child birth timing changed '+time+' active '+active);
  const box=bounds(),center=box.getCenter(new T.Vector3()),extent=box.getSize(new T.Vector3()).length();
  if(!grid){grid=new T.GridHelper(extent*2,20,0x606060,0x303030);grid.position.set(center.x,box.min.y,center.z);scene.add(grid);}
  for(const [view,angle] of [['front',.35],['side',1.2]]){
   camera.position.copy(center).add(new T.Vector3(Math.sin(angle)*extent,extent*.35,Math.cos(angle)*extent));camera.lookAt(center);camera.updateMatrixWorld(true);
   const measured=measureDofFocus(model,camera),settings={enabled:true,focus:measured.focus,range:extent*.035,strength:1},focal=dofFocal(settings),occluders=extras.meshes;
   const depthWith=read(depth.render(scene,camera,model,focal,occluders));renderer.setRenderTarget(null);
   particles.forEach(m=>m.userData.dofParticle=false);const depthWithout=read(depth.render(scene,camera,model,focal,occluders));renderer.setRenderTarget(null);particles.forEach(m=>m.userData.dofParticle=true);
   let depthDelta=0;for(let i=0;i<depthWith.length;i++)if(Math.abs(depthWith[i]-depthWithout[i])>1)depthDelta++;
   if(time<.6)check(depthDelta===0,'unborn particles added depth');else if(depthDelta>0)positive++;
   const marked=parent.model.materials.filter(m=>m.userData.motionOpaqueOccluder);marked.forEach(m=>m.userData.motionOpaqueOccluder=false);
   const noBlock=read(depth.render(scene,camera,model,focal,occluders));renderer.setRenderTarget(null);marked.forEach(m=>m.userData.motionOpaqueOccluder=true);
   for(let i=0;i<noBlock.length;i++)if(noBlock[i]!==depthWith[i])occlusion++;
   for(const bloom of [false,true]){
    const render=dof=>{fx.render(scene,camera,model,{bloom,bloomMode:'viewer',dof,occluders});return read();};
    const base=render(null),prefix='seha-bike-'+time+'-'+view+'-'+(bloom?'bloom':'plain');
    if(time===.9&&!bloom){capture(prefix+'-off');}
    const on=render(settings);if(time===.9&&!bloom)capture(prefix+'-on');
    check(changed(base,on,true)===0,'source scene output alpha changed '+prefix);
    particles.forEach(m=>m.userData.dofParticle=false);const excluded=render(settings);particles.forEach(m=>m.userData.dofParticle=true);
    const contribution=changed(on,excluded);if(time<.6)check(contribution===0,'unborn particle changed final color');
    check(render({...settings,enabled:false}).every((v,i)=>v===base[i]),'OFF did not restore source motion frame '+prefix);
    check(grid.visible&&parent.model.materials.every(m=>m.visible&&m.colorWrite)&&particles.every(m=>!m.material.some(x=>x.userData.particleDofDepth?.particleDofDepthPass.value)),'source motion state leaked '+prefix);
    window.motionDofResults.push({time,view,bloom,active,depthDelta,contribution});
   }
  }
 }
 check(positive>=2&&occlusion>0,'source motion had no particle depth or opaque bike occlusion');
 check(window.motionDofResults.some(r=>r.contribution>2),'particle depth never affected the real source image');
 check(parent.model.materials.some(m=>m.map?.userData.avatarAlphaMode==='opaque')&&parent.model.materials.some(m=>m.map?.userData.avatarAlphaMode==='blend'),'mixed bike texture coverage was not classified');
 check(window.motionDofResults.length===12&&!errors.length&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'source motion GPU checks incomplete');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack+'\n'+JSON.stringify(window.motionDofResults)}));}
finally{extras?.dispose();loader.constructor.prototype.loadAsync=load;if(grid){grid.geometry.dispose();grid.material.dispose();}for(const map of maps.values())map.dispose();depth.dispose();fx.dispose();model.dispose();renderer.dispose();}
