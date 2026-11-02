import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
const check=(v,m)=>{if(!v)throw Error(m);};
const renderer=new T.WebGLRenderer({alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true});renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.setSize(128,128);renderer.setClearColor(0,0);
const world=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const material=(texture,color=[1,0,0,1])=>({texture,color}),geometry=(source_id,texture,z,color)=>({name:'fixture',source_id,frame:-1,vertices:[-.8,-.8,z,.8,-.8,z,.8,.8,z,-.8,.8,z],indices:[0,1,2,0,2,3],uv:[0,0,1,0,1,1,0,1],skin:[],groups:[[0,6,0]],materials:[material(texture,color)]});
const sources=[{entry_id:1,model_group:{kind:'avatar',variant:'BASE'}},{entry_id:2,model_group:{kind:'avatar',variant:'ALPHA'}}];
const map=new T.DataTexture(new Uint8Array([255,255,255,128]),1,1);map.needsUpdate=true;
let model;const maps=[];const gl=renderer.getContext(),errors=[];renderer.debug.onShaderError=()=>errors.push('shader');
const read=()=>{renderer.render(world,camera);const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
try{
  model=buildModel({frames:[],sources,meshes:[geometry(1,'SKIN.PNG',0,[0,0,1,1]),geometry(2,'CLOTH_ALPHA.PNG',.1,[1,0,0,1])]});model.root.scale.z=1;world.add(model.root);model.materials[1].map=map;model.materials[1].needsUpdate=true;
  const image=read(),pixel=image.slice((64*128+64)*4,(64*128+64)*4+4);
  check(Math.abs(pixel[0]-128)<=1&&pixel[1]===0&&Math.abs(pixel[2]-127)<=1&&pixel[3]===255,'alpha overlay must blend with underlying skin: '+pixel);
  check(model.materials[1].transparent&&!model.materials[1].depthWrite,'overlay must not hide later translucent layers with an opaque depth write');
  check(!model.materials[0].transparent&&model.materials[0].depthWrite,'opaque skin material changed');world.remove(model.root);model.dispose();model=null;
  model=buildModel({frames:[],sources,meshes:[geometry(1,'SKIN.PNG',0,[0,0,1,1]),geometry(2,'FRONT_ALPHA.PNG',.2,[1,0,0,1]),geometry(2,'BACK_ALPHA.PNG',.1,[0,1,0,1])]});model.root.scale.z=1;world.add(model.root);
  for(const m of model.materials.slice(1)){m.map=map;m.needsUpdate=true;}
  const layered=read().slice((64*128+64)*4,(64*128+64)*4+4);check(layered.every((v,i)=>Math.abs(v-[128,64,63,255][i])<=2),'overlapping sheer layers must composite over opaque skin: '+layered);world.remove(model.root);model.dispose();model=null;
  for(const [source_id,texture,alpha,expected] of [[1,'CLOTH_ALPHA.PNG',1,false],[2,'SKIN.PNG',1,false],[1,'SKIN.PNG',.4,true]]){
    model=buildModel({frames:[],sources,meshes:[geometry(source_id,texture,0,[1,1,1,alpha])]});check(model.materials[0].transparent===expected&&model.materials[0].depthWrite,'unrelated/base/ordinary opacity material changed');model.dispose();model=null;
  }
  if(window.avatarAlphaFixture){
    renderer.setSize(384,384);const loader=new T.TextureLoader();window.testCaptures=[];
    for(const fixture of window.avatarAlphaFixture.scenes){
      model=buildModel(fixture.data);world.add(model.root);
      for(const m of model.materials){const id=m.userData.input.image?.selected;if(!id)continue;const image=window.avatarAlphaFixture.images[id],texture=await loader.loadAsync('data:image/png;base64,'+image);maps.push(texture);texture.flipY=false;texture.colorSpace=T.NoColorSpace;m.map=texture;m.color.set(0xffffff);m.needsUpdate=true;}
      const overlays=model.materials.filter(m=>m.userData.avatarAlphaOverlay);check(overlays.length===2,'expected two ALPHA-textured materials for '+fixture.label);
      check(model.materials.filter(m=>!overlays.includes(m)).every(m=>!m.transparent&&m.depthWrite),'skin/base materials changed for '+fixture.label);
      const bounds=new T.Box3().setFromObject(model.root),center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3()),half=Math.max(size.y*.6,size.x*.22),distance=size.length()*2;
      camera.left=camera.bottom=-half;camera.right=camera.top=half;camera.near=Math.max(.01,distance/1000);camera.far=distance*4;camera.updateProjectionMatrix();
      for(const angle of [0,.65]){
        camera.position.copy(center).add(new T.Vector3(Math.sin(angle)*distance,0,Math.cos(angle)*distance));camera.lookAt(center);camera.updateMatrixWorld(true);
        const correct=read();check(correct.some((v,i)=>i%4===3&&v>0),'costume did not render');window.testCaptures.push({name:fixture.label+'-'+angle+'-sheer',body:renderer.domElement.toDataURL()});
        for(const m of overlays){m.transparent=false;m.depthWrite=true;m.needsUpdate=true;}
        const opaque=read();window.testCaptures.push({name:fixture.label+'-'+angle+'-opaque',body:renderer.domElement.toDataURL()});
        const changed=correct.filter((v,i)=>i%4!==3&&Math.abs(v-opaque[i])>2).length;check(changed>100,'sheer texture had no visible effect for '+fixture.label+'/'+angle);
        for(const m of overlays){m.transparent=true;m.depthWrite=false;m.needsUpdate=true;}
        check(read().every((v,i)=>v===correct[i]),'restoring blend did not restore exact pixels');
      }
      world.remove(model.root);model.dispose();model=null;
    }
  }
  check(errors.length===0&&gl.getError()===gl.NO_ERROR,'WebGL error');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{model?.dispose();map.dispose();for(const texture of maps)texture.dispose();renderer.dispose();}
