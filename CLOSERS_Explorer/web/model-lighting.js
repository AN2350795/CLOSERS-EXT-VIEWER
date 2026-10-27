import * as THREE from './vendor/three/three.module.min.js';
import {setMaterialPreview} from './model-materials.js';

// A directional-light comparison on diffuse only. The game's toon lookup,
// MatCap conditions and bloom are deliberately not represented as this shader.
export function installAvatarLighting(material){
  const uniforms={avatarLightEnabled:{value:0},avatarLightDirection:{value:new THREE.Vector3(0,0,1)},avatarLightColor:{value:new THREE.Color(1,1,1)},avatarLightStrength:{value:1}};
  material.userData.avatarLighting=uniforms;
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.customProgramCacheKey=()=>key+'|avatar-directional-light-v1';
  material.onBeforeCompile=function(shader){
    previous.call(this,shader);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec3 avatarLightingNormal;\n'+shader.vertexShader
      .replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )','#if 1')
      .replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\navatarLightingNormal = inverseTransformDirection(transformedNormal, viewMatrix);');
    shader.fragmentShader='varying vec3 avatarLightingNormal;\nuniform float avatarLightEnabled;\nuniform vec3 avatarLightDirection;\nuniform vec3 avatarLightColor;\nuniform float avatarLightStrength;\n'+shader.fragmentShader
      .replace('#include <color_fragment>',`#include <color_fragment>
if (avatarLightEnabled > 0.5) {
  float directional = max(dot(normalize(avatarLightingNormal), normalize(avatarLightDirection)), 0.0);
  diffuseColor.rgb *= avatarLightColor * avatarLightStrength * directional;
}`);
  };
}

export function setAvatarLight(material,profile){
  const u=material.userData.avatarLighting;if(!u)return;
  u.avatarLightEnabled.value=profile?1:0;
  if(profile){u.avatarLightColor.value.setRGB(...profile.color.slice(0,3));u.avatarLightDirection.value.set(profile.direction[0],profile.direction[1],-profile.direction[2]).normalize();u.avatarLightStrength.value=profile.intensity;}
}

