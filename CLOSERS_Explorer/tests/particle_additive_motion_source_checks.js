import * as T from '/vendor/three/three.module.min.js';
import {buildModel,applyPose,setAvatarBaseMap} from '/model-core.js';
import {setMaterialPreviewMap} from '/model-materials.js';
import {setupMotionExtras} from '/model-motion-extras.js';
import {createEmissionRenderer} from '/model-emission.js';
import {measureDofFocus} from '/model-dof.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id),element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const side=256,renderer=new T.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});renderer.setSize(side,side);renderer.setClearColor(0,0);
const scene=new T.Scene(),camera=new T.PerspectiveCamera(40,1,.1,100000),model=buildModel(motionDofFixture.data);scene.add(model.root);
const state={model,clip:motionDofFixture.clip,time:0,playing:false},maps=new Map(),loader=new T.TextureLoader(),load=loader.loadAsync,errors=[];
const fx=createEmissionRenderer(renderer);let extras;window.testCaptures=[];window.additiveDofResults=[];renderer.debug.onShaderError=()=>errors.push('shader');
const read=()=>{const gl=renderer.getContext(),p=new Uint8Array(side*side*4);gl.readPixels(0,0,side,side,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
const changed=(a,b,alpha=false)=>{let count=0;for(let i=0;i<a.length;i+=4)if(alpha?Math.abs(a[i+3]-b[i+3])>1:Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])))>1)count++;return count;};
function bounds(){
 const box=new T.Box3(),point=new T.Vector3(),instance=new T.Matrix4();scene.updateMatrixWorld(true);
 for(const mesh of model.meshes){
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
 for(const [id,image] of Object.entries(motionDofFixture.images)){const map=await loader.loadAsync('data:image/png;base64,'+image.body);map.flipY=false;map.wrapS=map.wrapT=T.RepeatWrapping;maps.set(Number(id),map);}
 for(const m of model.materials){const input=m.userData.input;if(input.image?.selected)setAvatarBaseMap(m,maps.get(input.image.selected));if(m.userData.materialPreview&&input.material_preview?.image?.selected)setMaterialPreviewMap(m,maps.get(input.material_preview.image.selected));}
 T.TextureLoader.prototype.loadAsync=async function(url){const match=/\/api\/composition-image\/(\d+)/.exec(url);if(!match)return load.call(this,url);const map=maps.get(Number(match[1]));check(map,'unprepared source texture '+url);const copy=map.clone();copy.needsUpdate=true;return copy;};
 const api=async url=>{
  const u=new URL(url,location.href),q=u.searchParams;
  if(u.pathname.startsWith('/api/composition-source/'))return motionDofFixture.images[Number(u.pathname.split('/').at(-1))];
  if(u.pathname==='/api/model-scene')return motionDofFixture.scenes[q.get('entries')];
  if(u.pathname==='/api/model-animations')return motionDofFixture.animations[q.get('skeleton')+':'+q.get('animation')];
  if(u.pathname==='/api/model-clip')return motionDofFixture.clips[q.get('skeleton')+':'+q.get('animation')+':'+q.get('clip')];
  if(u.pathname==='/api/model-effect-clip')return motionDofFixture.effects[q.get('skeleton')+':'+q.get('name')];
  throw Error('unexpected source request '+url);
 };
 localStorage.setItem('closers-motion-extras',JSON.stringify({models:true,effects:true,sounds:false,voices:false,colors:false}));
 extras=setupMotionExtras({state,api,getScene:()=>scene,getCamera:()=>camera,element});await extras.select([state.clip],[{state:'USN_EMOTION_DANCE',speed:1}]);
 const particles=[...extras.assets.values()].flat().filter(a=>a.particle).flatMap(a=>a.model.meshes).filter(m=>m.userData.dofParticleAdditive);
 check(particles.length===3,'three source additive spot/note particles must load: '+$('motion-extra-items').textContent);
 let positive=0;
 for(const time of [.2,1,2]){
  state.time=time;applyPose(model,state.clip,time);scene.updateMatrixWorld(true);extras.seek();extras.update();scene.updateMatrixWorld(true);
  const box=bounds(),center=box.getCenter(new T.Vector3()),extent=box.getSize(new T.Vector3()).length();
  for(const [view,angle] of [['front',.35],['side',1.2]]){
   camera.position.copy(center).add(new T.Vector3(Math.sin(angle)*extent,extent*.2,Math.cos(angle)*extent));camera.lookAt(center);camera.updateMatrixWorld(true);
   const focus=measureDofFocus(model,camera).focus,settings={enabled:true,focus,range:extent*.035,strength:1};
   for(const bloom of [false,true]){
    const render=dof=>{fx.render(scene,camera,model,{bloom,bloomMode:'viewer',dof,occluders:extras.meshes});return read();};
    const base=render(null),on=render(settings);
    particles.forEach(m=>m.userData.dofParticle=false);const excluded=render(settings);particles.forEach(m=>m.userData.dofParticle=true);
    const contribution=changed(on,excluded);if(contribution>1)positive++;
    check(changed(base,on,true)===0,'source additive DOF changed output alpha');
    check(render({...settings,enabled:false}).every((v,i)=>v===base[i]),'source additive OFF did not restore frame');
    check(particles.every(m=>m.material.every(x=>x.blendDst===T.OneFactor&&!x.userData.particleDofDepth?.particleDofDepthPass.value&&!x.userData.particleDofDepth?.particleDofAlphaRed.value)),'source additive state not restored');
    if(time===1&&view==='front'&&!bloom){render(null);window.testCaptures.push({name:'dance-additive-off',body:renderer.domElement.toDataURL('image/png')});render(settings);window.testCaptures.push({name:'dance-additive-on',body:renderer.domElement.toDataURL('image/png')});}
    window.additiveDofResults.push({time,view,bloom,contribution});
   }
  }
 }
 check(positive>=2&&window.additiveDofResults.length===12&&!errors.length,'source additive depth had no visible contribution '+JSON.stringify(window.additiveDofResults));
 check(renderer.getContext().getError()===renderer.getContext().NO_ERROR,'source additive GPU error');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{extras?.dispose();T.TextureLoader.prototype.loadAsync=load;for(const map of maps.values())map.dispose();fx.dispose();model.dispose();renderer.dispose();}
