import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMaterialPreviewMap} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
import {createDofDepthPass} from '/model-dof-depth.js';
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>a.every((v,i)=>v===b[i]);
const renderer=new T.WebGLRenderer({alpha:true,antialias:!!window.occlusionAntialias,preserveDrawingBuffer:true});renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.setSize(64,64);renderer.setClearColor(0,0);
const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const avatar=buildModel({frames:[],meshes:[{name:'emitter',frame:-1,vertices:[-.7,-.7,0,.7,-.7,0,.7,.7,0,-.7,.7,0],indices:[0,1,2,0,2,3],uv:[0,0,1,0,1,1,0,1],skin:[],groups:[[0,6,0]],materials:[{color:[.1,.1,.1,1],material_preview:{kind:'emissive',status:'approximate',color:[1,.3,.1,1],strength:2}}]}]});avatar.root.scale.z=1;scene.add(avatar.root);
const emission=new T.DataTexture(new Uint8Array([255,128,32,255]),1,1);emission.needsUpdate=true;setMaterialPreviewMap(avatar.materials[0],emission);
const pixels=new Uint8Array(8*8*4);for(let i=0;i<64;i++)pixels.set(i%2?[20,180,40,255]:[180,20,100,255],i*4);
const map=new T.DataTexture(pixels,8,8);map.needsUpdate=true;
const prop=new T.Mesh(new T.PlaneGeometry(1.8,1.8),new T.MeshBasicMaterial({map}));prop.position.z=1;scene.add(prop);
const hidden=new T.Mesh(new T.PlaneGeometry(),new T.MeshBasicMaterial());hidden.visible=false;scene.add(hidden);
const particle=new T.Mesh(new T.PlaneGeometry(.4,.4),new T.MeshBasicMaterial({color:0x2040ff,transparent:true,opacity:.4,depthWrite:false,blending:T.AdditiveBlending}));particle.position.set(.7,0,2);scene.add(particle);
const fx=createEmissionRenderer(renderer),depth=createDofDepthPass(renderer),gl=renderer.getContext(),errors=[];renderer.debug.onShaderError=()=>errors.push('shader');
const read=()=>{const p=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
const render=options=>{fx.render(scene,camera,avatar,{bloom:false,...options});return read();};
const encoded=occluders=>{depth.render(scene,camera,avatar,[0,4,8,.5],occluders);const p=new Uint8Array(64*64*4);renderer.readRenderTargetPixels(depth.target,0,0,64,64,p);return p;};
const center=(32*64+32)*4;
try{
  const plain=render({});
  const blocked=encoded([prop,particle]);check(blocked[center+3]===0,'opaque auxiliary must block avatar depth coverage');
  const unblocked=encoded([]);check(unblocked[center+3]===255,'avatar depth fixture is not covered');
  for(const bloomMode of ['viewer','source']){
    // Compare within the same HDR/MSAA path to avoid confusing framebuffer
    // quantization with leaked emission. Removing a fully hidden avatar must
    // leave every output pixel unchanged.
    const covered=render({bloom:true,bloomMode,occluders:[prop,particle]});avatar.root.visible=false;
    const absent=render({bloom:true,bloomMode,occluders:[prop,particle]});avatar.root.visible=true;
    check(same(covered,absent),'hidden avatar emission leaks through opaque prop: '+bloomMode);
    prop.position.z=-1;const behind=render({bloom:true,bloomMode,occluders:[prop,particle]});check(!same(plain,behind),'rear prop incorrectly blocks visible emission');prop.position.z=1;
  }
  const focused=render({occluders:[prop,particle],dof:{enabled:true,focus:4,range:4,strength:1}});check(same(plain,focused),'foreground prop was blurred using hidden avatar depth');
  // Cutouts retain the material alpha test; blended particles never become
  // opaque blockers merely because they are in the auxiliary mesh list.
  const holes=new T.DataTexture(new Uint8Array([255,255,255,0]),1,1);holes.needsUpdate=true;prop.material.map=holes;prop.material.alphaTest=.5;prop.material.needsUpdate=true;
  check(encoded([prop,particle])[center+3]===255,'cutout hole incorrectly occludes avatar');
  prop.material.map=map;prop.material.alphaTest=0;prop.material.transparent=true;prop.material.opacity=.5;prop.material.needsUpdate=true;
  check(encoded([prop,particle])[center+3]===255,'blended auxiliary was treated as opaque');
  prop.material.transparent=false;prop.material.opacity=1;prop.material.needsUpdate=true;prop.visible=false;
  check(encoded([prop])[center+3]===255,'hidden auxiliary occluded avatar');prop.visible=true;
  prop.visible=false;
  const particleMask=render({solo:true,bloom:false,occluders:[prop,particle]});particle.visible=false;
  check(same(render({solo:true,bloom:false,occluders:[prop,particle]}),particleMask),'additive particle contaminated avatar emission mask');particle.visible=true;prop.visible=true;
  prop.material.depthWrite=false;check(encoded([prop])[center+3]===255,'non-depth-writing auxiliary became a blocker');prop.material.depthWrite=true;
  // Depth-only failures must restore all live flags before the next frame.
  const original=renderer.render;
  for(const invoke of [()=>encoded([prop]),()=>render({bloom:true,occluders:[prop]}),()=>render({bloom:true,bloomMode:'source',occluders:[prop]})]){
    renderer.render=function(s,c){if(!prop.material.colorWrite)throw Error('occluder failure');return original.call(this,s,c);};let failed=false;
    try{invoke();}catch(e){failed=e.message==='occluder failure';}finally{renderer.render=original;}
    check(failed&&prop.material.colorWrite&&avatar.meshes[0].visible&&particle.visible&&!hidden.visible&&renderer.getRenderTarget()===null&&renderer.autoClear,'occluder failure leaked render state');
  }
  check(same(render({}),plain),'occluder tests changed normal rendering');check(errors.length===0&&gl.getError()===gl.NO_ERROR,'WebGL error');holes.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{depth.dispose();fx.dispose();avatar.dispose();emission.dispose();map.dispose();for(const mesh of [prop,hidden,particle]){mesh.geometry.dispose();mesh.material.dispose();}renderer.dispose();}
