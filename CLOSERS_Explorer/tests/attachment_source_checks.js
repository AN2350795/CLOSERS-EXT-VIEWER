import * as T from '/vendor/three/three.module.min.js';
import {buildModel,restorePose} from '/model-core.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
  const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(700,700);renderer.setClearColor(0x202630);
  const loader=new T.TextureLoader(),maps=new Map();window.testCaptures=[];
  for(const [id,file] of Object.entries(attachmentFixture.images)){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{const map=await loader.loadAsync(url);map.flipY=false;map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;maps.set(Number(id),map);}finally{URL.revokeObjectURL(url);}
  }
  for(const test of attachmentFixture.scenes){
    const model=buildModel(test.data),scene=new T.Scene();scene.add(model.root);
    for(const material of model.materials){const id=material.userData.input.image?.selected;if(id){material.map=maps.get(id);material.color.set(0xffffff);material.needsUpdate=true;}}
    for(const source of test.data.sources.filter(s=>s.attachment)){
      const target=model.bones.find(b=>b.name===source.attachment.bone),pivot=model.bones.find(b=>b.name==='__ITEM_ATTACHMENT_'+source.entry_id);
      check(pivot?.parent===target,'declared bone owns accessory '+test.label+' '+source.name);
      const expected=new T.Matrix4().compose(new T.Vector3(...source.attachment.offset),new T.Quaternion().setFromEuler(new T.Euler(...source.attachment.rotation.map(T.MathUtils.degToRad),'YXZ')),new T.Vector3(...source.attachment.scale));
      check(pivot.matrix.elements.every((v,i)=>Math.abs(v-expected.elements[i])<1e-6),'source local scale/rotation/offset preserved');
      const rigid=model.meshes.filter((m,i)=>test.data.meshes[i].source_id===source.entry_id&&!test.data.meshes[i].skin.length);
      check(rigid.length>0,'native accessory has rigid geometry');
      const relative=rigid.map(mesh=>target.matrixWorld.clone().invert().multiply(mesh.matrixWorld));
      target.position.add(new T.Vector3(12,-7,4));target.rotateY(.7);target.rotateX(.3);model.root.updateMatrixWorld(true);
      rigid.forEach((mesh,i)=>{const actual=target.matrixWorld.clone().invert().multiply(mesh.matrixWorld);check(actual.elements.every((v,j)=>Math.abs(v-relative[i].elements[j])<1e-5),'accessory follows moving bone without drift');});
      restorePose(model,test.data);
    }
    const box=new T.Box3();model.meshes.filter(m=>m.visible).forEach(m=>box.expandByObject(m,true));
    const center=box.getCenter(new T.Vector3()),distance=box.getSize(new T.Vector3()).length()*1.5,camera=new T.PerspectiveCamera(40,1,.1,100000);
    for(const [view,direction] of [['front',1],['back',-1]]){
      camera.position.copy(center).add(new T.Vector3(distance*.12,distance*.04,distance*direction));camera.lookAt(center);renderer.render(scene,camera);
      window.testCaptures.push({name:test.label+'-'+view,body:renderer.domElement.toDataURL('image/png')});
    }
    model.dispose();
  }
  maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
