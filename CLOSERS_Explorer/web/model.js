import * as THREE from './vendor/three/three.module.min.js';
import {buildModel,applyPose,restorePose} from './model-core.js';
import {setupPicker} from './model-picker.js';

const $=id=>document.getElementById(id),token=document.querySelector('meta[name="explorer-token"]').content;
const state={ids:[],skeleton:null,data:null,model:null,animation:null,clip:null,time:0,playing:false,busy:false,page:1,textures:new Map(),texturePixels:0};
let renderer,scene,camera,boneHelper;
const target=new THREE.Vector3(),orbit={yaw:0,pitch:.15,distance:150},textureLoader=new THREE.TextureLoader();
function element(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
function status(text){$('model-status').textContent=text;}
async function api(url){const r=await fetch(url,{headers:{'X-Explorer-Token':token}});const data=await r.json();if(!r.ok)throw Error(data.error||'불러오기 실패');return data;}
function setBusy(value){state.busy=value;document.querySelectorAll('#model-results button,#model-parts button,#motion-choice button,#animation-choice select,#model-textures select,#avatar-bundle button,#avatar-bundle select,#avatar-bundle input,#model-search-form input,#model-search-form button,.model-filters select').forEach(e=>e.disabled=value);$('clear-model').disabled=value||!state.model;$('animation-clip').disabled=value||!state.animation;$('play-animation').disabled=value||!state.clip;$('animation-seek').disabled=value||!state.clip;}
async function operation(fn){if(state.busy)return;setBusy(true);try{await fn();}catch(e){status(e.message);}finally{setBusy(false);}}
function stop(){state.playing=false;$('play-animation').textContent='재생';}
function updateTime(){const duration=state.clip?.clip.duration||0;$('animation-seek').max=duration||1;$('animation-seek').value=state.time;$('animation-time').textContent=`${state.time.toFixed(2)} / ${duration.toFixed(2)}초`;}
function initRenderer(){
  renderer=new THREE.WebGLRenderer({canvas:$('model-canvas'),antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x111823);renderer.outputColorSpace=THREE.SRGBColorSpace;
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(40,1,.1,100000);
  const observer=new ResizeObserver(()=>{const rect=$('viewport').getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();});observer.observe($('viewport'));
  let pointer=null;
  $('model-canvas').oncontextmenu=e=>e.preventDefault();
  $('model-canvas').onpointerdown=e=>{pointer={id:e.pointerId,x:e.clientX,y:e.clientY,pan:e.button===2};$('model-canvas').setPointerCapture(e.pointerId);};
  $('model-canvas').onpointermove=e=>{if(!pointer||pointer.id!==e.pointerId)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer.x=e.clientX;pointer.y=e.clientY;if(pointer.pan){const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);target.addScaledVector(right,-dx*orbit.distance*.0015).addScaledVector(up,dy*orbit.distance*.0015);}else{orbit.yaw-=dx*.008;orbit.pitch=THREE.MathUtils.clamp(orbit.pitch+dy*.008,-1.5,1.5);}};
  $('model-canvas').onpointerup=$('model-canvas').onpointercancel=e=>{if(pointer?.id===e.pointerId)pointer=null;};
  $('model-canvas').addEventListener('wheel',e=>{e.preventDefault();orbit.distance=THREE.MathUtils.clamp(orbit.distance*Math.exp(e.deltaY*.001),.1,100000);},{passive:false});
  $('model-canvas').addEventListener('webglcontextlost',e=>{e.preventDefault();stop();status('3D 그래픽 연결이 끊겼습니다. 이 페이지를 새로고침해 주세요.');});
  let previous=performance.now();
  renderer.setAnimationLoop(now=>{const delta=Math.min(.1,(now-previous)/1000);previous=now;if(state.playing&&state.clip){const duration=state.clip.clip.duration;state.time+=delta*Number($('animation-speed').value);if(state.time>=duration){if($('animation-loop').checked&&duration>0)state.time%=duration;else{state.time=duration;stop();}}applyPose(state.model,state.clip,state.time);updateTime();}const c=Math.cos(orbit.pitch);camera.position.set(target.x+Math.sin(orbit.yaw)*c*orbit.distance,target.y+Math.sin(orbit.pitch)*orbit.distance,target.z+Math.cos(orbit.yaw)*c*orbit.distance);camera.lookAt(target);renderer.render(scene,camera);});
}
function resetCamera(){if(!state.model)return;const bounds=new THREE.Box3();for(const m of state.model.meshes){if(m.visible)bounds.expandByObject(m,true);}if(bounds.isEmpty())bounds.setFromObject(state.model.root);bounds.getCenter(target);const size=bounds.getSize(new THREE.Vector3());orbit.distance=Math.max(size.length()*1.45,1);orbit.yaw=0;orbit.pitch=.12;camera.near=Math.max(.01,orbit.distance/1000);camera.far=Math.max(1000,orbit.distance*100);camera.updateProjectionMatrix();}
function disposeModel(){stop();state.animation=null;state.clip=null;state.time=0;if(boneHelper){scene.remove(boneHelper);boneHelper.geometry.dispose();boneHelper.material.dispose();boneHelper=null;}if(state.model){scene.remove(state.model.root);state.model.dispose();state.model=null;}for(const t of state.textures.values())t.dispose();state.textures.clear();state.texturePixels=0;$('animation-clip').replaceChildren(element('option','연결된 동작 없음'));updateTime();}
async function texture(id,materials){
  let map=state.textures.get(id);
  if(!map){const metadata=await api('/api/composition-source/'+id);if(state.texturePixels+metadata.width*metadata.height>32*1024*1024)throw Error('텍스처 합계는 33,554,432픽셀까지 지원합니다.');map=await textureLoader.loadAsync('/api/composition-image/'+id+'?token='+encodeURIComponent(token)+'&sha256='+metadata.image_sha256);map.colorSpace=THREE.SRGBColorSpace;map.flipY=false;map.wrapS=map.wrapT=THREE.RepeatWrapping;state.textures.set(id,map);state.texturePixels+=metadata.width*metadata.height;}
  materials.forEach(m=>{m.map=map;m.color.set(0xffffff);m.needsUpdate=true;});
}
function sourceSelector(info,callback){const select=element('select');select.append(element('option',info.candidates.length?'출처를 선택하세요':'일치하는 파일 없음'));select.firstChild.value='';for(const row of info.candidates){const option=element('option',row.archive+' · #'+row.ordinal);option.value=row.id;select.append(option);}if(info.selected)select.value=info.selected;select.onchange=()=>{if(select.value)operation(()=>callback(Number(select.value)));};return select;}
async function showTextures(){
  $('model-textures').replaceChildren();const groups=new Map();
  for(const material of state.model.materials){const info=material.userData.input.image;if(!info)continue;const key=JSON.stringify(info);if(!groups.has(key))groups.set(key,{info,materials:[]});groups.get(key).materials.push(material);}
  let failed=0;
  for(const {info,materials} of groups.values()){const row=element('div');row.className='model-row';row.append(element('span',info.name));const message=element('small');const load=async id=>{message.textContent='불러오는 중…';try{await texture(id,materials);message.textContent='원본 해상도 적용';}catch(e){failed++;message.textContent='텍스처 표시 실패: '+e.message;}};row.append(sourceSelector(info,load),message);$('model-textures').append(row);if(info.selected)await load(info.selected);else{failed++;message.textContent=info.candidates.length?'여러 출처가 있어 자동으로 선택하지 않았습니다.':'동일한 파일 이름의 이미지가 없습니다.';}}
  if(!groups.size)$('model-textures').textContent='모델에 명시된 텍스처가 없습니다.';
  return failed;
}
function showParts(){
  $('model-parts').replaceChildren();
  state.data.sources.forEach(source=>{const row=element('div');row.className='model-part';row.append(element('span',source.name),element('p',source.archive+' · #'+source.ordinal));if(source.saved_exists){const a=element('a','원본 파일 저장');a.href='/api/download/'+source.entry_id+'?token='+encodeURIComponent(token);row.append(a);}else row.append(element('p','원본 저장은 라이브러리에서 이 항목을 추출하세요.'));if(state.ids.length>1){const remove=element('button','부위 제외');remove.onclick=()=>operation(()=>loadModel(state.ids.filter(id=>id!==source.entry_id),state.skeleton));row.append(remove);}$('model-parts').append(row);});
  $('motion-choice').replaceChildren();const motion=state.data.motion;if(motion?.candidates.length){$('motion-choice').append(element('h3','캐릭터 공용 뼈'));for(const candidate of motion.candidates){const button=element('button',candidate.name+' 연결');button.title=candidate.archive;button.onclick=()=>operation(()=>loadModel(state.ids,candidate.id));$('motion-choice').append(button);}}
  $('motion-choice').append(element('p','현재 뼈: '+state.data.skeleton_source.name));
}
async function connectAnimation(id){
  stop();state.clip=null;state.animation=null;state.time=0;updateTime();$('animation-clip').replaceChildren(element('option','연결 확인 중…'));
  try{const data=await api('/api/model-animations?skeleton='+state.data.skeleton_source.entry_id+'&animation='+id);if(data.skeleton_source.sha256!==state.data.skeleton_source.sha256)throw Error('뼈 파일이 변경되었습니다. 모델을 다시 열어 주세요.');state.animation={...data,id};$('animation-clip').replaceChildren(element('option','동작을 선택하세요'));$('animation-clip').firstChild.value='';for(const clip of data.clips){const option=element('option',clip.name+' · '+clip.duration.toFixed(2)+'초');option.value=clip.index;$('animation-clip').append(option);}$('animation-verification').textContent=`${data.mapping.verified_bones}개 뼈 · 기본 자세 ${data.mapping.verified_keys}개 키 대조 · 최대 오차 ${data.mapping.maximum_error.toExponential(2)}. 게임 셰이더·효과와 화면 일치 검증은 별도입니다.`;}
  catch(e){$('animation-clip').replaceChildren(element('option','동작 연결 검증 실패'));$('animation-verification').textContent=e.message;throw e;}
}
async function loadModel(ids,skeleton=null){
  status('모델을 읽는 중…');const data=await api('/api/model-scene?entries='+ids.join(',')+(skeleton?'&skeleton='+skeleton:''));const model=buildModel(data);disposeModel();state.ids=ids;state.skeleton=skeleton;state.data=data;state.model=model;scene.add(model.root);boneHelper=new THREE.SkeletonHelper(model.root);boneHelper.visible=$('show-bones').checked;scene.add(boneHelper);state.model.meshes.forEach(m=>m.visible=!m.userData.helper||$('show-helpers').checked);state.model.materials.forEach(m=>m.wireframe=$('wireframe').checked);showParts();const failed=await showTextures();resetCamera();
  $('animation-choice').replaceChildren(element('p',data.animation.name));$('animation-choice').append(sourceSelector(data.animation,connectAnimation));$('animation-verification').textContent='연결할 XMD가 없거나 출처 선택이 필요합니다.';let animationError='';if(data.animation.selected){try{await connectAnimation(data.animation.selected);}catch(e){animationError=' · 동작: '+e.message;}}
  const vertices=data.meshes.reduce((s,m)=>s+m.vertices.length/3,0);status(`${ids.length}개 파일 · 메시 ${data.meshes.length}개 · 정점 ${vertices.toLocaleString()}개${failed?' · 텍스처 확인 필요 '+failed+'개':''}${animationError}${data.warnings.length?' · '+data.warnings.join(' '):''}`);
  history.replaceState(null,'','/model?entries='+ids.join(',')+(skeleton?'&skeleton='+skeleton:''));
}
async function chooseClip(index){
  stop();state.clip=null;state.time=0;updateTime();const a=state.animation;
  const clip=await api('/api/model-clip?skeleton='+state.data.skeleton_source.entry_id+'&animation='+a.id+'&clip='+index+'&sha256='+a.animation_source.sha256);if(clip.skeleton_source.sha256!==state.data.skeleton_source.sha256)throw Error('뼈 파일이 변경되었습니다. 모델을 다시 열어 주세요.');state.clip=clip;$('animation-clip').value=clip.clip.index;applyPose(state.model,clip,0);updateTime();status('게임 동작 불러오기 완료: '+clip.clip.name);
}
const {search}=setupPicker({state,api,operation,loadModel,element});
$('clear-model').onclick=()=>{
  if(state.busy||!state.model)return;
  disposeModel();state.ids=[];state.skeleton=null;state.data=null;
  $('model-parts').replaceChildren(element('p','선택한 모델이 없습니다.'));
  $('motion-choice').replaceChildren();$('animation-choice').replaceChildren(element('p','연결된 동작 없음'));
  $('model-textures').replaceChildren();$('animation-verification').textContent='XMD의 _DEFAULT 자세와 X의 전체 뼈 행렬을 대조한 뒤 재생합니다.';
  target.set(0,0,0);Object.assign(orbit,{yaw:0,pitch:.15,distance:150});
  camera.near=.1;camera.far=100000;camera.updateProjectionMatrix();
  history.replaceState(null,'','/model');setBusy(false);status('선택한 모델을 초기화했습니다. 모델을 다시 선택해 주세요.');
};
$('reset-camera').onclick=resetCamera;$('bind-pose').onclick=()=>{if(!state.model||state.busy)return;stop();restorePose(state.model,state.data);state.clip=null;state.time=0;updateTime();setBusy(false);$('animation-clip').value='';status('X 파일의 기본 자세');};
$('show-helpers').onchange=()=>{state.model?.meshes.forEach(m=>m.visible=!m.userData.helper||$('show-helpers').checked);};$('wireframe').onchange=()=>state.model?.materials.forEach(m=>m.wireframe=$('wireframe').checked);$('show-bones').onchange=()=>{if(boneHelper)boneHelper.visible=$('show-bones').checked;};
$('animation-clip').onchange=()=>{if($('animation-clip').value!=='')operation(()=>chooseClip(Number($('animation-clip').value)));};$('play-animation').onclick=()=>{if(!state.clip||state.busy)return;state.playing=!state.playing;if(state.playing&&state.time>=state.clip.clip.duration)state.time=0;$('play-animation').textContent=state.playing?'일시정지':'재생';};$('animation-seek').oninput=()=>{if(!state.clip||state.busy)return;stop();state.time=Number($('animation-seek').value);applyPose(state.model,state.clip,state.time);updateTime();};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('pagehide',()=>{renderer?.setAnimationLoop(null);disposeModel();renderer?.dispose();});
// Readable state also allows the isolated browser checks to inspect actual bone/mesh results.
window.modelViewer={state,loadModel:(ids,skeleton)=>operation(()=>loadModel(ids,skeleton)),chooseClip:index=>operation(()=>chooseClip(index)),THREE};
try{initRenderer();await operation(async()=>{await search();const query=new URLSearchParams(location.search),ids=(query.get('entries')||'').split(',').filter(Boolean).map(Number);if(ids.length)await loadModel(ids,query.has('skeleton')?Number(query.get('skeleton')):null);});}catch(e){status('3D 그래픽 초기화 실패: '+e.message);}
