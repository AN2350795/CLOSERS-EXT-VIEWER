import * as THREE from './vendor/three/three.module.min.js';
import {normalizeColorGrading} from './model-color-grading.js';
import {setMaterialPreview,setMatcapPreview,setSpecularPreview,setMatcapMaskPreview,setSpecularLight} from './model-materials.js';

function setupMatcapControls({state,element,dialog}){
  const key='closers-avatar-matcap-v1';let saved={};
  try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
  let enabled=saved.enabled===true,strength=Number.isFinite(saved.strength)?Math.max(0,Math.min(1,saved.strength)):1;
  let useNormal=saved.useNormal!==false;
  let useSpecular=saved.useSpecular===true;
  let lightMode=saved.lightMode==='region'?'region':'camera',lightProfile=null;
  let maskOnly=false;
  const excluded=new Set(Array.isArray(saved.excluded)?saved.excluded.filter(v=>typeof v==='string'):[]);
  let groups=[];
  const field=element('fieldset');
  field.innerHTML='<legend>광택 미리보기</legend><label><input id="avatar-matcap-enabled" type="checkbox"> 광택 켜기 (근사)</label><label>광택 강도<input id="avatar-matcap-strength" type="range" min="0" max="1" step="0.05"><output id="avatar-matcap-strength-value"></output></label><p class="muted">유광 타입 등 선택한 아이템에 연결된 MatCap을 표면 방향에 따라 표시합니다. 게임의 부위별 광택 마스크와 반사까지 재현하지 않아 적용 범위·밝기가 다를 수 있습니다. 끄면 기본 재질로 돌아갑니다.</p><p id="avatar-matcap-status" role="status"></p><div id="avatar-matcap-items"></div>';
  dialog.querySelector('fieldset').before(field);
  const toggle=field.querySelector('#avatar-matcap-enabled'),slider=field.querySelector('#avatar-matcap-strength'),output=field.querySelector('output'),status=field.querySelector('#avatar-matcap-status'),list=field.querySelector('#avatar-matcap-items');
  const normalLabel=element('label'),normalToggle=element('input');normalToggle.id='avatar-matcap-normal';normalToggle.type='checkbox';normalToggle.checked=useNormal;normalLabel.append(normalToggle,document.createTextNode(' 원본 표면 굴곡·광택 마스크 사용'));toggle.closest('label').after(normalLabel);
  const maskLabel=element('label'),maskToggle=element('input');maskToggle.id='avatar-matcap-mask-only';maskToggle.type='checkbox';maskLabel.append(maskToggle,document.createTextNode(' 광택 범위 확인 · 흰색: 허용 / 검정: 제외'));normalLabel.after(maskLabel);
  const maskStatus=element('p');maskStatus.id='avatar-matcap-mask-status';maskStatus.setAttribute('role','status');maskLabel.after(maskStatus);
  const specularLabel=element('label'),specularToggle=element('input');specularToggle.id='avatar-matcap-specular';specularToggle.type='checkbox';specularToggle.checked=useSpecular;specularLabel.append(specularToggle,document.createTextNode(' 원본 반사색·반사 지수 사용 (근사)'));normalLabel.after(specularLabel);
  const specularStatus=element('p');specularStatus.id='avatar-specular-status';specularStatus.className='muted';specularStatus.setAttribute('role','status');specularLabel.after(specularStatus);
  const lightLabel=element('label','반사 광원'),lightSelect=element('select');lightSelect.id='avatar-specular-light';
  for(const [value,text] of [['camera','카메라 위치 · 확인용'],['region','선택 지역 · 원본 광원 위치']]){const option=element('option',text);option.value=value;lightSelect.append(option);}lightSelect.value=lightMode;lightLabel.append(lightSelect);specularStatus.before(lightLabel);
  field.querySelector('p.muted:not(#avatar-specular-status)').textContent='아이템의 광택·반사를 비교합니다. 원본 굴곡·광택 마스크가 준비될 때까지 적용을 보류합니다. 마스크 사용을 끄면 표면 전체에 광택을 더하는 별도 비교가 됩니다. 반사 광원은 카메라 확인용 또는 선택 지역의 원본 위치를 사용합니다. 지역 위치는 아바타 원점 기준의 근사 비교이며 인게임 외형과 차이가 있습니다. 광택을 끄면 기본 재질로 돌아갑니다.';
  toggle.checked=enabled;slider.value=strength;output.value=strength.toFixed(2);
  function save(){try{localStorage.setItem(key,JSON.stringify({enabled,strength,useNormal,useSpecular,lightMode,excluded:[...excluded]}));}catch{}}
  function apply(){
    maskToggle.disabled=!groups.some(g=>!excluded.has(g.key)&&g.materials.some(m=>m.userData.matcapPreview.uniforms.avatarMatcapNormalMap.value));
    if(maskToggle.disabled){maskOnly=false;maskToggle.checked=false;}
    let maskCount=0;
    toggle.disabled=!groups.length;slider.disabled=!groups.length||!enabled;
    normalToggle.disabled=!enabled||!groups.length;
    const specularMaterials=groups.flatMap(g=>g.materials).filter(m=>m.userData.matcapPreview.specular);
    const specularReady=specularMaterials.some(m=>m.userData.matcapPreview.uniforms.avatarMatcapMap.value&&m.userData.matcapPreview.uniforms.avatarMatcapNormalMap.value);
    lightSelect.disabled=!specularMaterials.length;
    const position=lightProfile?.position,hasPosition=Array.isArray(position)&&position.length===3&&position.every(v=>Number.isFinite(v)&&Math.abs(v)<=3.402823466e38),lightReady=lightMode==='camera'||hasPosition;
    const lightDescription=lightMode==='camera'?'카메라 위치의 확인용 광원':hasPosition?`${lightProfile.label} · 원본 위치 · 모델 원점 기준 근사`:'원본 광원 위치가 있는 지역 조명을 선택하세요.';
    specularToggle.disabled=!enabled||!useNormal||!specularReady;
    specularStatus.textContent=!specularMaterials.length?'현재 아이템에 지정된 반사색·반사 지수가 없습니다.':!specularReady?'반사 설정 연결됨 · 광택·표면 굴곡 텍스처 확인 필요':!enabled?'반사를 비교하려면 광택을 켜세요.':!useNormal?'반사에는 원본 표면 굴곡·광택 마스크가 필요합니다.':useSpecular?'반사 켜짐 · 카메라 위치의 확인용 광원':'반사 꺼짐 · 켜면 MatCap과 별도의 하이라이트를 비교합니다.';
    let active=0,specularActive=0;
    for(const group of groups){
      const capReady=group.materials.some(m=>m.userData.matcapPreview.uniforms.avatarMatcapMap.value);
      const ready=group.materials.some(m=>m.userData.matcapPreview.uniforms.avatarMatcapMap.value&&(!useNormal||m.userData.matcapPreview.uniforms.avatarMatcapNormalMap.value));
      const on=enabled&&!excluded.has(group.key);
      for(const m of group.materials){setMatcapPreview(m,on,strength,useNormal);setSpecularLight(m,lightMode,hasPosition?position:null);setSpecularPreview(m,useSpecular);setMatcapMaskPreview(m,maskOnly&&!excluded.has(group.key));if(m.userData.matcapPreview.uniforms.avatarMatcapMaskOnly.value>0)maskCount++;}
      if(group.lightStatus)group.lightStatus.textContent='반사 광원: '+lightDescription;
      if(on&&ready&&group.visible&&strength>0)active++;
      const normal=group.materials.some(m=>m.userData.matcapPreview.uniforms.avatarMatcapNormalEnabled.value>0);
      group.status.textContent=!on?'광택 꺼짐':!capReady?'광택 텍스처 확인 필요':!ready?'원본 굴곡·광택 마스크 확인 필요 · 적용 보류':!group.visible?'현재 숨겨진 메시의 광택':strength===0?'강도 0 · 기본 재질 표시':normal?'광택 켜짐 · 원본 굴곡·마스크 적용':'마스크 없는 비교 · 표면 전체에 광택 (인게임 적용 범위 미검증)';
      if(on&&ready&&group.visible&&strength>0&&group.materials.some(m=>m.userData.matcapPreview.uniforms.avatarSpecularEnabled.value>0)){group.status.textContent+=' · 반사 켜짐';specularActive++;}
    }
    const waiting=groups.filter(g=>enabled&&!excluded.has(g.key)&&g.materials.some(m=>m.userData.matcapPreview.uniforms.avatarMatcapMap.value&&useNormal&&!m.userData.matcapPreview.uniforms.avatarMatcapNormalMap.value)).length;
    status.textContent=groups.length?`광택 연결 ${groups.length}개 · 현재 표시 ${active}개${waiting?' · 마스크 확인 필요 '+waiting+'개':''}`:'연결된 광택 재질이 없습니다. 유광 타입 등 아이템별 목록에서 선택하세요.';
    if(enabled&&useNormal&&specularReady&&useSpecular)specularStatus.textContent=lightReady?`반사 켜짐 · 현재 표시 ${specularActive}개 · ${lightDescription}`:`반사 보류 · ${lightDescription} MatCap 광택은 유지합니다.`;
    maskStatus.textContent=maskOnly?`광택 마스크 확인 중 · 연결 ${maskCount}개 · 회색: 부분 허용 · 발광만 보기·번짐 일시 제외 · 끄면 기존 화면 복원`:maskToggle.disabled?'확인할 원본 광택 마스크가 없습니다.':'광택을 켜기 전에도 원본 마스크의 적용 범위를 확인할 수 있습니다.';
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
      if(group.input.matcap_preview.normal_texture)details.append(element('p','표면 굴곡·광택 마스크: '+group.input.matcap_preview.normal_texture));
      const specular=group.input.matcap_preview.specular;if(specular){group.lightStatus=element('p');details.append(element('p','반사색: '+specular.color.join(', ')+' · 반사 지수: '+specular.power),group.lightStatus);}
    }
    apply();
  }
  toggle.onchange=()=>{enabled=toggle.checked;save();apply();};
  slider.oninput=()=>{strength=Number(slider.value);output.value=strength.toFixed(2);save();apply();};
  normalToggle.onchange=()=>{useNormal=normalToggle.checked;save();apply();};
  specularToggle.onchange=()=>{useSpecular=specularToggle.checked;save();apply();};
  lightSelect.onchange=()=>{lightMode=lightSelect.value==='region'?'region':'camera';save();apply();};
  maskToggle.onchange=()=>{maskOnly=maskToggle.checked;apply();};
  return {refresh,isMaskInspection:()=>maskOnly,requiresLightProfile:()=>lightMode==='region'&&enabled&&useSpecular,setLightProfile:profile=>{lightProfile=profile;apply();}};
}

