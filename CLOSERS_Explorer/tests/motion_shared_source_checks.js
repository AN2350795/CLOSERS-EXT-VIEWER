import * as T from '/vendor/three/three.module.min.js';
import {buildModel,applyPose} from '/model-core.js';
import {setupMotionExtras} from '/model-motion-extras.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id),maps=new Map();
const renderer=new T.WebGLRenderer({alpha:true,antialias:false,preserveDrawingBuffer:true});renderer.setSize(256,256);renderer.setClearColor(0,0);
const scene=new T.Scene(),camera=new T.PerspectiveCamera(40,1,.1,10000),model=buildModel(sharedMotionFixture.data);
scene.add(model.root);camera.position.set(0,120,350);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
const state={model,clip:sharedMotionFixture.clip,time:0,playing:false},loader=new T.TextureLoader(),load=loader.loadAsync;
let extras;
try{
 for(const [id,input] of Object.entries(sharedMotionFixture.images)){
  const map=await loader.loadAsync('data:image/png;base64,'+input.body);map.flipY=false;maps.set(Number(id),map);
 }
 T.TextureLoader.prototype.loadAsync=async function(url){const id=Number(url.match(/composition-image\/(\d+)/)?.[1]);check(maps.has(id),'unexpected source texture '+url);return maps.get(id).clone();};
 const api=async url=>{const id=Number(url.split('/').at(-1));check(url.startsWith('/api/composition-source/')&&sharedMotionFixture.images[id],'unexpected API '+url);return sharedMotionFixture.images[id];};
 localStorage.setItem('closers-motion-extras',JSON.stringify({models:false,effects:true,sounds:false,voices:false,colors:false}));
 extras=setupMotionExtras({state,api,getScene:()=>scene,getCamera:()=>camera,element:(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}});
 await extras.select([state.clip],[{state:'USN_RUN',speed:1}]);
 check(extras.assets.size===1,'shared motion foot dust failed to load');
 check($('motion-extras-status').textContent.includes('원본 변형표 공통 연출'),'shared source status missing');
 check(!$('show-conditional-extras').checked,'common dust must not require conditional preview');
 const read=()=>{renderer.render(scene,camera);const gl=renderer.getContext(),p=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
 let contribution=0;
 for(const time of [.1,.25,.5]){
  state.time=time;applyPose(model,state.clip,time);scene.updateMatrixWorld(true);extras.seek();extras.update();scene.updateMatrixWorld(true);
  const asset=[...extras.assets.values()][0][0],withDust=read();check(asset.anchor.visible&&asset.model.meshes.some(m=>m.count>0),'source dust instance absent at '+time);
  asset.anchor.visible=false;const withoutDust=read();asset.anchor.visible=true;
  for(let i=0;i<withDust.length;i++)if(Math.abs(withDust[i]-withoutDust[i])>1)contribution++;
 }
 check(contribution>0,'real shared foot dust never contributed pixels');
 check(renderer.getContext().getError()===renderer.getContext().NO_ERROR,'source dust GPU error');
 renderer.render(scene,camera);window.testCaptures=[{name:'shared-rare-2-run-dust',body:renderer.domElement.toDataURL('image/png')}];
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{extras?.dispose();T.TextureLoader.prototype.loadAsync=load;for(const m of maps.values())m.dispose();model.dispose();renderer.dispose();}
