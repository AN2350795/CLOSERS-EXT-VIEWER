import * as THREE from './vendor/three/three.module.min.js';

export function applyEmbeddedPose(model,clip,time){
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  for(const track of clip.tracks){
    const keys=track.keys;let lo=0,hi=keys.length-1;
    while(lo<hi){const mid=(lo+hi+1)>>1;if(keys[mid].time<=time)lo=mid;else hi=mid-1;}
    const a=keys[lo],b=keys[Math.min(lo+1,keys.length-1)],t=b.time>a.time?THREE.MathUtils.clamp((time-a.time)/(b.time-a.time),0,1):0;
    const bone=model.bones[track.frame];
    if(track.property==='matrix'){
      matrix.fromArray(a.value).decompose(bone.position,bone.quaternion,bone.scale);
      matrix.fromArray(b.value).decompose(position,rotation,scale);
      bone.position.lerp(position,t);bone.quaternion.slerp(rotation,t);bone.scale.lerp(scale,t);
    }else if(track.property==='quaternion')bone.quaternion.fromArray(a.value).slerp(rotation.fromArray(b.value),t);
    else bone[track.property].fromArray(a.value).lerp(position.fromArray(b.value),t);
  }
  model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
}
