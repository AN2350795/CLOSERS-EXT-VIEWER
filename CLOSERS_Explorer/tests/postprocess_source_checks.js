import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMaterialPreviewMap} from '/model-materials.js';
import {createEmissionRenderer,applyAvatarColorSpace} from '/model-emission.js';
import {createDofDepthPass} from '/model-dof-depth.js';
import {measureDofFocus,dofFocal} from '/model-dof.js';
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b,t=0)=>a.every((v,i)=>Math.abs(v-b[i])<=t),side=256;
const renderer=new T.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});renderer.setSize(side,side);renderer.setClearColor(0,0);
const fx=createEmissionRenderer(renderer),depth=createDofDepthPass(renderer),loader=new T.TextureLoader(),maps=new Map(),errors=[];renderer.debug.onShaderError=()=>errors.push('shader');window.testCaptures=[];
const grade={enabled:true,rgb:[.7,.8,.6],bcs:[-.1,.15,.8]},neutral={enabled:true,rgb:[1,1,1],bcs:[0,0,1]},sharpen={enabled:true,radius:1.55};
const read=target=>{const p=new Uint8Array(side*side*4);if(target)renderer.readRenderTargetPixels(target,0,0,side,side,p);else{const gl=renderer.getContext();gl.readPixels(0,0,side,side,gl.RGBA,gl.UNSIGNED_BYTE,p);}return p;};
const capture=name=>window.testCaptures.push({name,body:renderer.domElement.toDataURL('image/png')});
let model,grid,cases=0;
try{
 for(const [id,file] of Object.entries(emissionFixture.images)){
  const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
  try{const map=await loader.loadAsync(url);map.flipY=false;map.wrapS=map.wrapT=T.RepeatWrapping;maps.set(Number(id),map);}finally{URL.revokeObjectURL(url);}
 }
 applyAvatarColorSpace(renderer,new Map([...maps].map(([id,map])=>['base:'+id,map])),true);
 for(const fixture of emissionFixture.scenes){
  model=buildModel(fixture.data);const scene=new T.Scene();scene.add(model.root);
  for(const material of model.materials){const input=material.userData.input;if(input.image?.selected){material.map=maps.get(input.image.selected);material.color.set(0xffffff);material.needsUpdate=true;}if(material.userData.materialPreview){const map=maps.get(input.material_preview.image?.selected);check(map,'real emission texture missing');setMaterialPreviewMap(material,map);}}
  const emissions=model.materials.filter(m=>m.userData.materialPreview).map(m=>m.userData.materialPreview.uniforms);check(emissions.some(u=>u.avatarMaterialEnabled.value>0),'real emission not active');const native=emissions.map(u=>u.avatarEmissiveStrength.value);
  const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),extent=box.getSize(new T.Vector3()).length(),distance=extent*1.45,camera=new T.PerspectiveCamera(40,1,.1,100000);camera.position.copy(center).add(new T.Vector3(0,distance*.12,distance));camera.lookAt(center);camera.updateMatrixWorld(true);
  grid=new T.GridHelper(extent*2,20,0x606060,0x303030);grid.position.set(center.x,box.min.y,center.z);scene.add(grid);
  const measured=measureDofFocus(model,camera);check(measured,'real focus unavailable');const dof={enabled:true,focus:measured.focus*.5,range:extent*.05,strength:.65};
  const encodedDepth=read(depth.render(scene,camera,model,dofFocal(dof)));renderer.setRenderTarget(null);
  for(const gain of [1,4]){
   emissions.forEach((u,i)=>u.avatarEmissiveStrength.value=native[i]*gain);
   for(const mode of ['off','viewer','source']){
    const prefix='post-'+fixture.label+'-'+(gain===1?'native':'stress4')+'-'+mode,options={bloom:mode!=='off',bloomMode:mode==='source'?'source':'viewer',strength:.8},draw=effects=>{fx.render(scene,camera,model,{...options,...effects});return read();};
    const original=draw({});capture(prefix+'-base');
    // Rasterization and depth are tested separately. These real GPU images
    // seed independent CPU calculations for every following postprocess.
    const edge=postReference.sharpen(original,side,side,sharpen.radius),focus=postReference.dof(original,encodedDepth,side,side,dof.strength),edgeFocus=postReference.dof(edge,encodedDepth,side,side,dof.strength),graded=postReference.grade(original,grade);
    check(!same(graded,postReference.grade(edgeFocus,grade),3),'real fixture did not exercise spatial effects '+prefix);
    const verify=(effects,wanted,name,tolerance=2)=>{const actual=draw(effects);let max=0,at=0;for(let i=0;i<actual.length;i++)if(Math.abs(actual[i]-wanted[i])>max){max=Math.abs(actual[i]-wanted[i]);at=i;}check(max<=tolerance,prefix+' '+name+' max '+max+' channel '+at+': '+[actual[at],wanted[at]]);for(let i=3;i<actual.length;i+=4)check(Math.abs(actual[i]-original[i])<=1,prefix+' alpha changed');cases++;return actual;};
    verify({colorGrading:neutral},original,'neutral grading',1);
    const gradeOnly=verify({colorGrading:grade},graded,'grading');capture(prefix+'-grade');
    verify({colorGrading:grade,sharpen},postReference.grade(edge,grade),'edge then grading');
    verify({colorGrading:grade,dof},postReference.grade(focus,grade),'DOF then grading');
    const linearAll=verify({colorGrading:grade,sharpen,dof},postReference.grade(edgeFocus,grade),'all effects');capture(prefix+'-all');
    check(same(verify({colorGrading:grade,sharpen:{...sharpen,radius:0}},graded,'edge radius zero'),gradeOnly),'zero edge changed graded output');
    check(same(verify({colorGrading:grade,dof:{...dof,strength:0}},graded,'DOF strength zero'),gradeOnly),'zero DOF changed graded output');
    // A linear framebuffer byte represents an interval of +/- .5/255.
    // Transform that interval, rather than amplifying reference rounding at
    // dark pixels through sRGB and relaxing every channel's tolerance.
    const encode=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;renderer.outputColorSpace=T.SRGBColorSpace;const encoded=draw({colorGrading:grade,sharpen,dof});renderer.outputColorSpace=T.LinearSRGBColorSpace;
    for(let i=0;i<encoded.length;i++){if(i%4===3){check(Math.abs(encoded[i]-original[i])<=1,'encoded alpha changed '+prefix);continue;}const low=Math.round(encode(Math.max(0,linearAll[i]-.5)/255)*255)-1,high=Math.round(encode(Math.min(255,linearAll[i]+.5)/255)*255)+1;check(encoded[i]>=low&&encoded[i]<=high,'final transfer outside linear quantization interval '+prefix+' channel '+i+': '+[encoded[i],low,high]);}cases++;
    check(same(draw({}),original),'OFF failed exact restoration '+prefix);check(grid.visible&&renderer.getRenderTarget()===null&&model.materials.every(m=>!m.userData.avatarLighting.avatarEmissionPass.value&&!m.userData.dofDepth.avatarDofDepthPass.value),'postprocess leaked state '+prefix);
   }
  }
  model.dispose();model=null;grid.geometry.dispose();grid.material.dispose();grid=null;
 }
 check(cases===96&&errors.length===0&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'real postprocess cases/GPU error');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{model?.dispose();if(grid){grid.geometry.dispose();grid.material.dispose();}for(const map of maps.values())map.dispose();depth.dispose();fx.dispose();renderer.dispose();renderer.forceContextLoss();}
