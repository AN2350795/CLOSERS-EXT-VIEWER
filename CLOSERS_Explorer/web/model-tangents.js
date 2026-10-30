import * as THREE from './vendor/three/three.module.min.js';

// CW.EXE 0x141745f80 averages raw face UV derivatives at each vertex,
// normalizes T/B separately, then aligns B with cross(N,T). No Gram-Schmidt.
export function prepareMatcapBasis(geometry){
  if(!geometry.index||!geometry.attributes.uv||!geometry.attributes.normal)return;
  const {position,uv,normal}=geometry.attributes,count=position.count;
  const sumT=new Float64Array(count*3),sumB=new Float64Array(count*3),ts=new Float32Array(count*3),bs=new Float32Array(count*3);
  const p0=new THREE.Vector3(),e1=new THREE.Vector3(),e2=new THREE.Vector3(),t=new THREE.Vector3(),b=new THREE.Vector3(),n=new THREE.Vector3(),cross=new THREE.Vector3();
  const index=geometry.index;
  for(let face=0;face+2<index.count;face+=3){
    const a=index.getX(face),c=index.getX(face+1),d=index.getX(face+2);
    p0.fromBufferAttribute(position,a);e1.fromBufferAttribute(position,c).sub(p0);e2.fromBufferAttribute(position,d).sub(p0);
    const u1=uv.getX(c)-uv.getX(a),v1=uv.getY(c)-uv.getY(a),u2=uv.getX(d)-uv.getX(a),v2=uv.getY(d)-uv.getY(a),det=u1*v2-u2*v1;
    // Keep unusable UV triangles from poisoning valid neighbouring vertices.
    if(!Number.isFinite(det)||det===0)continue;
    t.copy(e1).multiplyScalar(v2).addScaledVector(e2,-v1).divideScalar(det);
    b.copy(e2).multiplyScalar(u1).addScaledVector(e1,-u2).divideScalar(det);
    if(!Number.isFinite(t.lengthSq()+b.lengthSq()))continue;
    for(const vertex of [a,c,d])for(let axis=0;axis<3;axis++){sumT[vertex*3+axis]+=t.getComponent(axis);sumB[vertex*3+axis]+=b.getComponent(axis);}
  }
  for(let i=0;i<count;i++){
    t.fromArray(sumT,i*3);b.fromArray(sumB,i*3);n.fromBufferAttribute(normal,i);
    if(!Number.isFinite(t.lengthSq()+b.lengthSq())||t.lengthSq()===0||b.lengthSq()===0)continue;
    t.normalize();b.normalize();if(cross.crossVectors(n,t).dot(b)<0)b.negate();
    t.toArray(ts,i*3);b.toArray(bs,i*3);
  }
  geometry.setAttribute('avatarUvTangent',new THREE.BufferAttribute(ts,3));
  geometry.setAttribute('avatarUvBitangent',new THREE.BufferAttribute(bs,3));
}
