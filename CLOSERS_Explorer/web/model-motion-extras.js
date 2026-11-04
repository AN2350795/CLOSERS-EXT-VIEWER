import * as THREE from './vendor/three/three.module.min.js';
import {buildModel,applyPose,setAvatarBaseMap} from './model-core.js';
import {TextureCache} from './model-texture-cache.js';
import {createTracks,random,vector,sample,EFFECT_ROTATION_ORDER} from './effect-timeline.js';
import {createParticleModel,applyBlend,EFFECT_ALPHA_TEST,effectRenderOrder} from './particle-model.js';
import {createFBXModel,createSpineModel} from './model-effect-formats.js';
import {installDissolve} from './model-effect-dissolve.js';
import {applyEmbeddedPose} from './model-x-animation.js';
import {chooseTextureSequence} from './model-texture-animation.js';
import {MotionAudio} from './model-motion-audio.js';

// Explicit states declared by the source dance skills. Snowman/pet states
// reuse the same XMD clip and must not become the default dance presentation.
const DANCE_STATES={EMOTION_DANCE:'USN_EMOTION_DANCE',EMOTION_DANCE_2:'USN_EMOTION_DANCE2'};
const CUSTOM_FIELDS=['m_vecShowEffectCustomID','m_vecHideEffectCustomID'];
const DANCE_LIGHT_EFFECT='DE_HYPER_MODE_2026_BOSS_HOD_BUFF_SPOT_LIGHT';

function danceLightKeys(entries,state){
  const rows=new Map(entries.map(e=>[e.key,e])),roots=new Set(entries.filter(e=>e.state===state&&e.label===DANCE_LIGHT_EFFECT).map(e=>e.key)),selected=new Set();
  for(const entry of entries){
    const path=[];let current=entry;
    while(current&&!path.includes(current.key)){path.push(current.key);if(roots.has(current.key)){selected.add(entry.key);break;}current=rows.get(current.parent_key);}
  }
  for(const key of roots){let current=rows.get(key);const seen=new Set();while(current&&!seen.has(current.key)){seen.add(current.key);selected.add(current.key);current=rows.get(current.parent_key);}}
  return selected;
}

