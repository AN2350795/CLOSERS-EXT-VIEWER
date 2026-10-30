import * as THREE from './vendor/three/three.module.min.js';
import {buildModel,applyPose,restorePose} from './model-core.js';
import {slots,partLabels} from './avatar-navigation.js';
import {setupPicker} from './model-picker.js';
import {setupPreviews} from './model-preview.js';
import {setMaterialPreview,setMaterialPreviewMap,setMatcapPreviewMap,setMatcapNormalMap} from './model-materials.js';
import {TextureCache,limitedMap} from './model-texture-cache.js';
import {setupMotions} from './model-motions.js';
import {MotionSequencePlayer} from './motion-sequence-player.js';
import {setupMotionExtras} from './model-motion-extras.js';
import {setupModelStage} from './model-stage.js';
import {setupAvatarLighting,setAvatarToonMap,setAvatarGlowMap,setAvatarExtMap,setAvatarSecondMap} from './model-lighting.js';
import {createEmissionRenderer} from './model-emission.js';

const $=id=>document.getElementById(id),token=document.querySelector('meta[name="explorer-token"]').content;
const state={eye:null,ids:[],skeleton:null,data:null,model:null,animation:null,clip:null,time:0,playing:false,busy:false,page:1,textures:new Map(),textureKeys:new Set(),texturePixels:0,generation:0,timings:null};
const textureCache=new TextureCache();
let sequenceController;
const sequenceControls=element('div');sequenceControls.className='sequence-controls';sequenceControls.hidden=true;
sequenceControls.innerHTML='<button id="finish-motion" type="button" class="secondary">종료하기</button><label>종료 후 <select id="sequence-finish-mode"><option value="start">처음 선택 상태</option><option value="hold">마지막 자세 유지</option></select></label><span id="sequence-phase" role="status"></span>';
document.querySelector('.animation-options').prepend(sequenceControls);
const preserveViewKey='closers-model-preserve-view-v1';
try{$('preserve-view').checked=localStorage.getItem(preserveViewKey)!=='false';}catch{}
$('preserve-view').onchange=()=>{try{localStorage.setItem(preserveViewKey,String($('preserve-view').checked));}catch{}};
let modelController,operationVersion=0,animationVersion=0,clipVersion=0,viewerDisposed=false;
let renderer,scene,camera,boneHelper,stage,emissionRenderer;
const extras=setupMotionExtras({state,api,getScene:()=>scene,getCamera:()=>camera,onLoadingChange:value=>{state.extrasLoading=value;updatePlaybackControls();updateSequenceControls();},onEquipmentVisibility:()=>updateMeshVisibility(),onVisible:()=>{if(state.sequence)return;scene.updateMatrixWorld(true);resetCamera();},element});
const lighting=setupAvatarLighting({state,api,element,getEmissionEnabled:()=>$('material-preview').checked});
const target=new THREE.Vector3(),orbit={yaw:0,pitch:.15,distance:150},textureLoader=new THREE.TextureLoader();
function element(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
function clipLabel(clip){return clip.display_name?clip.display_name+' · '+clip.name:clip.name;}
let noticeTimer;
function closeNotice(){clearTimeout(noticeTimer);$('model-status').classList.remove('is-notice');$('model-status').querySelector('.notice-close')?.remove();}
function status(text,notice=false){
  closeNotice();$('model-status').textContent=text;
  if(notice){const close=element('button','×');close.type='button';close.className='notice-close';close.setAttribute('aria-label','알림 닫기');close.onclick=closeNotice;$('model-status').append(close);$('model-status').classList.add('is-notice');noticeTimer=setTimeout(closeNotice,6000);}
}
function updateMeshVisibility(){state.model?.meshes.forEach(m=>m.visible=!m.userData.motionHidden&&(!m.userData.helper||$('show-helpers').checked)&&(!m.userData.equipmentHidden||$('show-equipment-hidden').checked));stage?.fit(state.model);lighting.refresh();}
async function api(url,signal){const r=await fetch(url,{headers:{'X-Explorer-Token':token},signal});const data=await r.json();if(!r.ok)throw Error(data.error||'불러오기 실패');return data;}
function updatePlaybackControls(){const blocked=state.busy||state.extrasLoading;for(const id of ['play-animation','animation-seek','animation-loop','animation-speed'])$(id).disabled=blocked||!state.clip;$('animation-loop').disabled=blocked||!state.clip||!!state.sequence;$('viewport').setAttribute('aria-busy',String(!!blocked));}
function setBusy(value){state.busy=value;extras.setBusy(value);$('open-motions').disabled=value||!state.model;$('bind-pose').disabled=value||!state.model;document.querySelectorAll('#model-results button:not(.favorite-button),#model-results select,#model-parts button,#motion-choice button,#animation-choice select,#model-textures select,#avatar-bundle button,#avatar-bundle select,#avatar-bundle input').forEach(e=>e.disabled=value||e.dataset.unavailable==='true');$('clear-model').disabled=value||!state.model;$('animation-clip').disabled=value||!state.animation;updatePlaybackControls();updateSequenceControls();updateMotionName();}
async function operation(fn,replace=false){if(state.busy&&!replace)return;const version=++operationVersion;closeNotice();setBusy(true);try{await fn();}catch(e){if(version===operationVersion)status(e.message,true);}finally{if(version===operationVersion)setBusy(false);}}
function stop(){state.playing=false;extras.pauseAudio();$('play-animation').textContent='재생';$('play-animation').setAttribute('aria-pressed','false');}
function updateMotionName(){
  const clip=state.clip?.clip,name=state.model?(state.sequence?.definition.label||clip?.game_names?.[0]||clip?.display_name||clip?.name||'기본 자세'):'모델을 선택하세요';
  if($('current-motion').textContent!==name)$('current-motion').textContent=name;
  $('current-motion').title=clip?clipLabel(clip):name;
}
function updateTime(){const duration=state.clip?.clip.duration||0;$('animation-seek').max=duration||1;$('animation-seek').value=state.time;$('animation-time').textContent=`${state.time.toFixed(2)} / ${duration.toFixed(2)}초`;updateMotionName();updateSequenceControls();}
function updateSequenceControls(){
  const sequence=state.sequence;sequenceControls.hidden=!sequence;
  $('finish-motion').disabled=state.busy||state.extrasLoading||!sequence||sequence.finishRequested||sequence.completed;
  $('finish-motion').textContent=sequence?.finishRequested&&!sequence.completed?'종료 중…':'종료하기';
  $('sequence-phase').textContent=sequence?sequence.phase:'';
}
function cancelSequence(){sequenceController?.abort();sequenceController=null;state.sequence=null;extras.reset();updateSequenceControls();}
function advanceAnimation(delta){
  if(state.sequence){
    const sequence=state.sequence;sequence.advance(delta,Number($('animation-speed').value));
    state.clip=sequence.clip;state.time=sequence.time;
    applyPose(state.model,state.clip,state.time);
    if(sequence.completed){
      stop();
      if($('sequence-finish-mode').value==='start'){
        sequence.restart();extras.seek();state.clip=sequence.clip;state.time=sequence.time;
        restorePose(state.model,state.data);applyPose(state.model,state.clip,state.time);
      }
      setBusy(state.busy);
    }
  }else{
    const duration=state.clip.clip.duration;state.time+=delta*Number($('animation-speed').value);
    if(state.time>=duration){if($('animation-loop').checked&&duration>0)state.time%=duration;else{state.time=duration;stop();}}
    applyPose(state.model,state.clip,state.time);
  }
  updateTime();
}
function initRenderer(){
  renderer=new THREE.WebGLRenderer({canvas:$('model-canvas'),antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x111823);renderer.outputColorSpace=THREE.SRGBColorSpace;
  emissionRenderer=createEmissionRenderer(renderer);
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(40,1,.1,100000);
  stage=setupModelStage({scene});
  const observer=new ResizeObserver(()=>{const rect=$('viewport').getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);stage.resize(rect.width,rect.height);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();});observer.observe($('viewport'));
  let pointer=null;
  $('model-canvas').oncontextmenu=e=>e.preventDefault();
  $('model-canvas').onpointerdown=e=>{pointer={id:e.pointerId,x:e.clientX,y:e.clientY,pan:e.button===2};$('model-canvas').setPointerCapture(e.pointerId);};
  $('model-canvas').onpointermove=e=>{if(!pointer||pointer.id!==e.pointerId)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer.x=e.clientX;pointer.y=e.clientY;if(pointer.pan){const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);target.addScaledVector(right,-dx*orbit.distance*.0015).addScaledVector(up,dy*orbit.distance*.0015);}else{orbit.yaw-=dx*.008;orbit.pitch=THREE.MathUtils.clamp(orbit.pitch+dy*.008,-1.5,1.5);}};
  $('model-canvas').onpointerup=$('model-canvas').onpointercancel=e=>{if(pointer?.id===e.pointerId)pointer=null;};
  $('model-canvas').addEventListener('wheel',e=>{e.preventDefault();orbit.distance=THREE.MathUtils.clamp(orbit.distance*Math.exp(e.deltaY*.001),.1,100000);},{passive:false});
  $('model-canvas').addEventListener('webglcontextlost',e=>{e.preventDefault();stop();status('3D 그래픽 연결이 끊겼습니다. 이 페이지를 새로고침해 주세요.');});
  let previous=performance.now();
  renderer.setAnimationLoop(now=>{const delta=Math.min(.1,(now-previous)/1000);previous=now;if(state.playing&&state.clip&&!extras.loading)advanceAnimation(delta);extras.update(delta);const c=Math.cos(orbit.pitch);camera.position.set(target.x+Math.sin(orbit.yaw)*c*orbit.distance,target.y+Math.sin(orbit.pitch)*orbit.distance,target.z+Math.cos(orbit.yaw)*c*orbit.distance);camera.lookAt(target);emissionRenderer.render(scene,camera,state.model,lighting.getRenderOptions());});
}
function resetCamera(){if(!state.model)return;const bounds=new THREE.Box3();for(const m of [...state.model.meshes,...extras.meshes]){if(m.visible)bounds.expandByObject(m,true);}if(bounds.isEmpty())bounds.setFromObject(state.model.root);bounds.getCenter(target);const size=bounds.getSize(new THREE.Vector3());orbit.distance=Math.max(size.length()*1.45,1);orbit.yaw=0;orbit.pitch=.12;camera.near=Math.max(.01,orbit.distance/1000);camera.far=Math.max(1000,orbit.distance*100);camera.updateProjectionMatrix();}
function avatarCharacter(data){
  const sources=data?.sources||[];
  if(!sources.length||sources.some(source=>source.model_group?.kind!=='avatar'))return null;
  const characters=new Set(sources.map(source=>source.model_group.character).filter(Boolean));
  return characters.size===1?[...characters][0]:null;
}
function disposeModel(){cancelSequence();motions.reset();stage?.fit(null);stop();animationVersion++;clipVersion++;state.animation=null;state.clip=null;state.time=0;if(boneHelper){scene.remove(boneHelper);boneHelper.geometry.dispose();boneHelper.material.dispose();boneHelper=null;}if(state.model){scene.remove(state.model.root);state.model.dispose();state.model=null;}for(const key of state.textureKeys)textureCache.release(key);state.textures=new Map();state.textureKeys=new Set();state.texturePixels=0;$('animation-clip').replaceChildren(element('option','연결된 동작 없음'));updateTime();}
async function texture(id,materials,role='base'){
  const model=state.model,generation=state.generation,timings=state.timings;
  model.textureTasks??=new Map();const taskKey=role+':'+id;
  if(!model.textureTasks.has(taskKey))model.textureTasks.set(taskKey,(async()=>{
    // Metadata is revalidated even on GPU-cache hits; ID alone is not an identity.
    const metadata=await api('/api/composition-source/'+id);
    if(state.generation!==generation||state.model!==model)return null;
    const key=taskKey+':'+metadata.image_sha256,pixels=metadata.width*metadata.height;
    const map=await textureCache.acquire(key,pixels,async()=>{
      const map=await textureLoader.loadAsync('/api/composition-image/'+id+'?token='+encodeURIComponent(token)+'&sha256='+metadata.image_sha256);
      if(viewerDisposed){map.dispose();throw Error('뷰어가 종료되었습니다.');}
      // Verified companion and XET MatCap/emission paths use UNORM resources.
      map.colorSpace=['matcap-normal','ext','glow','matcap','auxiliary'].includes(role)?THREE.NoColorSpace:THREE.SRGBColorSpace;map.flipY=false;map.wrapS=map.wrapT=['matcap','toon'].includes(role)?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping;
      const started=performance.now();try{renderer.initTexture(map);}catch(e){map.dispose();throw e;}timings.uploadMs+=performance.now()-started;
      return map;
    });
    if(state.generation!==generation||state.model!==model){textureCache.release(key);return null;}
    state.textures.set(taskKey,map);state.textureKeys.add(key);state.texturePixels+=pixels;return map;
  })());
  let map;try{map=await model.textureTasks.get(taskKey);}catch(e){model.textureTasks.delete(taskKey);throw e;}
  if(!map||state.generation!==generation||state.model!==model)return;
  materials.forEach(m=>{if(role==='auxiliary')setMaterialPreviewMap(m,map);else if(role==='matcap')setMatcapPreviewMap(m,map);else if(role==='matcap-normal')setMatcapNormalMap(m,map);else if(role==='toon')setAvatarToonMap(m,map);else if(role==='glow')setAvatarGlowMap(m,map);else if(role==='ext')setAvatarExtMap(m,map);else if(role==='second')setAvatarSecondMap(m,map);else{m.map=map;m.color.set(0xffffff);m.needsUpdate=true;}});
}
function sourceSelector(info,callback){const select=element('select');select.append(element('option',info.candidates.length?'출처를 선택하세요':'일치하는 파일 없음'));select.firstChild.value='';for(const row of info.candidates){const option=element('option',row.archive+' · #'+row.ordinal);option.value=row.id;select.append(option);}if(info.selected)select.value=info.selected;select.onchange=()=>{if(select.value)operation(()=>callback(Number(select.value)));};return select;}
async function showTextures(){
  const generation=state.generation,model=state.model;
  $('model-textures').replaceChildren();const groups=new Map();
  for(const material of state.model.materials){
    const input=material.userData.input;
    const roles={base:input.image,auxiliary:material.userData.materialPreview?input.material_preview?.image:null,matcap:material.userData.matcapPreview?input.matcap_preview?.image:null,'matcap-normal':material.userData.matcapPreview?input.matcap_preview?.normal_image:null,toon:material.userData.toonPreview?input.toon_preview?.image:null,glow:material.userData.glowPreview?input.glow_preview?.image:null,ext:material.userData.extPreview?input.ext_preview?.image:null,second:material.userData.secondPreview?input.second_preview?.image:null};
    for(const [role,info] of Object.entries(roles)){if(!info)continue;const key=role+':'+JSON.stringify(info);if(!groups.has(key))groups.set(key,{info,role,materials:[]});groups.get(key).materials.push(material);}
  }
  let failed=0;
  const jobs=[];
  const labels={base:'기본색 · ',auxiliary:'발광 미리보기 · ',matcap:'광택 미리보기 · ','matcap-normal':'표면 굴곡 · 광택 마스크 · ',toon:'원본 툰 음영 · ',glow:'원본 GLOW 보조광 · ',ext:'EXT 전역 반사 · ',second:'하이퍼 모드 SecondMap · '};
  const connected={base:'원본 해상도 적용',auxiliary:'발광 입력 연결 · 근사 미리보기',matcap:'광택 입력 연결 · 재질 설정에서 켜기','matcap-normal':'원본 표면 굴곡·광택 마스크 연결',toon:'원본 툰 연결 · 조명 설정에서 켜기',glow:'표면 보조광 연결 · 번짐/발광 전용 화면에서 제외',ext:'원본 EXT R 연결 · 지역 조명에서 반사 비교',second:'원본 보조광 연결 · 조명 설정에서 정지 미리보기'};
  for(const {info,role,materials} of groups.values()){
    const row=element('div');row.className='model-row';row.dataset.textureRole=role;row.append(element('span',labels[role]+info.name));const message=element('small');
    const load=async id=>{if(state.generation!==generation||state.model!==model)return;message.textContent='불러오는 중…';try{await texture(id,materials,role);message.textContent=connected[role];lighting.refresh();}catch(e){failed++;message.textContent='텍스처 표시 실패: '+e.message;}};
    row.append(sourceSelector(info,load),message);$('model-textures').append(row);
    if(info.selected)jobs.push(()=>load(info.selected));else{failed++;message.textContent=info.candidates.length?'여러 출처가 있어 자동으로 선택하지 않았습니다.':'동일한 파일 이름의 이미지가 없습니다.';}
  }
  await limitedMap(jobs,3,run=>run());
  if(state.generation!==generation||state.model!==model)return failed;
  if(!groups.size)$('model-textures').textContent='모델에 명시된 텍스처가 없습니다.';
  const reports=new Map();
  for(const material of state.model.materials){const report=material.userData.input.material_report;if(report?.unsupported.length)reports.set(JSON.stringify(report),report);}
  for(const report of reports.values()){
    const details=element('details');details.append(element('summary','미지원 재질 설정 · '+report.source_texture),element('p','아이템 원본: '+report.reference));
    details.append(element('p','게임 재현 미지원: '+report.unsupported.join(', ')));
    for(const aux of report.textures){const info=aux.image;details.append(element('p',aux.field+' · '+aux.texture+' · '+(info?.selected?(aux.field==='m_MultiTexName'?'출처 확인됨 · 광택 근사 미리보기 제공':'출처 확인됨 · 효과 미적용'):info?.candidates.length?'출처 중복 · 확인 필요':'원본 누락 · 확인 필요')));}
    const values=element('pre');values.textContent=JSON.stringify({source_values:report.source_values,inputs:report.inputs,toon_changes:report.toon_changes},null,2);details.append(values);$('model-textures').append(details);
  }
  return failed;
}
function updateMaterialPreview(){
  const supported=state.model?.materials.some(m=>m.userData.materialPreview)||false;
  $('material-preview').disabled=!supported;$('material-preview-note').hidden=!supported;
  state.model?.materials.forEach(m=>setMaterialPreview(m,$('material-preview').checked));
  lighting.refresh();
}
function showParts(){
  const panel=$('model-parts');panel.replaceChildren();const places=new Map();
  const equipped=new Map();
  for(const source of state.data.sources){const key=source.appearance_key||source.entry_id;if(!equipped.has(key))equipped.set(key,[]);equipped.get(key).push(source);}
  const count=element('p','착용 중 '+equipped.size+'개');count.className='equipment-summary';panel.append(count);
  for(const sources of equipped.values()){
    const source=sources[0],part=sources.some(s=>s.entry_id===state.eye?.face_id)?'EYES':source.model_group?.part;
    if(!places.has(part)){const box=element('section');box.className='equipped-slot';box.append(element('h3',partLabels[part]||'기타 모델'));places.set(part,box);panel.append(box);}
    const row=element('div');row.className='model-part';const header=element('div');header.className='equipped-item-header';const title=element('span',source.display_name||source.name);title.title=(source.game_names||[]).join('\n');header.append(title);row.append(header);
    const metadata=element('details');metadata.append(element('summary',sources.length>1?'구성 모델 '+sources.length+'개':'파일 정보'));
    for(const component of sources){metadata.append(element('p',component.name),element('p',component.archive+' · #'+component.ordinal));if(component.saved_exists){const a=element('a','원본 파일 저장');a.href='/api/download/'+component.entry_id+'?token='+encodeURIComponent(token);metadata.append(a);}else metadata.append(element('p','원본 저장은 라이브러리에서 이 항목을 추출하세요.'));}
    row.append(metadata);
    const remove=element('button','제외');remove.className='secondary';remove.setAttribute('aria-label',(source.display_name||source.name)+' 제외');const componentIds=new Set(sources.map(s=>s.entry_id));remove.onclick=()=>state.ids.length===sources.length?$('clear-model').click():operation(()=>loadModel(state.ids.filter(id=>!componentIds.has(id)),state.skeleton));header.append(remove);
    places.get(part).append(row);
  }
  const empty=Object.keys(slots).filter(part=>!places.has(part));
  if(empty.length&&state.data.sources.some(s=>s.model_group?.kind==='avatar')){const remaining=element('details');remaining.className='empty-equipment';remaining.append(element('summary','빈 부위 '+empty.length+'개'));const tags=element('div');for(const part of empty)tags.append(element('span',slots[part]));remaining.append(tags);panel.append(remaining);}
  $('motion-choice').replaceChildren();const motion=state.data.motion;if(motion?.candidates.length){$('motion-choice').append(element('h3','캐릭터 공용 뼈'));for(const candidate of motion.candidates){const button=element('button',candidate.name+' 연결');button.title=candidate.archive;button.onclick=()=>operation(()=>loadModel(state.ids,candidate.id));$('motion-choice').append(button);}}
  $('motion-choice').append(element('p','현재 뼈: '+state.data.skeleton_source.name));
}
async function connectAnimation(id){
  cancelSequence();
  const generation=state.generation,version=++animationVersion,skeleton=state.data.skeleton_source,started=performance.now(),timings=state.timings;
  const current=()=>state.generation===generation&&animationVersion===version;
  stop();clipVersion++;if(state.model)restorePose(state.model,state.data);state.clip=null;state.animation=null;state.time=0;updateTime();$('animation-clip').replaceChildren(element('option','연결 확인 중…'));
  try{const data=await api('/api/model-animations?skeleton='+skeleton.entry_id+'&animation='+id);if(!current())return;if(data.skeleton_source.sha256!==skeleton.sha256)throw Error('뼈 파일이 변경되었습니다. 모델을 다시 열어 주세요.');state.animation={...data,id};$('animation-clip').title=data.animation_source.name;$('animation-choice').querySelector('p').textContent='현재 동작 파일: '+data.animation_source.name;$('animation-clip').replaceChildren(element('option','동작을 선택하세요'));$('animation-clip').firstChild.value='';for(const clip of data.clips){const option=element('option',clipLabel(clip)+' · '+clip.duration.toFixed(2)+'초');option.value=clip.index;$('animation-clip').append(option);}$('animation-verification').textContent=`${data.mapping.verified_bones}개 뼈 · 기본 자세 ${data.mapping.verified_keys}개 키 대조 · 최대 오차 ${data.mapping.maximum_error.toExponential(2)}. 게임 셰이더·효과와 화면 일치 검증은 별도입니다.`;}
  catch(e){if(!current())return;$('animation-clip').replaceChildren(element('option','동작 연결 검증 실패'));$('animation-verification').textContent=e.message;throw e;}
  finally{if(current()){timings.animationMs=performance.now()-started;setBusy(state.busy);}}
}
async function applyEye(item,face,texture,baseFace){
  const sources=state.data?.sources||[];
  if(sources.some(s=>s.model_group?.kind!=='avatar'||s.model_group.character!==item.character))throw Error('현재 모델과 눈동자의 캐릭터가 다릅니다. 같은 캐릭터를 선택하세요.');
  const remaining=sources.filter(s=>s.entry_id!==state.eye?.face_id&&(item.geometry||s.model_group.part!=='FACE'));
  const ids=remaining.map(s=>s.entry_id);
  if(item.geometry&&!remaining.some(s=>s.model_group.part==='FACE')){if(!baseFace)throw Error('함께 표시할 기본 얼굴의 출처를 선택하세요.');ids.push(baseFace);}
  ids.push(face);
  await loadModel(ids,state.skeleton,{key:item.key,face_id:face,texture_id:texture});
}
async function loadModel(ids,skeleton=null,eye=state.eye,items=Object.fromEntries((state.data?.sources||[]).filter(s=>ids.includes(s.entry_id)&&s.appearance_key).map(s=>[s.entry_id,s.appearance_key]))){
  cancelSequence();stop();
  const generation=++state.generation,started=performance.now();animationVersion++;clipVersion++;
  modelController?.abort();modelController=new AbortController();
  const timings=state.timings={uploadMs:0};
  const current=()=>state.generation===generation;
  if(eye&&!ids.includes(eye.face_id))eye=null;
  const parameters=new URLSearchParams({entries:ids.join(',')});if(Object.keys(items).length)parameters.set('items',JSON.stringify(items));if(skeleton)parameters.set('skeleton',skeleton);if(eye){parameters.set('eye',eye.key);parameters.set('eye_face',eye.face_id);if(eye.texture_id)parameters.set('eye_texture',eye.texture_id);}
  $('model-status').classList.add('is-loading');$('viewport').setAttribute('aria-busy','true');
  try{
  status(`모델 여는 중… · ${ids.length}개 파일의 데이터를 불러오고 있습니다.`);
  const data=await api('/api/model-scene?'+parameters,modelController.signal);if(!current())return;timings.sceneMs=performance.now()-started;
  ids=data.sources.map(s=>s.entry_id);parameters.set('entries',ids.join(','));const resolvedItems=Object.fromEntries(data.sources.filter(s=>s.appearance_key).map(s=>[s.entry_id,s.appearance_key]));if(Object.keys(resolvedItems).length)parameters.set('items',JSON.stringify(resolvedItems));
  const buildStarted=performance.now(),model=buildModel(data);timings.buildMs=performance.now()-buildStarted;
  const character=avatarCharacter(data),preserveView=!!state.model&&$('preserve-view').checked&&!!character&&character===avatarCharacter(state.data);
  disposeModel();state.ids=ids;state.eye=data.eye_avatar||null;state.skeleton=skeleton;state.data=data;state.model=model;scene.add(model.root);boneHelper=new THREE.SkeletonHelper(model.root);boneHelper.visible=$('show-bones').checked;scene.add(boneHelper);updateMeshVisibility();state.model.materials.forEach(m=>m.wireframe=$('wireframe').checked);showParts();if(!preserveView)resetCamera();
  status('모델 여는 중… · 텍스처를 적용하고 있습니다.');updateMaterialPreview();const textureStarted=performance.now();
  const failed=await showTextures();if(!current())return;lighting.refresh();timings.textureMs=performance.now()-textureStarted;
  // Readiness includes a rendered frame with textures, even when XMD is slow.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(!current())return;
  timings.readyMs=performance.now()-started;
  $('animation-choice').replaceChildren(element('p',data.animation.name));$('animation-choice').append(sourceSelector(data.animation,connectAnimation));$('animation-verification').textContent=data.animation.selected?'모델 표시 완료 · 동작 연결을 준비하고 있습니다.':'연결할 XMD가 없거나 출처 선택이 필요합니다.';
  if(data.animation.selected)void connectAnimation(data.animation.selected).catch(()=>{});
  const vertices=data.meshes.reduce((s,m)=>s+m.vertices.length/3,0);status(`${ids.length}개 파일 · 메시 ${data.meshes.length}개 · 정점 ${vertices.toLocaleString()}개${data.equipment_visibility?.hidden.length?' · 장비 겹침 방지 '+data.equipment_visibility.hidden.length+'개 메시 숨김':''}${failed?' · 텍스처 확인 필요 '+failed+'개':''}${data.warnings.length?' · '+data.warnings.join(' '):''}`);
  document.dispatchEvent(new Event('model-selection'));
  history.replaceState(null,'','/model?'+parameters);
  }finally{if(current()){$('model-status').classList.remove('is-loading');$('viewport').setAttribute('aria-busy','false');}}
}
async function chooseClip(index){
  cancelSequence();
  const generation=state.generation,version=++clipVersion;
  stop();state.clip=null;state.time=0;updateTime();const a=state.animation;
  const clip=await api('/api/model-clip?skeleton='+state.data.skeleton_source.entry_id+'&animation='+a.id+'&clip='+index+'&sha256='+a.animation_source.sha256);if(generation!==state.generation||version!==clipVersion||a!==state.animation)return;if(clip.skeleton_source.sha256!==state.data.skeleton_source.sha256)throw Error('뼈 파일이 변경되었습니다. 모델을 다시 열어 주세요.');state.clip=clip;await extras.select([clip]);if(generation!==state.generation||version!==clipVersion||a!==state.animation)return;$('animation-clip').value=clip.clip.index;applyPose(state.model,clip,0);updateTime();status('게임 동작 불러오기 완료: '+clipLabel(clip.clip));
}
async function chooseSequence(definition,onProgress){
  if(definition.status!=='ready')throw Error(definition.error||'묶음 동작을 연결할 수 없습니다.');
  cancelSequence();stop();
  if(definition.skeleton_id!==state.data.skeleton_source.entry_id){
    const expectedGeneration=state.generation+1;
    const items=Object.fromEntries(state.data.sources.filter(s=>s.appearance_key).map(s=>[s.entry_id,s.appearance_key]));
    await loadModel(state.ids,definition.skeleton_id,state.eye,items);
    if(state.generation!==expectedGeneration||state.data?.skeleton_source.entry_id!==definition.skeleton_id)return;
  }
  const generation=state.generation,version=++animationVersion,skeleton=state.data.skeleton_source;
  clipVersion++;
  const controller=new AbortController();sequenceController=controller;
  const clips=[];let transforms=0;
  for(const step of definition.steps){
    onProgress?.(`묶음 동작을 준비하는 중입니다. (${clips.length+1}/${definition.steps.length})`);
    const clip=await api('/api/model-clip?'+new URLSearchParams({skeleton:skeleton.entry_id,animation:step.animation_id,clip:step.clip_index,sha256:step.sha256}),controller.signal);
    if(generation!==state.generation||version!==animationVersion||controller.signal.aborted)return;
    if(clip.skeleton_source.sha256!==skeleton.sha256)throw Error('뼈 파일이 변경되었습니다. 모델을 다시 열어 주세요.');
    transforms+=clip.keys.reduce((n,k)=>n+k.transforms.length,0);
    if(transforms>300000)throw Error('묶음 동작의 전체 뼈 키 변환은 300,000개까지 지원합니다.');
    clips.push(clip);
  }
  state.sequence=new MotionSequencePlayer(definition,clips);state.animation=null;state.clip=state.sequence.clip;state.time=state.sequence.time;
  applyPose(state.model,state.clip,state.time);onProgress?.('묶음 동작의 보조 모델과 효과를 준비하는 중입니다.');await extras.select(clips,definition.steps);if(generation!==state.generation||version!==animationVersion||controller.signal.aborted)return;stop();updateTime();status('묶음 동작 선택: '+definition.label);
}
const motions=setupMotions({state,api,operation,connectAnimation,chooseClip,chooseSequence,loadModel,element});
const {search}=setupPicker({state,api,operation,loadModel,applyEye,element,previews:setupPreviews({api})});
$('clear-model').onclick=()=>{
  if(state.busy||!state.model)return;
  state.generation++;modelController?.abort();
  disposeModel();state.ids=[];state.eye=null;state.skeleton=null;state.data=null;updateMaterialPreview();
  $('model-parts').replaceChildren(element('p','선택한 모델이 없습니다.'));
  $('motion-choice').replaceChildren();$('animation-choice').replaceChildren(element('p','연결된 동작 없음'));
  $('model-textures').replaceChildren();$('animation-verification').textContent='XMD의 _DEFAULT 자세와 X의 전체 뼈 행렬을 대조한 뒤 재생합니다.';
  target.set(0,0,0);Object.assign(orbit,{yaw:0,pitch:.15,distance:150});
  camera.near=.1;camera.far=100000;camera.updateProjectionMatrix();
  document.dispatchEvent(new Event('model-selection'));history.replaceState(null,'','/model');setBusy(false);status('선택한 모델을 초기화했습니다. 모델을 다시 선택해 주세요.');
};
$('reset-camera').onclick=resetCamera;$('bind-pose').onclick=()=>{if(!state.model||state.busy)return;clipVersion++;cancelSequence();stop();restorePose(state.model,state.data);state.clip=null;state.time=0;updateTime();setBusy(false);$('animation-clip').value='';$('motion-library').close();status('X 파일의 기본 자세');};
$('show-helpers').onchange=$('show-equipment-hidden').onchange=updateMeshVisibility;$('wireframe').onchange=()=>state.model?.materials.forEach(m=>m.wireframe=$('wireframe').checked);$('show-bones').onchange=()=>{if(boneHelper)boneHelper.visible=$('show-bones').checked;};
$('material-preview').onchange=updateMaterialPreview;
$('finish-motion').onclick=()=>{if(!state.sequence||state.busy||state.extrasLoading||state.sequence.completed)return;void extras.unlockAudio();state.sequence.requestFinish();state.playing=true;$('play-animation').textContent='일시정지';$('play-animation').setAttribute('aria-pressed','true');updateSequenceControls();};
$('animation-clip').onchange=()=>{if($('animation-clip').value!=='')operation(()=>chooseClip(Number($('animation-clip').value)));};$('play-animation').onclick=()=>{if(!state.clip||state.busy||state.extrasLoading)return;void extras.unlockAudio();if(state.sequence?.completed){state.sequence.restart();extras.seek();state.clip=state.sequence.clip;state.time=state.sequence.time;}state.playing=!state.playing;if(!state.playing)extras.pauseAudio();if(!state.sequence&&state.playing&&state.time>=state.clip.clip.duration){state.time=0;extras.seek();}$('play-animation').textContent=state.playing?'일시정지':'재생';$('play-animation').setAttribute('aria-pressed',String(state.playing));};$('animation-seek').oninput=()=>{if(!state.clip||state.busy||state.extrasLoading)return;stop();state.time=Number($('animation-seek').value);if(state.sequence){state.sequence.seek(state.time);state.time=state.sequence.time;}extras.seek();applyPose(state.model,state.clip,state.time);updateTime();};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('pagehide',()=>{viewerDisposed=true;state.generation++;modelController?.abort();renderer?.setAnimationLoop(null);disposeModel();extras.dispose();stage?.dispose();textureCache.clear();emissionRenderer?.dispose();renderer?.dispose();});
// Readable state also allows the isolated browser checks to inspect actual bone/mesh results.
window.modelViewer={get view(){return {target:target.toArray(),...orbit};},state,loadModel:(...args)=>operation(()=>loadModel(...args),true),chooseClip:index=>operation(()=>chooseClip(index)),textureCache,extras,THREE};
try{initRenderer();await operation(async()=>{await search();const query=new URLSearchParams(location.search),ids=(query.get('entries')||'').split(',').filter(Boolean).map(Number);if(ids.length)await loadModel(ids,query.has('skeleton')?Number(query.get('skeleton')):null,query.has('eye')?{key:query.get('eye'),face_id:Number(query.get('eye_face')),texture_id:query.has('eye_texture')?Number(query.get('eye_texture')):null}:null,query.has('items')?JSON.parse(query.get('items')):{});});}catch(e){status('3D 그래픽 초기화 실패: '+e.message);}
