import * as THREE from './vendor/three/three.module.min.js';

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
    if(materials.length&&materials.every(m=>m?.isMeshBasicMaterial&&!m.transparent&&m.depthTest&&m.depthWrite&&[THREE.NormalBlending,THREE.NoBlending].includes(m.blending)))selected.add(object);
  });
  if(!selected.size)return false;
  const hidden=[],writes=new Map(),autoClear=renderer.autoClear;
  try{
    world.traverse(object=>{
      if(!object.visible)return;
      if(object.isMesh||object.isLine||object.isPoints||object.isSprite){
        if(!selected.has(object)){hidden.push(object);object.visible=false;}
        else for(const material of (Array.isArray(object.material)?object.material:[object.material]))if(!writes.has(material)){writes.set(material,material.colorWrite);material.colorWrite=false;}
      }
    });
    renderer.autoClear=true;renderer.render(world,camera);return true;
  }finally{
    for(const object of hidden)object.visible=true;
    for(const [material,value] of writes)material.colorWrite=value;
    renderer.autoClear=autoClear;
  }
}
