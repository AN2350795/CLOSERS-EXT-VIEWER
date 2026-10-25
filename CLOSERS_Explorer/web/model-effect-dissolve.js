import * as THREE from './vendor/three/three.module.min.js';

// Local preview of the source mask, coverage, edge color and threshold tracks.
// Compose with the existing material preview and extended skinning hooks.
export function installDissolve(material,map){
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey;
  const uniforms={effectDissolveMap:{value:map},effectDissolveColor:{value:new THREE.Vector4(1,1,1,1)},effectDissolveWidth:{value:.05},effectDissolveThreshold:{value:1}};
  material.customProgramCacheKey=()=>key.call(material)+'|effect-dissolve-v1';
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec2 effectDissolveUv;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\neffectDissolveUv=uv;');
    shader.fragmentShader='varying vec2 effectDissolveUv;\nuniform sampler2D effectDissolveMap;\nuniform vec4 effectDissolveColor;\nuniform float effectDissolveWidth;\nuniform float effectDissolveThreshold;\n'+shader.fragmentShader.replace('#include <alphatest_fragment>',`
float coverage=clamp(effectDissolveColor.a,0.0,1.0);
float mask=clamp(texture2D(effectDissolveMap,effectDissolveUv).r/max(effectDissolveThreshold,0.001),0.0,1.0);
float edgeWidth=max(effectDissolveWidth,0.001);
float boundary=mix(1.0+edgeWidth,-edgeWidth,coverage);
if(mask<boundary)discard;
float edge=(1.0-smoothstep(boundary,boundary+edgeWidth,mask))*step(0.001,coverage)*step(coverage,0.999);
diffuseColor.rgb=mix(diffuseColor.rgb,effectDissolveColor.rgb,edge);
#include <alphatest_fragment>`);
  };
  material.needsUpdate=true;
  return {update(color,width,threshold){uniforms.effectDissolveColor.value.fromArray(color);uniforms.effectDissolveWidth.value=width;uniforms.effectDissolveThreshold.value=threshold;}};
}
