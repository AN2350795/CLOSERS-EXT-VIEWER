import * as THREE from './vendor/three/three.module.min.js';
import {createViewerLightHelpers} from './model-viewer-light-helpers.js';
import {createLightGizmo} from './model-light-gizmo.js';

// Stable type IDs are shared by storage, controls and the shader. Add new
// type-specific controls here, and a matching shader branch below.
export const viewerLightTypes=Object.freeze({
  directional:{id:0,label:'방향광',fields:['position','target']},
  point:{id:1,label:'점광원',fields:['position','distance']},
  spot:{id:2,label:'스포트라이트',fields:['position','target','distance','angle']},
  ambient:{id:3,label:'환경광',fields:[]},
});
const defaults={enabled:false,type:'directional',position:[100,200,150],target:[0,80,0],color:'#ffffff',intensity:1,ambient:.3,distance:500,angle:35};
export const maxViewerLights=4;
const ranges={intensity:[0,8],ambient:[0,2],distance:[.01,100000],angle:[1,89]};
const finite=(v,fallback,min,max)=>Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
export function normalizeViewerLight(value){
  const v=value&&typeof value==='object'?value:{};
  const result={enabled:v.enabled===true,type:Object.hasOwn(viewerLightTypes,v.type)?v.type:defaults.type,color:typeof v.color==='string'&&/^#[0-9a-f]{6}$/i.test(v.color)?v.color:defaults.color};
  for(const name of ['position','target'])result[name]=[0,1,2].map(i=>finite(v[name]?.[i],defaults[name][i],-100000,100000));
  for(const [name,[min,max]] of Object.entries(ranges))result[name]=finite(v[name],defaults[name],min,max);
  return result;
}

export function normalizeViewerLights(value){
  const v=value&&typeof value==='object'?value:{};
  // A legacy light's enable switch becomes the master switch. The first
  // individual light stays enabled so switching the master on still works.
  const source=Array.isArray(v.lights)?v.lights.slice(0,maxViewerLights):[{...v,enabled:true}];
  if(!source.length)source.push({enabled:true});
  const lights=source.map((light,index)=>{
    const {ambient,...settings}=normalizeViewerLight(light);
    return {...settings,name:typeof light?.name==='string'&&light.name.trim()?light.name.trim().slice(0,40):`조명 ${index+1}`};
  });
  return {version:2,enabled:v.enabled===true,mode:v.mode==='diffuse'?'diffuse':'source',sourceIndex:Number.isInteger(v.sourceIndex)?Math.max(0,Math.min(lights.length-1,v.sourceIndex)):0,showHelpers:v.showHelpers===true,hideOverlays:v.hideOverlays===true,gizmoEnabled:v.gizmoEnabled===true,gizmoTarget:v.gizmoTarget==='target'?'target':'position',gizmoSnap:[1,5,10].includes(v.gizmoSnap)?v.gizmoSnap:0,gizmoMode:v.gizmoMode==='rotate'?'rotate':'translate',rotationSnap:[5,15,45].includes(v.rotationSnap)?v.rotationSnap:0,ambient:finite(v.ambient,defaults.ambient,...ranges.ambient),selected:Number.isInteger(v.selected)?Math.max(0,Math.min(lights.length-1,v.selected)):0,lights};
}

// The source shader consumes a single per-avatar light direction. Preserve
// its authored ramp/SDF instead of layering a second Lambert term on the skin.
export function viewerSourceProfile(settings,base,origin=[0,0,0]){
  if(!settings.enabled||settings.mode!=='source')return null;
  const light=settings.lights[settings.sourceIndex];if(!light?.enabled||light.type==='ambient')return null;
  const position=new THREE.Vector3(...light.position),direction=position.clone().sub(new THREE.Vector3(...(light.type==='directional'?light.target:origin))),distance=direction.length();
  if(distance<1e-8)return null;direction.divideScalar(distance);
  let attenuation=1;
  if(light.type!=='directional')attenuation=Math.max(0,1-distance/light.distance)**2;
  if(light.type==='spot'){
    const aim=new THREE.Vector3(...light.target).sub(position);if(aim.lengthSq()<1e-10)return null;
    const alignment=-direction.dot(aim.normalize()),edge=Math.cos(light.angle*Math.PI/180);
    const t=THREE.MathUtils.clamp((alignment-edge)/(Math.min(1,edge+.05)-edge),0,1);attenuation*=t*t*(3-2*t);
  }
  const color=new THREE.Color(light.color),gameDirection=[direction.x,direction.y,-direction.z];
  const intensity=(base?.intensity??1)*light.intensity*attenuation;
  return {...base,key:'viewer-source',label:'뷰어 주광원 · '+light.name,direction:gameDirection,toon_direction:[...gameDirection],position:[position.x,position.y,-position.z],color:[color.r*(base?.color?.[0]??1),color.g*(base?.color?.[1]??1),color.b*(base?.color?.[2]??1),1],intensity,near_intensity:intensity};
}

export function setViewerLights(material,settings){
  if(!material.userData.avatarLighting)return;
  if(!material.userData.viewerLight){
    const u={viewerLightEnabled:{value:0},viewerLightAmbient:{value:.3},viewerLights:{value:Array.from({length:maxViewerLights},()=>({enabled:0,type:0,position:new THREE.Vector3(),target:new THREE.Vector3(),color:new THREE.Color(),intensity:1,distance:500,angle:0}))}};
    material.userData.viewerLight=u;
    const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
    material.customProgramCacheKey=()=>key+'|viewer-lights-v2-'+maxViewerLights;
    material.onBeforeCompile=function(shader){
      previous.call(this,shader);Object.assign(shader.uniforms,u);
      shader.vertexShader='varying vec3 viewerLightWorldPosition;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nviewerLightWorldPosition = (modelMatrix * vec4(transformed,1.0)).xyz;');
      shader.fragmentShader=`varying vec3 viewerLightWorldPosition;
uniform float viewerLightEnabled, viewerLightAmbient;
struct ViewerLight {
  float enabled, type, intensity, distance, angle;
  vec3 position, target, color;
};
uniform ViewerLight viewerLights[${maxViewerLights}];
`+shader.fragmentShader.replace('/* viewer_light_surface */',`/* viewer_light_surface */
if (viewerLightEnabled > 0.5 && avatarEmissionPass < 0.5) {
  vec3 surfaceNormal = avatarLightingNormal/max(length(avatarLightingNormal),0.00001);
  vec3 illumination = vec3(viewerLightAmbient);
  for (int i=0; i<${maxViewerLights}; i++) {
    if (viewerLights[i].enabled < 0.5) continue;
    vec3 delta = viewerLights[i].type < 0.5 ? viewerLights[i].position-viewerLights[i].target : viewerLights[i].position-viewerLightWorldPosition;
    float lengthToLight = length(delta);
    vec3 lightDirection = delta/max(lengthToLight,0.00001);
    float diffuse = max(dot(surfaceNormal,lightDirection),0.0);
    if (viewerLights[i].type > 0.5 && viewerLights[i].type < 2.5) {
      float falloff = max(1.0-lengthToLight/viewerLights[i].distance,0.0);
      diffuse *= falloff*falloff;
    }
    if (viewerLights[i].type > 1.5 && viewerLights[i].type < 2.5) {
      vec3 aim = viewerLights[i].target-viewerLights[i].position;
      float alignment = dot(-lightDirection,aim/max(length(aim),0.00001));
      diffuse *= smoothstep(viewerLights[i].angle,min(1.0,viewerLights[i].angle+0.05),alignment);
    }
    if (viewerLights[i].type > 2.5) diffuse = 1.0;
    illumination += viewerLights[i].color*(viewerLights[i].intensity*diffuse);
  }
  outgoingLight *= illumination;
}
`);
    };
    material.needsUpdate=true;
  }
  const u=material.userData.viewerLight;
  u.viewerLightEnabled.value=settings.enabled&&settings.mode==='diffuse'&&settings.lights.some(light=>light.enabled)?1:0;
  u.viewerLightAmbient.value=settings.ambient;
  for(const [index,light] of u.viewerLights.value.entries()){
    const s=settings.lights[index];light.enabled=s?.enabled?1:0;if(!s)continue;
    light.type=viewerLightTypes[s.type].id;light.position.set(...s.position);light.target.set(...s.target);
    light.color.set(s.color);light.intensity=s.intensity;light.distance=s.distance;light.angle=Math.cos(s.angle*Math.PI/180);
  }
}