// Keep the legacy diffuse comparison separate from the source toon lookup.
// The latter shades the surface after MatCap/reflection and before emission.
export function installAvatarLighting(material){
  const uniforms={avatarLightEnabled:{value:0},avatarLightDirection:{value:new THREE.Vector3(0,0,1)},avatarLightColor:{value:new THREE.Color(1,1,1)},avatarLightStrength:{value:1},avatarLightInfluence:{value:.5},avatarEmissionPass:{value:0},avatarToonEnabled:{value:0},avatarToonMap:{value:null},avatarToonDirection:{value:new THREE.Vector3(0,0,1)},avatarToonColor:{value:new THREE.Color(1,1,1)},avatarToonIntensity:{value:1},avatarToonPower:{value:1}};
  material.userData.avatarLighting=uniforms;
  if(material.userData.input?.toon_preview?.status==='approximate')material.userData.toonPreview={enabled:false,profile:null,power:1};
  if(material.userData.input?.glow_preview?.status==='approximate')material.userData.glowPreview={enabled:false,profile:null};
  if(material.userData.input?.ext_preview?.status==='approximate')material.userData.extPreview={enabled:false,profile:null};
  Object.assign(uniforms,{avatarExtEnabled:{value:0},avatarExtMap:{value:null},avatarExtDirection:{value:new THREE.Vector3(0,0,-1)},avatarExtColor:{value:new THREE.Color()},avatarExtIntensity:{value:0},avatarExtPower:{value:1}});
  Object.assign(uniforms,{avatarGlowEnabled:{value:0},avatarGlowMap:{value:null},avatarGlowIntensity:{value:1}});
  if(material.userData.input?.second_preview?.status==='approximate')material.userData.secondPreview={enabled:false,offset:[0,0]};
  Object.assign(uniforms,{avatarSecondEnabled:{value:0},avatarSecondMap:{value:null},avatarSecondOffset:{value:new THREE.Vector2()}});
  const face=material.userData.input?.face_sdf_preview;
  if(material.userData.faceShadingAlpha&&face?.status==='approximate')material.userData.faceSdfPreview={enabled:false,profile:null,power:1,headReady:false};
  if(material.userData.toonPreview||material.userData.faceSdfPreview)material.userData.rimPreview={enabled:false,profile:null};
  Object.assign(uniforms,{avatarRimEnabled:{value:0},avatarRimDirection:{value:new THREE.Vector3(0,0,-1)},avatarRimWidth:{value:0},avatarRimPower:{value:0}});
  Object.assign(uniforms,{avatarFaceEnabled:{value:0},avatarFaceSide:{value:new THREE.Vector3(1,0,0)},avatarFaceForward:{value:new THREE.Vector3(0,0,1)},avatarFaceDirection:{value:new THREE.Vector3(0,0,1)},avatarFaceColor:{value:new THREE.Color(1,1,1)},avatarFaceIntensity:{value:1},avatarFacePower:{value:1}});
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.customProgramCacheKey=()=>key+'|avatar-gloss-mask-v8';
  material.onBeforeCompile=function(shader){
    previous.call(this,shader);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec3 avatarLightingNormal;\nvarying float avatarToonCoordinate;\nuniform vec3 avatarToonDirection;\n'+shader.vertexShader
      .replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )','#if 1')
      .replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\navatarLightingNormal = inverseTransformDirection(transformedNormal, viewMatrix);\navatarToonCoordinate = dot(avatarLightingNormal, normalize(avatarToonDirection));');
    shader.fragmentShader='varying vec3 avatarLightingNormal;\nuniform float avatarLightEnabled;\nuniform vec3 avatarLightDirection;\nuniform vec3 avatarLightColor;\nuniform float avatarLightStrength;\nuniform float avatarLightInfluence;\nuniform float avatarEmissionPass;\n'+shader.fragmentShader
      .replace('#include <color_fragment>',`#include <color_fragment>
if (avatarLightEnabled > 0.5) {
  float directional = max(dot(normalize(avatarLightingNormal), normalize(avatarLightDirection)), 0.0);
  diffuseColor.rgb *= mix(vec3(1.0), avatarLightColor * avatarLightStrength, directional * avatarLightInfluence);
}`)
      .replace('#include <opaque_fragment>',`${material.userData.matcapPreview?`if (avatarMatcapMaskOnly > 0.5 && avatarEmissionPass < 0.5) {
  vec4 inspectionBump = textureLod(avatarMatcapNormalMap,avatarMatcapUv,0.0);
  outgoingLight = vec3(any(greaterThan(inspectionBump.rgb,vec3(0.0))) ? inspectionBump.a : 0.0);
}`:''}
if (avatarEmissionPass > 0.5) {
  outgoingLight = ${material.userData.materialPreview?'avatarMaterialEnabled * texture2D(avatarEmissiveMap, avatarMaterialUv).rgb * avatarEmissiveColor * avatarEmissiveStrength':'vec3(0.0)'};
}
#include <opaque_fragment>`);
    shader.fragmentShader='varying float avatarToonCoordinate;\nuniform float avatarToonEnabled;\nuniform sampler2D avatarToonMap;\nuniform vec3 avatarToonColor;\nuniform float avatarToonIntensity;\nuniform float avatarToonPower;\n'+shader.fragmentShader;
    shader.fragmentShader='uniform float avatarFaceEnabled;\nuniform vec3 avatarFaceSide;\nuniform vec3 avatarFaceForward;\nuniform vec3 avatarFaceDirection;\nuniform vec3 avatarFaceColor;\nuniform float avatarFaceIntensity;\nuniform float avatarFacePower;\n'+shader.fragmentShader;
    shader.fragmentShader='uniform float avatarGlowEnabled;\nuniform sampler2D avatarGlowMap;\nuniform float avatarGlowIntensity;\nvarying vec2 avatarGlowUv;\n'+shader.fragmentShader;
    shader.fragmentShader='uniform float avatarSecondEnabled;\nuniform sampler2D avatarSecondMap;\nuniform vec2 avatarSecondOffset;\n'+shader.fragmentShader;
    shader.fragmentShader='uniform float avatarExtEnabled;\nuniform sampler2D avatarExtMap;\nuniform vec3 avatarExtDirection;\nuniform vec3 avatarExtColor;\nuniform float avatarExtIntensity;\nuniform float avatarExtPower;\n'+shader.fragmentShader;
    shader.fragmentShader='uniform float avatarRimEnabled;\nuniform vec3 avatarRimDirection;\nuniform float avatarRimWidth;\nuniform float avatarRimPower;\n'+shader.fragmentShader;
    shader.vertexShader='varying vec2 avatarGlowUv;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\navatarGlowUv = uv;');
    const marker=material.userData.materialPreview?'/* avatar_surface_end */':'#include <opaque_fragment>';
    shader.fragmentShader=shader.fragmentShader.replace(marker,`float rimWeight = 0.0;
if (avatarRimEnabled > 0.5 && avatarEmissionPass < 0.5) {
  // PS cb1[9] and cb2[13]: source camera forward, not per-fragment eye rays.
  vec3 rimView = inverseTransformDirection(vec3(0.0,0.0,-1.0),viewMatrix);
  rimWeight = clamp(1.0-abs(dot(avatarLightingNormal,rimView))*avatarRimWidth,0.0,1.0)
    * max(-dot(avatarRimDirection,rimView),0.0)*avatarRimPower;
}
if (avatarToonEnabled > 0.5) {
  vec3 toon = clamp(texture2D(avatarToonMap, vec2(avatarToonCoordinate)).rgb * avatarToonPower,0.0,1.0);
  vec3 surface = outgoingLight;
  outgoingLight *= toon * avatarToonColor * avatarToonIntensity;
  outgoingLight += toon*surface*rimWeight;
  if (avatarExtEnabled > 0.5 && avatarEmissionPass < 0.5) {
    // Source t2.R / cb1[7:8]. This uses the geometric world normal, separately
    // from the BUMP normal used by the XET MatCap reflection branch.
    float red = texture2D(avatarExtMap,avatarGlowUv).r;
    float nl = dot(avatarLightingNormal,avatarExtDirection);
    vec3 reflected = avatarLightingNormal-2.0*nl*avatarExtDirection;
    vec3 viewNormal = normalize(mat3(viewMatrix)*avatarLightingNormal);
    float angle = clamp(dot(-viewNormal,reflected),0.0,1.0);
    float exponent = red*avatarExtPower;
    float highlight = exponent > 0.0 ? pow(angle,exponent) : 1.0;
    outgoingLight += toon*surface*avatarExtColor*(red*avatarExtIntensity*max(-nl,0.0)*highlight);
  }
}
#ifdef USE_MAP
if (avatarFaceEnabled > 0.5) {
  vec3 faceLight = normalize(avatarFaceDirection);
  float faceFront = clamp(dot(avatarFaceForward,faceLight),-1.0,1.0);
  float faceSide = dot(avatarFaceSide,faceLight);
  float faceAbs = abs(faceFront);
  float faceAngle = ((-0.018729 * faceAbs + 0.074261) * faceAbs - 0.212114) * faceAbs + 1.570729;
  faceAngle *= sqrt(max(0.0,1.0-faceAbs));
  if (faceFront < 0.0) faceAngle = 3.141593-faceAngle;
  float faceThreshold = faceAngle * 0.318310 - 0.01;
  float faceLeft = texture2D(map,vec2(1.0-vMapUv.x,vMapUv.y)).a;
  float faceRight = texture2D(map,vMapUv).a;
  float faceDistance = mix(faceLeft,faceRight,smoothstep(-0.1,0.1,faceSide));
  float faceLit = smoothstep(0.0,0.02,faceDistance-faceThreshold);
  vec3 faceShadow = vec3(1.0,0.878,0.784);
  vec3 faceTint = mix(faceShadow,clamp(outgoingLight+faceShadow,0.0,1.0),faceLit);
  vec3 faceSurface = clamp(outgoingLight * clamp(faceTint*avatarFacePower,0.0,1.0),0.0,1.0);
  outgoingLight = faceSurface * (avatarFaceColor * avatarFaceIntensity + vec3(rimWeight));
}
#endif
if (avatarGlowEnabled > 0.5 && avatarEmissionPass < 0.5) {
  // PS t3 * cb1[4].x is added after toon; this is not the MRT1 emissive output.
  outgoingLight += texture2D(avatarGlowMap,avatarGlowUv).rgb * avatarGlowIntensity;
}
if (avatarSecondEnabled > 0.5 && avatarEmissionPass < 0.5) {
  // Source t8.rgb adds after toon, independently of light color/intensity.
  outgoingLight += texture2D(avatarSecondMap,avatarGlowUv+avatarSecondOffset).rgb;
}
`+marker);
  };
}

