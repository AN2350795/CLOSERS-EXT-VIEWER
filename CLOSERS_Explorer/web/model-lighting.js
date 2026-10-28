import * as THREE from './vendor/three/three.module.min.js';
import {setMaterialPreview,setMatcapPreview} from './model-materials.js';

function setupMatcapControls({state,element,dialog}){
  const key='closers-avatar-matcap-v1';let saved={};
  try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
  let enabled=saved.enabled===true,strength=Number.isFinite(saved.strength)?Math.max(0,Math.min(1,saved.strength)):1;
  const excluded=new Set(Array.isArray(saved.excluded)?saved.excluded.filter(v=>typeof v==='string'):[]);
  let groups=[];
  const field=element('fieldset');
  field.innerHTML='<legend>광택 미리보기</legend><label><input id="avatar-matcap-enabled" type="checkbox"> 광택 켜기 (근사)</label><label>광택 강도<input id="avatar-matcap-strength" type="range" min="0" max="1" step="0.05"><output id="avatar-matcap-strength-value"></output></label><p class="muted">유광 타입 등 선택한 아이템에 연결된 MatCap을 표면 방향에 따라 표시합니다. 게임의 부위별 광택 마스크와 반사까지 재현하지 않아 적용 범위·밝기가 다를 수 있습니다. 끄면 기본 재질로 돌아갑니다.</p><p id="avatar-matcap-status" role="status"></p><div id="avatar-matcap-items"></div>';
  dialog.querySelector('fieldset').before(field);
  const toggle=field.querySelector('#avatar-matcap-enabled'),slider=field.querySelector('#avatar-matcap-strength'),output=field.querySelector('output'),status=field.querySelector('#avatar-matcap-status'),list=field.querySelector('#avatar-matcap-items');
  toggle.checked=enabled;slider.value=strength;output.value=strength.toFixed(2);
  function save(){try{localStorage.setItem(key,JSON.stringify({enabled,strength,excluded:[...excluded]}));}catch{}}
  function apply(){
    toggle.disabled=!groups.length;slider.disabled=!groups.length||!enabled;
    let active=0;
    for(const group of groups){
      const ready=group.materials.some(m=>m.userData.matcapPreview.uniforms.avatarMatcapMap.value);
      const on=enabled&&!excluded.has(group.key);
      for(const m of group.materials)setMatcapPreview(m,on,strength);
      if(on&&ready&&group.visible&&strength>0)active++;
      group.status.textContent=!ready?'광택 텍스처 확인 필요':!on?'광택 꺼짐':!group.visible?'현재 숨겨진 메시의 광택':strength===0?'강도 0 · 기본 재질 표시':'광택 켜짐 · 근사';
    }
    status.textContent=groups.length?`광택 연결 ${groups.length}개 · 현재 표시 ${active}개`:'연결된 광택 재질이 없습니다. 유광 타입 등 아이템별 목록에서 선택하세요.';
  }
  function refresh(){
    const found=new Map(),sources=state.data?.sources||[];
    for(const [index,m] of (state.model?.materials||[]).entries()){
      if(!m.userData.matcapPreview)continue;
      const input=m.userData.input,source=sources.find(s=>s.entry_id===m.userData.avatarSourceId);
      const groupKey=JSON.stringify([source?.appearance_key||source?.entry_id||m.userData.avatarSourceId||'material:'+index,input.matcap_preview.texture,input.material_report?.source_texture||input.texture]);
      if(!found.has(groupKey))found.set(groupKey,{key:groupKey,label:source?.display_name||source?.name||m.userData.avatarMeshName||'아바타',input,materials:[],visible:false});
      const group=found.get(groupKey);group.materials.push(m);
      group.visible||=(state.model.meshes||[]).some(mesh=>mesh.visible&&mesh.material.some((mat,i)=>mat===m&&mesh.geometry.groups.some(g=>g.materialIndex===i&&g.count>0)));
    }
    groups=[...found.values()];list.replaceChildren();
    for(const group of groups){
      const row=element('div'),label=element('label'),check=element('input');check.type='checkbox';check.checked=!excluded.has(group.key);check.setAttribute('aria-label',group.label+' 광택');
      check.onchange=()=>{if(check.checked)excluded.delete(group.key);else excluded.add(group.key);save();apply();};
      label.append(check,element('span',group.label));group.status=element('small');group.status.className='muted';row.append(label,group.status);
      const details=element('details');details.append(element('summary','광택 적용 표면 · 출처'),element('p','표면: '+(group.input.material_report?.source_texture||group.input.texture)),element('p','MatCap: '+group.input.matcap_preview.texture),element('p','아이템 원본: '+(group.input.material_report?.reference||'')));row.append(details);list.append(row);
    }
    apply();
  }
  toggle.onchange=()=>{enabled=toggle.checked;save();apply();};
  slider.oninput=()=>{strength=Number(slider.value);output.value=strength.toFixed(2);save();apply();};
  return {refresh};
}

