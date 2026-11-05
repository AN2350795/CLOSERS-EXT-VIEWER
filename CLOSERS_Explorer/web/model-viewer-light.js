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
  return {version:2,enabled:v.enabled===true,showHelpers:v.showHelpers===true,gizmoEnabled:v.gizmoEnabled===true,gizmoTarget:v.gizmoTarget==='target'?'target':'position',ambient:finite(v.ambient,defaults.ambient,...ranges.ambient),selected:Number.isInteger(v.selected)?Math.max(0,Math.min(lights.length-1,v.selected)):0,lights};
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
  u.viewerLightEnabled.value=settings.enabled&&settings.lights.some(light=>light.enabled)?1:0;
  u.viewerLightAmbient.value=settings.ambient;
  for(const [index,light] of u.viewerLights.value.entries()){
    const s=settings.lights[index];light.enabled=s?.enabled?1:0;if(!s)continue;
    light.type=viewerLightTypes[s.type].id;light.position.set(...s.position);light.target.set(...s.target);
    light.color.set(s.color);light.intensity=s.intensity;light.distance=s.distance;light.angle=Math.cos(s.angle*Math.PI/180);
  }
}

export function setupViewerLight({state,element}){
  const storageKey='closers-viewer-light-v2';let saved;
  try{const current=localStorage.getItem(storageKey);saved=JSON.parse(current||localStorage.getItem('closers-viewer-light-v1')||'null');}catch{}
  let settings=normalizeViewerLights(saved);
  const helpers=createViewerLightHelpers();
  let gizmo=null,suppressed=false;
  const panel=element('div');panel.id='viewer-light-controls';
  const title=element('h3','뷰어 조명'),toggleLabel=element('label'),toggle=element('input');toggle.id='viewer-light-enabled';toggle.type='checkbox';toggleLabel.append(toggle,document.createTextNode(' 뷰어 조명 사용'));
  const help=element('p',`조명을 최대 ${maxViewerLights}개 배치할 수 있습니다. 좌표는 뷰어 월드 기준이며 Y가 위쪽입니다. 방향광과 스포트라이트는 위치에서 조준점을 향합니다. 주변 밝기는 모든 조명에 공통으로 한 번 적용합니다.`);help.className='lighting-help';
  const details=element('details');details.append(element('summary','조명 종류 · 위치 · 밝기'));
  panel.append(title,toggleLabel,help,details);
  const helperLabel=element('label'),helperToggle=element('input');helperToggle.id='viewer-light-show-helpers';helperToggle.type='checkbox';helperLabel.append(helperToggle,document.createTextNode(' 광원 위치·방향·범위 표시'));details.before(helperLabel);
  const helperHelp=element('p','선택한 광원은 흰 십자로 표시합니다. 꺼진 광원은 흐리게 표시하며 환경광은 위치가 없어 표시하지 않습니다.');helperHelp.className='lighting-help';helperLabel.after(helperHelp);
  const listLabel=element('label','편집할 조명'),list=element('select');list.id='viewer-light-list';listLabel.append(list);
  const actions=element('div');actions.className='viewer-light-actions';
  const add=element('button','조명 추가'),remove=element('button','선택 조명 삭제');
  for(const button of [add,remove]){button.type='button';button.className='secondary';actions.append(button);}
  add.id='viewer-light-add';remove.id='viewer-light-remove';details.before(listLabel,actions);
  const edit=element('button','3D 조절기로 이동');edit.id='viewer-light-edit-3d';edit.type='button';edit.className='secondary';actions.append(edit);
  const dragHelp=element('p','3D 조절기를 켠 뒤 빨강 X·초록 Y·파랑 Z 화살표를 드래그하세요. 가운데 사각형은 화면 방향으로 이동하며 Esc로 취소합니다.');dragHelp.className='lighting-help';actions.after(dragHelp);
  const toolbar=element('div');toolbar.id='viewer-light-gizmo-toolbar';toolbar.hidden=true;toolbar.setAttribute('aria-label','광원 3D 이동');
  const toolbarLight=element('select');toolbarLight.id='viewer-light-gizmo-light';toolbarLight.setAttribute('aria-label','이동할 광원');
  const toolbarTarget=element('select');toolbarTarget.id='viewer-light-gizmo-target';toolbarTarget.setAttribute('aria-label','이동 대상');
  for(const [value,text] of [['position','광원 위치'],['target','조준점']]){const option=element('option',text);option.value=value;toolbarTarget.append(option);}
  const place=element('button','모델 옆으로'),close=element('button','이동 끝내기');
  for(const button of [place,close]){button.type='button';button.className='secondary';}
  place.id='viewer-light-gizmo-place';close.id='viewer-light-gizmo-close';toolbar.append(toolbarLight,toolbarTarget,place,close);
  document.getElementById('viewport')?.append(toolbar);
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
  function refresh(){
    for(const m of state.model?.materials||[])setViewerLights(m,settings);
    helpers.update(settings,!!state.model);
    const light=settings.lights[settings.selected],field=settings.gizmoTarget;
    const available=!!state.model&&light.type!=='ambient'&&(field==='position'||light.type!=='point');
    toolbar.hidden=!settings.gizmoEnabled||!state.model||suppressed;edit.disabled=!state.model||light.type==='ambient';place.disabled=!available;
    gizmo?.update({enabled:settings.gizmoEnabled&&available&&!suppressed,position:light[field],model:state.model,selection:`${settings.selected}:${field}:${light.type}`});
    const count=settings.lights.filter(light=>light.enabled).length;
    status.textContent=!settings.enabled?'뷰어 조명 꺼짐':!count?'모든 개별 조명 꺼짐 · 기존 화면 표시':!state.model?'뷰어 조명 선택됨 · 모델을 선택하세요':`뷰어 조명 ${count}개 적용 중 · 전체 ${settings.lights.length}개`;
  }
  function sync(){
    toggle.checked=settings.enabled;
    helperToggle.checked=settings.showHelpers;
    const light=settings.lights[settings.selected];individual.checked=light.enabled;
    list.replaceChildren();for(const [index,item] of settings.lights.entries()){const option=element('option',`${item.name} · ${viewerLightTypes[item.type].label} · ${item.enabled?'켜짐':'꺼짐'}`);option.value=index;list.append(option);}list.value=settings.selected;
    toolbarLight.replaceChildren(...[...list.options].map(option=>option.cloneNode(true)));toolbarLight.value=settings.selected;
    toolbarTarget.value=settings.gizmoTarget;toolbarTarget.options[1].disabled=!['directional','spot'].includes(light.type);
    add.disabled=settings.lights.length>=maxViewerLights;remove.disabled=settings.lights.length<=1;
    for(const [name,input] of controls){const [vector,index]=name.split('-');input.value=name==='ambient'?settings.ambient:index===undefined?light[name]:light[vector][Number(index)];}
    for(const name of ['position','target','distance','angle'])rows.get(name).hidden=!viewerLightTypes[light.type].fields.includes(name);
  }
  function save(){try{localStorage.setItem(storageKey,JSON.stringify(settings));}catch{}sync();refresh();}
  toggle.onchange=()=>{settings.enabled=toggle.checked;save();};
  helperToggle.onchange=()=>{settings.showHelpers=helperToggle.checked;save();};
  individual.onchange=()=>{settings.lights[settings.selected].enabled=individual.checked;save();};
  function selectLight(index){gizmo?.cancel();settings.selected=index;if(settings.lights[index].type==='point')settings.gizmoTarget='position';save();}
  list.onchange=()=>selectLight(Number(list.value));toolbarLight.onchange=()=>selectLight(Number(toolbarLight.value));
  toolbarTarget.onchange=()=>{const field=toolbarTarget.value;gizmo?.cancel();settings.gizmoTarget=field;save();};
  edit.onclick=()=>{gizmo?.cancel();settings.gizmoEnabled=true;settings.gizmoTarget='position';settings.showHelpers=true;save();panel.closest('dialog')?.close();};
  close.onclick=()=>{gizmo?.cancel();settings.gizmoEnabled=false;save();};
  place.onclick=()=>{
    gizmo?.cancel();if(!state.model)return;
    const bounds=new THREE.Box3();for(const mesh of state.model.meshes||[])if(mesh.visible)bounds.expandByObject(mesh,true);
    if(bounds.isEmpty())return;const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    if(settings.gizmoTarget==='position')center.add(new THREE.Vector3(Math.max(size.x*.6,1),size.y*.2,Math.max(size.z*.6,size.y*.2,1)));
    settings.lights[settings.selected][settings.gizmoTarget]=center.toArray().map(value=>Math.max(-100000,Math.min(100000,value)));save();
  };
  add.onclick=()=>{
    gizmo?.cancel();
    if(settings.lights.length>=maxViewerLights)return;
    let number=1;while(settings.lights.some(light=>light.name===`조명 ${number}`))number++;
    settings.lights.push({...normalizeViewerLight({enabled:true,type:'point',intensity:.5}),name:`조명 ${number}`});
    settings.selected=settings.lights.length-1;settings=normalizeViewerLights(settings);details.open=true;save();nameInput.focus();
  };
  remove.onclick=()=>{
    gizmo?.cancel();
    if(settings.lights.length<=1)return;
    settings.lights.splice(settings.selected,1);settings=normalizeViewerLights(settings);save();list.focus();
  };
  for(const [name,input] of controls)input.onchange=()=>{
    gizmo?.cancel();
    const [vector,index]=name.split('-');
    if(input.type==='number'&&(input.value.trim()===''||!input.validity.valid||!Number.isFinite(input.valueAsNumber))){sync();return;}
    const light=settings.lights[settings.selected];
    if(name==='ambient')settings.ambient=input.valueAsNumber;
    else if(index!==undefined)light[vector][Number(index)]=input.valueAsNumber;
    else light[name]=input.type==='number'?input.valueAsNumber:input.value;
    settings=normalizeViewerLights(settings);save();
  };
  reset.onclick=()=>{gizmo?.cancel();settings=normalizeViewerLights(null);save();};
  function bindGizmo(camera,canvas){
    gizmo?.dispose();
    gizmo=createLightGizmo({camera,canvas,onChange:value=>{settings.lights[settings.selected][settings.gizmoTarget]=value;sync();refresh();},onCommit:save});refresh();
  }
  function renderHelpers(renderer,camera){helpers.render(renderer,camera);gizmo?.render(renderer);}
  function dispose(){gizmo?.dispose();helpers.dispose();toolbar.remove();}
  function setGizmoSuppressed(value){suppressed=value;if(value)gizmo?.cancel();}
  sync();return {panel,refresh,bindGizmo,renderHelpers,dispose,setGizmoSuppressed};
}
