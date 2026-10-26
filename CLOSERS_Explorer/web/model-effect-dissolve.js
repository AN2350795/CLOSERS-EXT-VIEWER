import * as THREE from './vendor/three/three.module.min.js';

// Local preview of the source mask, coverage, edge color and threshold tracks.
// Compose with the existing material preview and extended skinning hooks.
export function installDissolve(material,map,instanced=false){
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey;
  const uniforms={effectDissolveMap:{value:map},effectDissolveColor:{value:new THREE.Vector4(1,1,1,1)},effectDissolveWidth:{value:.05},effectDissolveThreshold:{value:new THREE.Vector2(1,1)}};
  const color=instanced?'vParticleDissolveColor':'effectDissolveColor',width=instanced?'vParticleDissolveParams.x':'effectDissolveWidth',threshold=instanced?'vParticleDissolveParams.yz':'effectDissolveThreshold';
  material.customProgramCacheKey=()=>key.call(material)+'|effect-dissolve-v2-'+instanced;
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);
    const varyings=instanced?'varying vec4 vParticleDissolveColor; varying vec3 vParticleDissolveParams;\n':'';
    shader.vertexShader=varyings+(instanced?'attribute vec4 particleDissolveColor; attribute vec3 particleDissolveParams;\n':'')+'varying vec2 effectDissolveUv;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\neffectDissolveUv=uv;'+(instanced?'vParticleDissolveColor=particleDissolveColor;vParticleDissolveParams=particleDissolveParams;':''));
    shader.fragmentShader=varyings+'varying vec2 effectDissolveUv;\nuniform sampler2D effectDissolveMap;\nuniform vec4 effectDissolveColor;\nuniform float effectDissolveWidth;\nuniform vec2 effectDissolveThreshold;\n'+shader.fragmentShader.replace('#include <alphatest_fragment>',`
vec2 threshold=${threshold};
float coverage=clamp(${color}.a*threshold.y,0.0,1.0);
float mask=clamp(texture2D(effectDissolveMap,effectDissolveUv).r,0.0,1.0);
float edgeWidth=max(${width},0.001);
float boundary=mix(1.0+edgeWidth,-edgeWidth,coverage);
if(mask<boundary)discard;
float edge=(1.0-smoothstep(boundary,boundary+edgeWidth,mask))*step(0.001,coverage)*step(coverage,0.999);
diffuseColor.rgb=mix(diffuseColor.rgb,${color}.rgb,edge);
#include <alphatest_fragment>`);
  };
  material.needsUpdate=true;
  return {update(color,width,threshold){uniforms.effectDissolveColor.value.fromArray(color);uniforms.effectDissolveWidth.value=width;uniforms.effectDissolveThreshold.value.fromArray(Array.isArray(threshold)?threshold:[threshold,threshold]);}};
}
