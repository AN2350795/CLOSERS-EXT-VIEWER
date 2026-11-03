import * as THREE from './vendor/three/three.module.min.js';
import {textureAlphaMode} from './model-texture-alpha.js';

function occludes(material){
  if(!material?.visible||!material.isMeshBasicMaterial||!material.depthTest||!material.depthWrite)return false;
  if(!material.transparent&&[THREE.NormalBlending,THREE.NoBlending].includes(material.blending))return true;
  // Effect loading uses transparent CustomBlending even for opaque surfaces.
  // Accept only its explicitly marked normal pass at full opacity. Binary
  // cutouts remain excluded here: filtering can make their edge alpha partial.
  return material.userData.motionOpaqueOccluder===true&&material.opacity===1&&!material.alphaMap&&!material.vertexColors&&material.blending===THREE.CustomBlending&&material.blendEquation===THREE.AddEquation&&material.blendSrc===THREE.SrcAlphaFactor&&material.blendDst===THREE.OneMinusSrcAlphaFactor&&(!material.map||textureAlphaMode(material.map)==='opaque');
}

// Only auxiliary opaque surfaces with ordinary depth semantics participate.
// Blended/particle surfaces need their own coverage rules; do not turn them
// into solid silhouettes in the avatar-only emission and DOF comparisons.
export function renderAuxiliaryDepth(renderer,world,camera,model,meshes=[]){
  const requested=new Set(meshes),selected=new Set();
  if(!requested.size)return false;
  world.traverseVisible(object=>{
    if(!requested.has(object)||!object.isMesh)return;
    for(let parent=object;parent;parent=parent.parent)if(parent===model.root)return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    if(materials.some(occludes))selected.add(object);
  });
  if(!selected.size)return false;
  const hidden=[],writes=new Map(),visibility=new Map(),autoClear=renderer.autoClear;
  try{
    world.traverse(object=>{
      if(!object.visible)return;
      if(object.isMesh||object.isLine||object.isPoints||object.isSprite){
        if(!selected.has(object)){hidden.push(object);object.visible=false;}
        else for(const material of (Array.isArray(object.material)?object.material:[object.material])){
          if(occludes(material)){if(!writes.has(material)){writes.set(material,material.colorWrite);material.colorWrite=false;}}
          else if(material&&!visibility.has(material)){visibility.set(material,material.visible);material.visible=false;}
        }
      }
    });
    renderer.autoClear=true;renderer.render(world,camera);return true;
  }finally{
    for(const object of hidden)object.visible=true;
    for(const [material,value] of writes)material.colorWrite=value;
    for(const [material,value] of visibility)material.visible=value;
    renderer.autoClear=autoClear;
  }
}
