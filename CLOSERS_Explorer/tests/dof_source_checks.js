import * as T from '/vendor/three/three.module.min.js';
import {buildModel,setAvatarBaseMap} from '/model-core.js';
import {setMaterialPreviewMap,setMatcapPreviewMap,setMatcapNormalMap,setMatcapPreview} from '/model-materials.js';
import {createEmissionRenderer,applyAvatarColorSpace} from '/model-emission.js';
import {createDofDepthPass} from '/model-dof-depth.js';
import {dofFocal,supportsDofModel,measureDofFocus} from '/model-dof.js';
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b,t=0)=>a.every((v,i)=>Math.abs(v-b[i])<=t),side=384;
const renderer=new T.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});renderer.setSize(side,side);renderer.setClearColor(0,0);
const fx=createEmissionRenderer(renderer),depth=createDofDepthPass(renderer),maps=new Map(),loader=new T.TextureLoader(),gl=renderer.getContext(),errors=[];renderer.debug.onShaderError=()=>errors.push('shader');window.testCaptures=[];
const read=target=>{const p=new Uint8Array(side*side*4);if(target)renderer.readRenderTargetPixels(target,0,0,side,side,p);else gl.readPixels(0,0,side,side,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
const capture=name=>window.testCaptures.push({name,body:renderer.domElement.toDataURL('image/png')});
let current,grid;
try{
 for(const [id,file] of Object.entries(emissionFixture.images)){
  const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
  try{const map=await loader.loadAsync(url);map.flipY=false;map.wrapS=map.wrapT=T.RepeatWrapping;maps.set(Number(id),map);}finally{URL.revokeObjectURL(url);}
 }
 for(const fixture of emissionFixture.scenes){
  const model=current=buildModel(fixture.data),scene=new T.Scene();scene.add(model.root);
  for(const material of model.materials){
   const input=material.userData.input;if(input.image?.selected)setAvatarBaseMap(material,maps.get(input.image.selected));
   if(material.userData.materialPreview){const map=maps.get(input.material_preview.image?.selected);check(map,'missing real emissive texture');setMaterialPreviewMap(material,map);}
   if(fixture.gloss&&material.userData.matcapPreview){const cap=input.matcap_preview;setMatcapPreviewMap(material,maps.get(cap.image?.selected)||null);setMatcapNormalMap(material,maps.get(cap.normal_image?.selected)||null);setMatcapPreview(material,true,1,true);}
  }
  if(fixture.gloss)check(model.materials.some(m=>m.userData.matcapPreview?.uniforms.avatarMatcapEnabled.value>0),'real gloss/mask did not activate');
  const supported=supportsDofModel(model);
  applyAvatarColorSpace(renderer,new Map([...maps].map(([id,map])=>['base:'+id,map])),true);
  const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);const center=box.getCenter(new T.Vector3()),extent=box.getSize(new T.Vector3()).length();
  grid=new T.GridHelper(extent*2,20,0x606060,0x303030);grid.position.set(center.x,box.min.y,center.z);scene.add(grid);
  for(const [view,scale,azimuth] of [['front',1.45,0],['close-side',.95,.6]]){
   const camera=new T.PerspectiveCamera(40,1,.1,100000),distance=extent*scale;camera.position.copy(center).add(new T.Vector3(Math.sin(azimuth)*distance,distance*.12,Math.cos(azimuth)*distance));camera.lookAt(center);camera.updateMatrixWorld(true);
   const measured=measureDofFocus(model,camera);check(measured?.focus>0&&measured?.range>0,'real visible costume focus unavailable');
   const focus=measured.focus,sharp={enabled:true,focus,range:extent*2,strength:1},blur={enabled:true,focus:focus*.5,range:extent*.05,strength:1};
   for(const mode of ['off','viewer','source']){
    const options={bloom:mode!=='off',bloomMode:mode==='source'?'source':'viewer',strength:.8},prefix='dof-'+fixture.label+'-'+view+'-'+mode;
    const render=dof=>{fx.render(scene,camera,model,{...options,dof});return read();};
    const base=render(null);capture(prefix+'-base');const focused=render(sharp);const blurred=render(blur);capture(prefix+'-blur');
    if(!supported){
     check(model.materials.some(m=>m.userData.avatarAlphaOverlay),'unexpected unsupported source material '+prefix);
     check(same(base,focused)&&same(base,blurred),'unsupported source alpha DOF changed output '+prefix);
     window.dofSourceResults??=[];window.dofSourceResults.push({fixture:fixture.label,view,bloom:mode,supported:false,reason:'alpha-overlay'});continue;
    }
    const depthPixels=read(depth.render(scene,camera,model,dofFocal(blur)));renderer.setRenderTarget(null);
    let covered=0,outside=0,changed=0,focusDelta=0,blurDelta=0;
    for(let i=0;i<base.length;i+=4){
     // Direct MSAA framebuffer vs half-float resolve -> UNORM8 can round a
     // fractional edge alpha to neighboring bytes (e.g. 192 vs 191).
     check(Math.abs(base[i+3]-blurred[i+3])<=1&&Math.abs(base[i+3]-focused[i+3])<=1,'alpha changed '+prefix+' pixel '+i/4+': '+[base[i+3],focused[i+3],blurred[i+3]]);
     if(depthPixels[i+3]===0){outside++;for(let c=0;c<3;c++)check(Math.abs(blurred[i+c]-base[i+c])<=1,'background/grid/halo changed outside avatar '+prefix+' pixel '+i/4+' channel '+c+': '+[base[i+c],blurred[i+c]]);}
     else{covered++;let delta=0;for(let c=0;c<3;c++){focusDelta+=Math.abs(focused[i+c]-base[i+c]);const d=Math.abs(blurred[i+c]-base[i+c]);blurDelta+=d;delta+=d;}if(delta>6)changed++;}
    }
    check(covered>100&&outside>1000,'real model coverage absent '+prefix);check(changed>20&&blurDelta>focusDelta*1.2,'defocus not stronger than wide focus '+prefix+': '+JSON.stringify({covered,changed,focusDelta,blurDelta}));
    check(same(render({...blur,enabled:false}),base),'DOF OFF not exact '+prefix);check(grid.visible&&model.materials.every(m=>!m.userData.dofDepth.avatarDofDepthPass.value),'depth state leaked '+prefix);
    window.dofSourceResults??=[];window.dofSourceResults.push({fixture:fixture.label,view,bloom:mode,covered,changed,focusDelta,blurDelta});
   }
  }
  model.dispose();current=null;grid.geometry.dispose();grid.material.dispose();grid=null;
 }
 check(errors.length===0&&gl.getError()===gl.NO_ERROR,'real costume GPU errors');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{current?.dispose();if(grid){grid.geometry.dispose();grid.material.dispose();}for(const map of maps.values())map.dispose();depth.dispose();fx.dispose();renderer.dispose();renderer.forceContextLoss();}