// A directional-light comparison on diffuse only. The game's toon lookup,
// MatCap conditions and bloom are deliberately not represented as this shader.
export function installAvatarLighting(material){
  const uniforms={avatarLightEnabled:{value:0},avatarLightDirection:{value:new THREE.Vector3(0,0,1)},avatarLightColor:{value:new THREE.Color(1,1,1)},avatarLightStrength:{value:1},avatarLightInfluence:{value:.5},avatarEmissionPass:{value:0}};
  material.userData.avatarLighting=uniforms;
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.customProgramCacheKey=()=>key+'|avatar-directional-light-v1';
  material.onBeforeCompile=function(shader){
    previous.call(this,shader);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec3 avatarLightingNormal;\n'+shader.vertexShader
      .replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )','#if 1')
      .replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\navatarLightingNormal = inverseTransformDirection(transformedNormal, viewMatrix);');
    shader.fragmentShader='varying vec3 avatarLightingNormal;\nuniform float avatarLightEnabled;\nuniform vec3 avatarLightDirection;\nuniform vec3 avatarLightColor;\nuniform float avatarLightStrength;\nuniform float avatarLightInfluence;\nuniform float avatarEmissionPass;\n'+shader.fragmentShader
      .replace('#include <color_fragment>',`#include <color_fragment>
if (avatarLightEnabled > 0.5) {
  float directional = max(dot(normalize(avatarLightingNormal), normalize(avatarLightDirection)), 0.0);
  diffuseColor.rgb *= mix(vec3(1.0), avatarLightColor * avatarLightStrength, directional * avatarLightInfluence);
}`)
      .replace('#include <opaque_fragment>',`if (avatarEmissionPass > 0.5) {
  outgoingLight = ${material.userData.materialPreview?'avatarMaterialEnabled * texture2D(avatarEmissiveMap, avatarMaterialUv).rgb * avatarEmissiveColor * avatarEmissiveStrength':'vec3(0.0)'};
}
#include <opaque_fragment>`);
  };
}

export function setAvatarLight(material,profile,influence=.5){
  const u=material.userData.avatarLighting;if(!u)return;
  u.avatarLightEnabled.value=profile?1:0;
  u.avatarLightInfluence.value=Math.max(0,Math.min(1,influence));
  if(profile){u.avatarLightColor.value.setRGB(...profile.color.slice(0,3));u.avatarLightDirection.value.set(profile.direction[0],profile.direction[1],-profile.direction[2]).normalize();u.avatarLightStrength.value=profile.intensity;}
}

