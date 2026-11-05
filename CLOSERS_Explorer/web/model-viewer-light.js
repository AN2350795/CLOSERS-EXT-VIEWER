import * as THREE from './vendor/three/three.module.min.js';

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
  return {version:2,enabled:v.enabled===true,ambient:finite(v.ambient,defaults.ambient,...ranges.ambient),selected:Number.isInteger(v.selected)?Math.max(0,Math.min(lights.length-1,v.selected)):0,lights};
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
  const panel=element('div');panel.id='viewer-light-controls';
  const title=element('h3','뷰어 조명'),toggleLabel=element('label'),toggle=element('input');toggle.id='viewer-light-enabled';toggle.type='checkbox';toggleLabel.append(toggle,document.createTextNode(' 뷰어 조명 사용'));
  const help=element('p',`조명을 최대 ${maxViewerLights}개 배치할 수 있습니다. 좌표는 뷰어 월드 기준이며 Y가 위쪽입니다. 방향광과 스포트라이트는 위치에서 조준점을 향합니다. 주변 밝기는 모든 조명에 공통으로 한 번 적용합니다.`);help.className='lighting-help';
  const details=element('details');details.append(element('summary','조명 종류 · 위치 · 밝기'));
  panel.append(title,toggleLabel,help,details);
  const listLabel=element('label','편집할 조명'),list=element('select');list.id='viewer-light-list';listLabel.append(list);
  const actions=element('div');actions.className='viewer-light-actions';
  const add=element('button','조명 추가'),remove=element('button','선택 조명 삭제');
  for(const button of [add,remove]){button.type='button';button.className='secondary';actions.append(button);}
  add.id='viewer-light-add';remove.id='viewer-light-remove';details.before(listLabel,actions);
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
    const count=settings.lights.filter(light=>light.enabled).length;
    status.textContent=!settings.enabled?'뷰어 조명 꺼짐':!count?'모든 개별 조명 꺼짐 · 기존 화면 표시':!state.model?'뷰어 조명 선택됨 · 모델을 선택하세요':`뷰어 조명 ${count}개 적용 중 · 전체 ${settings.lights.length}개`;
  }
  function sync(){
    toggle.checked=settings.enabled;
    const light=settings.lights[settings.selected];individual.checked=light.enabled;
    list.replaceChildren();for(const [index,item] of settings.lights.entries()){const option=element('option',`${item.name} · ${viewerLightTypes[item.type].label} · ${item.enabled?'켜짐':'꺼짐'}`);option.value=index;list.append(option);}list.value=settings.selected;
    add.disabled=settings.lights.length>=maxViewerLights;remove.disabled=settings.lights.length<=1;
    for(const [name,input] of controls){const [vector,index]=name.split('-');input.value=name==='ambient'?settings.ambient:index===undefined?light[name]:light[vector][Number(index)];}
    for(const name of ['position','target','distance','angle'])rows.get(name).hidden=!viewerLightTypes[light.type].fields.includes(name);
  }
  function save(){try{localStorage.setItem(storageKey,JSON.stringify(settings));}catch{}sync();refresh();}
  toggle.onchange=()=>{settings.enabled=toggle.checked;save();};
  individual.onchange=()=>{settings.lights[settings.selected].enabled=individual.checked;save();};
  list.onchange=()=>{settings.selected=Number(list.value);save();};
  add.onclick=()=>{
    if(settings.lights.length>=maxViewerLights)return;
    let number=1;while(settings.lights.some(light=>light.name===`조명 ${number}`))number++;
    settings.lights.push({...normalizeViewerLight({enabled:true,type:'point',intensity:.5}),name:`조명 ${number}`});
    settings.selected=settings.lights.length-1;settings=normalizeViewerLights(settings);details.open=true;save();nameInput.focus();
  };
  remove.onclick=()=>{
    if(settings.lights.length<=1)return;
    settings.lights.splice(settings.selected,1);settings=normalizeViewerLights(settings);save();list.focus();
  };
  for(const [name,input] of controls)input.onchange=()=>{
    const [vector,index]=name.split('-');
    if(input.type==='number'&&(input.value.trim()===''||!input.validity.valid||!Number.isFinite(input.valueAsNumber))){sync();return;}
    const light=settings.lights[settings.selected];
    if(name==='ambient')settings.ambient=input.valueAsNumber;
    else if(index!==undefined)light[vector][Number(index)]=input.valueAsNumber;
    else light[name]=input.type==='number'?input.valueAsNumber:input.value;
    settings=normalizeViewerLights(settings);save();
  };
  reset.onclick=()=>{settings=normalizeViewerLights(null);save();};
  sync();return {panel,refresh};
}
