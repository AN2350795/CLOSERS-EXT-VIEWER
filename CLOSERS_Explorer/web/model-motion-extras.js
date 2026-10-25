import * as THREE from './vendor/three/three.module.min.js';
import {buildModel,applyPose} from './model-core.js';
import {TextureCache} from './model-texture-cache.js';

export function setupMotionExtras({state,api,getScene,element}){
  const button=element('button','연출 설정');button.id='motion-extras-settings';button.type='button';button.className='secondary';button.disabled=true;
  button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','motion-extras-dialog');
  document.querySelector('.animation-options').append(button);
  const dialog=element('dialog');dialog.id='motion-extras-dialog';dialog.setAttribute('aria-labelledby','motion-extras-title');
  dialog.innerHTML='<div class="view-settings-heading"><h2 id="motion-extras-title">모션 연출</h2><button type="button" class="secondary">닫기</button></div><div class="motion-extra-switches"><label><input id="show-motion-props" type="checkbox"> 보조 모델 표시</label><label><input id="show-motion-effects" type="checkbox"> 메시 효과 표시</label></div><p class="muted">모션에 연결된 소품과 메시 효과를 함께 봅니다. 게임 파티클·특수 셰이더·사운드는 포함하지 않습니다.</p><p id="motion-extras-status" role="status"></p><div id="motion-extra-items"></div>';
  document.body.append(dialog);
  const $=id=>document.getElementById(id),cache=new TextureCache(),loader=new THREE.TextureLoader();
  let entries=[],assets=new Map(),version=0,controller,packets=[],lastPacket=null,lastTime=0,total=0,stageClock=0,disposed=false;
  const excluded=new Set(),token=document.querySelector('meta[name="explorer-token"]').content;
  try{const saved=JSON.parse(localStorage.getItem('closers-motion-extras')||'{}');$('show-motion-props').checked=saved.models===true;$('show-motion-effects').checked=saved.effects===true;}catch{}
  const enabled=entry=>!excluded.has(entry.id)&&(entry.kind==='model'?$('show-motion-props').checked:$('show-motion-effects').checked);
  function disposeAsset(asset){asset.anchor.removeFromParent();asset.model.dispose();for(const key of asset.textureKeys)cache.release(key);}
  function release(){for(const group of assets.values())for(const asset of group)disposeAsset(asset);assets.clear();cache.clear();}
  function reset(){version++;controller?.abort();release();entries=[];packets=[];lastPacket=null;total=0;stageClock=0;excluded.clear();button.disabled=true;if(dialog.open)dialog.close();render();}
  function render(){
    const container=$('motion-extra-items');container.replaceChildren();
    for(const entry of entries){
      const row=element('div');row.className='motion-extra-row';
      const label=element('label'),check=element('input');check.type='checkbox';check.checked=entry.status==='ready'&&!excluded.has(entry.id);check.disabled=entry.status!=='ready';
      check.onchange=()=>{if(check.checked)excluded.delete(entry.id);else excluded.add(entry.id);void refresh();};
      label.append(check,element('span',entry.label));row.append(label);
      row.append(element('small',entry.error||entry.loadError||(assets.has(entry.id)?'표시 준비됨':entry.status==='ready'?'선택한 표시 옵션에 따라 적용':'연결 확인 필요')));
      const details=element('details');details.append(element('summary','출처'),element('small',entry.source+(entry.mesh_source?' · '+entry.mesh_source:'')),element('small',entry.state||'모션에 직접 연결'));
      if(entry.notes)details.append(element('small',entry.notes));row.append(details);container.append(row);
    }
    if(!entries.length)container.append(element('p',packets.some(p=>p.extras_index_available)?'이 동작에 연결된 연출이 없습니다.':'연출 정보가 없습니다. 라이브러리에서 후처리만 실행하면 연결 정보를 갱신할 수 있습니다.'));
  }
  async function load(entry,resource,current,signal){
    const data=await api('/api/model-scene?entries='+resource.selected,signal);
    if(current!==version||disposed)throw Error('연출 선택이 변경되었습니다.');
    const model=buildModel(data),anchor=new THREE.Group(),textureKeys=[];
    const asset={model,anchor,textureKeys,begun:false,born:0,packet:entry.packet};
    model.root.scale.z=1;anchor.add(model.root);anchor.visible=false;anchor.matrixAutoUpdate=false;
    try{
      for(const material of model.materials){
        const image=material.userData.input.image;
        if(!image)continue;
        if(!image.selected)throw Error('연출 텍스처가 없거나 출처가 중복됩니다: '+image.name);
        const metadata=await api('/api/composition-source/'+image.selected,signal);
        const key=current+':'+image.selected+':'+metadata.image_sha256;
        const map=await cache.acquire(key,metadata.width*metadata.height,async()=>{
          const value=await loader.loadAsync('/api/composition-image/'+image.selected+'?token='+encodeURIComponent(token)+'&sha256='+metadata.image_sha256);
          value.colorSpace=THREE.SRGBColorSpace;value.flipY=false;value.wrapS=value.wrapT=THREE.RepeatWrapping;return value;
        });
        textureKeys.push(key);material.map=map;material.color.set(0xffffff);material.needsUpdate=true;
      }
      if(entry.animation){
        if(!data.animation.selected)throw Error('효과 동작 파일이 없거나 출처가 중복됩니다.');
        const info=await api('/api/model-animations?'+new URLSearchParams({skeleton:resource.selected,animation:data.animation.selected}),signal);
        if(info.skeleton_source.sha256!==data.skeleton_source.sha256)throw Error('연출 모델이 변경되었습니다. 모션을 다시 선택해 주세요.');
        const matches=info.clips.filter(c=>c.name===entry.animation);
        if(matches.length!==1)throw Error('효과 동작을 하나로 확인할 수 없습니다: '+entry.animation);
        asset.clip=await api('/api/model-clip?'+new URLSearchParams({skeleton:resource.selected,animation:data.animation.selected,clip:matches[0].index,sha256:info.animation_source.sha256}),signal);
        if(asset.clip.skeleton_source.sha256!==data.skeleton_source.sha256)throw Error('연출 모델이 변경되었습니다. 모션을 다시 선택해 주세요.');
      }
      if(current!==version||signal.aborted||disposed)throw Error('연출 선택이 변경되었습니다.');
      asset.base=model.materials.map(m=>({color:m.color.clone(),opacity:m.opacity}));
      if(entry.kind==='effect')model.materials.forEach(m=>{m.transparent=true;m.depthTest=entry.depth_test;m.depthWrite=entry.depth_write;m.blending=entry.additive?THREE.AdditiveBlending:THREE.NormalBlending;m.needsUpdate=true;});
      getScene().add(anchor);asset.vertices=data.meshes.reduce((n,m)=>n+m.vertices.length/3,0);asset.transforms=asset.clip?.keys.reduce((n,k)=>n+k.transforms.length,0)||0;return asset;
    }catch(e){disposeAsset(asset);throw e;}
  }
  async function refresh(){
    const current=++version;controller?.abort();controller=new AbortController();const signal=controller.signal;
    release();let count=0,vertices=0,transforms=0;
    $('motion-extras-status').textContent='선택한 연출을 준비하고 있습니다…';
    for(const entry of entries){
      entry.loadError='';if(entry.status!=='ready'||!enabled(entry))continue;
      const group=[];
      try{
        for(const resource of entry.resources){
          if(count>=16)throw Error('보조 모델과 효과는 한 번에 16개까지 표시합니다.');
          const asset=await load(entry,resource,current,signal);
          if(vertices+asset.vertices>250000){disposeAsset(asset);throw Error('보조 모델과 효과의 정점 합계는 250,000개까지 표시합니다.');}
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
      for(const original of all){
        if(known&&original.state&&original.state!==known)continue;
        const entry={...original,id:index+':'+original.key,packet,stateSpeed:steps[index]?.speed||original.state_speed||1};
        if(!known&&states.size>1&&entry.kind!=='model')entry.status='unavailable',entry.error='같은 클립에 여러 상태의 효과가 연결되어 있습니다. 묶음 동작에서 선택하세요.';
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
    for(const entry of entries){
      const active=entry.packet===state.clip,group=assets.get(entry.id)||[];
      for(const asset of group){
        if(!enabled(entry)||entry.loadError||(!active&&(entry.kind==='model'||entry.state_end||!asset.begun))){asset.anchor.visible=false;continue;}
        if(active&&(changed||(wrapped&&entry.anim_time)))asset.begun=false;
        const clock=entry.anim_time?state.time:stageClock;
        if(!asset.begun){if(!active||clock<entry.at){asset.anchor.visible=false;continue;}asset.begun=true;asset.born=total-(clock-entry.at)/(entry.anim_time?entry.stateSpeed:1);asset.frozen=false;}
        const age=Math.max(0,total-asset.born);
        if(age>entry.life){asset.anchor.visible=false;continue;}
        const target=entry.bone?state.model.bones.find(b=>b.name===entry.bone):state.model.root;
        if(!target){asset.anchor.visible=false;continue;}
        if(entry.follow||!asset.frozen){asset.anchor.matrix.copy(target.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(...entry.offset));asset.anchor.matrixWorldNeedsUpdate=true;asset.frozen=true;}
        asset.anchor.visible=true;
        const time=age*entry.speed;
        if(asset.clip){const duration=asset.clip.clip.duration;applyPose(asset.model,asset.clip,entry.loop&&duration>0?time%duration:Math.min(time,duration));}
        let rgba=entry.color;
        for(const fade of entry.fades){if(time<fade.start)break;const t=fade.end===fade.start?1:Math.min(1,(time-fade.start)/(fade.end-fade.start));rgba=rgba.map((v,i)=>v+(fade.color[i]-v)*t);}
        asset.model.materials.forEach((material,i)=>{material.color.copy(asset.base[i].color).multiply(new THREE.Color(...rgba.slice(0,3)));material.opacity=asset.base[i].opacity*rgba[3];});
      }
    }
  }
  button.onclick=()=>{render();dialog.showModal();};dialog.querySelector('button').onclick=()=>dialog.close();
  for(const id of ['show-motion-props','show-motion-effects'])$(id).onchange=()=>{try{localStorage.setItem('closers-motion-extras',JSON.stringify({models:$('show-motion-props').checked,effects:$('show-motion-effects').checked}));}catch{}void refresh();};
  reset();return {select,reset,seek,update,setBusy(value){button.disabled=value||!packets.length;},get assets(){return assets;},get meshes(){return [...assets.values()].flat().filter(a=>a.anchor.visible).flatMap(a=>a.model.meshes);},dispose(){disposed=true;reset();}};
}
