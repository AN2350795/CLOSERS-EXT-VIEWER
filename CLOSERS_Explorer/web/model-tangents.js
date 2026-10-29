import * as THREE from './vendor/three/three.module.min.js';

// X files in the audited costumes contain normals/UVs, but no tangent data.
// Generate a smooth UV basis; it is not the game's verified importer output.
export function prepareMatcapBasis(geometry){
  if(!geometry.index||!geometry.attributes.uv||!geometry.attributes.normal)return;
  geometry.computeTangents();
  const tangent=geometry.attributes.tangent,normal=geometry.attributes.normal;
  const ts=new Float32Array(tangent.count*3),bs=new Float32Array(ts.length);
  const t=new THREE.Vector3(),b=new THREE.Vector3(),n=new THREE.Vector3();
  for(let i=0;i<tangent.count;i++){
    t.fromBufferAttribute(tangent,i);n.fromBufferAttribute(normal,i);
    b.crossVectors(n,t).multiplyScalar(tangent.getW(i));
    if(!Number.isFinite(t.lengthSq()+b.lengthSq())||t.lengthSq()<1e-10||b.lengthSq()<1e-10)continue;
    t.toArray(ts,i*3);b.normalize().toArray(bs,i*3);
  }
  geometry.deleteAttribute('tangent');
  geometry.setAttribute('avatarUvTangent',new THREE.BufferAttribute(ts,3));
  geometry.setAttribute('avatarUvBitangent',new THREE.BufferAttribute(bs,3));
}
