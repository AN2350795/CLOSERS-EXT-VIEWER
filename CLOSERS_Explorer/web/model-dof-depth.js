import * as THREE from './vendor/three/three.module.min.js';
import {renderAuxiliaryDepth} from './model-occlusion.js';

// Preparation pass only: encode positive view distance using the investigated
// MRT2 RGB formula. No UI, focus guessing, blur, or game-state activation.
export function validDofFocal(value){
  return Array.isArray(value)&&value.length===4&&value.every(Number.isFinite)&&value[0]<value[1]&&value[1]<value[2]&&value[3]>=0&&value[3]<=1;
}

export const dofDepthFragment=`
float avatarDofEncodedDepth(float z,vec4 focal){
  float value;
  if(z<focal.y)value=(z-focal.y)/(focal.y-focal.x);
  else value=min(max((z-focal.y)/(focal.z-focal.y),0.0),focal.w);
  return value*0.5+0.5;
}`;

function installDepth(material){
  if(!material.isMeshBasicMaterial)throw Error('DOF 깊이 비교에서 지원하지 않는 재질입니다.');
  if(![THREE.NormalBlending,THREE.NoBlending].includes(material.blending)||!material.depthTest||!material.depthWrite)throw Error('DOF 깊이 비교는 일반 깊이·블렌딩 재질만 지원합니다.');
  if(material.userData.dofDepth)return material.userData.dofDepth;
  const uniforms={avatarDofDepthPass:{value:false},avatarDofFocal:{value:new THREE.Vector4()}};
  material.userData.dofDepth=uniforms;
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey;
  material.customProgramCacheKey=()=>key.call(material)+'|avatar-dof-depth-v2';
  material.onBeforeCompile=function(shader){
    previous.call(this,shader);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying float avatarDofViewDepth;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\navatarDofViewDepth=-mvPosition.z;');
    shader.fragmentShader='varying float avatarDofViewDepth;\nuniform bool avatarDofDepthPass;\nuniform vec4 avatarDofFocal;\n'+dofDepthFragment+shader.fragmentShader.replace('#include <opaque_fragment>',`if(avatarDofDepthPass){
// Opaque materials force alpha to one in the normal shader. For blended
// surfaces, zero effective alpha must not become depth coverage merely
// because this comparison encodes the retained samples with alpha one.
#ifndef OPAQUE
if(diffuseColor.a<=0.0)discard;
#endif
float depth=avatarDofEncodedDepth(avatarDofViewDepth,avatarDofFocal);gl_FragColor=vec4(vec3(depth),1.0);return;}
#include <opaque_fragment>`);
  };
  material.needsUpdate=true;return uniforms;
}

export function createDofDepthPass(renderer){
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.UnsignedByteType,depthBuffer:true,stencilBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  const size=new THREE.Vector2();let disposed=false;
  return {target,
    render(scene,camera,model,focal,occluders=[]){
      if(disposed)throw Error('종료된 DOF 깊이 비교입니다.');
      if(!validDofFocal(focal))throw Error('DOF 깊이 비교에는 근거리 < 초점 < 원거리와 0~1 원거리 제한이 필요합니다.');
      if(!model?.root||!model.materials?.length)throw Error('DOF 깊이를 비교할 모델이 없습니다.');
      // Install before changing any live render state, so unsupported materials
      // fail without leaving other materials in the transient pass.
      const inputs=model.materials.map(installDepth),saved=inputs.map(u=>[u,u.avatarDofDepthPass.value,u.avatarDofFocal.value.clone()]);
      renderer.getDrawingBufferSize(size);if(size.x<1||size.y<1)throw Error('DOF 깊이를 비교할 화면 크기가 없습니다.');if(target.width!==size.x||target.height!==size.y)target.setSize(size.x,size.y);
      const output=renderer.getRenderTarget(),background=scene.background,clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),autoClear=renderer.autoClear,hidden=[];
      try{
        for(const [u] of saved){u.avatarDofDepthPass.value=true;u.avatarDofFocal.value.fromArray(focal);}
        scene.background=null;renderer.autoClear=true;
        // Diagnostic empty pixels: focus-neutral RGB, zero coverage alpha.
        renderer.setClearColor(new THREE.Color(.5,.5,.5),0);renderer.setRenderTarget(target);
        if(renderAuxiliaryDepth(renderer,scene,camera,model,occluders))renderer.autoClear=false;
        for(const child of scene.children)if(child!==model.root&&child.visible){child.visible=false;hidden.push(child);}
        renderer.render(scene,camera);
        return target;
      }finally{
        for(const [u,enabled,prior] of saved){u.avatarDofDepthPass.value=enabled;u.avatarDofFocal.value.copy(prior);}
        scene.background=background;for(const child of hidden)child.visible=true;
        renderer.setClearColor(clear,alpha);renderer.setRenderTarget(output);renderer.autoClear=autoClear;
      }
    },
    dispose(){if(!disposed){disposed=true;target.dispose();}}
  };
}