export function setAvatarSecond(material,enabled,offset=[0,0]){
  const p=material.userData.secondPreview,u=material.userData.avatarLighting;if(!p||!u)return;
  p.enabled=enabled;p.offset=[0,1].map(i=>Number.isFinite(offset?.[i])?Math.max(-1,Math.min(1,offset[i])):0);
  u.avatarSecondOffset.value.set(...p.offset);u.avatarSecondEnabled.value=enabled&&u.avatarSecondMap.value?1:0;
}

export function setAvatarSecondMap(material,map){
  const p=material.userData.secondPreview,u=material.userData.avatarLighting;if(!p||!u)return;
  u.avatarSecondMap.value=map;setAvatarSecond(material,p.enabled,p.offset);
}

export function setAvatarLight(material,profile,influence=.5){
  const u=material.userData.avatarLighting;if(!u)return;
  u.avatarLightEnabled.value=profile?1:0;
  u.avatarLightInfluence.value=Math.max(0,Math.min(1,influence));
  if(profile){u.avatarLightColor.value.setRGB(...profile.color.slice(0,3));u.avatarLightDirection.value.set(profile.direction[0],profile.direction[1],-profile.direction[2]).normalize();u.avatarLightStrength.value=profile.intensity;}
}

export function setAvatarToon(material,enabled,profile,power=1){
  const preview=material.userData.toonPreview,u=material.userData.avatarLighting;if(!preview||!u)return;
  preview.enabled=enabled;preview.profile=profile;preview.power=Number.isFinite(power)?Math.max(0,Math.min(2,power)):1;
  u.avatarToonPower.value=preview.power;
  u.avatarToonEnabled.value=enabled&&profile&&u.avatarToonMap.value?1:0;
  if(profile){u.avatarToonDirection.value.set(profile.direction[0],profile.direction[1],-profile.direction[2]).normalize();u.avatarToonColor.value.setRGB(...profile.color.slice(0,3));u.avatarToonIntensity.value=profile.intensity;}
}

