import * as THREE from './vendor/three/three.module.min.js';
import {ParticleTimeline} from './effect-timeline.js';

const factors={ZERO:THREE.ZeroFactor,ONE:THREE.OneFactor,SRCCOLOR:THREE.SrcColorFactor,INVSRCCOLOR:THREE.OneMinusSrcColorFactor,SRCALPHA:THREE.SrcAlphaFactor,INVSRCALPHA:THREE.OneMinusSrcAlphaFactor,DESTALPHA:THREE.DstAlphaFactor,INVDESTALPHA:THREE.OneMinusDstAlphaFactor,DESTCOLOR:THREE.DstColorFactor,INVDESTCOLOR:THREE.OneMinusDstColorFactor,SRCALPHASAT:THREE.SrcAlphaSaturateFactor};
export function applyBlend(material,blend=['SRCALPHA','INVSRCALPHA']){
  material.blending=THREE.CustomBlending;material.blendEquation=THREE.AddEquation;
  material.blendSrc=factors[blend[0]]??THREE.SrcAlphaFactor;material.blendDst=factors[blend[1]]??THREE.OneMinusSrcAlphaFactor;
}
function installAlpha(material){
  material.customProgramCacheKey=()=> 'closers-particle-alpha-uv-v1';
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float particleAlpha; attribute vec2 particleUV; varying float vParticleAlpha;')
      .replace('#include <uv_vertex>','#include <uv_vertex>\nvParticleAlpha=particleAlpha;\n#ifdef USE_MAP\nvMapUv+=particleUV;\n#endif');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vParticleAlpha;')
      .replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a*=vParticleAlpha;');
  };
}

export function createParticleModel(rule,source,maps=[]){
  const root=new THREE.Group(),templates=[],ownedGeometry=[],ownedMaterials=[],meshes=[],groups=[];
  if(source){
    source.root.scale.z=1;source.root.updateMatrixWorld(true);
    for(const mesh of source.meshes){
      const geometry=mesh.geometry.clone(),position=geometry.getAttribute('position'),point=new THREE.Vector3();
      for(let i=0;i<position.count;i++){point.fromBufferAttribute(mesh.geometry.getAttribute('position'),i);if(mesh.isSkinnedMesh)mesh.applyBoneTransform(i,point);point.applyMatrix4(mesh.matrixWorld);position.setXYZ(i,...point.toArray());}
      templates.push({geometry,materials:mesh.material});ownedGeometry.push(geometry);
    }
  }else{
    const geometry=new THREE.PlaneGeometry(1,1),material=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide});
    geometry.addGroup(0,geometry.index.count,0);templates.push({geometry,materials:[material]});ownedGeometry.push(geometry);ownedMaterials.push(material);
  }
  const capacity=rule.max_particles,frames=maps.length?maps:[null];
  for(let fi=0;fi<frames.length;fi++)for(const template of templates)for(let pass=0;pass<(rule.dual?2:1);pass++){
    const geometry=template.geometry.clone();ownedGeometry.push(geometry);
    const alpha=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1),uv=new THREE.InstancedBufferAttribute(new Float32Array(capacity*2),2);
    geometry.setAttribute('particleAlpha',alpha);geometry.setAttribute('particleUV',uv);
    const materials=template.materials.map(original=>{
      const material=original.clone();ownedMaterials.push(material);material.transparent=true;material.alphaTest=0;material.depthTest=rule.depth_test;material.depthWrite=rule.depth_write;
      if(frames[fi]){material.map=frames[fi];material.color.set(0xffffff);}applyBlend(material,pass?['SRCALPHA','DESTALPHA']:rule.blend);installAlpha(material);return material;
    });
    const mesh=new THREE.InstancedMesh(geometry,materials,capacity);mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3);root.add(mesh);meshes.push(mesh);groups.push({mesh,alpha,uv,frame:fi,pass});
  }
  const timeline=new ParticleTimeline(rule),matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),quaternion=new THREE.Quaternion(),euler=new THREE.Euler(),look=new THREE.Matrix4(),up=new THREE.Vector3(0,1,0);
  return {root,meshes,materials:ownedMaterials,skeletons:[],
    update(time,camera,anchor){
      const particles=timeline.at(time),cameraLocal=camera?camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(anchor.matrixWorld.clone().invert()):new THREE.Vector3(0,0,100);
      for(const group of groups){
        let count=0;
        for(const p of particles){
          if(frames.length>1&&p.frame!==group.frame)continue;
          position.fromArray(p.position);scale.fromArray(p.size);euler.set(...p.rotation.map(v=>THREE.MathUtils.degToRad(v)));quaternion.setFromEuler(euler);
          if(rule.billboard!=='BBT_NONE'){look.lookAt(cameraLocal,position,up);quaternion.premultiply(new THREE.Quaternion().setFromRotationMatrix(look));}
          matrix.compose(position,quaternion,scale);group.mesh.setMatrixAt(count,matrix);
          const color=group.pass?p.dualColor:p.color;group.mesh.instanceColor.setXYZ(count,color[0],color[1],color[2]);group.alpha.setX(count,Math.max(0,Math.min(1,color[3])));group.uv.setXY(count,p.uv[0],p.uv[1]);count++;
        }
        group.mesh.count=count;group.mesh.instanceMatrix.needsUpdate=true;group.mesh.instanceColor.needsUpdate=true;group.alpha.needsUpdate=true;group.uv.needsUpdate=true;
      }
    },
    dispose(){meshes.forEach(m=>m.dispose());ownedGeometry.forEach(g=>g.dispose());ownedMaterials.forEach(m=>m.dispose());source?.dispose();}
  };
}
