import * as THREE from './vendor/three/three.module.min.js';
import {isFaceShadingMaterial} from './face-preview.js';

// Store a sparse list rather than reserving a fixed number of influences per
// vertex. WebGL2 vertex shaders can fetch every influence without truncation.
function extendSkinning(mesh,weights,textures){
  const count=weights.reduce((sum,values)=>sum+values.length,0),width=Math.min(1024,count),height=Math.ceil(count/width);
  const entries=new Float32Array(width*height*4),ranges=new Float32Array(weights.length*2);
  let offset=0;
  weights.forEach((values,vi)=>{
    ranges[vi*2]=offset;ranges[vi*2+1]=values.length;
    for(const [bone,weight] of values){entries[offset*4]=bone;entries[offset*4+1]=weight;offset++;}
  });
  const texture=new THREE.DataTexture(entries,width,height,THREE.RGBAFormat,THREE.FloatType);
  texture.needsUpdate=true;textures.push(texture);
  mesh.geometry.setAttribute('influenceRange',new THREE.Float32BufferAttribute(ranges,2));
  for(const material of mesh.material){
    material.customProgramCacheKey=()=> 'closers-full-skinning-v1';
    material.onBeforeCompile=shader=>{
      shader.uniforms.influenceTexture={value:texture};
      shader.vertexShader=shader.vertexShader.replace('#include <skinning_pars_vertex>',`#include <skinning_pars_vertex>
attribute vec2 influenceRange;
uniform highp sampler2D influenceTexture;`)
        .replace('#include <skinbase_vertex>',`
mat4 fullSkinMatrix = mat4(0.0);
int influenceWidth = textureSize(influenceTexture, 0).x;
for (int j = 0; j < int(influenceRange.y); j++) {
  int entry = int(influenceRange.x) + j;
  vec2 influence = texelFetch(influenceTexture, ivec2(entry % influenceWidth, entry / influenceWidth), 0).rg;
  fullSkinMatrix += getBoneMatrix(influence.x) * influence.y;
}`)
        .replace('#include <skinning_vertex>','transformed = (bindMatrixInverse * fullSkinMatrix * bindMatrix * vec4(transformed, 1.0)).xyz;')
        .replace('#include <skinnormal_vertex>',`
mat4 skinMatrix = bindMatrixInverse * fullSkinMatrix * bindMatrix;
objectNormal = (skinMatrix * vec4(objectNormal, 0.0)).xyz;
#ifdef USE_TANGENT
  objectTangent = (skinMatrix * vec4(objectTangent, 0.0)).xyz;
#endif`);
    };
  }
  // Three.js also skins on the CPU for bounds, camera framing and raycasting.
  const base=new THREE.Vector3(),point=new THREE.Vector3(),matrix=new THREE.Matrix4();
  mesh.applyBoneTransform=function(index,target){
    base.copy(target).applyMatrix4(this.bindMatrix);target.set(0,0,0);
    for(const [bone,weight] of weights[index]){
      matrix.multiplyMatrices(this.skeleton.bones[bone].matrixWorld,this.skeleton.boneInverses[bone]);
      target.addScaledVector(point.copy(base).applyMatrix4(matrix),weight);
    }
    return target.applyMatrix4(this.bindMatrixInverse);
  };
}

export function buildModel(data){
  const root=new THREE.Group(),bones=data.frames.map(f=>{const b=new THREE.Bone();b.name=f.name;new THREE.Matrix4().fromArray(f.matrix).decompose(b.position,b.quaternion,b.scale);return b;});
  bones.forEach((b,i)=>{const p=data.frames[i].parent;(p<0?root:bones[p]).add(b);});
  root.updateMatrixWorld(true);
  const meshes=[],materials=[],skeletons=[],textures=[],geometries=[];
  try{
    for(const m of data.meshes){
      const g=new THREE.BufferGeometry();geometries.push(g);g.setAttribute('position',new THREE.Float32BufferAttribute(m.vertices,3));g.setIndex(m.indices);
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
        let extended=false;
        weights.forEach((values,vi)=>{
          values.sort((a,b)=>b[1]-a[1]);
          const total=values.reduce((s,v)=>s+v[1],0);
          if(!Number.isFinite(total)||total<.99||total>1.01)throw Error('정점의 스킨 가중치 합이 1과 일치하지 않습니다.');
          extended ||= values.length>4;
          values.forEach((value,j)=>{value[1]/=total;if(j<4){si[vi*4+j]=value[0];sw[vi*4+j]=value[1];}});
        });
        g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(si,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(sw,4));
        mesh=new THREE.SkinnedMesh(g,mats);const skeleton=new THREE.Skeleton(bones,inverses);mesh.bind(skeleton,new THREE.Matrix4());skeletons.push(skeleton);root.add(mesh);
        if(extended)extendSkinning(mesh,weights,textures);
      }else{mesh=new THREE.Mesh(g,mats);(m.frame<0?root:bones[m.frame]).add(mesh);}
      mesh.name=m.name;mesh.userData.helper=m.helper;mesh.userData.equipmentHidden=!!m.equipment_hidden;mesh.visible=!m.helper&&!m.equipment_hidden;mesh.frustumCulled=false;meshes.push(mesh);
    }
  }catch(e){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());skeletons.forEach(s=>s.dispose());textures.forEach(t=>t.dispose());throw e;}
  root.scale.z=-1;root.updateMatrixWorld(true);skeletons.forEach(s=>s.update());
  return {root,bones,meshes,materials,skeletons,dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());skeletons.forEach(s=>s.dispose());textures.forEach(t=>t.dispose());}};
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
