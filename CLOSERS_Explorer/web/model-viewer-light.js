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
const ranges={intensity:[0,8],ambient:[0,2],distance:[.01,100000],angle:[1,89]};
const finite=(v,fallback,min,max)=>Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
export function normalizeViewerLight(value){
  const v=value&&typeof value==='object'?value:{};
  const result={enabled:v.enabled===true,type:Object.hasOwn(viewerLightTypes,v.type)?v.type:defaults.type,color:typeof v.color==='string'&&/^#[0-9a-f]{6}$/i.test(v.color)?v.color:defaults.color};
  for(const name of ['position','target'])result[name]=[0,1,2].map(i=>finite(v[name]?.[i],defaults[name][i],-100000,100000));
  for(const [name,[min,max]] of Object.entries(ranges))result[name]=finite(v[name],defaults[name],min,max);
  return result;
}

export function setViewerLight(material,settings){
  if(!material.userData.avatarLighting)return;
  if(!material.userData.viewerLight){
    const u={viewerLightEnabled:{value:0},viewerLightType:{value:0},viewerLightPosition:{value:new THREE.Vector3()},viewerLightTarget:{value:new THREE.Vector3()},viewerLightColor:{value:new THREE.Color()},viewerLightIntensity:{value:1},viewerLightAmbient:{value:.3},viewerLightDistance:{value:500},viewerLightAngle:{value:0}};
    material.userData.viewerLight=u;
    const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
    material.customProgramCacheKey=()=>key+'|viewer-light-v1';
    material.onBeforeCompile=function(shader){
      previous.call(this,shader);Object.assign(shader.uniforms,u);
      shader.vertexShader='varying vec3 viewerLightWorldPosition;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nviewerLightWorldPosition = (modelMatrix * vec4(transformed,1.0)).xyz;');
      shader.fragmentShader=`varying vec3 viewerLightWorldPosition;
uniform float viewerLightEnabled, viewerLightType, viewerLightIntensity, viewerLightAmbient, viewerLightDistance, viewerLightAngle;
uniform vec3 viewerLightPosition, viewerLightTarget, viewerLightColor;
`+shader.fragmentShader.replace('/* viewer_light_surface */',`/* viewer_light_surface */
if (viewerLightEnabled > 0.5 && avatarEmissionPass < 0.5) {
  vec3 delta = viewerLightType < 0.5 ? viewerLightPosition-viewerLightTarget : viewerLightPosition-viewerLightWorldPosition;
  float lengthToLight = length(delta);
  vec3 lightDirection = delta/max(lengthToLight,0.00001);
  vec3 surfaceNormal = avatarLightingNormal/max(length(avatarLightingNormal),0.00001);
  float diffuse = max(dot(surfaceNormal,lightDirection),0.0);
  if (viewerLightType > 0.5 && viewerLightType < 2.5) {
    float falloff = max(1.0-lengthToLight/viewerLightDistance,0.0);
    diffuse *= falloff*falloff;
  }
  if (viewerLightType > 1.5 && viewerLightType < 2.5) {
    vec3 aim = viewerLightTarget-viewerLightPosition;
    float alignment = dot(-lightDirection,aim/max(length(aim),0.00001));
    diffuse *= smoothstep(viewerLightAngle,min(1.0,viewerLightAngle+0.05),alignment);
  }
  if (viewerLightType > 2.5) diffuse = 1.0;
  outgoingLight *= vec3(viewerLightAmbient)+viewerLightColor*(viewerLightIntensity*diffuse);
}
`);
    };
    material.needsUpdate=true;
  }
  const u=material.userData.viewerLight;
  u.viewerLightEnabled.value=settings.enabled?1:0;u.viewerLightType.value=viewerLightTypes[settings.type].id;
  u.viewerLightPosition.value.set(...settings.position);u.viewerLightTarget.value.set(...settings.target);
  u.viewerLightColor.value.set(settings.color);u.viewerLightIntensity.value=settings.intensity;
  u.viewerLightAmbient.value=settings.ambient;u.viewerLightDistance.value=settings.distance;u.viewerLightAngle.value=Math.cos(settings.angle*Math.PI/180);
}