export function setupAvatarLighting({state,api,element,getEmissionEnabled}){
  const $=id=>document.getElementById(id),storageKey='closers-avatar-lighting-v2';
  let settings={enabled:false,selected:'',excluded:[],bloom:true,bloomStrength:.8,influence:.5,solo:false,soloExposure:4};
  try{const current=localStorage.getItem(storageKey),saved=JSON.parse(current||localStorage.getItem('closers-avatar-lighting-v1')||'{}');settings={...settings,enabled:!!current&&saved?.enabled===true,selected:typeof saved?.selected==='string'?saved.selected:'',excluded:Array.isArray(saved?.excluded)?saved.excluded.filter(v=>typeof v==='string'):[],bloom:saved?.bloom!==false,bloomStrength:Number.isFinite(saved?.bloomStrength)?Math.max(0,Math.min(2,saved.bloomStrength)):.8,influence:Number.isFinite(saved?.influence)?Math.max(0,Math.min(1,saved.influence)):.5};}catch{}
  const excluded=new Set(settings.excluded);let profiles=[],groups=[],pending=null;
  const button=element('button','조명 · 발광');button.id='open-avatar-lighting';button.type='button';button.className='secondary';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','avatar-lighting-dialog');document.querySelector('.viewport-actions').prepend(button);
  const dialog=element('dialog');dialog.id='avatar-lighting-dialog';dialog.setAttribute('aria-labelledby','avatar-lighting-title');
  dialog.innerHTML='<div class="view-settings-heading"><h2 id="avatar-lighting-title">아바타 조명 · 발광</h2><button type="button" class="secondary">닫기</button></div><p id="avatar-lighting-summary" role="status"></p><fieldset><legend>발광 확인</legend><div id="avatar-emission-master"></div><label><input id="avatar-emission-solo" type="checkbox"> 발광만 보기 · 검은 배경에서 발광 부위 확인</label><label><input id="avatar-emission-bloom" type="checkbox"> 빛 번짐</label><label>번짐 강도<input id="avatar-emission-strength" type="range" min="0" max="2" step="0.05"><output id="avatar-emission-strength-value"></output></label><p class="muted">번짐은 발광 텍스처가 지정된 부위에만 적용하는 뷰어 미리보기입니다.</p><div id="avatar-emission-items"></div></fieldset><details><summary>원본 조명 수치 비교 (실험)</summary><fieldset><label><input id="avatar-lighting-enabled" type="checkbox"> 조명 수치 비교 켜기</label><label>참조할 원본<select id="avatar-lighting-profile" aria-label="의상 조명 선택"><option value="">조명 목록 불러오기</option></select></label><label>비교 강도<input id="avatar-lighting-influence" type="range" min="0" max="1" step="0.05"></label><p id="avatar-lighting-status" class="muted" role="status"></p><p class="muted">게임 조명 재현이 아닙니다. 기존 텍스처의 음영을 유지하며 원본 색·강도의 영향을 비교합니다. 세트 착용 조건·툰·MatCap은 자동 적용하지 않습니다.</p><details><summary>선택한 조명 출처</summary><pre id="avatar-lighting-source"></pre></details></fieldset></details>';
  document.body.append(dialog);$('avatar-lighting-enabled').checked=settings.enabled;
  const matcap=setupMatcapControls({state,element,dialog});
  $('avatar-lighting-title').textContent='아바타 조명 · 재질';
  const exposureLabel=element('label','확인용 밝기'),exposureInput=element('input'),exposureValue=element('output');exposureInput.id='avatar-emission-exposure';exposureInput.type='range';exposureInput.min=1;exposureInput.max=8;exposureInput.step=.5;exposureInput.value=settings.soloExposure;exposureInput.setAttribute('aria-label','발광만 보기의 확인용 밝기');exposureValue.value=settings.soloExposure+'×';exposureLabel.append(exposureInput,exposureValue);$('avatar-emission-solo').closest('label').after(exposureLabel);exposureInput.oninput=()=>{settings.soloExposure=Number(exposureInput.value);exposureValue.value=settings.soloExposure+'×';};
  const master=$('material-preview').closest('label');master.lastChild.textContent=' 발광 켜기';$('avatar-emission-master').append(master,$('material-preview-note'));$('material-preview-note').textContent='발광만 보기에서 실제 발광 부위를 확인하고, 빛 번짐을 따로 비교할 수 있습니다.';
  $('avatar-emission-bloom').checked=settings.bloom;$('avatar-emission-strength').value=settings.bloomStrength;$('avatar-emission-strength-value').value=settings.bloomStrength.toFixed(2);$('avatar-lighting-influence').value=settings.influence;
  function save(){settings.excluded=[...excluded];try{localStorage.setItem(storageKey,JSON.stringify(settings));}catch{}}
  function selected(){const p=profiles.find(p=>p.key===settings.selected);const characters=new Set((state.data?.sources||[]).map(s=>s.model_group?.character).filter(Boolean));return p&&(!characters.size||!p.characters?.length||[...characters].every(c=>p.characters.includes(c)))?p:null;}
  function apply(){
    const profile=settings.enabled?selected():null;
    exposureInput.disabled=!settings.solo;$('avatar-emission-strength').disabled=!settings.bloom;
    for(const m of state.model?.materials||[])setAvatarLight(m,profile,settings.influence);
    for(const group of groups){for(const m of group.materials)setMaterialPreview(m,getEmissionEnabled()&&!excluded.has(group.key));if(group.status)group.status.textContent=!getEmissionEnabled()?'전체 발광 꺼짐':excluded.has(group.key)?'이 발광 꺼짐':!group.materials.some(m=>m.userData.materialPreview.uniforms.avatarEmissiveMap.value)?'발광 텍스처 확인 필요':!group.visible?'현재 숨겨진 메시의 발광':'발광 켜짐 · 발광만 보기에서 확인';}
    if(state.model){const visible=groups.filter(g=>g.visible&&getEmissionEnabled()&&!excluded.has(g.key)&&g.materials.some(m=>m.userData.materialPreview.uniforms.avatarEmissiveMap.value)).length;$('avatar-lighting-summary').textContent=`발광 연결 ${groups.length}개 · 현재 표시 ${visible}개${getEmissionEnabled()?'':' · 전체 발광 꺼짐'}${settings.solo?' · 발광만 보기':''}`;}
    const profileInfo=profiles.find(p=>p.key===settings.selected);$('avatar-lighting-source').textContent=profileInfo?JSON.stringify(profileInfo,null,2):'조명을 선택하면 원본 출처를 확인할 수 있습니다.';
    if(profiles.length)$('avatar-lighting-status').textContent=settings.enabled?(profile?(state.model?'원본 조명 수치를 비교 중입니다.':'선택한 조명 유지 · 아바타를 선택하면 비교합니다.'):'현재 캐릭터에 적용할 조명을 선택하세요.'):'조명 수치 비교 꺼짐';
  }
  function refresh(){
    matcap.refresh();
    const found=new Map(),sources=state.data?.sources||[];let unsupported=0;
    for(const [index,m] of (state.model?.materials||[]).entries()){
      if(m.userData.input.material_report?.unsupported?.length)unsupported++;
      const preview=m.userData.input.material_preview;if(!m.userData.materialPreview)continue;
      const source=sources.find(s=>s.entry_id===m.userData.avatarSourceId),key=JSON.stringify([source?.appearance_key||source?.entry_id||m.userData.avatarSourceId||'material:'+index,m.userData.input.texture,preview.texture]);
      if(!found.has(key))found.set(key,{key,label:source?.display_name||source?.name||m.userData.avatarMeshName||'아바타',texture:preview.texture||'발광 재질',preview,materials:[],visible:false});const group=found.get(key);group.materials.push(m);group.visible||=(state.model.meshes||[]).some(mesh=>mesh.visible&&mesh.material.some((mat,i)=>mat===m&&mesh.geometry.groups.some(g=>g.materialIndex===i&&g.count>0)));
    }
    groups=[...found.values()];const list=$('avatar-emission-items');list.replaceChildren();
    button.textContent='조명 · 재질';
    for(const group of groups){
      const row=element('div'),label=element('label'),check=element('input');check.type='checkbox';check.checked=!excluded.has(group.key);check.setAttribute('aria-label',group.label+' 발광');
      check.onchange=()=>{if(check.checked)excluded.delete(group.key);else excluded.add(group.key);save();apply();};label.append(check,element('span',group.label));group.status=element('small');group.status.className='muted';row.append(label,group.status);
      const details=element('details');details.append(element('summary','발광 재질 정보'),element('p',group.texture),element('p','색상 '+group.preview.color.join(', ')+' · 강도 '+group.preview.strength));row.append(details);list.append(row);
    }
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
  $('avatar-emission-solo').onchange=()=>{settings.solo=$('avatar-emission-solo').checked;apply();};
  $('avatar-emission-bloom').onchange=()=>{settings.bloom=$('avatar-emission-bloom').checked;save();apply();};
  $('avatar-emission-strength').oninput=()=>{settings.bloomStrength=Number($('avatar-emission-strength').value);$('avatar-emission-strength-value').value=settings.bloomStrength.toFixed(2);save();};
  $('avatar-lighting-influence').oninput=()=>{settings.influence=Number($('avatar-lighting-influence').value);save();apply();};
  return {refresh,getRenderOptions:()=>({bloom:settings.bloom,solo:settings.solo,strength:settings.bloomStrength,exposure:settings.soloExposure})};
}
