import * as THREE from './vendor/three/three.module.min.js';
import {buildModel,applyPose} from './model-core.js';
import {TextureCache} from './model-texture-cache.js';
import {createTracks,random,vector} from './effect-timeline.js';
import {createParticleModel,applyBlend} from './particle-model.js';

export function setupMotionExtras({state,api,getScene,getCamera,element}){
  const button=element('button','연출 설정');button.id='motion-extras-settings';button.type='button';button.className='secondary';button.disabled=true;
  button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','motion-extras-dialog');
  document.querySelector('.animation-options').append(button);
  const dialog=element('dialog');dialog.id='motion-extras-dialog';dialog.setAttribute('aria-labelledby','motion-extras-title');
  dialog.innerHTML='<div class="view-settings-heading"><h2 id="motion-extras-title">모션 연출</h2><button type="button" class="secondary">닫기</button></div><div class="motion-extra-switches"><label><input id="show-motion-props" type="checkbox"> 보조 모델 표시</label><label><input id="show-motion-effects" type="checkbox"> 모션 효과 표시</label></div><p class="muted">모델과 파티클을 모션에 맞춰 표시합니다. 게임 전용 물리·셰이더는 근사하며 항목별 안내를 확인할 수 있습니다.</p><p id="motion-extras-status" role="status"></p><div id="motion-extra-items"></div>';
  document.body.append(dialog);
  const $=id=>document.getElementById(id),cache=new TextureCache({maxPixels:64*1024*1024,maxEntries:256}),loader=new THREE.TextureLoader();
  const conditional=element('label'),conditionCheck=element('input');conditionCheck.type='checkbox';conditionCheck.id='show-conditional-extras';conditional.append(conditionCheck,element('span','조건부 연출도 미리보기'));dialog.querySelector('.motion-extra-switches').append(conditional);
  const stateChoice=element('select');stateChoice.id='motion-extra-state';stateChoice.setAttribute('aria-label','연출 상태 선택');stateChoice.hidden=true;dialog.querySelector('.motion-extra-switches').after(stateChoice);
  let entries=[],assets=new Map(),version=0,controller,packets=[],lastPacket=null,lastTime=0,total=0,stageClock=0,disposed=false;
  const excluded=new Set(),token=document.querySelector('meta[name="explorer-token"]').content;
  try{const saved=JSON.parse(localStorage.getItem('closers-motion-extras')||'{}');$('show-motion-props').checked=saved.models===true;$('show-motion-effects').checked=saved.effects===true;}catch{}
  const enabled=entry=>!excluded.has(entry.id)&&(!Object.keys(entry.conditions||{}).length||conditionCheck.checked)&&(!entry.ambiguous||entry.state===stateChoice.value)&&(entry.kind==='model'?$('show-motion-props').checked:$('show-motion-effects').checked);
  function disposeAsset(asset){asset.anchor.removeFromParent();asset.model?.dispose();asset.owned?.forEach(v=>v.dispose());asset.extraMeshes?.forEach(v=>v.removeFromParent());for(const key of asset.textureKeys)cache.release(key);}
  function release(){for(const group of assets.values())for(const asset of group)disposeAsset(asset);assets.clear();cache.clear();}
  function reset(){version++;controller?.abort();release();entries=[];packets=[];lastPacket=null;total=0;stageClock=0;stateChoice.hidden=true;stateChoice.replaceChildren();excluded.clear();button.disabled=true;if(dialog.open)dialog.close();render();}
  function render(){
    const container=$('motion-extra-items');container.replaceChildren();
    for(const entry of entries){
      const row=element('div');row.className='motion-extra-row';
      const label=element('label'),check=element('input');check.type='checkbox';check.checked=entry.status==='ready'&&!excluded.has(entry.id);check.disabled=entry.status!=='ready';
      check.onchange=()=>{if(check.checked)excluded.delete(entry.id);else excluded.add(entry.id);void refresh();};
      label.append(check,element('span',entry.label));row.append(label);
      row.append(element('small',entry.error||entry.loadError||(assets.has(entry.id)?'표시 준비됨':entry.status==='ready'?'선택한 표시 옵션에 따라 적용':'연결 확인 필요')));
      const warnings=[...(entry.warnings||[]),...(entry.loadWarnings||[])];if(warnings.length)row.append(element('small',warnings.join(' ')));
      if(Object.keys(entry.conditions||{}).length)row.append(element('small','조건 · '+JSON.stringify(entry.conditions)));
      for(const resource of [...(entry.resources||[]),...(entry.images||[])])if(resource.candidates?.length>1){
        const select=element('select');select.setAttribute('aria-label',resource.name+' 출처');select.append(element('option','출처 선택 · '+resource.name));select.firstChild.value='';
        for(const candidate of resource.candidates){const option=element('option',candidate.archive+' · '+candidate.ordinal);option.value=candidate.id;select.append(option);}select.value=resource.selected||'';
        select.onchange=()=>{resource.selected=Number(select.value)||null;void refresh();};row.append(select);
      }
      const details=element('details');details.append(element('summary','출처'),element('small',entry.source+(entry.mesh_source?' · '+entry.mesh_source:'')),element('small',entry.state||'모션에 직접 연결'));
      if(entry.notes)details.append(element('small',entry.notes));row.append(details);container.append(row);
    }
    if(!entries.length)container.append(element('p',packets.some(p=>p.extras_index_available)?'이 동작에 연결된 연출이 없습니다.':'연출 정보가 없습니다. 라이브러리에서 후처리만 실행하면 연결 정보를 갱신할 수 있습니다.'));
  }
  async function image(info,current,signal,asset,entry){
    if(!info?.selected){entry.loadWarnings.push('텍스처 미확인 · '+(info?.name||'원본 없음')+' · 단색 미리보기');return null;}
    const metadata=await api('/api/composition-source/'+info.selected,signal),key=current+':'+info.selected+':'+metadata.image_sha256;
    const map=await cache.acquire(key,metadata.width*metadata.height,async()=>{
      const value=await loader.loadAsync('/api/composition-image/'+info.selected+'?token='+encodeURIComponent(token)+'&sha256='+metadata.image_sha256);
      value.colorSpace=THREE.SRGBColorSpace;value.flipY=false;value.wrapS=value.wrapT=THREE.RepeatWrapping;return value;
    });asset.textureKeys.push(key);return map;
  }
  async function load(entry,resource,current,signal){
    if(resource&&!resource.selected)throw Error('모델 출처를 선택해 주세요: '+resource.name);
    const data=resource?await api('/api/model-scene?entries='+resource.selected,signal):null;
    if(current!==version||disposed)throw Error('연출 선택이 변경되었습니다.');
    let model=data?buildModel(data):null;
    const anchor=new THREE.Group(),asset={model,anchor,textureKeys:[],owned:[],extraMeshes:[],begun:false,born:0,packet:entry.packet};
    anchor.visible=false;anchor.matrixAutoUpdate=false;
    try{
      if(model)for(const material of model.materials){
        const info=material.userData.input.image;if(!info)continue;
        const map=await image(info,current,signal,asset,entry);
        if(map){material.map=map;material.color.set(0xffffff);material.needsUpdate=true;}
      }
      if(entry.kind==='particle'){
        const maps=[];
        for(const info of entry.images||[])maps.push(await image(info,current,signal,asset,entry));
        model=createParticleModel(entry.particle,model,maps);asset.model=model;asset.particle=true;
      }else if(entry.animation){
        try{
          if(!data.animation.selected)throw Error('자체 XMD가 없어 정적 모델로 표시합니다.');
          const info=await api('/api/model-animations?'+new URLSearchParams({skeleton:resource.selected,animation:data.animation.selected}),signal);
          if(info.skeleton_source.sha256!==data.skeleton_source.sha256)throw Error('연출 모델 원본이 변경되었습니다.');
          const matches=info.clips.filter(c=>c.name===entry.animation);
          if(matches.length!==1)throw Error('효과 클립을 확정할 수 없어 정적 모델로 표시합니다.');
          asset.clip=await api('/api/model-clip?'+new URLSearchParams({skeleton:resource.selected,animation:data.animation.selected,clip:matches[0].index,sha256:info.animation_source.sha256}),signal);
          if(asset.clip.skeleton_source.sha256!==data.skeleton_source.sha256)throw Error('연출 모델 원본이 변경되었습니다.');
        }catch(e){if(signal.aborted)throw e;asset.clip=null;entry.loadWarnings.push('정적 모델 미리보기 · '+e.message);}
      }
      if(current!==version||signal.aborted||disposed)throw Error('연출 선택이 변경되었습니다.');
      model.root.scale.z=1;anchor.add(model.root);
      asset.base=model.materials.map(m=>({color:m.color.clone(),opacity:m.opacity,material:m,dual:false}));
      if(entry.kind==='effect'){
        for(const m of model.materials){m.transparent=true;m.alphaTest=0;m.depthTest=entry.depth_test;m.depthWrite=entry.depth_write;applyBlend(m,entry.blend||['SRCALPHA',entry.additive?'ONE':'INVSRCALPHA']);m.needsUpdate=true;}
        if(entry.dual)for(const mesh of [...model.meshes]){
          const copy=mesh.clone(false);copy.material=mesh.material.map(original=>{const m=original.clone();m.onBeforeCompile=original.onBeforeCompile;m.customProgramCacheKey=original.customProgramCacheKey;applyBlend(m,['SRCALPHA','DESTALPHA']);m.transparent=true;asset.owned.push(m);asset.base.push({color:m.color.clone(),opacity:m.opacity,material:m,dual:true});return m;});
          mesh.parent.add(copy);asset.extraMeshes.push(copy);
        }
      }
      const seed=[...entry.id].reduce((n,c)=>((n*31)^c.charCodeAt(0))>>>0,1),rng=random(seed);
      asset.offset=vector(entry.offset,rng);asset.rotation=vector(entry.rotation,rng);
      asset.gravity=vector(entry.gravity,rng);asset.life=entry.play_count&&asset.clip?asset.clip.clip.duration*entry.play_count/entry.speed:entry.life;
      asset.timeline=createTracks(entry.tracks||[],seed,asset.life);
      if(!entry.tracks?.length)asset.timeline=createTracks([{property:'color',mode:'initial',value:entry.color||[1,1,1,1]},...(entry.fades||[]).map(f=>({property:'color',mode:'fade',value:f.color,start:f.start,end:f.end}))],seed,asset.life);
      getScene().add(anchor);asset.vertices=(data?data.meshes.reduce((n,m)=>n+m.vertices.length/3,0):4)*(asset.particle?entry.particle.max_particles*Math.max(1,entry.images?.length||0)*(entry.particle.dual?2:1):1);asset.transforms=asset.clip?.keys.reduce((n,k)=>n+k.transforms.length,0)||0;return asset;
    }catch(e){disposeAsset(asset);throw e;}
  }
  async function refresh(){
    const current=++version;controller?.abort();controller=new AbortController();const signal=controller.signal;
    release();let count=0,vertices=0,transforms=0;
    $('motion-extras-status').textContent='선택한 연출을 준비하고 있습니다…';
    for(const entry of entries){
      entry.loadError='';entry.loadWarnings=[];if(entry.status!=='ready'||!enabled(entry))continue;
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
    const requested=$('show-motion-props').checked||$('show-motion-effects').checked;
    $('motion-extras-status').textContent=count?`${count}개 모델 준비됨 · 모션에 맞춰 표시합니다.`:requested?'표시할 수 있는 연출이 없습니다. 항목별 사유를 확인하세요.':'표시 옵션을 켜면 연결된 연출을 함께 볼 수 있습니다.';render();
  }
  function select(clips,steps=[]){
    reset();packets=clips;button.disabled=!clips.length;
    clips.forEach((packet,index)=>{
      const all=packet.extras||[],known=steps[index]?.state,states=new Set(all.filter(e=>e.kind!=='model'&&e.state).map(e=>e.state));
      if(!known&&states.size>1){stateChoice.hidden=false;stateChoice.replaceChildren();for(const name of states){const option=element('option',name);option.value=name;stateChoice.append(option);}}
      for(const original of all){
        if(known&&original.state&&original.state!==known)continue;
        const entry={...original,id:index+':'+original.key,packet,stateSpeed:steps[index]?.speed||original.state_speed||1};
        entry.ambiguous=!known&&states.size>1&&entry.kind!=='model';
        entries.push(entry);
      }
    });render();void refresh();
  }
  function seek(){lastPacket=null;total=0;for(const group of assets.values())for(const asset of group)asset.begun=false;}
  function update(delta=0){
    if(!state.clip||!state.model){for(const group of assets.values())for(const asset of group)asset.anchor.visible=false;return;}
    const changed=lastPacket!==state.clip;
    if(changed){lastPacket=state.clip;stageClock=state.sequence?state.sequence.elapsed/state.sequence.definition.steps[state.sequence.index].speed:state.time;lastTime=state.time;}
    if(state.playing){const elapsed=delta*Number($('animation-speed').value);total+=elapsed;if(!changed)stageClock+=elapsed;}
    const wrapped=!changed&&state.time<lastTime-1e-6&&state.playing;lastTime=state.time;
    const births=new Map();
    for(const entry of entries){
      const active=entry.packet===state.clip,group=assets.get(entry.id)||[];
      const parent=entry.parent_key?births.get(entry.id.split(':')[0]+':'+entry.parent_key):null;
      // Child event clocks are relative to their damage effect, even if its mesh is unavailable.
      const clock=entry.parent_key?(parent===undefined?-1:parent):entry.anim_time?state.time:stageClock;
      const since=clock-entry.at;
      if(active&&since>=0)births.set(entry.id,since);
      for(const asset of group){
        if(!enabled(entry)||entry.loadError||(!active&&(entry.kind==='model'||entry.state_end||!asset.begun))){asset.anchor.visible=false;continue;}
        if(active&&(changed||(wrapped&&entry.anim_time)))asset.begun=false;
        if(!asset.begun){if(!active||since<0){asset.anchor.visible=false;continue;}asset.begun=true;asset.born=total-since/(entry.anim_time?entry.stateSpeed:1);asset.frozen=false;}
        const age=Math.max(0,total-asset.born);
        if(age>(asset.life??entry.life)){asset.anchor.visible=false;continue;}
        const parentEntry=entry.parent_key?entries.find(e=>e.id===entry.id.split(':')[0]+':'+entry.parent_key):null;
        const parentAsset=parentEntry?(assets.get(parentEntry.id)||[]).find(a=>a.anchor.visible):null;
        const target=parentAsset?.model.root||(entry.bone?state.model.bones.find(b=>b.name===entry.bone):state.model.root);
        if(!target){asset.anchor.visible=false;continue;}
        if(entry.follow||!asset.frozen){
          const local=new THREE.Matrix4().compose(new THREE.Vector3(...asset.offset),new THREE.Quaternion().setFromEuler(new THREE.Euler(...asset.rotation.map(THREE.MathUtils.degToRad))),new THREE.Vector3(1,1,1));
          asset.anchor.matrix.copy(target.matrixWorld).multiply(local);asset.anchor.matrixWorldNeedsUpdate=true;asset.frozen=true;
        }
        asset.anchor.visible=true;asset.anchor.updateMatrixWorld(true);
        if(asset.particle){asset.model.update(age,getCamera?.(),asset.anchor);continue;}
        const time=age*entry.speed;
        if(asset.clip){const duration=asset.clip.clip.duration;applyPose(asset.model,asset.clip,entry.loop&&duration>0?time%duration:Math.min(time,duration));}
        const timeline=asset.timeline,position=timeline.value('position',age,time),movement=timeline.integral('velocity',age),spin=timeline.integral('rotationSpeed',age);
        asset.model.root.position.fromArray(position.map((v,i)=>v+movement[i]+asset.gravity[i]*age*age*.5));
        const size=timeline.value('size',age,time),scale=timeline.value('scale',age,time)[0];asset.model.root.scale.set(...size.map(v=>v*scale));
        asset.model.root.rotation.set(...timeline.value('rotation',age,time).map((v,i)=>THREE.MathUtils.degToRad(v+spin[i])));
        if(entry.billboard&&entry.billboard!=='BBT_NONE'&&getCamera?.()){
          const cameraLocal=getCamera().getWorldPosition(new THREE.Vector3()).applyMatrix4(asset.anchor.matrixWorld.clone().invert());asset.model.root.lookAt(cameraLocal);
        }
        for(const base of asset.base){
          const rgba=timeline.value(base.dual?'dualColor':'color',age,time),material=base.material;
          material.color.copy(base.color).multiply(new THREE.Color(...rgba.slice(0,3)));material.opacity=base.opacity*rgba[3];
        }
      }
    }
  }

  button.onclick=()=>{render();dialog.showModal();};dialog.querySelector('button').onclick=()=>dialog.close();
  conditionCheck.onchange=()=>void refresh();stateChoice.onchange=()=>void refresh();
  for(const id of ['show-motion-props','show-motion-effects'])$(id).onchange=()=>{try{localStorage.setItem('closers-motion-extras',JSON.stringify({models:$('show-motion-props').checked,effects:$('show-motion-effects').checked}));}catch{}void refresh();};
  reset();return {select,reset,seek,update,setBusy(value){button.disabled=value||!packets.length;},get assets(){return assets;},get meshes(){return [...assets.values()].flat().filter(a=>a.anchor.visible).flatMap(a=>a.model.meshes);},dispose(){disposed=true;reset();}};
}
