import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {createDofDepthPass,validDofFocal} from '/model-dof-depth.js';
const check=(v,m)=>{if(!v)throw Error(m);};
const renderer=new T.WebGLRenderer({alpha:true,antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:true});renderer.setSize(96,64);renderer.outputColorSpace=T.SRGBColorSpace;renderer.setClearColor(0x203040,.3);renderer.autoClear=false;
const scene=new T.Scene();const background=new T.Color(0x203040);scene.background=background;
const camera=new T.OrthographicCamera(-1.5,1.5,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const savedClear=renderer.getClearColor(new T.Color()),savedAlpha=renderer.getClearAlpha();
const focal=[0,4,10,.5],identity=new T.Matrix4().toArray();let model,depth,mask,other;const errors=[];renderer.debug.onShaderError=()=>errors.push('shader');
const read=target=>{const p=new Uint8Array(target.width*target.height*4);renderer.readRenderTargetPixels(target,0,0,target.width,target.height,p);return p;};
const normal=()=>{const auto=renderer.autoClear;renderer.autoClear=true;renderer.setRenderTarget(null);renderer.render(scene,camera);renderer.autoClear=auto;const p=new Uint8Array(96*64*4),gl=renderer.getContext();gl.readPixels(0,0,96,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
try{
 const meshes=[9,6,0].map((z,i)=>{const x=i-1;return {name:'depth'+i,frame:-1,vertices:[x-.35,-.7,z,x+.35,-.7,z,x+.35,.7,z,x-.35,.7,z],indices:[0,1,2,0,2,3],uv:[0,0,1,0,1,1,0,1],skin:i===2?Array.from({length:5},(_,j)=>({bone:'b'+j,offset:identity,indices:[0,1,2,3],weights:[.2,.2,.2,.2]})):[],groups:[[0,6,0]],materials:[{color:[.8-i*.2,.2,.4,1]}]};});
 model=buildModel({frames:Array.from({length:5},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes});model.root.scale.z=1;scene.add(model.root);depth=createDofDepthPass(renderer);
 const before=normal(),target=depth.render(scene,camera,model,focal),pixels=read(target),at=(x,y,c=0)=>pixels[(y*96+x)*4+c];
 for(const [x,expected] of [[16,32],[48,128],[80,191]]){check(Math.abs(at(x,32)-expected)<=1,'CPU/GPU focal encoding at '+x);check(at(x,32)===at(x,32,1)&&at(x,32)===at(x,32,2)&&at(x,32,3)===255,'depth RGB/coverage');}
 check(at(0,0,3)===0&&Math.abs(at(0,0)-128)<=1,'empty diagnostic pixels');
 check(scene.background===background&&renderer.getRenderTarget()===null&&!renderer.autoClear,'pass failed to restore scene/renderer');
 check(renderer.getClearColor(new T.Color()).equals(savedClear)&&renderer.getClearAlpha()===savedAlpha&&renderer.outputColorSpace===T.SRGBColorSpace,'depth changed clear or output color space');
 check(model.materials.every(m=>!m.userData.dofDepth.avatarDofDepthPass.value),'depth pass remained enabled');check(normal().every((v,i)=>v===before[i]),'depth hook altered normal colors');
 // Move all five influencing bones: the depth varying must be after the full
 // skinning path, not a bind-pose or first-four-weights approximation.
 for(const bone of model.bones)bone.position.z=4.5;model.root.updateMatrixWorld(true);const moved=read(depth.render(scene,camera,model,focal));
 check(Math.abs(moved[(32*96+80)*4]-159)<=1,'five-weight skinned view depth did not follow bones');
 // Standard base-alpha cutouts must still discard, while retained translucent
 // pixels encode depth with coverage alpha 1.
 mask=new T.DataTexture(new Uint8Array([255,255,255,0,255,255,255,255]),2,1);mask.needsUpdate=true;const m=model.materials[1];m.map=mask;m.needsUpdate=true;
 const cutout=read(depth.render(scene,camera,model,focal));check(cutout[(32*96+41)*4+3]===0&&cutout[(32*96+55)*4+3]===255,'depth lost alpha-test cutouts');
 m.map=null;m.opacity=.5;m.transparent=true;m.needsUpdate=true;const translucent=read(depth.render(scene,camera,model,focal));check(Math.abs(translucent[(32*96+48)*4]-128)<=1,'material color/alpha contaminated encoded depth');
 const x=new T.Mesh(new T.PlaneGeometry(4,4),new T.MeshBasicMaterial({color:0xff0000}));x.position.z=9.5;scene.add(x);other=x;
 const excluded=read(depth.render(scene,camera,model,focal));check(Math.abs(excluded[(32*96+48)*4]-128)<=1&&x.visible,'non-avatar stage content entered depth or stayed hidden');
 const output=new T.WebGLRenderTarget(2,2);renderer.setRenderTarget(output);const realRender=renderer.render;
 renderer.render=()=>{throw Error('injected depth failure');};let caught=false;
 try{depth.render(scene,camera,model,focal);}catch(e){caught=e.message==='injected depth failure';}finally{renderer.render=realRender;}
 check(caught&&renderer.getRenderTarget()===output&&scene.background===background&&x.visible&&model.materials.every(m=>!m.userData.dofDepth.avatarDofDepthPass.value),'exception failed to restore depth pass');renderer.setRenderTarget(null);output.dispose();
 const priorBlend=m.blending;m.blending=T.AdditiveBlending;let refused=false;try{depth.render(scene,camera,model,focal);}catch{refused=true;}finally{m.blending=priorBlend;}
 check(refused&&model.materials.every(m=>!m.userData.dofDepth.avatarDofDepthPass.value),'unsupported material silently produced depth or left flags enabled');
 for(const input of [[0,0,10,.5],[0,4,4,.5],[0,4,10,2],[0,4,Infinity,.5]]){check(!validDofFocal(input),'unsafe focal accepted');let rejected=false;try{depth.render(scene,camera,model,input);}catch{rejected=true;}check(rejected,'invalid focal rendered');}
 renderer.setSize(65,49);let released=false;target.addEventListener('dispose',()=>released=true);const resized=depth.render(scene,camera,model,focal);check(released&&resized.width===65&&resized.height===49,'depth resize leaked old allocation');
 let disposals=0;target.addEventListener('dispose',()=>disposals++);depth.dispose();depth.dispose();check(disposals===1,'depth target not released exactly once');let closed=false;try{depth.render(scene,camera,model,focal);}catch{closed=true;}check(closed,'disposed pass rendered again');
 check(!errors.length&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'depth GPU error');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{depth?.dispose();model?.dispose();mask?.dispose();other?.geometry.dispose();other?.material.dispose();renderer.dispose();}
