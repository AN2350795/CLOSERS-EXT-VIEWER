import * as T from '/vendor/three/three.module.min.js';
import {createEmissionRenderer} from '/model-emission.js';
import {createDofDepthPass} from '/model-dof-depth.js';
import {dofFocal} from '/model-dof.js';
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b,t=0)=>a.every((v,i)=>Math.abs(v-b[i])<=t),w=96,h=64;
const renderer=new T.WebGLRenderer({alpha:true,antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:true});renderer.setSize(w,h);renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.setClearColor(0,0);
const camera=new T.OrthographicCamera(-1.5,1.5,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const scene=new T.Scene(),root=new T.Group();scene.add(root);const geometry=new T.PlaneGeometry(2,1.5),pixels=new Uint8Array(8*8*4);
for(let y=0;y<8;y++)for(let x=0;x<8;x++)pixels.set([(x%2)*255,(y%2)*255,100,x<2?0:x<5?128:255],(y*8+x)*4);
const map=new T.DataTexture(pixels,8,8);map.needsUpdate=true;map.minFilter=map.magFilter=T.NearestFilter;
const front=new T.MeshBasicMaterial({map,transparent:true,opacity:.5,alphaTest:0}),mesh=new T.Mesh(geometry,front);root.add(mesh);
const back=new T.MeshBasicMaterial({map,transparent:true,opacity:.6,alphaTest:.1}),behind=new T.Mesh(geometry,back);behind.position.set(.4,0,-2);root.add(behind);behind.visible=false;
const model={root,materials:[front,back]},fx=createEmissionRenderer(renderer),depth=createDofDepthPass(renderer),settings={enabled:true,focus:3,range:2,strength:1};
const read=target=>{const p=new Uint8Array(w*h*4);if(target)renderer.readRenderTargetPixels(target,0,0,w,h,p);else{const gl=renderer.getContext();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);}return p;};
const render=dof=>{fx.render(scene,camera,model,{bloom:false,dof});return read();};
try{
 for(const opacity of [.25,.5,.75]){
  front.opacity=opacity;const original=render(null),blur=render(settings),encoded=read(depth.render(scene,camera,model,dofFocal(settings)));renderer.setRenderTarget(null);
  let translucent=0,holes=0,changed=0;
  for(let i=0;i<original.length;i+=4){check(Math.abs(original[i+3]-blur[i+3])<=1,'translucent alpha changed');if(original[i+3]>0&&original[i+3]<255)translucent++;if(original[i+3]===0){holes++;check(encoded[i+3]===0,'fully transparent texture wrote DOF coverage');}else if(Math.abs(original[i]-blur[i])>3)changed++;}
  check(translucent>100&&holes>100&&changed>30,'translucent fixture lacked opacity/cutouts/blur');check(same(render({...settings,enabled:false}),original),'OFF changed translucent output');
 }
 // Keep a patterned non-avatar layer behind the invisible model. DOF must
 // leave it intact instead of blurring it through false depth coverage.
 root.remove(behind);scene.add(behind);behind.visible=true;
 front.opacity=0;const empty=render(null),encoded=read(depth.render(scene,camera,model,dofFocal(settings)));renderer.setRenderTarget(null);check(encoded.every((v,i)=>i%4!==3||v===0),'zero opacity covered invisible model');check(same(render(settings),empty,1),'invisible model blurred background');scene.remove(behind);root.add(behind);
 // A transparent front layer must not hide the depth of a visible rear layer.
 const layerFocus={...settings,focus:10,range:8},rear=read(depth.render(scene,camera,model,dofFocal(layerFocus)));renderer.setRenderTarget(null);const x=64,y=32,pixel=(y*w+x)*4;check(rear[pixel+3]===255&&Math.abs(rear[pixel]-159)<=1,'transparent front occluded visible rear depth');
 front.opacity=.5;front.alphaTest=.1;front.needsUpdate=true;const original=render(null),blur=render(settings);for(let i=3;i<blur.length;i+=4)check(Math.abs(original[i]-blur[i])<=1,'overlapping layers changed composite alpha');check(same(render(null),original),'depth pass changed regular layer blending');
 const nearest=read(depth.render(scene,camera,model,dofFocal(layerFocus)));renderer.setRenderTarget(null);check(Math.abs(nearest[pixel]-128)<=1,'visible translucent front lost nearest depth');
 // The ordinary opaque shader forces alpha to one; opacity zero must not
 // erase this surface from the diagnostic pass when alphaTest is zero.
 behind.visible=false;front.transparent=false;front.opacity=0;front.alphaTest=0;front.needsUpdate=true;const opaque=render(null),opaqueDepth=read(depth.render(scene,camera,model,dofFocal(settings)));renderer.setRenderTarget(null);check(opaque[pixel+3]===255&&opaqueDepth[pixel+3]===255,'opaque alpha semantics changed');
 check(renderer.getContext().getError()===renderer.getContext().NO_ERROR,'transparency GPU error');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{fx.dispose();depth.dispose();front.dispose();back.dispose();map.dispose();geometry.dispose();renderer.dispose();renderer.forceContextLoss();}
