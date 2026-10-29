import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMatcapPreview,setMatcapPreviewMap,setMatcapNormalMap,setSpecularPreview,setMaterialPreviewMap} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
// Distinct lower mips expose implicit texture2D sampling even when the level-0
// image is uniform. LinearFilter copies are an independent level-0 oracle.
function texture(base,lower){
  const levels=[];
  for(let size=512;size>=1;size/=2){const data=new Uint8Array(size*size*4);for(let i=0;i<data.length;i+=4)data.set(size===512?base:lower,i);levels.push({data,width:size,height:size});}
  const map=new T.DataTexture(levels[0].data,512,512);map.mipmaps=levels;map.generateMipmaps=false;map.minFilter=T.LinearMipmapLinearFilter;map.magFilter=T.LinearFilter;map.wrapS=map.wrapT=T.RepeatWrapping;map.needsUpdate=true;return map;
}
function fixture(count,emission=false){
  return {frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[{name:'surface',frame:-1,vertices:[-1,-1,0,1,-1,0,0,1,0],normals:[-.8,0,.6,.8,0,.6,0,.8,.6],indices:[0,1,2],uv:[0,0,64,0,32,64],groups:[[0,3,0]],materials:[{color:[.05,.04,.03,1],matcap_preview:{kind:'matcap',status:'approximate',specular:{status:'approximate',color:[.3,.2,.1,1],power:10}},...(emission?{material_preview:{kind:'emissive',status:'approximate',color:[1,1,1,1],strength:.1}}:{})}],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}]};
}
try{
  const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setClearColor(0);renderer.outputColorSpace=T.SRGBColorSpace;let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
  const gl=renderer.getContext(),pixels=scene=>{renderer.render(scene,camera);const p=new Uint8Array(renderer.domElement.width*renderer.domElement.height*4);gl.readPixels(0,0,renderer.domElement.width,renderer.domElement.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
  const cap=texture([64,32,16,255],[0,200,0,255]),bump=texture([128,128,255,128],[128,128,255,0]);cap.wrapS=cap.wrapT=T.ClampToEdgeWrapping;
  const capReference=cap.clone(),bumpReference=bump.clone();for(const m of [capReference,bumpReference]){m.minFilter=T.LinearFilter;m.needsUpdate=true;}
  for(const count of [0,4,5])for(const size of [32,96])for(const emissive of [false,true]){
    renderer.setSize(size,size);const model=buildModel(fixture(count,emissive)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0];
    if(emissive)setMaterialPreviewMap(m,capReference);
    const off=pixels(scene);
    setMatcapPreviewMap(m,capReference);setMatcapNormalMap(m,bumpReference);setMatcapPreview(m,true);setSpecularPreview(m,true);const expected=pixels(scene);
    check(expected.some((v,i)=>i%4!==3&&v!==off[i]),'mip oracle has no visible surface');
    setMatcapPreviewMap(m,cap);check(pixels(scene).every((v,i)=>Math.abs(v-expected[i])<=1),'MatCap must read explicit mip 0 under minification: '+count+'/'+size);
    setMatcapNormalMap(m,bump);const actual=pixels(scene);check(actual.every((v,i)=>Math.abs(v-expected[i])<=1),'BUMP RGB/alpha must read explicit mip 0 under minification: '+count+'/'+size);
    check(actual.every((v,i)=>i%4!==3||v===off[i]),'mip selection changed opacity');
    const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{solo:true,bloom:false});const solo=new Uint8Array(actual.length);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,solo);
    setMatcapPreview(m,false);check(pixels(scene).every((v,i)=>v===off[i]),'mip correction broke OFF restoration');
    fx.render(scene,camera,model,{solo:true,bloom:false});const soloOff=new Uint8Array(actual.length);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,soloOff);check(solo.every((v,i)=>v===soloOff[i]),'mip correction leaked into emission-only');fx.dispose();model.dispose();
  }
  check(!shaderError,'explicit mip shader failed');for(const m of [cap,bump,capReference,bumpReference])m.dispose();renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