export function setAvatarToonMap(material,map){
  const preview=material.userData.toonPreview,u=material.userData.avatarLighting;if(!preview||!u)return;
  u.avatarToonMap.value=map;setAvatarToon(material,preview.enabled,preview.profile,preview.power);
}

export function setAvatarGlow(material,enabled,profile){
  const preview=material.userData.glowPreview,u=material.userData.avatarLighting;if(!preview||!u)return;
  preview.enabled=enabled;preview.profile=profile;
  u.avatarGlowEnabled.value=enabled&&profile&&u.avatarGlowMap.value?1:0;
  if(profile)u.avatarGlowIntensity.value=profile.intensity;
}

export function setAvatarGlowMap(material,map){
  const preview=material.userData.glowPreview,u=material.userData.avatarLighting;if(!preview||!u)return;
  u.avatarGlowMap.value=map;setAvatarGlow(material,preview.enabled,preview.profile);
}

export function setAvatarExt(material,enabled,profile){
  const p=material.userData.extPreview,u=material.userData.avatarLighting;if(!p||!u)return;
  p.enabled=enabled;p.profile=profile;const spec=profile?.global_specular;
  u.avatarExtEnabled.value=enabled&&spec&&u.avatarExtMap.value?1:0;
  if(spec){u.avatarExtColor.value.setRGB(...spec.color.slice(0,3));u.avatarExtIntensity.value=spec.intensity;u.avatarExtPower.value=spec.power;u.avatarExtDirection.value.set(-profile.direction[0],-profile.direction[1],profile.direction[2]).normalize();}
}

export function setAvatarExtMap(material,map){
  const p=material.userData.extPreview,u=material.userData.avatarLighting;if(!p||!u)return;
  u.avatarExtMap.value=map;setAvatarExt(material,p.enabled,p.profile);
}

export function setAvatarRim(material,enabled,profile){
  const p=material.userData.rimPreview,u=material.userData.avatarLighting;if(!p||!u)return;
  p.enabled=enabled;p.profile=profile;const rim=profile?.global_rim;
  u.avatarRimEnabled.value=enabled&&rim?1:0;
  if(rim){u.avatarRimWidth.value=rim.width;u.avatarRimPower.value=rim.power;u.avatarRimDirection.value.set(-profile.direction[0],-profile.direction[1],profile.direction[2]).normalize();}
}

export function setAvatarFaceSdf(material,enabled,profile,power=1){
  const preview=material.userData.faceSdfPreview,u=material.userData.avatarLighting;if(!preview||!u)return;
  preview.enabled=enabled;preview.profile=profile;preview.power=Number.isFinite(power)?Math.max(0,Math.min(2,power)):1;
  u.avatarFacePower.value=preview.power;
  u.avatarFaceEnabled.value=enabled&&profile&&material.map&&preview.headReady?1:0;
  if(profile){u.avatarFaceDirection.value.set(profile.direction[0],profile.direction[1],-profile.direction[2]).normalize();u.avatarFaceColor.value.setRGB(...profile.color.slice(0,3));u.avatarFaceIntensity.value=profile.intensity;}
}

export function updateAvatarFaceFrame(material,headMatrix){
  const preview=material.userData.faceSdfPreview,u=material.userData.avatarLighting;if(!preview||!u)return;
  preview.headReady=false;
  if(headMatrix){
    u.avatarFaceSide.value.setFromMatrixColumn(headMatrix,1);u.avatarFaceForward.value.setFromMatrixColumn(headMatrix,2);
    if(u.avatarFaceSide.value.lengthSq()>1e-10&&u.avatarFaceForward.value.lengthSq()>1e-10){u.avatarFaceSide.value.normalize();u.avatarFaceForward.value.normalize();preview.headReady=true;}
  }
  setAvatarFaceSdf(material,preview.enabled,preview.profile,preview.power);
}

export function interpolateAvatarLight(profile,mix=0){
  if(!profile||!Number.isFinite(profile.intensity)||profile.intensity<0||!Number.isFinite(profile.near_intensity)||profile.near_intensity<0)return profile;
  const weight=Number.isFinite(mix)?Math.max(0,Math.min(1,mix)):0;
  if(weight===0)return profile;
  return {...profile,intensity:weight===1?profile.near_intensity:profile.intensity*(1-weight)+profile.near_intensity*weight};
}