export function setupMotionExtras({state,api,getScene,getCamera,onVisible,onEquipmentVisibility,onLoadingChange,element}){
  const button=element('button','연출 설정');button.id='motion-extras-settings';button.type='button';button.className='secondary';button.disabled=true;
  button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','motion-extras-dialog');
  document.querySelector('.animation-options').append(button);
  const progress=element('span','연출 준비 중…');progress.hidden=true;progress.setAttribute('role','status');document.querySelector('.animation-options').append(progress);
  const dialog=element('dialog');dialog.id='motion-extras-dialog';dialog.setAttribute('aria-labelledby','motion-extras-title');
  dialog.innerHTML='<div class="view-settings-heading"><h2 id="motion-extras-title">모션 연출</h2><button type="button" class="secondary">닫기</button></div><div class="motion-extra-switches"><label><input id="show-motion-props" type="checkbox"> 보조 모델 표시</label><label><input id="show-motion-effects" type="checkbox"> 모션 효과 표시</label></div><p class="muted">모델과 파티클을 모션에 맞춰 표시합니다. 게임 전용 물리·셰이더는 근사하며 항목별 안내를 확인할 수 있습니다.</p><p id="motion-extras-status" role="status"></p><div id="motion-extra-items"></div>';
  document.body.append(dialog);
  const danceControls=element('label','춤 조명 '),danceLight=element('select');danceControls.id='motion-dance-controls';danceControls.hidden=true;danceLight.id='motion-dance-light';danceLight.setAttribute('aria-label','춤 조명');
  for(const [value,label] of [['none','없음 · 기본 춤'],['spotlight','스포트라이트·음표']]){const option=element('option',label);option.value=value;danceLight.append(option);}danceControls.append(danceLight);dialog.querySelector('.motion-extra-switches').before(danceControls);
  const advanced=element('details');advanced.append(element('summary','개별 연출·출처'),dialog.querySelector('#motion-extra-items'));dialog.append(advanced);
  const audio=new MotionAudio();
  const volumeControls=element('div');volumeControls.className='motion-audio-controls';volumeControls.hidden=true;volumeControls.setAttribute('role','group');volumeControls.setAttribute('aria-label','모션 소리 조절');
  const muteButton=element('button'),volumeLabel=element('label','소리'),volumeInput=element('input'),volumeOutput=element('output');
  muteButton.id='motion-audio-mute';muteButton.type='button';muteButton.className='secondary';volumeInput.id='motion-audio-volume';volumeInput.type='range';volumeInput.min=0;volumeInput.max=100;volumeInput.step=1;volumeInput.setAttribute('aria-label','모션 소리 음량');volumeOutput.htmlFor=volumeInput.id;volumeLabel.append(volumeInput,volumeOutput);volumeControls.append(muteButton,volumeLabel);document.querySelector('.animation-controls').append(volumeControls);
  const volumeKey='closers-motion-audio-volume';let muted=false,lastVolume=100;volumeInput.value=100;
  try{const value=JSON.parse(localStorage.getItem(volumeKey)||'{}');if(typeof value?.volume==='number'&&Number.isFinite(value.volume))volumeInput.value=Math.max(0,Math.min(100,value.volume));muted=value?.muted===true;if(typeof value?.lastVolume==='number'&&Number.isFinite(value.lastVolume)&&value.lastVolume>0)lastVolume=Math.min(100,value.lastVolume);}catch{}
  function applyVolume(save=false){const value=Number(volumeInput.value),silent=muted||value===0;audio.setVolume(value/100,muted);volumeOutput.value=value+'%';volumeInput.setAttribute('aria-valuetext',value+'%'+(silent?' (음소거)':''));muteButton.textContent=silent?'음소거 해제':'음소거';muteButton.setAttribute('aria-pressed',String(silent));if(save)try{localStorage.setItem(volumeKey,JSON.stringify({volume:value,muted,lastVolume}));}catch{}}
  volumeInput.oninput=()=>{if(Number(volumeInput.value)>0){muted=false;lastVolume=Number(volumeInput.value);}applyVolume(true);};
  muteButton.onclick=()=>{if(Number(volumeInput.value)===0){volumeInput.value=lastVolume;muted=false;}else muted=!muted;applyVolume(true);};applyVolume();
  const $=id=>document.getElementById(id),cache=new TextureCache({maxPixels:64*1024*1024,maxEntries:256}),loader=new THREE.TextureLoader();
  const conditional=element('label'),conditionCheck=element('input');conditionCheck.type='checkbox';conditionCheck.id='show-conditional-extras';conditional.append(conditionCheck,element('span','조건부 연출도 미리보기'));dialog.querySelector('.motion-extra-switches').append(conditional);
  for(const [id,label] of [['show-motion-sounds','효과음·음악 재생'],['show-motion-voices','보이스 재생'],['show-motion-colors','캐릭터 색상 연출']]){const row=element('label'),input=element('input');input.id=id;input.type='checkbox';input.checked=true;row.append(input,element('span',label));dialog.querySelector('.motion-extra-switches').append(row);}
  const soundGroup=element('select');soundGroup.id='motion-sound-group';soundGroup.setAttribute('aria-label','변형 음원 선택');soundGroup.hidden=true;dialog.querySelector('.motion-extra-switches').after(soundGroup);
  const stateChoice=element('select');stateChoice.id='motion-extra-state';stateChoice.setAttribute('aria-label','연출 상태 선택');stateChoice.hidden=true;dialog.querySelector('.motion-extra-switches').after(stateChoice);
  let entries=[],assets=new Map(),version=0,controller,packets=[],lastPacket=null,lastTime=0,total=0,stageClock=0,disposed=false;
  let loading=false;
  function setLoading(value){if(loading===value)return;loading=value;progress.hidden=!value;onLoadingChange?.(value);}
  const excluded=new Set(),hiddenEquipment=new Map(),token=document.querySelector('meta[name="explorer-token"]').content;
  const preferences=[['show-motion-props','models'],['show-motion-effects','effects'],['show-motion-sounds','sounds'],['show-motion-voices','voices'],['show-motion-colors','colors']];
  let saved={};try{saved=JSON.parse(localStorage.getItem('closers-motion-extras')||'{}')||{};}catch{}
  for(const [id,key] of preferences)$(id).checked=saved[key]!==false;
  const danceEntry=entry=>Boolean(DANCE_STATES[entry.packet?.clip?.name]&&DANCE_STATES[entry.packet.clip.name]===entry.state);
  const customCondition=value=>Object.entries(value||{}).some(([k,v])=>CUSTOM_FIELDS.includes(k)||(k==='parent'&&customCondition(v)));
  const spotlightCondition=value=>Object.entries(value||{}).some(([k,v])=>k==='m_vecShowEffectCustomID'&&v&&typeof v==='object'&&Object.values(v).includes(13)||k==='parent'&&spotlightCondition(v));
  function conditions(entry,value=entry.conditions||{}){
    let unresolved=false;
    for(const [key,v] of Object.entries(value)){
      if(key==='parent'){const parent=conditions(entry,v);if(!parent.allowed)return parent;unresolved||=parent.unresolved;continue;}
      if(!CUSTOM_FIELDS.includes(key)){unresolved=true;continue;}
      const ids=v&&typeof v==='object'&&!Array.isArray(v)?Object.values(v):[];
      if(!ids.length||!ids.every(id=>Number.isSafeInteger(id)&&id>0))return {allowed:false,unresolved};
      const selected=danceEntry(entry)&&entry.danceLightPart&&danceLight.value==='spotlight'?13:null;
      if(key==='m_vecShowEffectCustomID'&&!ids.includes(selected)||key==='m_vecHideEffectCustomID'&&ids.includes(selected))return {allowed:false,unresolved};
    }
    return {allowed:true,unresolved};
  }
  const enabled=entry=>{
    if(DANCE_STATES[entry.packet?.clip?.name]&&entry.condition_schema!==2)return false;
    const check=conditions(entry);
    return check.allowed&&!excluded.has(entry.id)&&(!check.unresolved||conditionCheck.checked)&&(!entry.ambiguous||entry.state===stateChoice.value)&&(entry.kind==='equipment'||(entry.kind==='sound'?$(entry.voice?'show-motion-voices':'show-motion-sounds').checked&&(entry.sound_group==null||String(entry.sound_group)===soundGroup.value):entry.kind==='color'?$('show-motion-colors').checked:entry.kind==='model'?$('show-motion-props').checked:$('show-motion-effects').checked));
  };
  function updateDanceControls(){
    const available=entries.some(e=>e.packet===state.clip&&danceEntry(e)&&e.danceLightPart&&e.condition_schema===2&&e.status==='ready'&&spotlightCondition(e.conditions));
    danceControls.hidden=!available;
    if(!available)danceLight.value='none';
  }
  const colors=new Map();
  function restoreColors(){for(const [m,base] of colors){m.color.copy(base.color);m.opacity=base.opacity;if(m.transparent!==base.transparent){m.transparent=base.transparent;m.needsUpdate=true;}}colors.clear();}
  function equipment(parts=new Set()){
    let changed=false;
    for(const [mesh,visible] of hiddenEquipment)if(!parts.has(mesh.userData.part)){mesh.userData.motionHidden=false;mesh.visible=visible;hiddenEquipment.delete(mesh);changed=true;}
    for(const mesh of state.model?.meshes||[])if(parts.has(mesh.userData.part)&&!hiddenEquipment.has(mesh)){hiddenEquipment.set(mesh,mesh.visible);mesh.userData.motionHidden=true;mesh.visible=false;changed=true;}
    if(changed)onEquipmentVisibility?.();
  }
  function disposeAsset(asset){asset.anchor.removeFromParent();asset.model?.dispose();asset.owned?.forEach(v=>v.dispose());asset.extraMeshes?.forEach(v=>v.removeFromParent());for(const key of asset.textureKeys)cache.release(key);}
  function release(){audio.reset();restoreColors();equipment();for(const group of assets.values())for(const asset of group)disposeAsset(asset);assets.clear();cache.clear();}
  function reset(){version++;controller?.abort();setLoading(false);release();entries=[];packets=[];lastPacket=null;total=0;stageClock=0;danceLight.value='none';danceControls.hidden=true;stateChoice.hidden=true;stateChoice.replaceChildren();excluded.clear();button.disabled=true;if(dialog.open)dialog.close();render();}
  function render(){
    dialog.querySelector('p.muted').textContent=danceControls.hidden?'모델과 파티클을 모션에 맞춰 표시합니다. 게임 전용 물리·셰이더는 근사하며 항목별 안내를 확인할 수 있습니다.':'춤 조명은 직접 선택할 때만 적용됩니다. 동작을 바꾸면 해제됩니다.';
    volumeControls.hidden=!entries.some(entry=>entry.kind==='sound'&&entry.status==='ready'&&enabled(entry)&&entry.sounds?.some(sound=>sound.selected));
    const container=$('motion-extra-items');container.replaceChildren();
    for(const entry of entries){
      if(customCondition(entry.conditions))continue;
      const row=element('div');row.className='motion-extra-row';
      const label=element('label'),check=element('input');check.type='checkbox';check.checked=entry.status==='ready'&&!excluded.has(entry.id);check.disabled=entry.status!=='ready';
      check.onchange=()=>{if(check.checked)excluded.delete(entry.id);else excluded.add(entry.id);void refresh();};
      label.append(check,element('span',entry.label));row.append(label);
      row.append(element('small',entry.error||entry.loadError||(entry.kind==='equipment'?'지정된 구간에서 무기를 숨깁니다.':assets.has(entry.id)?'표시 준비됨':entry.status==='ready'?'선택한 표시 옵션에 따라 적용':'연결 확인 필요')));
      const warnings=[...(entry.warnings||[]),...(entry.loadWarnings||[])];if(warnings.length)row.append(element('small',warnings.join(' ')));
      if(Object.keys(entry.conditions||{}).length)row.append(element('small','조건 · '+JSON.stringify(entry.conditions)));
      if(entry.kind==='sound'&&entry.sounds?.length>1){const choice=element('select');choice.setAttribute('aria-label','재생할 음원');const random=element('option','후보 중 하나 재생');random.value='';choice.append(random);entry.sounds.forEach((s,i)=>{const option=element('option',s.name);option.value=i;choice.append(option);});choice.value=entry.soundChoice??'';choice.onchange=()=>{entry.soundChoice=choice.value===''?null:Number(choice.value);audio.seek();};row.append(choice);}
      for(const resource of [...(entry.resources||[]),...(entry.sounds||[]),...(entry.spine_sources||[]),...(entry.images||[]),...(entry.dissolve_image?[entry.dissolve_image]:[]),...(entry.mask_image?[entry.mask_image]:[])])if(resource.candidates?.length>1){
        const select=element('select');select.setAttribute('aria-label',resource.name+' 출처');select.append(element('option','출처 선택 · '+resource.name));select.firstChild.value='';
        for(const candidate of resource.candidates){const option=element('option',candidate.archive+' · '+candidate.ordinal);option.value=candidate.id;select.append(option);}select.value=resource.selected||'';
        select.onchange=()=>{resource.selected=Number(select.value)||null;void refresh();};row.append(select);
      }
      const details=element('details');details.append(element('summary','출처'),element('small',entry.source+(entry.mesh_source?' · '+entry.mesh_source:'')),element('small',entry.state||'모션에 직접 연결'));
      if(entry.events)details.append(element('pre',JSON.stringify(entry.events,null,2)));
      if(entry.notes)details.append(element('small',entry.notes));row.append(details);container.append(row);
    }
    if(!entries.length)container.append(element('p',packets.some(p=>p.extras_index_available)?'이 동작에 연결된 연출이 없습니다.':'연출 정보가 없습니다. 라이브러리에서 후처리만 실행하면 연결 정보를 갱신할 수 있습니다.'));
  }
  function assertCurrent(current,signal){
    if(disposed||current!==version||signal.aborted)throw new DOMException('연출 선택이 변경되었습니다.','AbortError');
  }
  async function image(info,current,signal,asset,entry){
    assertCurrent(current,signal);
    if(!info?.selected){entry.loadWarnings.push('텍스처 미확인 · '+(info?.name||'원본 없음')+' · 단색 미리보기');return null;}
    const metadata=await api('/api/composition-source/'+info.selected,signal);
    assertCurrent(current,signal);
    const key=current+':'+info.selected+':'+metadata.image_sha256;
    const map=await cache.acquire(key,metadata.width*metadata.height,async()=>{
      assertCurrent(current,signal);
      const value=await loader.loadAsync('/api/composition-image/'+info.selected+'?token='+encodeURIComponent(token)+'&sha256='+metadata.image_sha256);
      // The decoder cannot be aborted. Reject before the cache takes ownership
      // so a late result is disposed once, even if reset already cleared it.
      try{assertCurrent(current,signal);}catch(e){value.dispose();throw e;}
      value.colorSpace=THREE.SRGBColorSpace;value.flipY=false;value.wrapS=value.wrapT=THREE.RepeatWrapping;return value;
    });
    try{assertCurrent(current,signal);}catch(e){cache.release(key);throw e;}
    asset.textureKeys.push(key);return map;
  }
  async function load(entry,resource,current,signal){
    if(resource&&!resource.selected)throw Error('모델 출처를 선택해 주세요: '+resource.name);
    const fbx=resource?.name?.toUpperCase().endsWith('.FBX');
    const data=resource&&!fbx?await api('/api/model-scene?entries='+resource.selected,signal):null;
    if(current!==version||disposed)throw Error('연출 선택이 변경되었습니다.');
    let model=data?buildModel(data):null;
    const anchor=new THREE.Group(),asset={model,anchor,textureKeys:[],textureAnimations:[],owned:[],extraMeshes:[],begun:false,born:0,packet:entry.packet,customDecoration:customCondition(entry.conditions)};
    anchor.visible=false;anchor.matrixAutoUpdate=false;
    try{
      if(fbx){model=await createFBXModel(await api('/api/model-effect-resource?entry='+resource.selected,signal));asset.model=model;}
      if(model)for(const material of model.materials){
        const info=material.userData.input.image;if(!info)continue;
        const map=await image(info,current,signal,asset,entry);
        if(map)setAvatarBaseMap(material,map);
        const sequence=chooseTextureSequence(material.userData.input,entry.packet);
        if(!sequence&&material.userData.input.texture_animation_choices?.length)entry.loadWarnings.push('재질 애니메이션 후보가 중복되어 첫 이미지로 표시합니다: '+material.userData.input.texture_animation_choices.map(s=>s.name).join(', '));
        if(sequence&&entry.kind!=='particle'){
          const frames=[];
          for(const frame of sequence.frames)frames.push({...frame,map:await image(frame,current,signal,asset,entry)});
          if(frames.every(f=>f.map))asset.textureAnimations.push({name:sequence.name,material,frames,duration:frames.reduce((n,f)=>n+f.duration,0)});
        }
      }
      if(entry.particle?.spine){
        const [skel,atlas]=entry.spine_sources;
        if(!skel.selected||!atlas.selected)throw Error('Spine SKEL·ATLAS 출처를 선택해 주세요.');
        const packet=await api('/api/model-effect-resource?entry='+skel.selected,signal),sheet=await api('/api/model-spine-atlas?entry='+atlas.selected,signal);
        sheet.images=sheet.images.map(info=>{const previous=entry.images?.find(p=>p.name===info.name);return info.candidates?.some(c=>c.id===previous?.selected)?{...info,selected:previous.selected}:info;});entry.images=sheet.images;
        const maps=[];for(const info of sheet.images)maps.push(await image(info,current,signal,asset,entry));
        model=await createSpineModel(entry.particle,packet,sheet,maps);asset.model=model;asset.spine=true;
      }else if(entry.kind==='particle'){
        const maps=[];
        for(const info of entry.images||[])maps.push(await image(info,current,signal,asset,entry));
        const mask=entry.dissolve_image?await image(entry.dissolve_image,current,signal,asset,entry):null;
        const dissolveMap=mask?.clone();if(dissolveMap){dissolveMap.colorSpace=THREE.NoColorSpace;dissolveMap.needsUpdate=true;asset.owned.push(dissolveMap);}
        const coverage=entry.mask_image?await image(entry.mask_image,current,signal,asset,entry):null;
        const coverageMap=coverage?.clone();if(coverageMap){coverageMap.colorSpace=THREE.NoColorSpace;coverageMap.needsUpdate=true;asset.owned.push(coverageMap);}
        let traceMask=null;
        if(entry.trace_receiver_key){
          const receiver=assets.get(entry.id.split(':')[0]+':'+entry.trace_receiver_key)?.[0],mesh=receiver?.model.meshes[0];
          if(!receiver||!mesh?.isInstancedMesh||!mesh.material[0]?.map)throw Error('바닥 추적 효과의 마스크를 유일하게 연결할 수 없습니다. 함께 생성되는 기본 효과를 켜 주세요.');
          asset.traceReceiver=receiver;asset.traceProjection=new THREE.Matrix4();traceMask={map:mesh.material[0].map,projection:asset.traceProjection};
        }
        model=createParticleModel(entry.particle,model,maps,{dissolveMap,traceMask,coverageMap});asset.model=model;asset.particle=true;
      }else if(entry.animation){
        try{
          if(!data.animation.selected)throw Error('자체 XMD가 없어 정적 모델로 표시합니다.');
          const info=await api('/api/model-animations?'+new URLSearchParams({skeleton:resource.selected,animation:data.animation.selected,effect:'1'}),signal);
          if(info.skeleton_source.sha256!==data.skeleton_source.sha256)throw Error('연출 모델 원본이 변경되었습니다.');
          const matches=info.clips.filter(c=>c.name===entry.animation);
          if(matches.length!==1)throw Error('효과 클립을 확정할 수 없어 정적 모델로 표시합니다.');
          asset.clip=await api('/api/model-clip?'+new URLSearchParams({skeleton:resource.selected,animation:data.animation.selected,clip:matches[0].index,sha256:info.animation_source.sha256,effect:'1'}),signal);
          if(asset.clip.skeleton_source.sha256!==data.skeleton_source.sha256)throw Error('연출 모델 원본이 변경되었습니다.');
        }catch(e){
          if(signal.aborted)throw e;asset.clip=null;
          try{
            const fallback=await api('/api/model-effect-clip?'+new URLSearchParams({skeleton:resource.selected,name:entry.animation,sha256:data.skeleton_source.sha256}),signal);
            if(fallback.skeleton_source.sha256!==data.skeleton_source.sha256)throw Error('연출 모델 원본이 변경되었습니다.');
            if(fallback.tracks)asset.embedded=fallback;else asset.clip=fallback;
            entry.loadWarnings.push(...(fallback.warnings||[]));
          }catch(fallback){if(signal.aborted)throw fallback;asset.embedded=null;entry.loadWarnings.push('정적 모델 미리보기 · '+e.message+' · '+fallback.message);}
        }
      }
      if(current!==version||signal.aborted||disposed)throw Error('연출 선택이 변경되었습니다.');
      if(entry.parent_key&&entry.bone){
        const parent=(assets.get(entry.id.split(':')[0]+':'+entry.parent_key)||[]),matches=parent.flatMap(a=>a.model.bones||[]).filter(b=>b.name===entry.bone);
        if(matches.length>1)throw Error('연출 뼈의 출처가 중복됩니다: '+entry.bone);
        asset.boneTarget=matches[0]||state.model?.bones.find(b=>b.name===entry.bone);
        if(!asset.boneTarget)throw Error('부모 연출에서 연결할 뼈를 찾지 못했습니다: '+entry.bone);
      }
      model.root.scale.z=1;anchor.add(model.root);
      asset.base=model.materials.map(m=>({color:m.color.clone(),opacity:m.opacity,material:m,dual:false}));
      if(entry.kind==='effect'){
        for(const mesh of model.meshes)mesh.renderOrder=effectRenderOrder(entry.layer);
        for(const m of model.materials){m.transparent=true;m.alphaTest=EFFECT_ALPHA_TEST;m.depthTest=entry.depth_test;m.depthWrite=entry.depth_write;applyBlend(m,entry.blend||['SRCALPHA',entry.additive?'ONE':'INVSRCALPHA']);m.userData.motionOpaqueOccluder=!entry.dissolve_texture;m.needsUpdate=true;}
        if(entry.dual)for(const mesh of [...model.meshes]){
          const copy=mesh.clone(false);copy.material=mesh.material.map(original=>{const m=original.clone();m.onBeforeCompile=original.onBeforeCompile;m.customProgramCacheKey=original.customProgramCacheKey;applyBlend(m,['SRCALPHA','DESTALPHA']);m.transparent=true;asset.owned.push(m);asset.base.push({color:m.color.clone(),opacity:m.opacity,material:m,dual:true});const sequence=asset.textureAnimations.find(s=>s.material===original);if(sequence)asset.textureAnimations.push({...sequence,material:m});return m;});
          copy.material.forEach(m=>m.userData.motionOpaqueOccluder=false);mesh.parent.add(copy);asset.extraMeshes.push(copy);
        }
        if(entry.dissolve_texture){
          const map=await image(entry.dissolve_image,current,signal,asset,entry);
          if(map){const mask=map.clone();mask.colorSpace=THREE.NoColorSpace;mask.needsUpdate=true;asset.owned.push(mask);asset.dissolve=asset.base.map(base=>installDissolve(base.material,mask));}
        }
      }
      if(current!==version||signal.aborted||disposed)throw Error('연출 선택이 변경되었습니다.');
      const seed=[...entry.id].reduce((n,c)=>((n*31)^c.charCodeAt(0))>>>0,1),rng=random(seed);
      asset.offset=vector(entry.offset,rng);asset.rotation=vector(entry.rotation,rng);asset.scale=sample(entry.scale??1,rng);
      const ownClip=asset.clip||asset.embedded;
      asset.gravity=vector(entry.gravity,rng);asset.life=entry.play_count&&ownClip?ownClip.clip.duration*entry.play_count/entry.speed:entry.life;
      asset.timeline=createTracks(entry.tracks||[],seed,asset.life);
      if(!entry.tracks?.length)asset.timeline=createTracks([{property:'color',mode:'initial',value:entry.color||[1,1,1,1]},...(entry.fades||[]).map(f=>({property:'color',mode:'fade',value:f.color,start:f.start,end:f.end}))],seed,asset.life);
      getScene().add(anchor);
      // Particle meshes already include each texture frame and blend pass.
      // Multiplying those again can reject small emitters as millions of vertices.
      asset.vertices=(model.vertices??[...model.meshes,...asset.extraMeshes].reduce((n,m)=>n+m.geometry.getAttribute('position').count,0))*(asset.particle?entry.particle.max_particles:1);
      asset.transforms=asset.clip?.keys.reduce((n,k)=>n+k.transforms.length,0)||asset.embedded?.tracks.reduce((n,t)=>n+t.keys.length,0)||0;return asset;
    }catch(e){disposeAsset(asset);throw e;}
  }
  async function refresh(){
    if(disposed)return;
    const current=++version;controller?.abort();controller=new AbortController();const signal=controller.signal;
    setLoading(true);
    try{
    release();let count=0,soundCount=0,colorCount=0,vertices=0,transforms=0;
    $('motion-extras-status').textContent='선택한 연출을 준비하고 있습니다…';
    for(const entry of entries){
      entry.loadError='';entry.loadWarnings=[];if(entry.status!=='ready'||!enabled(entry))continue;
      if(entry.kind==='sound'){try{const ready=await audio.prepare(entry,token,signal);if(entry.sounds?.length&&!ready)entry.loadError='재생할 음원이 준비되지 않았습니다. 출처와 항목별 안내를 확인하세요.';else soundCount++;}catch(e){if(current!==version)return;entry.loadError=e.message;}if(current!==version)return;continue;}
      if(entry.kind==='color'){colorCount++;continue;}
      if(entry.kind==='equipment')continue;
      const group=[];
      try{
        for(const resource of (entry.resources.length?entry.resources:entry.kind==='particle'?[null]:[])){
          if(count>=128)throw Error('연출 렌더링 예산(128개)에 도달했습니다. 개별 항목을 선택해 미리보기할 수 있습니다.');
          const asset=await load(entry,resource,current,signal);
          if(vertices+asset.vertices>1000000){disposeAsset(asset);throw Error('연출 정점 예산에 도달했습니다. 개별 항목을 선택해 주세요.');}
          if(transforms+asset.transforms>300000){disposeAsset(asset);throw Error('연출 동작의 전체 뼈 키 변환은 300,000개까지 지원합니다.');}
          count++;vertices+=asset.vertices;transforms+=asset.transforms;group.push(asset);
        }
        if(current!==version){group.forEach(disposeAsset);return;}
        assets.set(entry.id,group);
      }catch(e){for(const asset of group){count--;vertices-=asset.vertices;transforms-=asset.transforms;disposeAsset(asset);}if(current!==version)return;entry.loadError=e.message;}
    }
    if(current!==version)return;
    const requested=preferences.some(([id])=>$(id).checked);
    const converted=entries.some(e=>e.motion_conversion)?'원본 변형표 연결 · ':entries.some(e=>e.motion_conversion_options)?'원본 변형표 공통 연출 · ':'';
    const staleDance=entries.some(e=>DANCE_STATES[e.packet?.clip?.name]&&e.condition_schema!==2);
    $('motion-extras-status').textContent=staleDance?'춤 연출 정보를 갱신하려면 라이브러리에서 후처리를 실행하세요.':!danceControls.hidden&&danceLight.value==='none'?'기본 춤 · 선택 조명 없음':converted+(count||soundCount||colorCount?`${count}개 모델 · ${soundCount}개 사운드 · ${colorCount}개 색상 연출 준비됨`:requested?'표시할 수 있는 연출이 없습니다. 항목별 사유를 확인하세요.':'표시 옵션을 켜면 연결된 연출을 함께 볼 수 있습니다.');render();
    }finally{if(current===version)setLoading(false);}
  }
  function select(clips,steps=[]){
    if(disposed)return Promise.resolve();
    reset();packets=clips;button.disabled=!clips.length;
    clips.forEach((packet,index)=>{
      const all=packet.extras||[],known=steps[index]?.state||DANCE_STATES[packet.clip?.name],states=new Set(all.filter(e=>e.kind!=='model'&&e.state).map(e=>e.state));
      const lightKeys=DANCE_STATES[packet.clip?.name]===known?danceLightKeys(all,known):new Set();
      if(!known&&states.size>1){stateChoice.hidden=false;stateChoice.replaceChildren();for(const name of states){const option=element('option',name);option.value=name;stateChoice.append(option);}}
      for(const original of all){
        if(known&&original.state&&original.state!==known)continue;
        const entry={...original,id:index+':'+original.key,packet,stateSpeed:steps[index]?.speed||original.state_speed||1,danceLightPart:lightKeys.has(original.key)};
        entry.ambiguous=!known&&states.size>1&&entry.kind!=='model';
        entries.push(entry);
      }
    });
    soundGroup.replaceChildren();const base=element('option','기본 음원');base.value='';soundGroup.append(base);for(const group of new Set(entries.filter(e=>e.kind==='sound'&&e.sound_group!=null).map(e=>e.sound_group))){const option=element('option','변형 음원 '+group);option.value=group;soundGroup.append(option);}soundGroup.hidden=soundGroup.options.length===1;
    updateDanceControls();render();return refresh();
  }
  function seek(){if(disposed)return;audio.seek();lastPacket=null;total=0;for(const group of assets.values())for(const asset of group)asset.begun=false;}
  function update(delta=0){
    if(disposed||loading)return;
    updateDanceControls();
    restoreColors();
    if(!state.clip||!state.model){equipment();for(const group of assets.values())for(const asset of group)asset.anchor.visible=false;return;}
    const changed=lastPacket!==state.clip;
    if(changed){lastPacket=state.clip;stageClock=state.sequence?state.sequence.elapsed/state.sequence.definition.steps[state.sequence.index].speed:state.time;lastTime=state.time;}
    if(state.playing){const elapsed=delta*Number($('animation-speed').value);total+=elapsed;if(!changed)stageClock+=elapsed;}
    const wrapped=!changed&&state.time<lastTime-1e-6&&state.playing;lastTime=state.time;
    const births=new Map(),restarts=new Map(),hiddenParts=new Set();let frameNeeded=false;
    const frame=asset=>{if(!asset.framed){asset.framed=true;if(!asset.customDecoration)frameNeeded=true;}};
    for(const entry of entries){
      if(entry.kind==='event_info')continue;
      if(customCondition(entry.conditions)&&entry.packet!==state.clip){for(const asset of assets.get(entry.id)||[])asset.anchor.visible=false;continue;}
      const active=entry.packet===state.clip,group=assets.get(entry.id)||[];
      const parentId=entry.parent_key?entry.id.split(':')[0]+':'+entry.parent_key:null,parent=parentId?births.get(parentId):null;
      // Child event clocks are relative to their damage effect, even if its mesh is unavailable.
      const clock=parentId?(parent===undefined?-1:entry.anim_time?parent.age*parent.speed:parent.age):entry.anim_time?state.time:stageClock;
      const since=clock-entry.at;
      const rate=entry.anim_time?(parentId?parent?.speed||1:entry.stateSpeed):1;
      const restart=active&&(changed||(wrapped&&entry.anim_time)||restarts.get(parentId));restarts.set(entry.id,restart);
      if(entry.kind==='equipment'){if(active&&enabled(entry)&&clock>=entry.at&&clock<entry.until)hiddenParts.add(entry.part);continue;}
      if(active&&since>=0)births.set(entry.id,{age:since/rate,speed:entry.speed||1});
      if(entry.kind==='sound'){audio.sync(entry,{active,since,rate,total,restart,playing:state.playing,speed:Number($('animation-speed').value),enabled:entry.status==='ready'&&enabled(entry)&&!entry.loadError});continue;}
      if(entry.kind==='color'){
        if(active&&enabled(entry)&&entry.status==='ready'&&since>=0&&since/rate<entry.life){const age=since/rate,weight=entry.transition?Math.min(1,age/entry.transition,(entry.life-age)/entry.transition):1;for(const m of state.model.materials||[]){if(!colors.has(m))colors.set(m,{color:m.color.clone(),opacity:m.opacity,transparent:m.transparent});m.color.multiply(new THREE.Color(...entry.color.slice(0,3)).multiplyScalar(1+entry.emissive).lerp(new THREE.Color(1,1,1),1-weight));m.opacity*=1+(entry.color[3]-1)*weight;if(m.opacity<1&&!m.transparent){m.transparent=true;m.needsUpdate=true;}}}
        continue;
      }
      for(const asset of group){
        if(!enabled(entry)||entry.loadError||(!active&&(entry.kind==='model'||entry.state_end||!asset.begun))){asset.anchor.visible=false;continue;}
        if(restart)asset.begun=false;
        if(!asset.begun){if(!active||since<0){asset.anchor.visible=false;continue;}asset.begun=true;asset.born=total-since/rate;asset.frozen=false;}
        const age=Math.max(0,total-asset.born);
        if(age>(asset.life??entry.life)){asset.anchor.visible=false;continue;}
        const parentEntry=entry.parent_key?entries.find(e=>e.id===entry.id.split(':')[0]+':'+entry.parent_key):null;
        const parentAsset=parentEntry?(assets.get(parentEntry.id)||[]).find(a=>a.anchor.visible):null;
        const target=asset.boneTarget||parentAsset?.model.root||(entry.bone?state.model.bones.find(b=>b.name===entry.bone):state.model.root);
        if(!target){asset.anchor.visible=false;continue;}
        if(entry.follow||!asset.frozen){
          const local=new THREE.Matrix4().compose(new THREE.Vector3(...asset.offset),new THREE.Quaternion().setFromEuler(new THREE.Euler(...asset.rotation.map(THREE.MathUtils.degToRad),EFFECT_ROTATION_ORDER)),new THREE.Vector3(asset.scale,asset.scale,asset.scale));
          asset.anchor.matrix.copy(target.matrixWorld).multiply(local);asset.anchor.matrixWorldNeedsUpdate=true;asset.frozen=true;
        }
        asset.anchor.visible=true;asset.anchor.updateMatrixWorld(true);
        if(asset.traceReceiver){
          const receiver=asset.traceReceiver,mesh=receiver.model.meshes[0];
          if(!receiver.anchor.visible||!mesh.count){asset.anchor.visible=false;continue;}
          mesh.getMatrixAt(0,asset.traceProjection);asset.traceProjection.premultiply(mesh.matrixWorld);
          if(Math.abs(asset.traceProjection.determinant())<1e-10){asset.anchor.visible=false;continue;}
          asset.traceProjection.invert();
        }
        if(asset.spine||asset.particle){asset.model.update(age,getCamera?.(),asset.anchor);if(asset.spine?asset.model.vertices>0:asset.model.meshes.some(m=>m.count>0))frame(asset);continue;}
        const time=age*entry.speed;
        for(const sequence of asset.textureAnimations){
          let elapsed=age%sequence.duration,selected=sequence.frames.at(-1);
          for(const f of sequence.frames){if(elapsed<f.duration){selected=f;break;}elapsed-=f.duration;}
          sequence.material.map=selected.map;
        }
        const ownClip=asset.clip||asset.embedded;
        if(ownClip){const duration=ownClip.clip.duration,local=entry.loop&&duration>0?time%duration:Math.min(time,duration);if(asset.clip)applyPose(asset.model,asset.clip,local);else applyEmbeddedPose(asset.model,asset.embedded,local);}
        const timeline=asset.timeline,position=timeline.value('position',age,time),movement=timeline.integral('velocity',age),spin=timeline.integral('rotationSpeed',age);
        asset.model.root.position.fromArray(position.map((v,i)=>v+movement[i]+asset.gravity[i]*age*age*.5));
        const size=timeline.value('size',age,time),scale=timeline.value('scale',age,time)[0];asset.model.root.scale.set(...size.map(v=>v*scale));
        asset.model.root.rotation.set(...timeline.value('rotation',age,time).map((v,i)=>THREE.MathUtils.degToRad(v+spin[i])),EFFECT_ROTATION_ORDER);
        if(entry.billboard&&entry.billboard!=='BBT_NONE'&&getCamera?.()){
          const cameraLocal=getCamera().getWorldPosition(new THREE.Vector3()).applyMatrix4(asset.anchor.matrixWorld.clone().invert());asset.model.root.lookAt(cameraLocal);
        }
        for(const base of asset.base){
          const rgba=timeline.value(base.dual?'dualColor':'color',age,time),material=base.material;
          material.color.copy(base.color).multiply(new THREE.Color(...rgba.slice(0,3)));material.opacity=base.opacity*rgba[3];
        }
        for(const dissolve of asset.dissolve||[])dissolve.update(timeline.value('dissolveColor',age,time),timeline.value('dissolveWidth',age,time)[0],timeline.value('dissolveThreshold',age,time));
        asset.model.root.updateMatrixWorld(true);
        frame(asset);
      }
    }
    equipment(hiddenParts);if(frameNeeded)onVisible?.();
  }

  button.onclick=()=>{render();dialog.showModal();};dialog.querySelector('button').onclick=()=>dialog.close();
  conditionCheck.onchange=()=>void refresh();stateChoice.onchange=()=>void refresh();
  danceLight.onchange=()=>{if(danceLight.value==='spotlight')$('show-motion-effects').checked=true;void refresh();};
  soundGroup.onchange=()=>void refresh();
  for(const [id] of preferences)$(id).onchange=()=>{try{localStorage.setItem('closers-motion-extras',JSON.stringify(Object.fromEntries(preferences.map(([id,key])=>[key,$(id).checked]))));}catch{}void refresh();};
  reset();return {select,reset,seek,update,unlockAudio:()=>{if(!disposed)return audio.unlock();},pauseAudio:()=>{if(!disposed)audio.pause();},setBusy(value){button.disabled=disposed||value||!packets.length;},get loading(){return loading;},get assets(){return assets;},get meshes(){return [...assets.values()].flat().filter(a=>a.anchor.visible).flatMap(a=>a.model.meshes);},get framingMeshes(){return [...assets.values()].flat().filter(a=>a.anchor.visible&&!a.customDecoration).flatMap(a=>a.model.meshes);},dispose(){if(disposed)return;disposed=true;reset();void audio.dispose();}};
}
