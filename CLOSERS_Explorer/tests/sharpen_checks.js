import * as T from '/vendor/three/three.module.min.js';
import {createEmissionRenderer} from '/model-emission.js';
import {normalizeSharpen} from '/model-sharpen.js';
import {buildModel} from '/model-core.js';
import {setupAvatarLighting} from '/model-lighting.js';
import {setMaterialPreviewMap,setMatcapNormalMap} from '/model-materials.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id),width=16,height=12;
// Independent bilinear/clamp sampling in integer pixel coordinates.
function oracle(input,w,h,radius,grade=null){
 const p=new Uint8Array(input.length),sample=(x,y,c)=>{x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));const a=Math.floor(x),b=Math.floor(y),u=x-a,v=y-b,at=(xx,yy)=>input[(Math.min(h-1,yy)*w+Math.min(w-1,xx))*4+c]/255;return (at(a,b)*(1-u)+at(a+1,b)*u)*(1-v)+(at(a,b+1)*(1-u)+at(a+1,b+1)*u)*v;};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const index=(y*w+x)*4,rgb=[];
  for(let c=0;c<3;c++){let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)sum+=sample(x+dx*radius,y+dy*radius,c);rgb[c]=Math.round(255*Math.max(0,Math.min(1,2*input[index+c]/255-sum/8)))/255;}
  if(grade){const tint=rgb.map((v,c)=>((v+grade.bcs[0]-.5)*Math.max(1+grade.bcs[1],0)+.5)*grade.rgb[c]),luma=tint[0]*.2125+tint[1]*.7154+tint[2]*.0721;rgb.splice(0,3,...tint.map(v=>Math.max(0,Math.min(1,luma+grade.bcs[2]*(v-luma)))));}
  for(let c=0;c<3;c++)p[index+c]=Math.round(rgb[c]*255);p[index+3]=input[index+3];
 }return p;
}
const renderer=new T.WebGLRenderer({alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true});renderer.setSize(width,height);renderer.outputColorSpace=T.LinearSRGBColorSpace;
const camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const values=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;values[i]=(x*37+y*19)%256;values[i+1]=(x*13+y*53)%256;values[i+2]=(x*71+y*7)%256;values[i+3]=[64,128,255][(x+y)%3];}
const texture=new T.DataTexture(values,width,height);texture.needsUpdate=true;texture.minFilter=texture.magFilter=T.NearestFilter;
const geometry=new T.PlaneGeometry(2,2),material=new T.ShaderMaterial({blending:T.NoBlending,uniforms:{image:{value:texture}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,vUv);}'});
const scene=new T.Scene(),root=new T.Mesh(geometry,material);scene.add(root);const model={root,materials:[material]},fx=createEmissionRenderer(renderer);
const read=()=>{const size=renderer.getDrawingBufferSize(new T.Vector2()),p=new Uint8Array(size.x*size.y*4),gl=renderer.getContext();gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},draw=options=>{fx.render(scene,camera,model,{bloom:false,...options});return read();};
const same=(a,b,tolerance=0)=>a.every((v,i)=>Math.abs(v-b[i])<=tolerance);let uiModel,emissionMap,bump;
try{
 for(const radius of [-1,6,NaN,Infinity,'1',null])check(normalizeSharpen({enabled:true,radius}).radius===0,'invalid radius guessed');
 check(normalizeSharpen({enabled:true,radius:0}).radius===0&&normalizeSharpen({enabled:1,radius:2}).enabled===false,'zero or enabled normalization');
 const original=draw({});check(same(original,values),'deterministic raw input fixture');
 for(const radius of [.5,1,1.55,5]){
  const actual=draw({sharpen:{enabled:true,radius}}),expected=oracle(original,width,height,radius);
  check(same(actual,expected,1),'eight-neighbor radius oracle '+radius);
  for(let i=3;i<actual.length;i+=4)check(actual[i]===original[i],'sharpen changed alpha');
 }
 check(!same(draw({sharpen:{enabled:true,radius:1}}),draw({sharpen:{enabled:true,radius:1.55}})),'coefficient treated as fixed-radius gain');
 for(const sharpen of [{enabled:false,radius:3},{enabled:true,radius:0},null])check(same(draw({sharpen}),original),'OFF/zero not exact');
 const grade={enabled:true,rgb:[.7,1.1,1.3],bcs:[.08,.25,.6]};
 check(same(draw({sharpen:{enabled:true,radius:1.55},colorGrading:grade}),oracle(original,width,height,1.55,grade),1),'sharpen UNORM8 must precede grading');
 const output=new T.WebGLRenderTarget(width,height),clear=renderer.getClearColor(new T.Color()).clone(),alpha=renderer.getClearAlpha();renderer.setRenderTarget(output);draw({sharpen:{enabled:true,radius:2}});check(renderer.getRenderTarget()===output&&renderer.getClearColor(new T.Color()).equals(clear)&&renderer.getClearAlpha()===alpha,'sharpen leaked renderer state');renderer.setRenderTarget(null);output.dispose();
 renderer.setSize(20,8);check(read().length===20*8*4,'resize readback');draw({sharpen:{enabled:true,radius:2}});check(renderer.getContext().getError()===renderer.getContext().NO_ERROR,'sharpen resize failed');renderer.setSize(width,height);
 // Real avatar emission: sharpen the completed bloom image; solo bypasses it.
 const identity=new T.Matrix4().toArray();uiModel=buildModel({frames:Array.from({length:5},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[{name:'mesh',source_id:1,frame:-1,vertices:[-1,-1,0,1,-1,0,0,1,0],indices:[0,1,2],uv:[0,0,1,0,0,1],groups:[[0,3,0]],materials:[{color:[.15,.3,.5,1],matcap_preview:{kind:'matcap',status:'approximate'},material_preview:{kind:'emissive',status:'approximate',color:[1,.5,.25,1],strength:.2}}],skin:Array.from({length:5},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[.2,.2,.2]}))}]});
 emissionMap=new T.DataTexture(new Uint8Array([128,64,32,255]),1,1);emissionMap.needsUpdate=true;setMaterialPreviewMap(uiModel.materials[0],emissionMap);const avatarScene=new T.Scene();uiModel.root.scale.z=1;avatarScene.add(uiModel.root);
 fx.render(avatarScene,camera,uiModel,{bloom:true,strength:.8});const bloom=read();fx.render(avatarScene,camera,uiModel,{bloom:true,strength:.8,sharpen:{enabled:true,radius:1}});check(same(read(),oracle(bloom,width,height,1),2),'sharpen must follow emission/bloom');
 fx.render(avatarScene,camera,uiModel,{solo:true,bloom:true});const solo=read();fx.render(avatarScene,camera,uiModel,{solo:true,bloom:true,sharpen:{enabled:true,radius:2},colorGrading:grade});check(same(read(),solo),'solo diagnostics sharpened');
 localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({sourceColor:true,sharpenVersion:1,sharpen:{enabled:!!window.restoreSharpen,radius:window.restoreSharpen?1.5:0}}));
 const state={model:uiModel,data:{sources:[]}},presets=[{key:'1',label:'Source sharp',scope:'color-grading-only',source_enabled:true,rgb:[1,1,1],bcs:[0,0,1],other_postprocess:{sharpen:{status:'source-verified',value:1.5499999523162842}}},{key:'bad',label:'Unverified sharp',scope:'color-grading-only',rgb:[1,1,1],bcs:[0,0,1],other_postprocess:{sharpen:{status:'unavailable',value:2}}}];
 const ui=setupAvatarLighting({state,api:async()=>({profiles:[],color_grading_presets:presets}),element:(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;},getEmissionEnabled:()=>true});
 $('open-avatar-lighting').click();for(let i=0;i<100&&$('avatar-grade-preset').options.length<3;i++)await new Promise(r=>setTimeout(r,10));
 const toggle=$('avatar-sharpen-enabled'),radius=$('avatar-sharpen-radius'),change=(e,v)=>{e.value=v;e.dispatchEvent(new Event('change'));};check(toggle.checked===!!window.restoreSharpen&&radius.value===(window.restoreSharpen?'1.5':'0'),'sharpen default/restoration');
 if(toggle.checked)toggle.click();const bloomChoice=$('avatar-emission-bloom').checked,gradeChoice=$('avatar-grade-enabled').checked;change($('avatar-grade-preset'),'1');$('avatar-sharpen-preset').click();check(!toggle.checked&&Number(radius.value)===1.5499999523162842&&$('avatar-emission-bloom').checked===bloomChoice&&$('avatar-grade-enabled').checked===gradeChoice,'preset copied more than radius');
 toggle.click();check(ui.getRenderOptions().sharpen.enabled&&ui.getRenderOptions().sharpen.radius===1.5499999523162842,'render options lost radius');
 change(radius,'9');check(Number(radius.value)===1.5499999523162842,'invalid input changed radius');change($('avatar-grade-preset'),'bad');check($('avatar-sharpen-preset').disabled,'unverified preset allowed');
 $('avatar-emission-solo').click();check(ui.getRenderOptions().sharpen===null&&$('avatar-sharpen-status').textContent.includes('보류'),'solo did not suspend sharpen');$('avatar-emission-solo').click();
 bump=new T.DataTexture(new Uint8Array([128,128,255,128]),1,1);bump.needsUpdate=true;setMatcapNormalMap(uiModel.materials[0],bump);ui.refresh();$('avatar-matcap-mask-only').click();check(ui.getRenderOptions().sharpen===null,'mask inspection sharpened');$('avatar-matcap-mask-only').click();
 $('avatar-source-color').click();check(ui.getRenderOptions().sharpen===null&&toggle.disabled&&toggle.checked,'raw OFF lost or applied preference');$('avatar-source-color').click();
 $('avatar-sharpen-reset').click();check(radius.value==='0'&&toggle.checked,'zero reset changed enabled preference');state.model=null;ui.refresh();check(toggle.disabled&&ui.getRenderOptions().sharpen===null,'clear retained sharpen');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{uiModel?.dispose();emissionMap?.dispose();bump?.dispose();fx.dispose();texture.dispose();material.dispose();geometry.dispose();renderer.dispose();renderer.forceContextLoss();}
