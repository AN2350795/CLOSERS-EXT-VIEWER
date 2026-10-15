import * as THREE from './vendor/three/three.module.min.js';
import {isFaceShadingMaterial} from './face-preview.js';

export function buildModel(data){
  const root=new THREE.Group(),bones=data.frames.map(f=>{const b=new THREE.Bone();b.name=f.name;new THREE.Matrix4().fromArray(f.matrix).decompose(b.position,b.quaternion,b.scale);return b;});
  bones.forEach((b,i)=>{const p=data.frames[i].parent;(p<0?root:bones[p]).add(b);});
  root.updateMatrixWorld(true);
  const meshes=[],materials=[],skeletons=[];
  try{
    for(const m of data.meshes){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(m.vertices,3));g.setIndex(m.indices);
      if(m.uv.length)g.setAttribute('uv',new THREE.Float32BufferAttribute(m.uv,2));
      const mats=m.materials.map(v=>{
        // Observed face SDF maps store shading data in alpha. Cutting them out
        // removes a cheek. Keep opacity testing for eyes, hair and other maps.
        const faceShadingAlpha=isFaceShadingMaterial(m,v);
        // X meshes include reverse-facing outline/interior surfaces. Drawing
        // both sides exposes those surfaces as patches on skin, hair and cloth.
        const mat=new THREE.MeshBasicMaterial({color:new THREE.Color(...v.color.slice(0,3)),opacity:faceShadingAlpha?1:v.color[3],transparent:!faceShadingAlpha&&v.color[3]<1,side:THREE.FrontSide,alphaTest:faceShadingAlpha?0:.1});
        mat.userData.input=v;mat.userData.faceShadingAlpha=faceShadingAlpha;materials.push(mat);return mat;
      });
      for(const group of m.groups)g.addGroup(...group);
      let mesh;
      if(m.skin.length){
        const names=new Map(bones.map((b,i)=>[b.name,i])),n=m.vertices.length/3,weights=Array.from({length:n},()=>[]),inverses=bones.map(()=>new THREE.Matrix4());
        for(const s of m.skin){const bi=names.get(s.bone);if(bi===undefined)throw Error('스킨 뼈 연결 실패');inverses[bi].fromArray(s.offset);s.indices.forEach((vi,j)=>{if(s.weights[j]>0)weights[vi].push([bi,s.weights[j]]);});}
        const si=new Uint16Array(n*4),sw=new Float32Array(n*4);
        weights.forEach((values,vi)=>{values.sort((a,b)=>b[1]-a[1]);if(values.slice(4).some(v=>v[1]>1e-5))throw Error('정점당 4개를 초과하는 스킨 가중치는 아직 지원하지 않습니다.');const kept=values.slice(0,4),total=kept.reduce((s,v)=>s+v[1],0);if(total<.99||total>1.01)throw Error('정점의 스킨 가중치 합이 1과 일치하지 않습니다.');kept.forEach(([i,w],j)=>{si[vi*4+j]=i;sw[vi*4+j]=w/total;});});
        g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(si,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(sw,4));
        mesh=new THREE.SkinnedMesh(g,mats);const skeleton=new THREE.Skeleton(bones,inverses);mesh.bind(skeleton,new THREE.Matrix4());skeletons.push(skeleton);root.add(mesh);
      }else{mesh=new THREE.Mesh(g,mats);(m.frame<0?root:bones[m.frame]).add(mesh);}
      mesh.name=m.name;mesh.userData.helper=m.helper;mesh.visible=!m.helper;mesh.frustumCulled=false;meshes.push(mesh);
    }
  }catch(e){for(const m of meshes)m.geometry.dispose();materials.forEach(m=>m.dispose());skeletons.forEach(s=>s.dispose());throw e;}
  root.scale.z=-1;root.updateMatrixWorld(true);skeletons.forEach(s=>s.update());
  return {root,bones,meshes,materials,skeletons,dispose(){for(const m of meshes)m.geometry.dispose();materials.forEach(m=>m.dispose());skeletons.forEach(s=>s.dispose());}};
}

export function applyPose(model,clip,time){
  const keys=clip.keys;if(!keys.length)return;
  let lo=0,hi=keys.length-1;
  while(lo<hi){const mid=Math.floor((lo+hi+1)/2);if(keys[mid].time<=time)lo=mid;else hi=mid-1;}
  const a=keys[lo],b=keys[Math.min(lo+1,keys.length-1)],t=b.time>a.time?THREE.MathUtils.clamp((time-a.time)/(b.time-a.time),0,1):0;
  const qa=new THREE.Quaternion(),qb=new THREE.Quaternion();
  clip.mapping.frames.forEach((index,i)=>{const bone=model.bones[index],u=a.transforms[i],v=b.transforms[i];qa.set(...u.slice(0,4)).normalize();qb.set(...v.slice(0,4)).normalize();bone.quaternion.copy(qa).slerp(qb,t);bone.scale.set(...u.slice(4,7)).lerp(new THREE.Vector3(...v.slice(4,7)),t);bone.position.set(...u.slice(7,10)).lerp(new THREE.Vector3(...v.slice(7,10)),t);});
  model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
}

export function restorePose(model,data){
  data.frames.forEach((f,i)=>new THREE.Matrix4().fromArray(f.matrix).decompose(model.bones[i].position,model.bones[i].quaternion,model.bones[i].scale));model.root.updateMatrixWorld(true);
}
