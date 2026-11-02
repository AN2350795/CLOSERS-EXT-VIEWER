import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMaterialPreviewMap} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b,t=0)=>a.every((v,i)=>Math.abs(v-b[i])<=t),byte=v=>Math.round(Math.max(0,Math.min(1,v))*255);
const w=64,h=48,renderer=new T.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});renderer.setSize(w,h);renderer.setClearColor(0,0);renderer.outputColorSpace=T.LinearSRGBColorSpace;
const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const surface=[.2,.1,.05],tint=[1,.8,.4],texel=[255,128,64],grading={enabled:true,rgb:[.6,.8,.55],bcs:[-.2,.15,.8]},neutral={enabled:true,rgb:[1,1,1],bcs:[0,0,1]},sharpen={enabled:true,radius:1.55},dof={enabled:true,focus:4,range:4,strength:.65};
const model=buildModel({frames:[],meshes:[{name:'hdr',frame:-1,vertices:[-1,-1,0,1,-1,0,1,1,0,-1,1,0],indices:[0,1,2,0,2,3],uv:[0,0,1,0,1,1,0,1],skin:[],groups:[[0,6,0]],materials:[{color:[...surface,1],material_preview:{kind:'emissive',status:'approximate',color:[...tint,1],strength:1}}]}]});model.root.scale.z=1;scene.add(model.root);
const map=new T.DataTexture(new Uint8Array([...texel,255]),1,1);map.needsUpdate=true;setMaterialPreviewMap(model.materials[0],map);const fx=createEmissionRenderer(renderer),errors=[],floating=renderer.extensions.has('EXT_color_buffer_float');renderer.debug.onShaderError=()=>errors.push('shader');let cases=0;
const read=()=>{const p=new Uint8Array(w*h*4),gl=renderer.getContext();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
try{
 for(const gain of [.5,1,4]){
  model.materials[0].userData.materialPreview.uniforms.avatarEmissiveStrength.value=gain;
  const emission=texel.map((v,c)=>v/255*tint[c]*gain);
  for(const mode of ['off','viewer','source']){
   const options={bloom:mode!=='off',bloomMode:mode==='source'?'source':'viewer',strength:.8},draw=effects=>{fx.render(scene,camera,model,{...options,...effects});return read();};
   // Uniform input avoids any unknown raster/sampling footprint. The source
   // five-level path quantizes both surface and mask to UNORM8 before adding
   // its five constant layers; the viewer path retains HDR until composition.
   const rgb=surface.map((s,c)=>mode==='source'?byte(s)/255+5*(byte(emission[c])/255)*.8:mode==='viewer'?(floating?s+emission[c]:byte(s+emission[c])/255)+.8*(floating?emission[c]:byte(emission[c])/255):s+emission[c]);
   const bounded=new Uint8Array([...rgb.map(byte),255]),want=postReference.grade(bounded,grading),base=draw({});
   check(same(base.slice((24*w+32)*4,(24*w+32)*4+4),bounded,1),'uniform emission/bloom CPU fixture '+[gain,mode]);
   const variants=[{colorGrading:grading},{colorGrading:grading,sharpen},{colorGrading:grading,dof},{colorGrading:grading,sharpen,dof},{colorGrading:grading,sharpen:{...sharpen,radius:0}},{colorGrading:grading,dof:{...dof,strength:0}}];
   let first;
   for(const effects of variants){const actual=draw(effects),center=actual.slice((24*w+32)*4,(24*w+32)*4+4);check(same(center,want,2),'HDR clamp must precede grading '+[gain,mode,variants.indexOf(effects)]+': actual '+[...center]+' expected '+[...want]);if(!first)first=actual;else check(same(actual,first,2),'spatially uniform HDR changed when enabling neutral spatial effects');for(let i=3;i<actual.length;i+=4)check(actual[i]===base[i],'HDR effects changed alpha');cases++;}
   renderer.outputColorSpace=T.SRGBColorSpace;const encoded=draw({colorGrading:grading,sharpen,dof}),encode=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055,encodedWant=postReference.grade(bounded,grading,encode);renderer.outputColorSpace=T.LinearSRGBColorSpace;
   check(same(encoded.slice((24*w+32)*4,(24*w+32)*4+4),encodedWant,2),'HDR output transfer order');cases++;
   check(same(draw({}),base),'HDR effect OFF did not restore exact output');const solo=draw({solo:true});check(same(draw({solo:true,colorGrading:grading,sharpen,dof}),solo),'HDR postprocess altered emission-only diagnostic');
  }
 }
 // For translucent surfaces, clamp the fragment before blending into the
 // normal UNORM frame. A floating surface target would lose this behavior.
 const material=model.materials[0];material.transparent=true;material.opacity=.4;material.needsUpdate=true;
 const emission=texel.map((v,c)=>v/255*tint[c]*4),bounded=new Uint8Array([...surface.map((s,c)=>byte(Math.min(1,s+emission[c])*.4)),byte(.4)]),want=postReference.grade(bounded,grading);
 fx.render(scene,camera,model,{bloom:false});const transparentBase=read();check(same(transparentBase.slice((24*w+32)*4,(24*w+32)*4+4),bounded,1),'translucent pre-blend clipping fixture');
 for(const effects of [{},{sharpen},{dof},{sharpen,dof},{sharpen:{...sharpen,radius:0}},{dof:{...dof,strength:0}}]){fx.render(scene,camera,model,{bloom:false,colorGrading:grading,...effects});const actual=read();check(same(actual.slice((24*w+32)*4,(24*w+32)*4+4),want,2),'translucent HDR grading clamp');for(let i=3;i<actual.length;i+=4)check(actual[i]===transparentBase[i],'translucent HDR alpha changed');cases++;}
 material.transparent=false;material.opacity=1;material.needsUpdate=true;
 // With no bloom, neutral grading must preserve clipped per-sample MSAA
 // edges, including when no spatial effect actually runs.
 const mesh=model.meshes[0],positions=mesh.geometry.getAttribute('position');positions.setXYZ(0,-.83,-.77,0);positions.setXYZ(1,.87,-.61,0);positions.setXYZ(2,-.23,.87,0);positions.setXYZ(3,-.23,.87,0);positions.needsUpdate=true;
 const direct=()=>{fx.render(scene,camera,model,{bloom:false});return read();},base=direct();
 check(base.some((v,i)=>i%4===3&&v>0&&v<255),'HDR MSAA edge fixture unavailable');
 for(const effects of [{},{sharpen:{...sharpen,radius:0}},{dof:{...dof,strength:0}}]){fx.render(scene,camera,model,{bloom:false,colorGrading:neutral,...effects});check(same(read(),base,1),'neutral grading brightened HDR MSAA silhouette');cases++;}
 check(cases===72&&errors.length===0&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'HDR case count/GPU error');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{fx.dispose();model.dispose();map.dispose();renderer.dispose();renderer.forceContextLoss();}
