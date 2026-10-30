import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setAvatarFaceSdf} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
function fixture(count=0){return {frames:Array.from({length:Math.max(1,count)},(_,i)=>({name:i?'b'+i:'BIP01_HEAD',parent:-1,matrix:identity})),meshes:[{name:'FACE_SDF_MC',frame:-1,vertices:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,64,0,32,64],groups:[[0,3,0]],materials:[{color:[1,1,1,1],texture:'BASIC_FACE.TGA',face_sdf_preview:{kind:'face-sdf',status:'approximate',head_bone:'BIP01_HEAD'}}],skin:Array.from({length:count},(_,i)=>({bone:i?'b'+i:'BIP01_HEAD',offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}]};}
const levels=[];for(let size=512;size>=1;size/=2){const data=new Uint8Array(size*size*4);for(let i=0;i<data.length;i+=4)data.set([128,128,128,size===512?0:255],i);levels.push({data,width:size,height:size});}
const map=new T.DataTexture(levels[0].data,512,512);map.mipmaps=levels;map.generateMipmaps=false;map.minFilter=T.LinearMipmapLinearFilter;map.magFilter=T.LinearFilter;map.wrapS=map.wrapT=T.RepeatWrapping;map.needsUpdate=true;
const reference=map.clone();reference.minFilter=T.LinearFilter;reference.needsUpdate=true;
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setClearColor(0);renderer.outputColorSpace=T.LinearSRGBColorSpace;let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext(),capture=scene=>{renderer.render(scene,camera);const p=new Uint8Array(renderer.domElement.width*renderer.domElement.height*4);gl.readPixels(0,0,renderer.domElement.width,renderer.domElement.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
const light=(x,y,z)=>({direction:[x,y,-z],color:[1,1,1,1],intensity:1});
try{
  for(const count of [0,4,5])for(const size of [32,96]){
    renderer.setSize(size,size);const model=buildModel(fixture(count)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0];m.map=reference;m.needsUpdate=true;const off=capture(scene);setAvatarFaceSdf(m,true,light(0,1,0));const expected=capture(scene);check(expected.some((v,i)=>i%4!==3&&v!==off[i]),'face alpha reference did not shade');
    m.map=map;m.needsUpdate=true;const actual=capture(scene);check(actual.every((v,i)=>Math.abs(v-expected[i])<=1),'SDF alpha must use mip 0 under minification '+count+'/'+size);check(actual.every((v,i)=>i%4!==3||v===off[i]),'SDF mip changed alpha');
    setAvatarFaceSdf(m,false,null);check(capture(scene).every((v,i)=>v===off[i]),'face mip OFF failed exact restoration');model.dispose();
  }
  // A parent rotation changes the head basis without rotating the face mesh.
  renderer.setSize(96,96);const data=fixture();data.frames=[{name:'PARENT',parent:-1,matrix:identity},{name:'BIP01_HEAD',parent:0,matrix:identity}];const model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0],axisMap=new T.DataTexture(new Uint8Array([128,128,128,128]),1,1);axisMap.needsUpdate=true;m.map=axisMap;m.needsUpdate=true;const index=(44*96+44)*4;
  model.bones[0].position.set(10,-20,30);model.bones[1].scale.set(1,2,3);
  for(const [rotation,l,lit] of [[Math.PI/2,light(1,0,0),true],[Math.PI/2,light(-1,0,0),false],[-Math.PI/2,light(-1,0,0),true],[-Math.PI/2,light(1,0,0),false]]){
    model.bones[0].rotation.y=rotation;model.root.updateMatrixWorld(true);setAvatarFaceSdf(m,true,l);const actual=capture(scene);for(let c=0;c<3;c++){const expected=Math.round(128*(lit?1:[1,.878,.784][c]));check(Math.abs(actual[index+c]-expected)<=1,'face forward column/sign/parent transform mismatch');}
  }
  model.dispose();axisMap.dispose();check(!shaderError,'face basis/mip shader failed');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{map.dispose();reference.dispose();renderer.dispose();renderer.forceContextLoss();}
