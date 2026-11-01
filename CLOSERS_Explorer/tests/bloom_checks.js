import * as T from '/vendor/three/three.module.min.js';
import {createSourceBloom} from '/model-bloom.js';
import {createEmissionRenderer} from '/model-emission.js';
import {buildModel} from '/model-core.js';
import {setMaterialPreviewMap,setMaterialPreview} from '/model-materials.js';
import {setupAvatarLighting} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id);
// Independent pixel-center bilinear/clamp and UNORM8 oracle for each pass.
function pass(input,iw,ih,w,h,vertical){
 const output=new Uint8Array(w*h*4),sample=(x,y,c)=>{x=Math.max(0,Math.min(iw-1,x));y=Math.max(0,Math.min(ih-1,y));const a=Math.floor(x),b=Math.floor(y),u=x-a,v=y-b,at=(xx,yy)=>input[(Math.min(ih-1,yy)*iw+Math.min(iw-1,xx))*4+c];return (at(a,b)*(1-u)+at(a+1,b)*u)*(1-v)+(at(a,b+1)*(1-u)+at(a+1,b+1)*u)*v;};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const index=(y*w+x)*4;for(let c=0;c<3;c++){let sum=0;for(let k=-4;k<=4;k++)sum+=sample((x+.5+(vertical?0:k))*iw/w-.5,(y+.5+(vertical?k:0))*ih/h-.5,c)*Math.exp(-k*k/2)/Math.sqrt(6.2831854820251465);output[index+c]=Math.round(Math.max(0,Math.min(255,sum)));}output[index+3]=255;
 }return output;
}
const renderer=new T.WebGLRenderer({alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true});renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.setSize(65,49);let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
const camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const quadScene=new T.Scene(),geometry=new T.PlaneGeometry(2,2),quad=new T.Mesh(geometry);quad.frustumCulled=false;quad.material.dispose();quadScene.add(quad);
const source=createSourceBloom();const textureValues=new Uint8Array(65*49*4);for(let y=0;y<49;y++)for(let x=0;x<65;x++){const i=(y*65+x)*4;textureValues[i]=(x*17+y*3)%256;textureValues[i+1]=(x*7+y*11)%256;textureValues[i+2]=x>25&&x<40&&y>16&&y<32?255:0;textureValues[i+3]=128;}
const texture=new T.DataTexture(textureValues,65,49);texture.needsUpdate=true;
const fill=new T.ShaderMaterial({depthTest:false,depthWrite:false,blending:T.NoBlending,uniforms:{image:{value:texture}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'varying vec2 vUv;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,vUv);}'});
const readTarget=t=>{const p=new Uint8Array(t.width*t.height*4);renderer.readRenderTargetPixels(t,0,0,t.width,t.height,p);return p;},draw=(m,t)=>{quad.material=m;renderer.setRenderTarget(t);renderer.render(quadScene,camera);};
let model,fx,emission;
try{
 check(!source.resize(31,49),'zero source targets were invented');check(source.resize(65,49),'valid dimensions rejected');draw(fill,source.mask);
 let expected=textureValues,iw=65,ih=49,passIndex=0;
 source.render((material,target)=>{
  const level=Math.floor(passIndex/2),w=Math.floor(65/2**(level+1)),h=Math.floor(49/2**(level+1));
  check(target.width===w&&target.height===h&&target.texture.type===T.UnsignedByteType,'target dimensions/type');
  expected=pass(expected,iw,ih,w,h,passIndex%2===1);draw(material,target);const actual=readTarget(target);
  check(actual.every((v,i)=>Math.abs(v-expected[i])<=2),'progressive nine-tap UNORM oracle at pass '+passIndex);
  iw=w;ih=h;passIndex++;
 });check(passIndex===10,'five pairs not rendered');
 let released=0;source.base.addEventListener('dispose',()=>released++);source.mask.addEventListener('dispose',()=>released++);source.resize(96,64);check(released===2,'resize retained old allocations');source.dispose();
 renderer.setRenderTarget(null);renderer.setSize(64,64);renderer.setClearColor(0,0);
 const scene=new T.Scene();model=buildModel({frames:[],meshes:[{name:'surface',frame:-1,vertices:[-1,-1,0,1,-1,0,1,1,0,-1,1,0],indices:[0,1,2,0,2,3],uv:[0,0,1,0,1,1,0,1],skin:[],groups:[[0,6,0]],materials:[{color:[.1,.15,.2,.5],material_preview:{kind:'emissive',status:'approximate',color:[1,1,1,1],strength:1}}]}]});model.root.scale.z=1;scene.add(model.root);model.materials[0].blending=T.NoBlending;
 emission=new T.DataTexture(new Uint8Array([24,12,6,255]),1,1);emission.needsUpdate=true;setMaterialPreviewMap(model.materials[0],emission);fx=createEmissionRenderer(renderer);
 const capture=options=>{fx.render(scene,camera,model,options);const p=new Uint8Array(64*64*4),gl=renderer.getContext();gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
 setMaterialPreview(model.materials[0],false);const surface=capture({bloom:false});setMaterialPreview(model.materials[0],true);
 const plain=capture({bloom:false}),zero=capture({bloom:true,bloomMode:'source',strength:0}),five=capture({bloom:true,bloomMode:'source',strength:1});
 check(zero.every((v,i)=>Math.abs(v-surface[i])<=1),'emission was already added to source surface');check(plain[0]>zero[0],'surface/emission separation fixture is ineffective');
 for(let i=0;i<five.length;i+=4){for(let c=0;c<3;c++)check(Math.abs(five[i+c]-Math.min(255,surface[i+c]+5*[24,12,6][c]))<=2,'five layers were not added once');check(Math.abs(five[i+3]-surface[i+3])<=1,'comparison changed base alpha');}
 const enabled=model.materials[0].userData.materialPreview.uniforms.avatarMaterialEnabled;check(enabled.value===1,'comparison failed to restore emission');
 const returnPlain=capture({bloom:false});check(returnPlain.every((v,i)=>v===plain[i]),'switching mode changed base render');
 const sharpened=capture({bloom:true,bloomMode:'source',strength:1,sharpen:{enabled:true,radius:1},colorGrading:{enabled:true,rgb:[1,1,1],bcs:[0,0,1]}});check(sharpened.every((v,i)=>Math.abs(v-five[i])<=2),'source bloom was applied twice around sharpen/grading');
 const graded=capture({bloom:true,bloomMode:'source',strength:1,colorGrading:{enabled:true,rgb:[1,1,1],bcs:[0,0,1]}});check(graded.every((v,i)=>Math.abs(v-five[i])<=1),'source bloom was applied twice around grading');
 const aa=new T.WebGLRenderer({antialias:true});aa.outputColorSpace=T.LinearSRGBColorSpace;aa.setSize(65,49);aa.autoClear=false;const aaFx=createEmissionRenderer(aa);aaFx.render(scene,camera,model,{bloomMode:'source'});check(aa.getContext().getError()===aa.getContext().NO_ERROR&&!aa.autoClear,'source MSAA or autoClear restore');aaFx.dispose();aa.dispose();
 const oldRender=renderer.render;let injected=false;renderer.render=function(...args){if(args[0]===scene&&!injected){injected=true;throw Error('injected draw failure');}return oldRender.apply(this,args);};
 try{capture({bloom:true,bloomMode:'source'});}catch(e){check(e.message==='injected draw failure','unexpected exception');}finally{renderer.render=oldRender;}
 check(injected&&enabled.value===1&&renderer.getRenderTarget()===null,'exception failed to restore transient render state');
 localStorage.removeItem('closers-avatar-lighting-v2');$('material-preview').disabled=false;
 const state={model,data:{}},ui=setupAvatarLighting({state,api:async()=>({profiles:[]}),element:(tag,text)=>Object.assign(document.createElement(tag),text?{textContent:text}:{}),getEmissionEnabled:()=>$('material-preview').checked});
 check(ui.getRenderOptions().bloomMode==='viewer','new comparison enabled by default');$('avatar-emission-mode').value='source';$('avatar-emission-mode').dispatchEvent(new Event('change'));
 check(ui.getRenderOptions().bloomMode==='source'&&JSON.parse(localStorage.getItem('closers-avatar-lighting-v2')).bloomMode==='source','mode not saved or forwarded');
 $('avatar-emission-bloom').checked=false;$('avatar-emission-bloom').dispatchEvent(new Event('change'));check(!ui.getRenderOptions().bloom&&$('avatar-emission-mode').disabled,'bloom OFF ignored');
 check(!shaderError&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'GPU shader/error');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{fx?.dispose();model?.dispose();emission?.dispose();fill.dispose();texture.dispose();geometry.dispose();renderer.dispose();}
