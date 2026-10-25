import * as THREE from './vendor/three/three.module.min.js';
import {vector,random} from './effect-timeline.js';

export function binaryResource(packet){
  const text=atob(packet.body),bytes=new Uint8Array(text.length);
  for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);
  return bytes;
}

export async function createFBXModel(packet){
  const {FBXLoader}=await import('./vendor/three/addons/FBXLoader.js');
  const placeholders=[],manager=new THREE.LoadingManager();
  // Resolve images only through the verified local catalog; FBX paths never fetch URLs.
  manager.addHandler(/.*/,{path:'',setPath(value){this.path=value;return this;},load(url){if(url.startsWith('blob:'))URL.revokeObjectURL(url);const t=new THREE.Texture();placeholders.push(t);return t;}});
  const root=new FBXLoader(manager).parse(binaryResource(packet).buffer,''),meshes=[],materials=[],geometries=new Set(),originals=new Set();
  root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const source=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    mesh.material=source.map(m=>{originals.add(m);const material=new THREE.MeshBasicMaterial({color:m.color,side:THREE.DoubleSide,transparent:true,opacity:m.opacity});material.userData.input={};materials.push(material);return material;});
    if(!mesh.geometry.groups.length)mesh.geometry.addGroup(0,mesh.geometry.index?.count||mesh.geometry.getAttribute('position').count,0);
    mesh.frustumCulled=false;meshes.push(mesh);geometries.add(mesh.geometry);
  });
  originals.forEach(m=>m.dispose());placeholders.forEach(t=>t.dispose());root.updateMatrixWorld(true);
  if(!meshes.length)throw Error('FBX에서 표시할 메시를 찾지 못했습니다.');
  return {root,meshes,materials,skeletons:[],dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());root.traverse(m=>m.skeleton?.dispose());}};
}

export async function createSpineModel(rule,packet,atlasPacket,maps){
  const [{SkeletonMesh},{ThreeJsTexture},{TextureAtlas,AtlasAttachmentLoader,SkeletonBinary,Physics}]=await Promise.all([
    import('./vendor/spine/threejs/SkeletonMesh.js'),import('./vendor/spine/threejs/ThreeJsTexture.js'),import('./vendor/spine/core/index.js')]);
  const atlas=new TextureAtlas(atlasPacket.text),textures=[],root=new THREE.Group();
  let mesh;
  try{
    for(const page of atlas.pages){
      const index=atlasPacket.images.findIndex(info=>info.name===page.name),map=maps[index];
      if(!map?.image)throw Error('Spine 아틀라스 이미지를 확인할 수 없습니다: '+page.name);
      const texture=new ThreeJsTexture(map.image,page.pma);textures.push(texture);page.setTexture(texture);
    }
    const reader=new SkeletonBinary(new AtlasAttachmentLoader(atlas)),data=reader.readSkeletonData(binaryResource(packet));
    if(!data.version.startsWith('4.2.'))throw Error('Spine 4.2 원본을 선택해 주세요: '+data.version);
    mesh=new SkeletonMesh(data,params=>{params.depthWrite=rule.depth_write;params.depthTest=rule.depth_test;});
    const config=rule.spine,rng=random(rule.seed),events=config.events.map(e=>({...e,at:Number(e.at),speed:Number(e.speed)})).sort((a,b)=>a.at-b.at);
    for(const event of events)if(!data.findAnimation(event.name))throw Error('Spine 애니메이션이 없습니다: '+event.name);
    mesh.position.fromArray(vector(config.position,rng));mesh.scale.fromArray(vector(config.scale,rng));mesh.rotation.set(...vector(config.rotation,rng).map(THREE.MathUtils.degToRad));root.add(mesh);
    let last=-1,selected=null;
    const model={root,meshes:[],materials:[],skeletons:[],vertices:0,
      update(age){
        let event=null;for(const candidate of events){if(candidate.at>age)break;event=candidate;}
        const elapsed=event?(age-event.at)*event.speed:0;
        if(event!==selected||elapsed<last||elapsed-last>.25){
          mesh.state.clearTracks();mesh.skeleton.time=0;mesh.skeleton.setToSetupPose();mesh.skeleton.updateWorldTransform(Physics.reset);
          last=0;
          if(event){
            const track=mesh.state.setAnimation(0,event.name,true),warmup=Math.min(30,Math.max(1,track.animation.duration*2));
            last=Math.max(0,elapsed-warmup);track.trackTime=last;mesh.skeleton.time=last;mesh.update(0);
          }
          selected=event;
        }
        let remaining=Math.max(0,elapsed-last);
        // Fixed substeps make physics stable and seeking reproducible.
        while(remaining>1e-8){const step=Math.min(1/60,remaining);mesh.update(step);remaining-=step;}
        if(elapsed===0)mesh.update(0);last=elapsed;
        // These exports share a login portrait mask. World emotion effects use
        // the game's EMOTION clipping preset rather than that UI-only root mask.
        // Keep all internal authored clipping (hair, clothing, etc.) intact.
        if(config.clipping==='EMOTION'){
          mesh.skeleton.findSlot('root_clipping')?.setAttachment(null);mesh.updateGeometry();
        }
        model.meshes=mesh.batches;model.meshes.forEach(b=>b.frustumCulled=false);model.materials=mesh.batches.flatMap(b=>Array.isArray(b.material)?b.material:[b.material]);
        model.vertices=mesh.batches.reduce((n,b)=>n+b.geometry.drawRange.count,0);
      },
      dispose(){mesh.dispose();textures.forEach(t=>t.dispose());}
    };model.update(0);return model;
  }catch(e){mesh?.dispose();textures.forEach(t=>t.dispose());throw e;}
}