export function setupViewerLight({state,element}){
  const storageKey='closers-viewer-light-v1';let saved;
  try{saved=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
  let settings=normalizeViewerLight(saved);
  const panel=element('div');panel.id='viewer-light-controls';
  const title=element('h3','뷰어 조명'),toggleLabel=element('label'),toggle=element('input');toggle.id='viewer-light-enabled';toggle.type='checkbox';toggleLabel.append(toggle,document.createTextNode(' 뷰어 조명 사용'));
  const help=element('p','뷰어에서 직접 배치하는 조명입니다. 좌표는 뷰어 월드 기준이며 Y가 위쪽입니다. 방향광과 스포트라이트는 위치에서 조준점을 향합니다.');help.className='lighting-help';
  const details=element('details');details.append(element('summary','조명 종류 · 위치 · 밝기'));
  panel.append(title,toggleLabel,help,details);
  const controls=new Map(),rows=new Map();
  function row(name,text,input){input.id='viewer-light-'+name;const label=element('label',text);label.append(input);details.append(label);controls.set(name,input);rows.set(name,label);return input;}
  const select=element('select');for(const [key,type] of Object.entries(viewerLightTypes)){const option=element('option',type.label);option.value=key;select.append(option);}row('type','조명 종류',select);
  const color=element('input');color.type='color';row('color','빛 색상',color);
  for(const [name,text] of [['intensity','빛 강도'],['ambient','주변 밝기'],['distance','도달 거리'],['angle','스포트 반각 (도)']]){const input=element('input');input.type='number';input.min=ranges[name][0];input.max=ranges[name][1];input.step='any';row(name,text,input);}
  for(const [name,text] of [['position','위치'],['target','조준점']]){
    const group=element('div');group.className='viewer-light-vector';group.setAttribute('role','group');group.setAttribute('aria-label',text);group.append(element('strong',text));
    for(const [i,axis] of ['x','y','z'].entries()){
      const label=element('label',axis.toUpperCase()),input=element('input');input.id=`viewer-light-${name}-${axis}`;input.type='number';input.min=-100000;input.max=100000;input.step='any';input.setAttribute('aria-label',text+' '+axis.toUpperCase());label.append(input);group.append(label);controls.set(name+'-'+i,input);
    }
    rows.set(name,group);details.append(group);
  }
  const reset=element('button','뷰어 조명 초기화');reset.type='button';reset.className='secondary';reset.id='viewer-light-reset';details.append(reset);
  const status=element('p');status.id='viewer-light-status';status.setAttribute('role','status');panel.append(status);
  function refresh(){for(const m of state.model?.materials||[])setViewerLight(m,settings);status.textContent=!settings.enabled?'뷰어 조명 꺼짐':!state.model?'뷰어 조명 선택됨 · 모델을 선택하세요':`뷰어 ${viewerLightTypes[settings.type].label} 적용 중`;}
  function sync(){
    toggle.checked=settings.enabled;
    for(const [name,input] of controls){const [vector,index]=name.split('-');input.value=index===undefined?settings[name]:settings[vector][Number(index)];}
    for(const name of ['position','target','distance','angle'])rows.get(name).hidden=!viewerLightTypes[settings.type].fields.includes(name);
  }
  function save(){try{localStorage.setItem(storageKey,JSON.stringify({version:1,...settings}));}catch{}sync();refresh();}
  toggle.onchange=()=>{settings.enabled=toggle.checked;save();};
  for(const [name,input] of controls)input.onchange=()=>{
    const [vector,index]=name.split('-');
    if(input.type==='number'&&(input.value.trim()===''||!input.validity.valid||!Number.isFinite(input.valueAsNumber))){sync();return;}
    if(index!==undefined)settings[vector][Number(index)]=input.valueAsNumber;
    else settings[name]=input.type==='number'?input.valueAsNumber:input.value;
    settings=normalizeViewerLight(settings);save();
  };
  reset.onclick=()=>{settings=normalizeViewerLight(null);save();};
  sync();return {panel,refresh};
}