export function setupAvatarLighting({state,api,element,getEmissionEnabled}){
  const $=id=>document.getElementById(id),storageKey='closers-avatar-lighting-v2';
  let settings={enabled:false,selected:'',excluded:[],bloom:true,bloomStrength:.8,influence:.5,solo:false,soloExposure:4,toon:false,toonPower:1,faceSdf:false,glow:false,ext:false,rim:false};
  try{const current=localStorage.getItem(storageKey),saved=JSON.parse(current||localStorage.getItem('closers-avatar-lighting-v1')||'{}');settings={...settings,enabled:!!current&&saved?.enabled===true&&saved?.legacyExplicit===true,legacyExplicit:saved?.legacyExplicit===true,selected:typeof saved?.selected==='string'?saved.selected:'',excluded:Array.isArray(saved?.excluded)?saved.excluded.filter(v=>typeof v==='string'):[],bloom:saved?.bloom!==false,bloomStrength:Number.isFinite(saved?.bloomStrength)?Math.max(0,Math.min(2,saved.bloomStrength)):.8,influence:Number.isFinite(saved?.influence)?Math.max(0,Math.min(1,saved.influence)):.5};}catch{}
  const excluded=new Set(settings.excluded);let profiles=[],groups=[],pending=null;
  const button=element('button','조명 · 발광');button.id='open-avatar-lighting';button.type='button';button.className='secondary';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','avatar-lighting-dialog');document.querySelector('.viewport-actions').prepend(button);
  const dialog=element('dialog');dialog.id='avatar-lighting-dialog';dialog.setAttribute('aria-labelledby','avatar-lighting-title');
  dialog.innerHTML='<div class="view-settings-heading"><h2 id="avatar-lighting-title">아바타 조명 · 발광</h2><button type="button" class="secondary">닫기</button></div><p id="avatar-lighting-summary" role="status"></p><fieldset><legend>발광 확인</legend><div id="avatar-emission-master"></div><label><input id="avatar-emission-solo" type="checkbox"> 발광만 보기 · 검은 배경에서 발광 부위 확인</label><label><input id="avatar-emission-bloom" type="checkbox"> 빛 번짐</label><label>번짐 강도<input id="avatar-emission-strength" type="range" min="0" max="2" step="0.05"><output id="avatar-emission-strength-value"></output></label><p class="muted">번짐은 발광 텍스처가 지정된 부위에만 적용하는 뷰어 미리보기입니다.</p><div id="avatar-emission-items"></div></fieldset><details><summary>원본 조명 수치 비교 (실험)</summary><fieldset><label><input id="avatar-lighting-enabled" type="checkbox"> 조명 수치 비교 켜기</label><label>참조할 원본<select id="avatar-lighting-profile" aria-label="의상 조명 선택"><option value="">조명 목록 불러오기</option></select></label><label>비교 강도<input id="avatar-lighting-influence" type="range" min="0" max="1" step="0.05"></label><p id="avatar-lighting-status" class="muted" role="status"></p><p class="muted">게임 조명 재현이 아닙니다. 기존 텍스처의 음영을 유지하며 원본 색·강도의 영향을 비교합니다. 세트 착용 조건·툰·MatCap은 자동 적용하지 않습니다.</p><details><summary>선택한 조명 출처</summary><pre id="avatar-lighting-source"></pre></details></fieldset></details>';
  document.body.append(dialog);$('avatar-lighting-enabled').checked=settings.enabled;
  const matcap=setupMatcapControls({state,element,dialog});
  settings.sourceColor=false;try{settings.sourceColor=JSON.parse(localStorage.getItem(storageKey)||'{}')?.sourceColor===true;}catch{}
  const colorField=element('fieldset');colorField.innerHTML='<legend>색상 계산 비교</legend><label><input id="avatar-source-color" type="checkbox"> 원본 형식의 색상 계산 비교 (후처리 미포함)</label><p id="avatar-source-color-status" role="status"></p><p>화면 전체의 입력·출력 색상 계산을 함께 전환합니다. 기본색과 조명·광택의 합성 결과가 달라질 수 있습니다. 실제 게임의 후처리·장면 상태는 포함하지 않습니다. 끄면 기존 뷰어 화면으로 돌아갑니다.</p>';
  dialog.querySelector('fieldset').before(colorField);const sourceColorToggle=$('avatar-source-color');sourceColorToggle.checked=settings.sourceColor;
  settings.colorGrading=normalizeColorGrading(null);try{settings.colorGrading=normalizeColorGrading(JSON.parse(localStorage.getItem(storageKey)||'{}')?.colorGrading);}catch{}
  const gradeDetails=element('details');gradeDetails.innerHTML='<summary>색상 보정 비교</summary><label><input id="avatar-grade-enabled" type="checkbox"> 색상 보정 켜기</label><p>원본 형식의 색상 계산을 켠 뒤 비교합니다. 아래 중립값에서 시작하며 게임의 프리셋·장면 설정을 자동으로 가져오지는 않습니다. 발광만 보기와 광택 범위 확인 중에는 보정을 잠시 보류합니다.</p><div id="avatar-grade-values"></div><button id="avatar-grade-reset" type="button" class="secondary">색상 보정 중립값</button><p id="avatar-grade-status" role="status"></p>';colorField.append(gradeDetails);
  const gradeToggle=$('avatar-grade-enabled');gradeToggle.checked=settings.colorGrading.enabled;
  const gradeInputs=[];
  for(const [key,index,label,min,max] of [['rgb',0,'빨강 배율',0,2],['rgb',1,'초록 배율',0,2],['rgb',2,'파랑 배율',0,2],['bcs',0,'밝기',-1,1],['bcs',1,'대비',-1,2],['bcs',2,'채도',0,2]]){
    const row=element('label',label),input=element('input');input.type='number';input.id=`avatar-grade-${key}-${index}`;input.min=min;input.max=max;input.step=.05;input.value=settings.colorGrading[key][index];row.append(input);$('avatar-grade-values').append(row);gradeInputs.push(input);
    input.onchange=()=>{const value=input.valueAsNumber;if(Number.isFinite(value))settings.colorGrading[key][index]=Math.max(min,Math.min(max,value));input.value=settings.colorGrading[key][index];save();apply();};
  }
  gradeToggle.onchange=()=>{settings.colorGrading.enabled=gradeToggle.checked;save();apply();};
  $('avatar-matcap-mask-only').addEventListener('change',()=>apply());
  $('avatar-grade-reset').onclick=()=>{const enabled=settings.colorGrading.enabled;settings.colorGrading=normalizeColorGrading({enabled});for(const input of gradeInputs){const [,key,index]=input.id.match(/avatar-grade-(rgb|bcs)-(\d)/);input.value=settings.colorGrading[key][Number(index)];}save();apply();};
  $('avatar-lighting-title').textContent='아바타 조명 · 재질';
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');settings.toon=saved?.toon===true;settings.faceSdf=saved?.faceSdf===true;settings.glow=saved?.glow===true;settings.toonPower=Number.isFinite(saved?.toonPower)?Math.max(0,Math.min(2,saved.toonPower)):1;if(settings.toon){settings.enabled=false;$('avatar-lighting-enabled').checked=false;}}catch{}
  const toonField=element('fieldset');toonField.innerHTML='<legend>원본 툰 음영 (근사)</legend><label><input id="avatar-toon-enabled" type="checkbox"> 원본 툰 음영 켜기</label><div id="avatar-toon-profile"></div><label>음영 밝기<input id="avatar-toon-power" type="range" min="0" max="2" step="0.05"><output id="avatar-toon-power-value"></output></label><p class="muted">모델과 아이템 타입에 연결된 툰 텍스처를 사용합니다. 의상 조명을 선택하세요. 얼굴 전용 음영·착용 조건·게임 후처리는 포함하지 않습니다. 끄면 기존 재질로 돌아갑니다.</p><p id="avatar-toon-status" role="status"></p><details><summary>툰 연결 · 적용 상태</summary><div id="avatar-toon-items"></div></details>';
  const legacy=$('avatar-lighting-enabled').closest('details');legacy.before(toonField);legacy.querySelector('summary').textContent='기존 색상 수치 비교 (실험)';$('avatar-toon-profile').append($('avatar-lighting-profile').closest('label'));
  $('avatar-toon-enabled').checked=settings.toon;$('avatar-toon-power').value=settings.toonPower;$('avatar-toon-power-value').value=settings.toonPower.toFixed(2);
  settings.nearMix=0;
  try{const value=JSON.parse(localStorage.getItem(storageKey)||'{}')?.nearMix;if(Number.isFinite(value))settings.nearMix=Math.max(0,Math.min(1,value));}catch{}
  const nearLabel=element('label','원거리 → 근거리 조명 강도 · 수동 비교'),nearInput=element('input'),nearStatus=element('p');
  nearInput.id='avatar-lighting-near-mix';nearInput.type='range';nearInput.min=0;nearInput.max=1;nearInput.step=.05;nearInput.value=settings.nearMix;
  nearInput.setAttribute('aria-label','원거리와 근거리 원본 조명 강도의 수동 혼합 비율');nearInput.setAttribute('aria-describedby','avatar-lighting-near-status');
  nearStatus.id='avatar-lighting-near-status';nearStatus.setAttribute('role','status');nearLabel.append(nearInput);
  $('avatar-toon-power').closest('label').after(nearLabel);nearLabel.after(nearStatus);
  settings.second=false;settings.secondVersion=2;settings.secondOffset=[0,0];
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');settings.second=saved?.secondVersion===2&&saved?.second===true;if(Array.isArray(saved?.secondOffset)&&saved.secondOffset.length===2&&saved.secondOffset.every(Number.isFinite))settings.secondOffset=saved.secondOffset.map(v=>Math.max(-1,Math.min(1,v)));}catch{}
  const secondField=element('fieldset');secondField.innerHTML='<legend>하이퍼 모드 색상 효과 · 정지 합성 실험</legend><label><input id="avatar-second-enabled" type="checkbox"> 효과 텍스처 정지 합성 켜기</label><label>UV 가로 이동<input id="avatar-second-u" type="range" min="-1" max="1" step="0.05"></label><label>UV 세로 이동<input id="avatar-second-v" type="range" min="-1" max="1" step="0.05"></label><p id="avatar-second-status" role="status"></p><p>원본 하이퍼 모드 효과 텍스처를 더하므로 표면이 파랗게 보일 수 있습니다. 일반 조명·코스튬 유광을 확인할 때는 꺼두세요. 자동 발동·UV 애니메이션·인게임 외형은 재현하지 않습니다.</p>';
  const secondDetails=element('details');secondDetails.id='avatar-state-experiments';secondDetails.append(element('summary','캐릭터 상태 효과 실험'),secondField);secondDetails.open=settings.second;toonField.after(secondDetails);const secondToggle=$('avatar-second-enabled'),secondU=$('avatar-second-u'),secondV=$('avatar-second-v');secondToggle.checked=settings.second;secondU.value=settings.secondOffset[0];secondV.value=settings.secondOffset[1];
  const faceLabel=element('label'),faceToggle=element('input');faceToggle.id='avatar-face-sdf-enabled';faceToggle.type='checkbox';faceToggle.checked=settings.faceSdf;faceLabel.append(faceToggle,document.createTextNode(' 얼굴 SDF 음영 포함 (근사)'));$('avatar-toon-enabled').closest('label').after(faceLabel);
  const glowLabel=element('label'),glowToggle=element('input');glowToggle.id='avatar-glow-enabled';glowToggle.type='checkbox';glowToggle.checked=settings.glow;glowLabel.append(glowToggle,document.createTextNode(' 원본 GLOW 표면 보조광 포함 (근사)'));faceLabel.after(glowLabel);
  const glowStatus=element('p');glowStatus.id='avatar-glow-status';glowStatus.className='muted';glowStatus.setAttribute('role','status');glowLabel.after(glowStatus);
  try{settings.ext=JSON.parse(localStorage.getItem(storageKey)||'{}')?.ext===true;}catch{}
  const extLabel=element('label'),extToggle=element('input');extToggle.id='avatar-ext-enabled';extToggle.type='checkbox';extToggle.checked=settings.ext;extLabel.append(extToggle,document.createTextNode(' 원본 EXT 전역 반사 포함 (근사)'));glowStatus.after(extLabel);
  const extStatus=element('p');extStatus.id='avatar-ext-status';extStatus.setAttribute('role','status');extLabel.after(extStatus);
  try{settings.rim=JSON.parse(localStorage.getItem(storageKey)||'{}')?.rim===true;}catch{}
  const rimLabel=element('label'),rimToggle=element('input');rimToggle.id='avatar-rim-enabled';rimToggle.type='checkbox';rimToggle.checked=settings.rim;rimLabel.append(rimToggle,document.createTextNode(' 원본 테두리광 포함 (근사)'));extStatus.after(rimLabel);
  const rimStatus=element('p');rimStatus.id='avatar-rim-status';rimStatus.setAttribute('role','status');rimLabel.after(rimStatus);
  toonField.querySelector('p.muted:not(#avatar-glow-status)').textContent='원본 툰 음영을 켠 뒤 의상 조명을 선택하세요. 조명 선택만으로 효과가 켜지지는 않습니다. 얼굴 SDF와 GLOW는 따로 켤 수 있습니다. 게임의 전체 조명·착용 조건·후처리와 차이가 있습니다. 끄면 기존 재질로 돌아갑니다.';
  const exposureLabel=element('label','확인용 밝기'),exposureInput=element('input'),exposureValue=element('output');exposureInput.id='avatar-emission-exposure';exposureInput.type='range';exposureInput.min=1;exposureInput.max=8;exposureInput.step=.5;exposureInput.value=settings.soloExposure;exposureInput.setAttribute('aria-label','발광만 보기의 확인용 밝기');exposureValue.value=settings.soloExposure+'×';exposureLabel.append(exposureInput,exposureValue);$('avatar-emission-solo').closest('label').after(exposureLabel);exposureInput.oninput=()=>{settings.soloExposure=Number(exposureInput.value);exposureValue.value=settings.soloExposure+'×';};
  const master=$('material-preview').closest('label');master.lastChild.textContent=' 발광 켜기';$('avatar-emission-master').append(master,$('material-preview-note'));$('material-preview-note').textContent='발광만 보기에서 실제 발광 부위를 확인하고, 빛 번짐을 따로 비교할 수 있습니다.';
  $('avatar-emission-bloom').checked=settings.bloom;$('avatar-emission-strength').value=settings.bloomStrength;$('avatar-emission-strength-value').value=settings.bloomStrength.toFixed(2);$('avatar-lighting-influence').value=settings.influence;
  function save(){settings.excluded=[...excluded];try{localStorage.setItem(storageKey,JSON.stringify(settings));}catch{}}
  function selected(){const p=profiles.find(p=>p.key===settings.selected);const characters=new Set((state.data?.sources||[]).map(s=>s.model_group?.character).filter(Boolean));return p&&(!characters.size||!p.characters?.length||[...characters].every(c=>p.characters.includes(c)))?p:null;}
  function apply(){
    matcap.setLightProfile(selected());
    const gradeAvailable=!!state.model&&settings.sourceColor,gradePaused=matcap.isMaskInspection()||settings.solo;
    gradeToggle.disabled=!gradeAvailable;for(const input of gradeInputs)input.disabled=!gradeAvailable||!settings.colorGrading.enabled;$('avatar-grade-reset').disabled=!gradeAvailable;
    $('avatar-grade-status').textContent=!gradeAvailable?'아바타를 선택하고 원본 형식의 색상 계산을 켜세요.':!settings.colorGrading.enabled?'색상 보정 꺼짐':gradePaused?'진단 화면 확인 중 · 색상 보정 잠시 보류':'색상 보정 비교 중 · 게임 프리셋·다른 후처리 미포함';
    sourceColorToggle.disabled=!state.model;
    $('avatar-source-color-status').textContent=!state.model?'아바타를 선택하면 색상 계산을 비교합니다.':settings.sourceColor?`원본 형식 비교 중 · 입력값으로 합성 · 추가 출력 색 변환 없음 · ${settings.colorGrading.enabled&&!gradePaused?'색상 보정 비교 · 다른 후처리 미포함':'게임 후처리 미포함'}`:'기존 뷰어 색상 계산 · 원본 최종 화면과의 일치는 미검증입니다.';
    const secondMaterials=(state.model?.materials||[]).filter(m=>m.userData.secondPreview),secondReady=secondMaterials.filter(m=>m.userData.avatarLighting.avatarSecondMap.value);
    secondToggle.disabled=!secondMaterials.length;secondU.disabled=secondV.disabled=!settings.second||!secondReady.length;
    for(const m of secondMaterials)setAvatarSecond(m,settings.second,settings.secondOffset);
    $('avatar-second-status').textContent=!secondMaterials.length?'현재 모델에 연결된 하이퍼 모드 효과 텍스처가 없습니다.':!settings.second?`효과 텍스처 연결 ${secondMaterials.length}개 · 꺼짐`:!secondReady.length?'효과 텍스처 출처를 확인하세요.':`정지 색상 효과 켜짐 · 준비 ${secondReady.length} / 연결 ${secondMaterials.length}개 · UV ${settings.secondOffset.map(v=>v.toFixed(2)).join(', ')} · 수동 비교`;
    const profile=settings.enabled?selected():null;
    const sourceProfile=selected(),toonProfile=interpolateAvatarLight(sourceProfile,settings.nearMix),toonMaterials=(state.model?.materials||[]).filter(m=>m.userData.toonPreview),toonReady=toonMaterials.filter(m=>m.userData.avatarLighting.avatarToonMap.value);
    const faces=(state.model?.materials||[]).filter(m=>m.userData.faceSdfPreview),faceReady=faces.filter(m=>m.map&&m.userData.faceSdfPreview.headReady);
    const glowMaterials=(state.model?.materials||[]).filter(m=>m.userData.glowPreview),glowReady=glowMaterials.filter(m=>m.userData.avatarLighting.avatarGlowMap.value);
    const hasNear=sourceProfile&&Number.isFinite(sourceProfile.near_intensity)&&sourceProfile.near_intensity>=0;
    nearInput.disabled=!settings.toon||!hasNear||(!toonReady.length&&(!settings.faceSdf||!faceReady.length)&&(!settings.glow||!glowReady.length));
    nearStatus.textContent=!sourceProfile?'조명을 선택하면 원본 원거리·근거리 강도를 비교합니다.':!hasNear?'원본 근거리 강도가 없습니다. 원거리 강도를 유지합니다.':!state.model?'아바타를 선택하면 강도를 비교합니다.':!settings.toon?'원거리·근거리 강도 비교 꺼짐 · 원본 툰 음영을 켜세요.':`원거리 ${sourceProfile.intensity} → 근거리 ${sourceProfile.near_intensity} · 수동 혼합 ${Math.round(settings.nearMix*100)}% · 비교 강도 ${toonProfile.intensity.toFixed(3)}${sourceProfile.intensity===sourceProfile.near_intensity?' · 양쪽 강도 같음':''} · 카메라 거리 자동 연동 아님`;
    $('avatar-toon-enabled').disabled=!toonMaterials.length&&!faces.length&&!glowMaterials.length;faceToggle.disabled=!settings.toon||!faces.length;glowToggle.disabled=!settings.toon||!glowMaterials.length;$('avatar-toon-power').disabled=!settings.toon||(!toonReady.length&&(!settings.faceSdf||!faceReady.length));
    for(const m of state.model?.materials||[])setAvatarToon(m,settings.toon,toonProfile,settings.toonPower);
    for(const m of faces)setAvatarFaceSdf(m,settings.toon&&settings.faceSdf,toonProfile,settings.toonPower);
    for(const m of glowMaterials)setAvatarGlow(m,settings.toon&&settings.glow,toonProfile);
    const extMaterials=(state.model?.materials||[]).filter(m=>m.userData.extPreview&&m.userData.toonPreview),extReady=extMaterials.filter(m=>m.userData.avatarLighting.avatarExtMap.value&&m.userData.avatarLighting.avatarToonMap.value);
    extToggle.disabled=!settings.toon||!extMaterials.length;
    for(const m of state.model?.materials||[])setAvatarExt(m,settings.toon&&settings.ext,toonProfile);
    extStatus.textContent=!extMaterials.length?'연결된 EXT 전역 반사 맵이 없습니다.':!settings.toon||!settings.ext?`EXT 전역 반사 ${extMaterials.length}개 · 꺼짐`:!toonProfile?.global_specular?'EXT 반사 수치가 있는 지역 조명을 선택하세요.':`EXT 전역 반사 켜짐 · 준비 ${extReady.length} / 연결 ${extMaterials.length}개 · 지역 수동 비교 · 번짐/발광만 보기에서 제외`;
    const rimMaterials=(state.model?.materials||[]).filter(m=>m.userData.rimPreview),rim=toonProfile?.global_rim;
    rimToggle.disabled=!settings.toon||!rimMaterials.length;
    for(const m of state.model?.materials||[])setAvatarRim(m,settings.toon&&settings.rim,toonProfile);
    const rimReady=rimMaterials.filter(m=>m.userData.avatarLighting.avatarToonEnabled.value||m.userData.avatarLighting.avatarFaceEnabled.value);
    rimStatus.textContent=!rimMaterials.length?'테두리광을 비교할 툰·얼굴 재질이 없습니다.':!settings.toon||!settings.rim?'테두리광 꺼짐':!rim?'테두리광 수치가 있는 지역 조명을 선택하세요.':!rimReady.length?'활성 툰·얼굴 음영과 텍스처를 확인하세요.':rim.power===0?`원본 테두리광 강도 0 · 화면 변화 없음 · 폭 ${rim.width}`:`원본 테두리광 · 적용 ${rimReady.length} / 연결 ${rimMaterials.length}개 · 폭 ${rim.width} · 강도 ${rim.power} · 카메라 방향 연동 · 번짐/발광만 보기에서 제외`;
    glowStatus.textContent=!glowMaterials.length?'연결된 원본 GLOW 보조광이 없습니다.':!settings.toon||!settings.glow?`보조광 연결 ${glowMaterials.length}개 · 꺼짐`:!toonProfile?'보조광에 사용할 의상 조명을 선택하세요.':`표면 보조광 켜짐 · 준비 ${glowReady.length}개 / 연결 ${glowMaterials.length}개${glowReady.length<glowMaterials.length?' · 텍스처 확인 필요':''} · 번짐/발광만 보기에서 제외`;
    $('avatar-toon-status').textContent=!state.model?'아바타를 선택하면 원본 툰 연결을 확인합니다.':!toonMaterials.length&&!faces.length&&!glowMaterials.length?'현재 모델에 적용 가능한 툰·얼굴 SDF·보조광 연결이 없습니다.':!settings.toon?`툰 연결 ${toonMaterials.length}개 · 얼굴 SDF ${faces.length}개 · 보조광 ${glowMaterials.length}개 · 꺼짐${toonProfile?' · 선택한 조명을 적용하려면 원본 툰 음영을 켜세요.':''}`:!toonProfile?'툰 음영에 사용할 의상 조명을 선택하세요.':`툰 음영 켜짐 · 적용 ${toonReady.length}개 / 연결 ${toonMaterials.length}개${toonReady.length<toonMaterials.length?' · 툰 텍스처 확인 필요':''}${settings.faceSdf?' · 얼굴 SDF '+faceReady.length+' / '+faces.length+'개':''}${settings.faceSdf&&faceReady.length<faces.length?' · 얼굴 텍스처·머리 뼈 확인 필요':''}`;
    const toonList=$('avatar-toon-items');toonList.replaceChildren();const seenToon=new Set();
    for(const m of state.model?.materials||[]){const p=m.userData.input.second_preview;if(!p)continue;const key=JSON.stringify(p);if(seenToon.has(key))continue;seenToon.add(key);toonList.append(element('p','SecondMap · '+p.source+' · '+(p.status==='approximate'?p.texture+' · 원본 UV 속도 '+p.speed.join(', ')+' (애니메이션 미적용)':p.reason)));}
    for(const m of extMaterials){const p=m.userData.input.ext_preview,key=JSON.stringify([m.userData.avatarSourceId,p]);if(seenToon.has(key))continue;seenToon.add(key);toonList.append(element('p','EXT 전역 반사 · '+p.source_texture+' → '+p.texture+' · R 채널 반사 지원 · B 채널 표면 가산 미지원'));}
    for(const m of state.model?.materials||[]){const p=m.userData.input.toon_preview;if(!p)continue;const key=JSON.stringify([m.userData.avatarSourceId,p]);if(seenToon.has(key))continue;seenToon.add(key);const source=state.data?.sources?.find(s=>s.entry_id===m.userData.avatarSourceId);toonList.append(element('p',(source?.display_name||source?.name||m.userData.avatarMeshName||'아바타')+' · '+p.source_name+' → '+p.name+' · '+(p.status!=='approximate'?p.reason:m.userData.avatarLighting.avatarToonMap.value?p.texture:'텍스처 확인 필요: '+p.texture)));}
    for(const m of state.model?.materials||[]){const p=m.userData.input.face_sdf_preview;if(!p)continue;const key=JSON.stringify([m.userData.avatarSourceId,p]);if(seenToon.has(key))continue;seenToon.add(key);toonList.append(element('p','얼굴 SDF · '+p.texture+' · '+(p.status!=='approximate'?p.reason:m.userData.faceSdfPreview?.headReady?p.head_bone+' · 머리 회전 연동':'머리 뼈 확인 필요')));}
    for(const m of glowMaterials){const p=m.userData.input.glow_preview,key=JSON.stringify([m.userData.avatarSourceId,p]);if(seenToon.has(key))continue;seenToon.add(key);toonList.append(element('p','표면 보조광 · '+p.source_texture+' → '+p.texture));}
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
  $('avatar-lighting-enabled').onchange=()=>{settings.enabled=$('avatar-lighting-enabled').checked;settings.legacyExplicit=true;if(settings.enabled){settings.toon=false;$('avatar-toon-enabled').checked=false;}save();apply();};
  $('avatar-lighting-profile').onchange=()=>{settings.selected=$('avatar-lighting-profile').value;settings.enabled=settings.enabled&&!settings.toon&&!!settings.selected;$('avatar-lighting-enabled').checked=settings.enabled;save();apply();};
  $('avatar-toon-enabled').onchange=()=>{settings.toon=$('avatar-toon-enabled').checked;if(settings.toon){settings.enabled=false;$('avatar-lighting-enabled').checked=false;}save();apply();};
  $('avatar-toon-power').oninput=()=>{settings.toonPower=Number($('avatar-toon-power').value);$('avatar-toon-power-value').value=settings.toonPower.toFixed(2);save();apply();};
  faceToggle.onchange=()=>{settings.faceSdf=faceToggle.checked;save();apply();};
  glowToggle.onchange=()=>{settings.glow=glowToggle.checked;save();apply();};
  extToggle.onchange=()=>{settings.ext=extToggle.checked;save();apply();};
  rimToggle.onchange=()=>{settings.rim=rimToggle.checked;save();apply();};
  nearInput.oninput=()=>{settings.nearMix=Number(nearInput.value);save();apply();};
  sourceColorToggle.onchange=()=>{settings.sourceColor=sourceColorToggle.checked;save();apply();};
  secondToggle.onchange=()=>{settings.second=secondToggle.checked;save();apply();};
  secondU.oninput=secondV.oninput=()=>{settings.secondOffset=[Number(secondU.value),Number(secondV.value)];save();apply();};
  button.onclick=()=>{refresh();dialog.showModal();void load();};dialog.querySelector('button').onclick=()=>dialog.close();refresh();if(settings.enabled||settings.toon||matcap.requiresLightProfile())void load();
  $('avatar-emission-solo').onchange=()=>{settings.solo=$('avatar-emission-solo').checked;apply();};
  $('avatar-emission-bloom').onchange=()=>{settings.bloom=$('avatar-emission-bloom').checked;save();apply();};
  $('avatar-emission-strength').oninput=()=>{settings.bloomStrength=Number($('avatar-emission-strength').value);$('avatar-emission-strength-value').value=settings.bloomStrength.toFixed(2);save();};
  $('avatar-lighting-influence').oninput=()=>{settings.influence=Number($('avatar-lighting-influence').value);save();apply();};
  return {refresh,getRenderOptions:()=>({bloom:matcap.isMaskInspection()?false:settings.bloom,solo:matcap.isMaskInspection()?false:settings.solo,strength:settings.bloomStrength,exposure:settings.soloExposure,sourceColor:settings.sourceColor&&!!state.model,colorGrading:settings.sourceColor&&state.model&&!matcap.isMaskInspection()&&!settings.solo?settings.colorGrading:null})};
}
