import * as T from '/vendor/three/three.module.min.js';
import {createEmissionRenderer} from '/model-emission.js';
import {createDofDepthPass} from '/model-dof-depth.js';
import {dofFocal} from '/model-dof.js';
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>a.every((v,i)=>v===b[i]);
const renderer=new T.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.setClearColor(0,0);
const camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const scene=new T.Scene(),geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([-.83,-.77,0,.87,-.61,0,-.23,.87,0],3));geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,1],2));
const texture=new T.DataTexture(new Uint8Array([255,255,255,255,255,255,255,0,255,255,255,255,255,255,255,255]),2,2);texture.needsUpdate=true;
// RGB above one models an emissive surface before framebuffer saturation.
// At fractional silhouette coverage, resolving HDR before clamping would
// brighten pixels whose center is outside both the triangle and alpha cutout.
const material=new T.MeshBasicMaterial({color:new T.Color(4,.3,.1),map:texture,alphaTest:.1}),root=new T.Mesh(geometry,material),model={root,materials:[material]};scene.add(root);
const fx=createEmissionRenderer(renderer),depth=createDofDepthPass(renderer),settings={enabled:true,focus:3,range:2,strength:1};
try{
 check(renderer.getContext().getContextAttributes().antialias,'MSAA fixture unavailable');
 for(const [width,height] of [[96,64],[123,79]]){
  renderer.setSize(width,height);const read=target=>{const p=new Uint8Array(width*height*4);if(target)renderer.readRenderTargetPixels(target,0,0,width,height,p);else{const gl=renderer.getContext();gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,p);}return p;};
  for(const bloom of [false,true]){
   const render=dof=>{fx.render(scene,camera,model,{bloom,dof});return read();},base=render(null),blur=render(settings),coverage=read(depth.render(scene,camera,model,dofFocal(settings)));renderer.setRenderTarget(null);
   let fractionalOutside=0,changed=0;
   for(let i=0;i<base.length;i+=4){
    check(Math.abs(base[i+3]-blur[i+3])<=1,'MSAA alpha changed');
    if(coverage[i+3]===0){if(base[i+3]>0&&base[i+3]<255)fractionalOutside++;for(let c=0;c<3;c++)check(Math.abs(base[i+c]-blur[i+c])<=1,'HDR resolve brightened an uncovered edge');}
    else if(Math.abs(base[i]-blur[i])>2)changed++;
   }
   check(fractionalOutside>5&&changed>10,'fixture did not exercise MSAA silhouette/cutout and DOF');check(same(render({...settings,enabled:false}),base),'DOF OFF did not restore direct output');
  }
 }
 check(renderer.getContext().getError()===renderer.getContext().NO_ERROR,'DOF MSAA/resize GPU error');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{depth.dispose();fx.dispose();texture.dispose();material.dispose();geometry.dispose();renderer.dispose();renderer.forceContextLoss();}