export function setupViewerLight({state,element,onLightChange,onOpenDetails}){
  const storageKey='closers-viewer-light-v2';let saved;
  try{const current=localStorage.getItem(storageKey);saved=JSON.parse(current||localStorage.getItem('closers-viewer-light-v1')||'null');}catch{}
  let settings=normalizeViewerLights(saved);
  const helpers=createViewerLightHelpers();
  let gizmo=null,suppressed=false,menuOpen=false,viewCamera=null,placementUndo=null,dragPlacement=null,placementOwner=state.model;
  function makeTabs(prefix,entries){
    const nav=element('div'),body=element('div'),panels=new Map(),buttons=new Map();nav.className='viewer-light-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label',prefix.includes('detail')?'조명 상세 설정 분류':'조명 빠른 설정 분류');body.className='viewer-light-tab-body';
    function activate(key,focus=false){for(const [name,panel] of panels){panel.hidden=name!==key;const button=buttons.get(name);button.setAttribute('aria-selected',String(name===key));button.tabIndex=name===key?0:-1;}body.scrollTop=0;if(body.parentElement)body.parentElement.scrollTop=0;if(focus)buttons.get(key).focus();}
    for(const [key,label] of entries){
      const button=element('button',label),panel=element('div');button.type='button';button.id=prefix+'-tab-'+key;button.setAttribute('role','tab');panel.id=prefix+'-panel-'+key;panel.className='viewer-light-tab-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);button.setAttribute('aria-controls',panel.id);panels.set(key,panel);buttons.set(key,button);nav.append(button);body.append(panel);button.onclick=()=>activate(key);
      button.onkeydown=event=>{const keys=[...panels.keys()],index=keys.indexOf(key);let next;if(event.key==='ArrowRight')next=keys[(index+1)%keys.length];else if(event.key==='ArrowLeft')next=keys[(index+keys.length-1)%keys.length];else if(event.key==='Home')next=keys[0];else if(event.key==='End')next=keys.at(-1);else return;event.preventDefault();activate(next,true);};
    }
    activate(entries[0][0]);return {nav,body,panels,activate};
  }
  const widget=element('div');widget.id='viewer-light-widget';
  const menuButton=element('button');menuButton.id='viewer-light-menu-toggle';menuButton.type='button';menuButton.className='viewport-icon';menuButton.setAttribute('aria-label','조명 설정 열기');menuButton.title='조명 설정';menuButton.setAttribute('aria-controls','viewer-light-menu');menuButton.setAttribute('aria-expanded','false');
  menuButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></svg>';
  const basic=element('section');basic.id='viewer-light-menu';basic.hidden=true;basic.setAttribute('aria-label','뷰어 조명');
  const basicHeading=element('div');basicHeading.className='viewer-light-menu-heading';const dismiss=element('button','닫기 ×');dismiss.type='button';dismiss.id='viewer-light-menu-close';dismiss.className='secondary';basicHeading.append(element('h3','뷰어 조명'),dismiss);basic.append(basicHeading);
  const detailDialog=element('dialog');detailDialog.id='viewer-light-details-dialog';detailDialog.setAttribute('aria-labelledby','viewer-light-details-title');
  const detailHeading=element('div');detailHeading.className='view-settings-heading';const detailTitle=element('h2','조명 상세 설정');detailTitle.id='viewer-light-details-title';const detailClose=element('button','닫기 ×');detailClose.type='button';detailClose.id='viewer-light-close-details';detailClose.className='secondary';detailHeading.append(detailTitle,detailClose);
  const detailBody=element('div');detailBody.id='viewer-light-details-body';detailDialog.append(detailHeading,detailBody);
  const openDetails=element('button','상세 설정');openDetails.id='viewer-light-open-details';openDetails.type='button';openDetails.className='secondary';openDetails.setAttribute('aria-haspopup','dialog');openDetails.setAttribute('aria-controls',detailDialog.id);
  const panel=element('div');panel.id='viewer-light-controls';
  const title=element('h3','뷰어 조명'),toggleLabel=element('label'),toggle=element('input');toggle.id='viewer-light-enabled';toggle.type='checkbox';toggleLabel.append(toggle,document.createTextNode(' 뷰어 조명 사용'));
  const help=element('p',`조명을 최대 ${maxViewerLights}개 배치할 수 있습니다. 좌표는 뷰어 월드 기준이며 Y가 위쪽입니다. 방향광과 스포트라이트는 위치에서 조준점을 향합니다. 주변 밝기는 모든 조명에 공통으로 한 번 적용합니다.`);help.className='lighting-help';
  const details=element('details');details.append(element('summary','조명 종류 · 위치 · 밝기'));
  panel.append(title,toggleLabel,help,details);
  const modeLabel=element('label','음영 방식'),mode=element('select');mode.id='viewer-light-shading';
  for(const [value,text] of [['source','원본 툰·얼굴 음영'],['diffuse','일반 입체 음영 · 비교용']]){const option=element('option',text);option.value=value;mode.append(option);}modeLabel.append(mode);details.before(modeLabel);
  const sourceLabel=element('label','음영을 제어할 주광원'),sourceSelect=element('select');sourceSelect.id='viewer-light-source-index';sourceLabel.append(sourceSelect);details.before(sourceLabel);
  const sourceHelp=element('p','원본 방식은 주광원 1개로 툰 텍스처·얼굴 SDF를 제어합니다. 다른 뷰어 광원과 공통 주변 밝기는 적용하지 않습니다. 선택한 원본 조명이 있으면 색·강도·반사 수치를 이어받습니다. 실제 인게임 화면과의 일치는 미검증입니다.');sourceHelp.className='lighting-help';details.before(sourceHelp);
  const helperLabel=element('label'),helperToggle=element('input');helperToggle.id='viewer-light-show-helpers';helperToggle.type='checkbox';helperLabel.append(helperToggle,document.createTextNode(' 광원 위치·방향·범위 표시'));details.before(helperLabel);
  const helperHelp=element('p','태양 아이콘은 광원, 과녁 아이콘은 조준점입니다. 환경광은 위치가 없어 표시하지 않습니다. 아이콘·선·조절기를 숨겨도 조명 효과는 유지됩니다.');helperHelp.className='lighting-help';helperLabel.after(helperHelp);
  const listLabel=element('label','편집할 조명'),list=element('select');list.id='viewer-light-list';listLabel.append(list);
  const actions=element('div');actions.className='viewer-light-actions';
  const add=element('button','조명 추가'),remove=element('button','선택 조명 삭제');
  for(const button of [add,remove]){button.type='button';button.className='secondary';actions.append(button);}
  add.id='viewer-light-add';remove.id='viewer-light-remove';details.before(listLabel,actions);
  const edit=element('button','화면에서 조절');edit.id='viewer-light-edit-3d';edit.type='button';edit.className='secondary';actions.append(edit);
  const dragHelp=element('p','3D 조절기를 켠 뒤 빨강 X·초록 Y·파랑 Z 화살표를 드래그하세요. 작은 색 사각형은 두 축의 평면 이동, 가운데 흰 손잡이는 화면 방향 이동이며 Esc로 취소합니다.');dragHelp.className='lighting-help';actions.after(dragHelp);
  const toolbar=element('div');toolbar.id='viewer-light-gizmo-toolbar';toolbar.hidden=true;toolbar.setAttribute('aria-label','광원 3D 조절');
  const toolbarTarget=element('select');toolbarTarget.id='viewer-light-gizmo-target';toolbarTarget.setAttribute('aria-label','이동 대상');
  const transformMode=element('select');transformMode.id='viewer-light-gizmo-mode';transformMode.setAttribute('aria-label','3D 조절 방식');
  for(const [value,text] of [['translate','위치 이동'],['rotate','방향 회전']]){const option=element('option',text);option.value=value;transformMode.append(option);}
  toolbar.append(transformMode);
  const rotationSnapSelect=element('select');rotationSnapSelect.id='viewer-light-rotation-snap';rotationSnapSelect.setAttribute('aria-label','회전 각도 간격');
  for(const [value,text] of [[0,'자유 회전'],[5,'5° 간격'],[15,'15° 간격'],[45,'45° 간격']]){const option=element('option',text);option.value=value;rotationSnapSelect.append(option);}
  const snapSelect=element('select');snapSelect.id='viewer-light-gizmo-snap';snapSelect.setAttribute('aria-label','이동 간격');
  for(const [value,text] of [[0,'자유 이동'],[1,'1 단위 간격'],[5,'5 단위 간격'],[10,'10 단위 간격']]){const option=element('option',text);option.value=value;snapSelect.append(option);}
  for(const [value,text] of [['position','광원 위치'],['target','조준점']]){const option=element('option',text);option.value=value;toolbarTarget.append(option);}
  const place=element('button','모델 옆으로'),close=element('button','조절 끝내기');
  for(const button of [place,close]){button.type='button';button.className='secondary';}
  const toolbarMode=element('span');toolbarMode.className='muted';toolbarMode.id='viewer-light-gizmo-shading';
  const useSource=element('button','이 광원으로 비추기');useSource.id='viewer-light-gizmo-use-source';useSource.type='button';useSource.className='secondary';
  place.id='viewer-light-gizmo-place';close.id='viewer-light-gizmo-close';toolbar.append(toolbarTarget,snapSelect,place,useSource,close,toolbarMode);
  const individualLabel=element('label'),individual=element('input');individual.type='checkbox';individual.id='viewer-light-item-enabled';individualLabel.append(individual,document.createTextNode(' 선택 조명 켜기'));details.append(individualLabel);
  const controls=new Map(),rows=new Map();
  function row(name,text,input){input.id='viewer-light-'+name;const label=element('label',text);label.append(input);details.append(label);controls.set(name,input);rows.set(name,label);return input;}
  const nameInput=element('input');nameInput.type='text';nameInput.maxLength=40;row('name','조명 이름',nameInput);
  const select=element('select');for(const [key,type] of Object.entries(viewerLightTypes)){const option=element('option',type.label);option.value=key;select.append(option);}row('type','조명 종류',select);
  const color=element('input');color.type='color';row('color','빛 색상',color);
  for(const [name,text] of [['intensity','빛 강도'],['ambient','공통 주변 밝기'],['distance','도달 거리'],['angle','스포트 반각 (도)']]){const input=element('input');input.type='number';input.min=ranges[name][0];input.max=ranges[name][1];input.step='any';row(name,text,input);}
  for(const [name,text] of [['position','위치'],['target','조준점']]){
    const group=element('div');group.className='viewer-light-vector';group.setAttribute('role','group');group.setAttribute('aria-label',text);group.append(element('strong',text));
    for(const [i,axis] of ['x','y','z'].entries()){
      const label=element('label',axis.toUpperCase()),input=element('input');input.id=`viewer-light-${name}-${axis}`;input.type='number';input.min=-100000;input.max=100000;input.step='any';input.setAttribute('aria-label',text+' '+axis.toUpperCase());label.append(input);group.append(label);controls.set(name+'-'+i,input);
    }
    rows.set(name,group);details.append(group);
  }
  const reset=element('button','뷰어 조명 전체 초기화');reset.type='button';reset.className='secondary';reset.id='viewer-light-reset';details.append(reset);
  const status=element('p');status.id='viewer-light-status';status.setAttribute('role','status');panel.append(status);
  const hideLabel=element('label'),hideToggle=element('input');hideToggle.type='checkbox';hideToggle.id='viewer-light-hide-overlays';hideLabel.append(hideToggle,document.createTextNode(' 아이콘·선·조절기 숨기기'));
  const tabs=makeTabs('viewer-light',[['look','빛'],['place','배치'],['display','표시']]);
  const detailTabs=makeTabs('viewer-light-detail',[['light','광원 수치'],['source','원본 음영'],['conditions','조건·합성']]);
  const selection=element('div');selection.className='viewer-light-selection';selection.append(listLabel,useSource);
  toggleLabel.lastChild.textContent=' 직접 조명';basicHeading.querySelector('h3').textContent='조명';basicHeading.insertBefore(toggleLabel,dismiss);
  const intensityRow=rows.get('intensity'),intensityInput=controls.get('intensity'),intensitySlider=element('input');intensitySlider.id='viewer-light-intensity-slider';intensitySlider.type='range';intensitySlider.min=0;intensitySlider.max=8;intensitySlider.step=.05;intensitySlider.setAttribute('aria-label','빛 강도');const intensityPair=element('span');intensityPair.className='viewer-light-intensity-pair';intensityPair.append(intensitySlider,intensityInput);intensityRow.append(intensityPair);
  intensityInput.setAttribute('aria-label','빛 강도 수치');
  const colorPair=element('span'),colorValue=element('output');colorPair.className='viewer-light-color-pair';colorValue.id='viewer-light-color-value';colorPair.append(controls.get('color'),colorValue);rows.get('color').append(colorPair);
  const manage=element('details');manage.id='viewer-light-manage';manage.append(element('summary','종류·조명 관리'),rows.get('type'),add,remove);
  remove.title='선택한 조명만 삭제합니다. 다른 조명 설정은 유지됩니다.';
  tabs.panels.get('look').append(individualLabel,rows.get('color'),intensityRow,manage);
  const presets=element('div');presets.className='viewer-light-presets';presets.setAttribute('role','group');presets.setAttribute('aria-label','빠른 조명 배치');
  const presetButtons=new Map();for(const [key,text] of [['front','정면'],['left','왼쪽'],['right','오른쪽'],['camera','카메라 쪽']]){const button=element('button',text);button.id='viewer-light-preset-'+key;button.type='button';button.className='secondary';button.title=key==='camera'?'현재 카메라 쪽에서 모델 중심을 비춥니다.':'모델의 기본 정면(+Z)을 기준으로 배치합니다.';presets.append(button);presetButtons.set(key,button);button.onclick=()=>applyPreset(key);}
  const presetHelp=element('p','빠른 배치는 선택 조명을 적용하고 위치·조준점만 바꿉니다. 색과 강도는 유지합니다.');presetHelp.className='lighting-help';
  const undo=element('button','배치 되돌리기');undo.id='viewer-light-placement-undo';undo.type='button';undo.className='secondary';undo.title='선택 조명의 위치·조준점만 이전 배치로 복원';
  const precision=element('details');precision.append(element('summary','조절 간격'),snapSelect,rotationSnapSelect);toolbar.insertBefore(precision,place);actions.remove();
  tabs.panels.get('place').append(presets,presetHelp,edit,toolbar,place,undo,dragHelp);
  const displayHelp=element('p','표시는 조명 효과와 별개입니다. 메뉴를 닫아도 빛은 유지됩니다.');displayHelp.className='lighting-help';tabs.panels.get('display').append(hideLabel,helperLabel,displayHelp);
  const sourceShortcut=element('button','원본 조명');sourceShortcut.id='viewer-light-open-source';sourceShortcut.type='button';sourceShortcut.className='secondary';sourceShortcut.setAttribute('aria-haspopup','dialog');
  const footer=element('div');footer.className='viewer-light-menu-footer';footer.append(openDetails,sourceShortcut);
  // Move the existing controls rather than duplicate IDs and bindings.
  basic.replaceChildren(basicHeading,status,selection,tabs.nav,tabs.body,footer);
  detailTabs.panels.get('light').append(panel);detailBody.append(detailTabs.body);detailHeading.after(detailTabs.nav);details.open=true;
  const resetSection=element('details');resetSection.id='viewer-light-reset-section';resetSection.append(element('summary','전체 초기화'),element('p','뷰어 조명을 기본 광원 1개와 꺼짐 상태로 되돌립니다. 원본 조명 프로필은 유지합니다.'),reset);panel.append(resetSection);
  widget.append(menuButton,basic,detailDialog);document.getElementById('viewport')?.append(widget);
  const viewport=document.getElementById('viewport'),message=document.getElementById('model-status');
  function positionMenu(){
    if(!viewport)return;
    const inline=message&&!message.classList.contains('is-loading')&&!message.classList.contains('is-notice')&&message.getClientRects().length;
    const top=inline?Math.max(10,Math.ceil(message.getBoundingClientRect().bottom-viewport.getBoundingClientRect().top+8)):10;
    widget.style.setProperty('--viewer-light-top',top+'px');
    const left=Math.max(10,Math.min(viewport.getBoundingClientRect().left+58,window.innerWidth-230)),width=Math.min(320,window.innerWidth-left-10);
    const popupTop=Math.max(10,Math.min(viewport.getBoundingClientRect().top+top,window.innerHeight-350));
    basic.style.left=left+'px';basic.style.width=width+'px';basic.style.top=popupTop+'px';basic.style.maxHeight=Math.min(540,window.innerHeight-popupTop-10)+'px';
  }
  const positionObserver=new ResizeObserver(positionMenu);if(viewport)positionObserver.observe(viewport);if(message)positionObserver.observe(message);
  const messageObserver=new MutationObserver(positionMenu);if(message)messageObserver.observe(message,{attributes:true,attributeFilter:['class']});positionMenu();
  document.addEventListener('scroll',positionMenu,true);window.addEventListener('resize',positionMenu);
  function setMenuOpen(value){menuOpen=value;basic.hidden=!value;if(value)positionMenu();menuButton.setAttribute('aria-expanded',String(value));menuButton.setAttribute('aria-label',value?'조명 설정 닫기':'조명 설정 열기');}
  menuButton.onclick=()=>setMenuOpen(!menuOpen);dismiss.onclick=()=>{setMenuOpen(false);menuButton.focus();};
  let detailOpener=openDetails;
  function showDetails(opener,key){gizmo?.cancel();detailOpener=opener;if(key)detailTabs.activate(key);onOpenDetails?.();if(!detailDialog.open)detailDialog.showModal();}
  openDetails.onclick=()=>showDetails(openDetails,'light');sourceShortcut.onclick=()=>showDetails(sourceShortcut,'source');detailClose.onclick=()=>detailDialog.close();
  detailDialog.addEventListener('close',()=>{(menuOpen?detailOpener:menuButton).focus();});
  function closeMenuOnEscape(event){if(event.key==='Escape'&&menuOpen&&!detailDialog.open){event.preventDefault();setMenuOpen(false);menuButton.focus();}}
  document.addEventListener('keydown',closeMenuOnEscape);
  function refresh(){
    if(placementOwner!==state.model){placementOwner=state.model;placementUndo=null;dragPlacement=null;}
    for(const m of state.model?.materials||[])setViewerLights(m,settings);
    const guideSettings={...settings,showHelpers:settings.showHelpers&&!settings.hideOverlays,showIcons:(settings.gizmoEnabled||settings.showHelpers)&&!settings.hideOverlays,gizmoTarget:settings.gizmoMode==='rotate'&&['directional','spot'].includes(settings.lights[settings.selected].type)?'position':settings.gizmoTarget};
    if(settings.mode==='source')guideSettings.lights=settings.lights.map((light,index)=>({...light,enabled:light.enabled&&index===settings.sourceIndex}));
    helpers.update(guideSettings,!!state.model);
    const light=settings.lights[settings.selected],field=settings.gizmoTarget;
    const canRotate=['directional','spot'].includes(light.type),rotating=canRotate&&settings.gizmoMode==='rotate';
    transformMode.value=rotating?'rotate':'translate';transformMode.options[1].disabled=!canRotate;
    toolbarTarget.hidden=rotating;snapSelect.hidden=rotating;rotationSnapSelect.hidden=!rotating;
    dragHelp.textContent=rotating?'빨강 X·초록 Y·파랑 Z 링으로 방향을 회전합니다. 바깥 링은 화면 축 회전입니다. 광원 위치와 조준 거리는 유지하며 Esc로 취소합니다.':'빨강 X·초록 Y·파랑 Z 화살표는 축 이동, 작은 색 사각형은 평면 이동, 가운데 흰 손잡이는 화면 방향 이동입니다. Esc로 취소합니다.';
    const available=!!state.model&&light.type!=='ambient'&&(field==='position'||light.type!=='point');
    toolbar.hidden=!settings.gizmoEnabled||!state.model||suppressed;edit.disabled=!state.model||light.type==='ambient';place.disabled=!available;
    edit.hidden=settings.gizmoEnabled&&!settings.hideOverlays;edit.textContent='화면에서 조절';edit.setAttribute('aria-pressed',String(settings.gizmoEnabled&&!settings.hideOverlays));undo.disabled=!placementUndo||placementUndo.index!==settings.selected||!state.model;
    for(const [key,button] of presetButtons)button.disabled=!state.model||light.type==='ambient'||key==='camera'&&!viewCamera;
    const direction=new THREE.Vector3(...light.target).sub(new THREE.Vector3(...light.position));if(direction.lengthSq()<1e-10)direction.set(0,0,-1);
    const quaternion=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),direction.normalize()).toArray();
    gizmo?.update({enabled:settings.gizmoEnabled&&available&&!suppressed&&!settings.hideOverlays,position:rotating?light.position:light[field],model:state.model,selection:`${settings.selected}:${field}:${light.type}`,snap:settings.gizmoSnap,mode:rotating?'rotate':'translate',quaternion,rotationSnap:settings.rotationSnap*Math.PI/180});
    const count=settings.lights.filter(light=>light.enabled).length;
    const source=settings.lights[settings.sourceIndex],sourceReady=!!state.viewerSourceLighting;
    status.textContent=!settings.enabled?'뷰어 조명 꺼짐':!state.model?'뷰어 조명 선택됨 · 모델을 선택하세요':settings.mode==='source'?(!source.enabled?'주광원 꺼짐 · 원래 음영 유지':source.type==='ambient'?'환경광은 원본 주광원으로 사용할 수 없습니다.':!sourceReady?'주광원 방향을 확인하세요.':(state.model.materials||[]).some(m=>m.userData.avatarLighting?.avatarToonEnabled.value||m.userData.avatarLighting?.avatarFaceEnabled.value)?`원본 음영 · ${source.name} · 툰·얼굴 연결에 적용`:'원본 툰·얼굴 데이터 연결 대기 · 일반 입체 음영은 적용하지 않습니다.'):!count?'모든 개별 조명 꺼짐 · 기존 화면 표시':`일반 입체 음영 · ${count}개 적용 중 · 전체 ${settings.lights.length}개`;
    if(settings.enabled&&state.model&&settings.mode==='source'&&settings.selected!==settings.sourceIndex)status.textContent=`${source.name} ${source.enabled?'적용 중':'꺼짐'} · ${light.name} 편집 중`;
  }
  function sync(){
    toggle.checked=settings.enabled;
    hideToggle.checked=settings.hideOverlays;
    mode.value=settings.mode;sourceLabel.hidden=sourceHelp.hidden=settings.mode!=='source';
    toolbarMode.textContent=settings.mode==='source'?`원본 음영 기준: ${settings.lights[settings.sourceIndex].name}${settings.selected!==settings.sourceIndex?' · 편집 중인 광원은 음영에 미적용':''}`:'일반 입체 음영 · 비교용';
    helperToggle.checked=settings.showHelpers;
    const light=settings.lights[settings.selected];individual.checked=light.enabled;
    useSource.hidden=settings.mode!=='source'||settings.selected===settings.sourceIndex&&settings.enabled&&light.enabled;useSource.disabled=light.type==='ambient';
    useSource.textContent='선택 조명 적용';
    list.replaceChildren();for(const [index,item] of settings.lights.entries()){const option=element('option',`${item.name}${settings.mode==='source'&&index===settings.sourceIndex?' · 주광원':''} · ${item.enabled?'켜짐':'꺼짐'}`);option.value=index;list.append(option);}list.value=settings.selected;
    sourceSelect.replaceChildren(...[...list.options].map(option=>option.cloneNode(true)));sourceSelect.value=settings.sourceIndex;
    toolbarTarget.value=settings.gizmoTarget;toolbarTarget.options[1].disabled=!['directional','spot'].includes(light.type);
    snapSelect.value=settings.gizmoSnap;
    rotationSnapSelect.value=settings.rotationSnap;
    intensitySlider.value=light.intensity;colorValue.value=light.color.toUpperCase();helperToggle.disabled=settings.hideOverlays;
    for(const option of select.options)option.disabled=settings.mode==='source'&&option.value==='ambient';
    add.disabled=settings.lights.length>=maxViewerLights;remove.disabled=settings.lights.length<=1;
    for(const [name,input] of controls){const [vector,index]=name.split('-');input.value=name==='ambient'?settings.ambient:index===undefined?light[name]:light[vector][Number(index)];}
    for(const name of ['position','target','distance','angle'])rows.get(name).hidden=!viewerLightTypes[light.type].fields.includes(name);
    rows.get('ambient').hidden=settings.mode==='source';
  }
  function save(){try{localStorage.setItem(storageKey,JSON.stringify(settings));}catch{}sync();onLightChange?.(false);refresh();}
  intensitySlider.oninput=()=>{gizmo?.cancel();settings.lights[settings.selected].intensity=Number(intensitySlider.value);intensityInput.value=intensitySlider.value;onLightChange?.(true);refresh();};intensitySlider.onchange=save;
  mode.onchange=()=>{gizmo?.cancel();settings.mode=mode.value;save();};
  sourceSelect.onchange=()=>{const index=Number(sourceSelect.value);gizmo?.cancel();settings.sourceIndex=index;save();};
  toggle.onchange=()=>{settings.enabled=toggle.checked;save();};
  helperToggle.onchange=()=>{settings.showHelpers=helperToggle.checked;save();};
  hideToggle.onchange=()=>{gizmo?.cancel();settings.hideOverlays=hideToggle.checked;save();};
  individual.onchange=()=>{settings.lights[settings.selected].enabled=individual.checked;save();};
  function selectLight(index){gizmo?.cancel();settings.selected=index;if(settings.lights[index].type==='point')settings.gizmoTarget='position';save();}
  list.onchange=()=>selectLight(Number(list.value));
  toolbarTarget.onchange=()=>{const field=toolbarTarget.value;gizmo?.cancel();settings.gizmoTarget=field;save();};
  snapSelect.onchange=()=>{const value=Number(snapSelect.value);gizmo?.cancel();settings.gizmoSnap=value;save();};
  transformMode.onchange=()=>{gizmo?.cancel();settings.gizmoMode=transformMode.value;save();};
  rotationSnapSelect.onchange=()=>{const value=Number(rotationSnapSelect.value);gizmo?.cancel();settings.rotationSnap=value;save();};
  edit.onclick=()=>{gizmo?.cancel();settings.gizmoEnabled=!(settings.gizmoEnabled&&!settings.hideOverlays);if(settings.lights[settings.selected].type==='point')settings.gizmoTarget='position';settings.showHelpers=true;settings.hideOverlays=false;save();if(detailDialog.open)detailDialog.close();};
  close.onclick=()=>{gizmo?.cancel();settings.gizmoEnabled=false;save();};
  useSource.onclick=()=>{gizmo?.cancel();if(settings.lights[settings.selected].type==='ambient')return;settings.sourceIndex=settings.selected;settings.enabled=true;settings.lights[settings.selected].enabled=true;save();};
  function placementSnapshot(){const light=settings.lights[settings.selected];return {index:settings.selected,position:[...light.position],target:[...light.target]};}
  function modelBounds(){const bounds=new THREE.Box3();for(const mesh of state.model?.meshes||[])if(mesh.visible)bounds.expandByObject(mesh,true);return bounds.isEmpty()?null:bounds;}
  function applyPreset(key){
    gizmo?.cancel();const bounds=modelBounds(),light=settings.lights[settings.selected];if(!bounds||light.type==='ambient')return;
    const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),distance=Math.max(size.length()*.9,1);
    let direction;if(key==='camera'){if(!viewCamera)return;direction=viewCamera.getWorldPosition(new THREE.Vector3()).sub(center);if(direction.lengthSq()<1e-10)return;}else direction=new THREE.Vector3(key==='left'?-1:key==='right'?1:0,.45,1);
    placementUndo=placementSnapshot();light.target=center.toArray().map(value=>Math.max(-100000,Math.min(100000,value)));light.position=center.clone().addScaledVector(direction.normalize(),distance).toArray().map(value=>Math.max(-100000,Math.min(100000,value)));
    settings.enabled=true;light.enabled=true;if(settings.mode==='source')settings.sourceIndex=settings.selected;save();
  }
  undo.onclick=()=>{gizmo?.cancel();if(!placementUndo||placementUndo.index!==settings.selected)return;const previous=placementUndo;placementUndo=null;Object.assign(settings.lights[settings.selected],{position:[...previous.position],target:[...previous.target]});save();};
  place.onclick=()=>{
    gizmo?.cancel();if(!state.model)return;
    const bounds=new THREE.Box3();for(const mesh of state.model.meshes||[])if(mesh.visible)bounds.expandByObject(mesh,true);
    if(bounds.isEmpty())return;const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const light=settings.lights[settings.selected],field=settings.gizmoMode==='rotate'&&['directional','spot'].includes(light.type)?'position':settings.gizmoTarget;
    if(field==='position')center.add(new THREE.Vector3(Math.max(size.x*.6,1),size.y*.2,Math.max(size.z*.6,size.y*.2,1)));
    placementUndo=placementSnapshot();light[field]=center.toArray().map(value=>Math.max(-100000,Math.min(100000,value)));save();
  };
  add.onclick=()=>{
    gizmo?.cancel();
    if(settings.lights.length>=maxViewerLights)return;
    placementUndo=null;
    let number=1;while(settings.lights.some(light=>light.name===`조명 ${number}`))number++;
    settings.lights.push({...normalizeViewerLight({enabled:true,type:'point',intensity:.5}),name:`조명 ${number}`});
    settings.selected=settings.lights.length-1;settings=normalizeViewerLights(settings);tabs.activate('look');save();list.focus();
  };
  remove.onclick=()=>{
    gizmo?.cancel();
    if(settings.lights.length<=1)return;
    placementUndo=null;
    if(settings.sourceIndex>settings.selected)settings.sourceIndex--;
    settings.lights.splice(settings.selected,1);settings=normalizeViewerLights(settings);save();list.focus();
  };
  for(const [name,input] of controls)input.onchange=()=>{
    gizmo?.cancel();
    const [vector,index]=name.split('-');
    if(input.type==='number'&&(input.value.trim()===''||!input.validity.valid||!Number.isFinite(input.valueAsNumber))){sync();return;}
    const light=settings.lights[settings.selected];
    if(name==='ambient')settings.ambient=input.valueAsNumber;
    else if(index!==undefined){placementUndo=placementSnapshot();light[vector][Number(index)]=input.valueAsNumber;}
    else light[name]=input.type==='number'?input.valueAsNumber:input.value;
    if(name==='type'&&['point','ambient'].includes(light.type))settings.gizmoTarget='position';
    settings=normalizeViewerLights(settings);save();
  };
  reset.onclick=()=>{gizmo?.cancel();placementUndo=null;settings=normalizeViewerLights(null);save();};
  function bindGizmo(camera,canvas){
    gizmo?.dispose();viewCamera=camera;
    gizmo=createLightGizmo({camera,canvas,onChange:value=>{if(gizmo?.controls.dragging){dragPlacement??=placementSnapshot();}else dragPlacement=null;settings.lights[settings.selected][settings.gizmoTarget]=value;sync();onLightChange?.(true);refresh();},onRotate:value=>{
      const light=settings.lights[settings.selected];
      if(gizmo?.controls.dragging){
        dragPlacement??=placementSnapshot();
        const radius=new THREE.Vector3(...dragPlacement.target).distanceTo(new THREE.Vector3(...dragPlacement.position))||1;
        const target=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion().fromArray(value)).multiplyScalar(radius).add(new THREE.Vector3(...light.position));
        // Reject only rotations beyond the supported coordinate range; do not
        // shorten the beam or distort its direction by clamping each axis.
        if(target.toArray().every(v=>Math.abs(v)<=100000))light.target=target.toArray();
      }else if(dragPlacement){light.target=[...dragPlacement.target];dragPlacement=null;}
      sync();onLightChange?.(true);refresh();
    },onCommit:()=>{if(dragPlacement)placementUndo=dragPlacement;dragPlacement=null;save();}});refresh();
  }
  function renderHelpers(renderer,camera){helpers.render(renderer,camera);gizmo?.render(renderer);helpers.renderIcons(renderer,camera);}
  function dispose(){gizmo?.dispose();helpers.dispose();placementUndo=null;dragPlacement=null;placementOwner=null;viewCamera=null;positionObserver.disconnect();messageObserver.disconnect();if(detailDialog.open)detailDialog.close();document.removeEventListener('keydown',closeMenuOnEscape);document.removeEventListener('scroll',positionMenu,true);window.removeEventListener('resize',positionMenu);widget.remove();}
  function setGizmoSuppressed(value){suppressed=value;if(value)gizmo?.cancel();}
  function getSourceProfile(base){if(!state.model)return null;const origin=state.model.root?.getWorldPosition?.(new THREE.Vector3())?.toArray()||[0,0,0];return viewerSourceProfile(settings,base,origin);}
  function setSourceSettings(toon,conditions,info){detailTabs.panels.get('source').append(toon,info);detailTabs.panels.get('conditions').append(conditions);}
  sync();return {panel:widget,refresh,bindGizmo,renderHelpers,dispose,setGizmoSuppressed,getSourceProfile,setSourceSettings};
}