export function setupAvatarLighting({state,api,element,getEmissionEnabled}){
  const $=id=>document.getElementById(id),storageKey='closers-avatar-lighting-v1';
  let settings={enabled:false,selected:'',excluded:[]};
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');settings={enabled:saved?.enabled===true,selected:typeof saved?.selected==='string'?saved.selected:'',excluded:Array.isArray(saved?.excluded)?saved.excluded.filter(v=>typeof v==='string'):[]};}catch{}
  const excluded=new Set(settings.excluded);let profiles=[],groups=[],pending=null;
  const button=element('button','조명 · 발광');button.id='open-avatar-lighting';button.type='button';button.className='secondary';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','avatar-lighting-dialog');document.querySelector('.viewport-actions').prepend(button);
  const dialog=element('dialog');dialog.id='avatar-lighting-dialog';dialog.setAttribute('aria-labelledby','avatar-lighting-title');
  dialog.innerHTML='<div class="view-settings-heading"><h2 id="avatar-lighting-title">아바타 조명 · 발광</h2><button type="button" class="secondary">닫기</button></div><p id="avatar-lighting-summary" role="status"></p><fieldset><legend>의상 조명 비교</legend><label><input id="avatar-lighting-enabled" type="checkbox"> 선택한 조명 켜기</label><label>인게임 조명<select id="avatar-lighting-profile" aria-label="의상 조명 선택"><option value="">조명 목록 불러오기</option></select></label><p id="avatar-lighting-status" class="muted" role="status"></p><p class="muted">원본 색·방향·강도의 방향광 근사입니다. 착용 조건을 자동 판정하지 않으며, 게임의 툰·MatCap·후처리와 차이가 있습니다.</p><details><summary>선택한 조명 출처</summary><pre id="avatar-lighting-source"></pre></details></fieldset><fieldset><legend>현재 아바타의 발광 재질</legend><p class="muted">장착한 아이템에 연결된 발광을 개별로 비교합니다. 보기 설정의 발광 재질 미리보기가 꺼져 있으면 전체 발광이 꺼집니다.</p><div id="avatar-emission-items"></div></fieldset>';
  document.body.append(dialog);$('avatar-lighting-enabled').checked=settings.enabled;
  function save(){settings.excluded=[...excluded];try{localStorage.setItem(storageKey,JSON.stringify(settings));}catch{}}
  function selected(){const p=profiles.find(p=>p.key===settings.selected);const characters=new Set((state.data?.sources||[]).map(s=>s.model_group?.character).filter(Boolean));return p&&(!characters.size||!p.characters?.length||[...characters].every(c=>p.characters.includes(c)))?p:null;}
  function apply(){
    const profile=settings.enabled?selected():null;
    for(const m of state.model?.materials||[])setAvatarLight(m,profile);
    for(const group of groups)for(const m of group.materials)setMaterialPreview(m,getEmissionEnabled()&&!excluded.has(group.key));
    const profileInfo=profiles.find(p=>p.key===settings.selected);$('avatar-lighting-source').textContent=profileInfo?JSON.stringify(profileInfo,null,2):'조명을 선택하면 원본 출처를 확인할 수 있습니다.';
    if(profiles.length)$('avatar-lighting-status').textContent=settings.enabled?(profile?(state.model?'현재 아바타에 선택한 조명을 적용했습니다.':'선택한 조명 유지 · 아바타를 선택하면 적용됩니다.'):'현재 캐릭터에 적용할 조명을 선택하세요.'):'조명 꺼짐 · 원래 재질 표시';
  }
  function refresh(){
    const found=new Map(),sources=state.data?.sources||[];let unsupported=0;
    for(const [index,m] of (state.model?.materials||[]).entries()){
      if(m.userData.input.material_report?.unsupported?.length)unsupported++;
      const preview=m.userData.input.material_preview;if(!m.userData.materialPreview)continue;
      const source=sources.find(s=>s.entry_id===m.userData.avatarSourceId),key=JSON.stringify([source?.appearance_key||source?.entry_id||m.userData.avatarSourceId||'material:'+index,m.userData.input.texture,preview.texture]);
      if(!found.has(key))found.set(key,{key,label:source?.display_name||source?.name||m.userData.avatarMeshName||'아바타',texture:preview.texture||'발광 재질',preview,materials:[]});found.get(key).materials.push(m);
    }
    groups=[...found.values()];const list=$('avatar-emission-items');list.replaceChildren();
    button.textContent='조명 · 발광'+(groups.length?' '+groups.length:'');
    for(const group of groups){const row=element('div'),label=element('label'),check=element('input');check.type='checkbox';check.checked=!excluded.has(group.key);check.setAttribute('aria-label',group.label+' 발광');check.onchange=()=>{if(check.checked)excluded.delete(group.key);else excluded.add(group.key);save();apply();};label.append(check,element('span',group.label));row.append(label);const details=element('details');details.append(element('summary','발광 재질 정보'),element('p',group.texture),element('p','색상 '+group.preview.color.join(', ')+' · 강도 '+group.preview.strength));if(group.materials.some(m=>!m.userData.materialPreview.uniforms.avatarEmissiveMap.value))details.append(element('p','발광 텍스처가 준비되지 않았습니다. 파일 출처에서 원본 선택을 확인하세요.'));row.append(details);list.append(row);}
    if(!groups.length)list.append(element('p','현재 아바타에 확인된 발광 재질이 없습니다.'));
    $('avatar-lighting-summary').textContent=state.model?`확인된 발광 재질 ${groups.length}개${unsupported?' · 미지원 보조 재질 '+unsupported+'개 (파일 출처에서 확인)':''}`:'아바타를 선택하면 연결된 재질을 확인할 수 있습니다.';
    apply();
  }
  async function load(){
    if(pending)return pending;
    $('avatar-lighting-status').textContent='원본 조명 목록을 불러오고 있습니다…';$('avatar-lighting-profile').disabled=true;
    pending=Promise.resolve().then(async()=>{try{const result=await api('/api/model-lighting');profiles=result.profiles||[];const select=$('avatar-lighting-profile');select.replaceChildren();const none=element('option','조명 선택');none.value='';select.append(none);for(const p of profiles){const option=element('option',p.label);option.value=p.key;select.append(option);}select.value=settings.selected;apply();if(!profiles.length)$('avatar-lighting-status').textContent='원본 조명 정의가 없습니다. 원본 CMF 목록과 CW.EXE 설정을 확인하세요.';}catch(e){profiles=[];apply();$('avatar-lighting-status').textContent='조명 목록을 불러오지 못했습니다: '+e.message;}finally{$('avatar-lighting-profile').disabled=false;pending=null;}});return pending;
  }
  $('avatar-lighting-enabled').onchange=()=>{settings.enabled=$('avatar-lighting-enabled').checked;save();apply();};
  $('avatar-lighting-profile').onchange=()=>{settings.selected=$('avatar-lighting-profile').value;settings.enabled=!!settings.selected;$('avatar-lighting-enabled').checked=settings.enabled;save();apply();};
  button.onclick=()=>{refresh();dialog.showModal();void load();};dialog.querySelector('button').onclick=()=>dialog.close();refresh();if(settings.enabled)void load();
  return {refresh};
}
