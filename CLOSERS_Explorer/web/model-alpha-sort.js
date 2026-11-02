import * as THREE from './vendor/three/three.module.min.js';

// Three.js sorts transparent draw calls, not triangles inside a cloth group.
// Keep the original topology and sort only drawable translucent groups. A
// pose/view cache reuses the order across the surface/emission/postprocess
// passes and when only lighting or material controls change.
export function installAvatarAlphaSort(mesh){
  if(!mesh.material.some(m=>m.userData.avatarAlphaComponent))return;
  const geometry=mesh.geometry,index=geometry.index;if(!index)return;
  const original=index.array.slice(),depths=new Float64Array(geometry.getAttribute('position').count),seen=new Uint32Array(depths.length),point=new THREE.Vector3(),groups=new Map();
  let stamp=0,snapshot=null;
  const stats=mesh.userData.avatarAlphaSort={sorts:0},previous=mesh.onBeforeRender;
  mesh.onBeforeRender=function(renderer,scene,camera,g,material,...rest){
    previous.call(this,renderer,scene,camera,g,material,...rest);
    if(!material.userData.avatarAlphaOverlay)return;
    const bones=mesh.skeleton?.boneMatrices||[],length=32+bones.length+mesh.material.length+2;
    let changed=!snapshot||snapshot.length!==length;if(changed)snapshot=new Float64Array(length).fill(NaN);
    let cursor=0;const visit=value=>{if(snapshot[cursor]!==value)changed=true;snapshot[cursor++]=value;};
    mesh.matrixWorld.elements.forEach(visit);camera.matrixWorldInverse.elements.forEach(visit);bones.forEach(visit);
    mesh.material.forEach(m=>visit(m.userData.avatarAlphaOverlay?1:0));visit(geometry.drawRange.start);visit(geometry.drawRange.count);
    if(!changed)return;
    if(++stamp===0xffffffff){seen.fill(0);stamp=1;}
    const depth=vertex=>{if(seen[vertex]!==stamp){mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);depths[vertex]=point.z;seen[vertex]=stamp;}return depths[vertex];};
    index.array.set(original);
    for(const group of geometry.groups){
      if(!mesh.material[group.materialIndex]?.userData.avatarAlphaOverlay)continue;
      const start=Math.max(group.start,geometry.drawRange.start),end=Math.min(original.length,group.start+group.count,geometry.drawRange.start+geometry.drawRange.count),key=start+':'+end;
      let triangles=groups.get(key);
      if(!triangles){triangles=[];for(let offset=start;offset+2<end;offset+=3)triangles.push({offset,z:0});groups.set(key,triangles);}
      for(const triangle of triangles){const offset=triangle.offset;triangle.z=depth(original[offset])+depth(original[offset+1])+depth(original[offset+2]);}
      triangles.sort((a,b)=>a.z-b.z||a.offset-b.offset);
      let output=start;for(const {offset} of triangles){index.array[output++]=original[offset];index.array[output++]=original[offset+1];index.array[output++]=original[offset+2];}
    }
    index.needsUpdate=true;stats.sorts++;
  };
}
