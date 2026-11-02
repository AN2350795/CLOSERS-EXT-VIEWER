import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMaterialPreviewMap} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b,t=0)=>a.every((v,i)=>Math.abs(v-b[i])<=t);
const renderer=new T.WebGLRenderer({alpha:true,antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:true});renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.setClearColor(0,0);
const fx=createEmissionRenderer(renderer),scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const grading={enabled:true,rgb:[.62,1.23,.86],bcs:[.08,.35,.55]},sharpen={enabled:true,radius:1.55},dof={enabled:true,focus:4,range:4,strength:.65};
const errors=[];renderer.debug.onShaderError=()=>errors.push('shader');let model,baseMap,emissionMap;let cases=0;
try{
 for(const [w,h] of [[45,33],[51,37]]){
  renderer.setSize(w,h);const colors=new Uint8Array(w*h*4),emission=new Uint8Array(w*h*4),depth=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   // Keep surface + emission below one so the captured UNORM input does not
   // lose HDR values before the CPU reference begins. Clipping introduced by
   // sharpening/grading is still included in the independent calculations.
   const i=(y*w+x)*4,alpha=[0,64,128,255][(Math.floor(x/3)+Math.floor(y/4))%4];colors.set([(x*37+y*11)%181,(x*7+y*53)%181,(x*23+y*17)%181,alpha],i);
   emission.set([(x+y)%7===0?180:0,(x+y)%7===0?75:0,0,255],i);
   // Analytical view distances 1/4/10 and focal [0,4,8,.5] encode to
   // UNORM bytes 32/128/191. Alpha-test holes do not write coverage.
   const d=alpha===0?128:[32,128,191][Math.floor(x/(w/3))];depth.set([d,d,d,alpha===0?0:255],i);
  }
  const meshes=[9,6,0].map((z,i)=>{const left=-1+i*2/3,right=left+2/3;return {name:'depth-'+i,frame:-1,vertices:[left,-1,z,right,-1,z,right,1,z,left,1,z],indices:[0,1,2,0,2,3],uv:[i/3,0,(i+1)/3,0,(i+1)/3,1,i/3,1],skin:[],groups:[[0,6,0]],materials:[{color:[1,1,1,.8],material_preview:{kind:'emissive',status:'approximate',color:[1,.5,.2,1],strength:.2}}]};});
  model=buildModel({frames:[],meshes});model.root.scale.z=1;scene.add(model.root);
  baseMap=new T.DataTexture(colors,w,h);baseMap.needsUpdate=true;emissionMap=new T.DataTexture(emission,w,h);emissionMap.needsUpdate=true;
  for(const m of model.materials){m.map=baseMap;m.needsUpdate=true;setMaterialPreviewMap(m,emissionMap);}
  const read=()=>{const out=new Uint8Array(w*h*4),gl=renderer.getContext();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,out);return out;};
  for(const mode of ['off','viewer','source']){
   const bloom={bloom:mode!=='off',bloomMode:mode==='source'?'source':'viewer',strength:.8},draw=options=>{fx.render(scene,camera,model,{...bloom,...options});return read();};
   // Bloom is tested separately. Capture its completed image as the input to
   // the independent CPU reference for the following three effects.
   const original=draw({});
   const expected=(bits,strength=.65)=>{let p=original;if(bits&4)p=postReference.sharpen(p,w,h,sharpen.radius);if(bits&2)p=postReference.dof(p,depth,w,h,strength);if(bits&1)p=postReference.grade(p,grading);return p;};
   for(const [bits,strength] of [...Array.from({length:8},(_,i)=>[i,.65]),[7,0],[7,1]]){
    const options={sharpen:{...sharpen,enabled:!!(bits&4)},dof:{...dof,enabled:!!(bits&2),strength},colorGrading:{...grading,enabled:!!(bits&1)}},actual=draw(options),wanted=expected(bits,strength);
    let max=0,at=0;for(let i=0;i<actual.length;i++)if(Math.abs(actual[i]-wanted[i])>max){max=Math.abs(actual[i]-wanted[i]);at=i;}
    check(max<=2,'postprocess CPU order '+[w,h,mode,bits,strength]+' max '+max+' channel '+at+': '+[actual[at],wanted[at]]);
    for(let i=3;i<actual.length;i+=4)check(Math.abs(actual[i]-original[i])<=1,'combined effects changed alpha');cases++;
   }
   const all=expected(7),wrongEdge=postReference.grade(postReference.sharpen(postReference.dof(original,depth,w,h,.65),w,h,sharpen.radius),grading),wrongGrade=postReference.dof(postReference.sharpen(postReference.grade(original,grading),w,h,sharpen.radius),depth,w,h,.65);
   check(!same(all,wrongEdge,5)&&!same(all,wrongGrade,5),'fixture cannot distinguish incorrect effect orders');
   // Intermediate UNORM stages remain linear even when the final destination
   // is sRGB. The transfer must happen once, after the last color correction.
   const beforeGrade=postReference.dof(postReference.sharpen(original,w,h,sharpen.radius),depth,w,h,.65),encode=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
   renderer.outputColorSpace=T.SRGBColorSpace;const encoded=draw({sharpen,dof,colorGrading:grading});renderer.outputColorSpace=T.LinearSRGBColorSpace;
   check(same(encoded,postReference.grade(beforeGrade,grading,encode),2),'final output transfer missing, repeated or before grading');cases++;
   check(same(draw({}),original),'combined effect preferences leaked into OFF frame');
   const solo=draw({solo:true});check(same(draw({solo:true,sharpen,dof,colorGrading:grading}),solo),'combined effects modified emission-only diagnostic');
  }
  scene.remove(model.root);model.dispose();model=null;baseMap.dispose();baseMap=null;emissionMap.dispose();emissionMap=null;
 }
 check(cases===66&&errors.length===0&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'combined GPU cases/error');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{model?.dispose();baseMap?.dispose();emissionMap?.dispose();fx.dispose();renderer.dispose();renderer.forceContextLoss();}
