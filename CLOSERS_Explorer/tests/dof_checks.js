import * as T from '/vendor/three/three.module.min.js';
import {createDofPipeline,normalizeDof,dofFocal} from '/model-dof.js';
import {createEmissionRenderer} from '/model-emission.js';
import {buildModel} from '/model-core.js';
import {setupAvatarLighting} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b,t=0)=>a.every((v,i)=>Math.abs(v-b[i])<=t),$=id=>document.getElementById(id);
const w=32,h=24,renderer=new T.WebGLRenderer({alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true});renderer.setSize(w,h);renderer.outputColorSpace=T.LinearSRGBColorSpace;
const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const quad=new T.Mesh(new T.PlaneGeometry(2,2));scene.add(quad);const pipeline=createDofPipeline(renderer),fx=createEmissionRenderer(renderer),errors=[];renderer.debug.onShaderError=()=>errors.push('shader');
const read=t=>{const p=new Uint8Array(w*h*4);if(t)renderer.readRenderTargetPixels(t,0,0,w,h,p);else{const gl=renderer.getContext();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);}return p;};
const draw=(m,t)=>{quad.material=m;renderer.setRenderTarget(t);renderer.render(scene,camera);};
const image=new Uint8Array(w*h*4),depth=new Uint8Array(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;image.set([(x*37+y*11)%256,(x*7+y*53)%256,(x*23+y*17)%256,[0,64,128,255][(x+y)%4]],i);const d=x<10?32:x<20?128:191;depth.set([d,d,d,y<3?0:255],i);}
const make=(p)=>{const t=new T.DataTexture(p,w,h);t.minFilter=t.magFilter=T.LinearFilter;t.needsUpdate=true;return t;},color=make(image),encoded=make(depth);
// CPU reference uses normalized UV bilinear/clamp sampling, quantizing each
// intermediate to UNORM8 independently of the shader implementation.
function sample(p,width,height,u,v){const x=Math.max(0,Math.min(width-1,u*width-.5)),y=Math.max(0,Math.min(height-1,v*height-.5)),a=Math.floor(x),b=Math.floor(y),s=x-a,t=y-b,at=(xx,yy,c)=>p[(Math.min(height-1,yy)*width+Math.min(width-1,xx))*4+c]/255;return [0,1,2,3].map(c=>(at(a,b,c)*(1-s)+at(a+1,b,c)*s)*(1-t)+(at(a,b+1,c)*(1-s)+at(a+1,b+1,c)*s)*t);}
const unorm=v=>Math.round(Math.max(0,Math.min(1,v))*255);
function oracle(strength){
 let input=image,iw=w,ih=h;
 for(let level=1;level<=2;level++){
  const ow=Math.floor(w/2**level),oh=Math.floor(h/2**level);
  for(let axis=0;axis<2;axis++){
   const output=new Uint8Array(ow*oh*4);
   for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){
    const u=(x+.5)/ow,v=(y+.5)/oh,sum=[0,0,0,0];
    for(let k=-4;k<=4;k++){const tap=sample(input,iw,ih,u+(axis===0?k/ow:0),v+(axis===1?k/oh:0)),weight=Math.exp(-k*k/2)/Math.sqrt(6.2831854820251465);for(let c=0;c<4;c++)sum[c]+=tap[c]*weight;}
    if(level===1&&axis===0)sum[3]=sample(depth,w,h,u,v)[0];output.set(sum.map(unorm),(y*ow+x)*4);
   }input=output;iw=ow;ih=oh;
  }
 }
 const out=new Uint8Array(image),disc=[[0,0],[.527837,-.085868],[-.040088,.536087],[-.670445,-.179949],[-.419418,-.616039],[.440453,-.639399],[-.757088,.349334],[.574619,.685879]];
 for(let y=3;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4,u=(x+.5)/w,v=(y+.5)/h,d=depth[i]/255,r=Math.abs(d-.5),sum=[0,0,0];let total=0;
  for(const [dx,dy] of disc){const a=sample(input,iw,ih,u+dx*r*2/w,v+dy*r*2/h),b=sample(image,w,h,u+dx*r/w,v+dy*r/h);b[3]=sample(depth,w,h,u+dx*r/w,v+dy*r/h)[0];const factor=Math.abs(2*b[3]-1),mixed=b.map((n,c)=>n*(1-factor)+a[c]*factor),weight=mixed[3]>=d?1:Math.abs(2*mixed[3]-1);total+=weight;for(let c=0;c<3;c++)sum[c]+=mixed[c]*weight;}
  for(let c=0;c<3;c++)out[i+c]=unorm(image[i+c]/255*(1-strength)+(total>1e-6?sum[c]/total:image[i+c]/255)*strength);
 }return out;
}
let avatar,ui;
try{
 check(!normalizeDof(null).enabled&&!dofFocal(null),'default focus guessed');for(const focus of [0,-1,NaN,Infinity,'2'])check(!dofFocal({focus,range:2}),'invalid focus accepted');
 for(const strength of [0,.45,1]){pipeline.renderImages(color,encoded,w,h,{strength},draw);const actual=read(pipeline.result);check(same(actual,oracle(strength),2),'preblur/gather CPU oracle '+strength);for(let i=3;i<actual.length;i+=4)check(actual[i]===image[i],'alpha changed');check(same(actual.slice(0,w*3*4),image.slice(0,w*3*4)),'uncovered stage blurred');}
 avatar=buildModel({frames:[],meshes:[{name:'focus',frame:-1,vertices:[-1,-1,0,1,-1,0,1,1,0,-1,1,0],indices:[0,1,2,0,2,3],uv:[0,0,1,0,1,1,0,1],groups:[[0,6,0]],materials:[{color:[1,1,1,.6]}],skin:[]}]});avatar.root.scale.z=1;avatar.materials[0].map=color;avatar.materials[0].needsUpdate=true;const world=new T.Scene();world.add(avatar.root);renderer.setRenderTarget(null);
 const render=opts=>{fx.render(world,camera,avatar,{bloom:false,...opts});return read();},original=render({}),settings={enabled:true,focus:4,range:5,strength:1};
 const focused=render({dof:settings});check(!same(original,focused),'DOF-only render did not activate');for(let i=3;i<focused.length;i+=4)check(focused[i]===original[i],'integrated alpha changed');
 for(const dof of [null,{...settings,enabled:false},{...settings,strength:0},{...settings,focus:null}])check(same(render({dof}),original),'OFF did not restore exact output');
 render({dof:settings,sharpen:{enabled:true,radius:1},colorGrading:{enabled:true,rgb:[1,.8,.7],bcs:[0,0,1]}});check(errors.length===0,'shader compilation failed');
 // A failure in the extra depth pass must not leave the renderer redirected.
 const real=renderer.render,background=world.background;renderer.render=function(s,c){if(avatar.materials[0].userData.dofDepth?.avatarDofDepthPass.value)throw Error('depth failure');return real.call(this,s,c);};let failed=false;
 try{render({dof:settings});}catch(e){failed=e.message==='depth failure';}finally{renderer.render=real;}
 check(failed&&renderer.getRenderTarget()===null&&world.background===background&&!avatar.materials[0].userData.dofDepth.avatarDofDepthPass.value,'failure leaked state');check(same(render({}),original),'failure changed normal output');
 localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({sourceColor:true,dofVersion:1,dof:{enabled:!!window.restoreDof,focus:window.restoreDof?7:null,range:window.restoreDof?3:null,strength:.5}}));
 const state={model:avatar,data:{sources:[]}};ui=setupAvatarLighting({state,api:async()=>({profiles:[],color_grading_presets:[]}),element:(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;},getEmissionEnabled:()=>true});ui.updateCamera(camera);ui.refresh();
 const toggle=$('avatar-dof-enabled');check(toggle.checked===!!window.restoreDof&&!toggle.closest('details').open,'DOF default/restore or folded menu');$('avatar-dof-focus-model').click();check(Number($('avatar-dof-focus').value)===10&&Number($('avatar-dof-range').value)>0&&toggle.checked===!!window.restoreDof,'focus button enabled effect or wrong camera depth');
 if(!toggle.checked)toggle.click();check(ui.getRenderOptions().dof.enabled,'UI did not forward DOF');const change=(id,value)=>{const e=$(id);e.value=value;e.dispatchEvent(new Event('change'));};change('avatar-dof-focus','-1');check(ui.getRenderOptions().dof.focus===null&&$('avatar-dof-status').textContent.includes('초점'),'invalid input retained unsafe focus');
 $('avatar-dof-focus-model').click();$('avatar-emission-solo').click();check(ui.getRenderOptions().dof===null&&$('avatar-dof-status').textContent.includes('보류'),'solo did not pause');$('avatar-emission-solo').click();$('avatar-source-color').click();check(ui.getRenderOptions().dof===null&&toggle.disabled&&toggle.checked,'source off lost choice');$('avatar-source-color').click();
 const saved=JSON.parse(localStorage.getItem('closers-avatar-lighting-v2'));check(saved.dofVersion===1&&saved.dof.enabled&&saved.dof.focus===10,'DOF settings not saved');state.model=null;ui.refresh();check(toggle.disabled,'cleared avatar retained controls');
 renderer.setSize(37,29);render({dof:settings});pipeline.renderImages(color,encoded,37,29,{strength:1},draw);check(pipeline.result.width===37&&pipeline.result.height===29&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'resize failed');
 let released=0;pipeline.result.addEventListener('dispose',()=>released++);pipeline.dispose();pipeline.dispose();check(released===1,'DOF target not released exactly once');let refused=false;try{pipeline.renderImages(color,encoded,w,h,{},draw);}catch{refused=true;}check(refused,'disposed pipeline reused');renderer.setRenderTarget(null);
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{pipeline.dispose();pipeline.dispose();fx.dispose();avatar?.dispose();color.dispose();encoded.dispose();quad.geometry.dispose();renderer.dispose();renderer.forceContextLoss();}
