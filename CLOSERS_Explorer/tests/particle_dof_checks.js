import * as T from '/vendor/three/three.module.min.js';
import {createParticleModel} from '/particle-model.js';
import {buildModel} from '/model-core.js';
import {createDofDepthPass} from '/model-dof-depth.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);};
const renderer=new T.WebGLRenderer({alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.setClearColor(0,0);
const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=12;camera.updateMatrixWorld(true);
const avatar=buildModel({frames:[],meshes:[{name:'avatar',frame:-1,vertices:[-.6,-.6,8,.6,-.6,8,.6,.6,8,-.6,.6,8],indices:[0,1,2,0,2,3],uv:[],skin:[],groups:[[0,6,0]],materials:[{color:[.2,.4,.6,1]}]}]});avatar.root.scale.z=1;scene.add(avatar.root);
const white=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1),cutout=new T.DataTexture(new Uint8Array([255,255,255,0,255,255,255,255]),2,1),tint=new T.DataTexture(new Uint8Array([102,255,255,255]),1,1);white.needsUpdate=cutout.needsUpdate=tint.needsUpdate=true;
const stripeBytes=new Uint8Array(32*4);for(let i=0;i<32;i++)stripeBytes.set([i%2?255:0,80,180,255],i*4);
const stripes=new T.DataTexture(stripeBytes,32,1);stripes.needsUpdate=true;
const depth=createDofDepthPass(renderer),effects=createEmissionRenderer(renderer),particles=[],focal=[0,4,8,.5],errors=[];renderer.debug.onShaderError=()=>errors.push('shader');
const bytes=()=>{const p=new Uint8Array(64*64*4),gl=renderer.getContext();gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
const normal=()=>{renderer.setRenderTarget(null);renderer.render(scene,camera);return bytes();};
const at=(p,x=32)=>[...p.slice((32*64+x)*4,(32*64+x)*4+4)];
const encoded=()=>{depth.render(scene,camera,avatar,focal,particles.flatMap(p=>p.meshes));const p=new Uint8Array(64*64*4);renderer.readRenderTargetPixels(depth.target,0,0,64,64,p);return p;};
function make({alpha=.5,red=1,z=10,write=false,layer=0,map=white,rule={}}={}){
 const p=createParticleModel({...window.particleDofRule,seed:1,max_particles:1,instant:1,rate:0,life:2,emitter_life:2,deaths:1,depth_write:write,...rule,layer:'ROL_EFFECT_'+layer,tracks:[{property:'size',mode:'initial',value:[1.5,1.5,1]},{property:'position',mode:'initial',value:[0,0,z]},{property:'color',mode:'initial',value:[red,.5,.25,alpha]}]},null,[map]);
 const anchor=new T.Group();anchor.add(p.root);scene.add(anchor);scene.updateMatrixWorld(true);p.update(.1,camera,anchor);p.anchor=anchor;particles.push(p);return p;
}
function clear(){for(const p of particles.splice(0)){scene.remove(p.anchor);p.dispose();}}
const quantize=x=>Math.round(Math.max(0,Math.min(1,x))*255)/255;
function oracle(layers,covered=true){let rgb=quantize(.5),coverage=covered?1:0,zBuffer=covered?4:Infinity;
 for(const p of layers){const z=12-p.z;if(z>zBuffer||p.alpha<=1/255)continue;const signal=z<4?(z-4)/4:Math.min(Math.max((z-4)/4,0),.5),a=p.alpha*(p.additive?p.red:1);rgb=quantize((signal*.5+.5)*a+rgb*(1-a));coverage=quantize(coverage+a);if(p.write)zBuffer=z;}
 return [Math.round(rgb*255),Math.round(coverage*255)];}
let cases=0,sourceMap;
try{
 if(window.particleDofTexture){sourceMap=await new T.TextureLoader().loadAsync(window.particleDofTexture);sourceMap.flipY=false;sourceMap.wrapS=sourceMap.wrapT=T.RepeatWrapping;}
 check(window.particleDofRule.dof_plane===true,'backend did not opt in the ordinary plane');
 for(const alpha of [0,.25,.5,1])for(const write of [false,true])for(const z of [10,6]){
  const p=make({alpha,write,z}),before=normal(),out=encoded(),expected=oracle([{alpha,write,z}]);
  check(Math.abs(at(out)[0]-expected[0])<=1&&Math.abs(at(out)[3]-expected[1])<=1,'avatar/particle depth blend '+JSON.stringify({alpha,write,z,actual:at(out),expected}));
  const edge=oracle([{alpha,write,z}],false);check(Math.abs(at(out,10)[0]-edge[0])<=1&&Math.abs(at(out,10)[3]-edge[1])<=1,'detached coverage mismatch');
  check(normal().every((v,i)=>v===before[i]),'normal rendering changed after depth pass');
  check(!p.materials.some(m=>m.userData.particleDofDepth?.particleDofDepthPass.value),'particle hook stayed enabled');clear();cases++;
 }
 for(const write of [false,true]){
  make({alpha:.5,write,z:10});make({alpha:.25,write:false,z:9,layer:1});const out=encoded(),expected=oracle([{alpha:.5,write,z:10},{alpha:.25,write:false,z:9}]);
  check(Math.abs(at(out)[0]-expected[0])<=1,'overlap order or depth-write mismatch');clear();cases++;
 }
 make({map:cutout,write:true});const holes=encoded();check(Math.abs(at(holes,20)[0]-128)<=1&&at(holes,44)[0]<110,'texture holes became solid depth');clear();
 // A hidden ancestor and an omitted request both exclude the particle.
 const hidden=make();hidden.anchor.visible=false;const base=encoded();hidden.anchor.visible=true;
 depth.render(scene,camera,avatar,focal,[]);const omitted=new Uint8Array(64*64*4);renderer.readRenderTargetPixels(depth.target,0,0,64,64,omitted);check(base.every((v,i)=>v===omitted[i]),'hidden/request filtering');
 // Render failure must restore every transient uniform, visibility and blend.
 const m=hidden.meshes[0].material[0],prior=[m.blendSrcAlpha,m.blendDstAlpha,m.blendEquationAlpha],render=renderer.render;
 renderer.render=()=>{throw Error('injected particle depth failure');};let caught=false;try{encoded();}catch(e){caught=e.message==='injected particle depth failure';}finally{renderer.render=render;}
 check(caught&&hidden.anchor.visible&&!m.userData.particleDofDepth.particleDofDepthPass.value&&prior.every((v,i)=>v===[m.blendSrcAlpha,m.blendDstAlpha,m.blendEquationAlpha][i]),'exception did not restore particle state');clear();
 // Existing/unsupported packets must keep their old exclusion behavior.
 for(const rule of [{dof_plane:undefined},{dof_plane:false},{type:'PCT_2D_PLANE'},{dual:true},{blend:['SRCALPHA','ONE']},{blend:['ONE','ONE'],dof_additive_plane:true},{depth_test:false}]){
  make({rule});check(encoded().every((v,i)=>v===omitted[i]),'unsupported particle entered depth '+JSON.stringify(rule));clear();
 }
 // Additive color keeps SRCALPHA/ONE, but audited depth uses alpha*red and
 // SRCALPHA/INVSRCALPHA. Black red-channel input contributes no DOF coverage.
 check(window.particleDofAdditiveRule.dof_additive_plane===true,'backend additive opt-in missing');
 let additiveCases=0;
 for(const red of [0,.4,1])for(const alpha of [0,.25,.5,1])for(const write of [false,true])for(const z of [10,6]){
  const rule={...window.particleDofAdditiveRule,depth_write:write},p=make({red,alpha,z,write,rule}),before=normal(),out=encoded();
  for(const [x,covered] of [[32,true],[10,false]]){const value=oracle([{red,alpha,z,write,additive:true}],covered);check(Math.abs(at(out,x)[0]-value[0])<=1&&Math.abs(at(out,x)[3]-value[1])<=1,'additive depth weighting '+JSON.stringify({red,alpha,z,write,actual:at(out,x),value}));}
  check(p.meshes[0].material.every(m=>m.blendDst===T.OneFactor&&!m.userData.particleDofDepth.particleDofAlphaRed.value),'additive RGB/uniform restoration failed');
  check(normal().every((v,i)=>v===before[i]),'additive color changed after depth');clear();additiveCases++;
 }
 make({red:.5,alpha:.5,map:tint,rule:window.particleDofAdditiveRule});
 const tinted=encoded(),tintedExpected=oracle([{red:.2,alpha:.5,z:10,additive:true}]);
 check(Math.abs(at(tinted)[0]-tintedExpected[0])<=1,'texture and instance red were not both applied to additive depth');clear();
 for(const write of [false,true]){
  make({red:0,alpha:.5,write,z:10,rule:{...window.particleDofAdditiveRule,depth_write:write}});make({alpha:.5,z:9,layer:1});
  const out=encoded(),value=oracle([{red:0,alpha:.5,write,z:10,additive:true},{alpha:.5,z:9}]);check(Math.abs(at(out)[0]-value[0])<=1,'zero red changed source hardware depth writes');clear();
 }
 const additive=make({rule:window.particleDofAdditiveRule}),am=additive.meshes[0].material[0],originalRender=renderer.render;
 renderer.render=()=>{throw Error('additive failure');};try{encoded();}catch(e){check(e.message==='additive failure','wrong injected error');}finally{renderer.render=originalRender;}
 check(am.blendDst===T.OneFactor&&!am.userData.particleDofDepth.particleDofAlphaRed.value&&!am.userData.particleDofDepth.particleDofDepthPass.value,'additive failure leaked state');clear();
 // End-to-end: an in-focus avatar remains unchanged by its own depth, while
 // a weakly covered foreground pattern responds when its depth is included.
 for(const rule of [{},window.particleDofAdditiveRule]){
 const active=make({alpha:.25,map:rule.dof_additive_plane?stripes:sourceMap||stripes,rule});const frame=()=>{renderer.setRenderTarget(null);effects.render(scene,camera,avatar,{bloom:false,dof:{enabled:true,focus:4,range:4,strength:1},occluders:active.meshes});return bytes();};
 active.meshes[0].userData.dofParticle=false;const without=frame();window.testCaptures=[{name:'particle-depth-excluded',body:renderer.domElement.toDataURL('image/png')}];
 active.meshes[0].userData.dofParticle=true;const withDepth=frame();window.testCaptures.push({name:'particle-depth-included',body:renderer.domElement.toDataURL('image/png')});
 check(withDepth.some((v,i)=>i%4!==3&&Math.abs(v-without[i])>1),'pipeline did not use particle depth');check(withDepth.every((v,i)=>i%4!==3||v===without[i]),'pipeline changed output alpha');
 clear();
 }
 check(cases===18&&additiveCases===48&&!errors.length&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'particle DOF GPU errors');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{clear();effects.dispose();depth.dispose();avatar.dispose();white.dispose();cutout.dispose();tint.dispose();stripes.dispose();sourceMap?.dispose();renderer.dispose();}
