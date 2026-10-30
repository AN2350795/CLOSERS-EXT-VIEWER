import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {createEmissionRenderer,applyAvatarColorSpace} from '/model-emission.js';
import {normalizeColorGrading} from '/model-color-grading.js';
import {setMaterialPreviewMap,setMatcapNormalMap} from '/model-materials.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
const fixture=(count=0)=>({frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[{name:'mesh',source_id:1,frame:-1,vertices:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,1,0,.5,1],groups:[[0,3,0]],materials:[{color:[.15,.3,.5,1],matcap_preview:{kind:'matcap',status:'approximate'},material_preview:{kind:'emissive',status:'approximate',color:[1,.5,.25,1],strength:.2}}],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}]});
const grade={enabled:true,rgb:[.7,1.1,1.3],bcs:[.08,.25,.6]};
// Independent scalar oracle: brightness precedes contrast, tint precedes luma.
function expected(color,g){const tint=color.map((v,i)=>((v+g.bcs[0]-.5)*Math.max(1+g.bcs[1],0)+.5)*g.rgb[i]),luma=tint[0]*.2125+tint[1]*.7154+tint[2]*.0721;return tint.map(v=>Math.round(255*Math.max(0,Math.min(1,luma+g.bcs[2]*(v-luma)))));}
const renderer=new T.WebGLRenderer({alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.setClearColor(0,0);renderer.outputColorSpace=T.LinearSRGBColorSpace;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext(),index=(32*64+32)*4;
const read=()=>{const p=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
const emission=new T.DataTexture(new Uint8Array([32,16,8,255]),1,1);emission.needsUpdate=true;
let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
try{
  for(const count of [0,4,5]){
    const model=buildModel(fixture(count)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const fx=createEmissionRenderer(renderer);
    const draw=options=>{fx.render(scene,camera,model,options);return read();};
    const base=draw({bloom:false});
    const neutral=draw({bloom:false,colorGrading:{enabled:true}});check(neutral.every((v,i)=>Math.abs(v-base[i])<=1),'neutral grading changed source pixels '+count);
    for(const g of [grade,{enabled:true,rgb:[1,1,1],bcs:[-.7,-1,2]},{enabled:true,rgb:[2,2,2],bcs:[1,2,2]}]){
      const actual=draw({bloom:false,colorGrading:g}),want=expected([.15,.3,.5],g);
      for(let c=0;c<3;c++)check(Math.abs(actual[index+c]-want[c])<=1,'source grading formula '+count+'/'+c);
      check(actual[index+3]===base[index+3],'grading changed opaque alpha');
    }
    setMaterialPreviewMap(model.materials[0],emission);
    const combined=draw({bloom:true,strength:.8}),graded=draw({bloom:true,strength:.8,colorGrading:grade});
    const want=expected(Array.from(combined.slice(index,index+3),v=>v/255),grade);for(let c=0;c<3;c++)check(Math.abs(graded[index+c]-want[c])<=2,'grading must follow emission and bloom composition '+count+'/'+c);
    const solo=draw({solo:true,bloom:false}),soloGrade=draw({solo:true,bloom:false,colorGrading:grade});check(solo.every((v,i)=>v===soloGrade[i]),'solo diagnostics must bypass grading');
    const restored=draw({bloom:false,colorGrading:{enabled:false}}),ungraded=draw({bloom:false});check(restored.every((v,i)=>v===ungraded[i]),'grading OFF failed exact restoration');
    check(renderer.getRenderTarget()===null&&scene.children[0].visible&&model.materials.every(m=>m.userData.avatarLighting.avatarEmissionPass.value===0),'postprocess leaked render state');
    renderer.setSize(80,40);fx.render(scene,camera,model,{bloom:false,colorGrading:grade});check(gl.getError()===gl.NO_ERROR,'grading resize failed');renderer.setSize(64,64);fx.dispose();model.dispose();
  }
  // Raw transparent color without material blending tests alpha independently.
  {const scene=new T.Scene(),geometry=new T.PlaneGeometry(2,2),material=new T.ShaderMaterial({vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'void main(){gl_FragColor=vec4(.15,.3,.5,.4);}'}),root=new T.Mesh(geometry,material);scene.add(root);const fx=createEmissionRenderer(renderer);fx.render(scene,camera,{root,materials:[]},{colorGrading:grade,bloom:false});check(Math.abs(read()[index+3]-102)<=1,'grading lost fractional alpha');fx.dispose();geometry.dispose();material.dispose();}
  // Output conversion still occurs exactly once in the existing viewer domain.
  {const model=buildModel(fixture()),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const fx=createEmissionRenderer(renderer);applyAvatarColorSpace(renderer,new Map(),false);fx.render(scene,camera,model,{bloom:false,colorGrading:grade});const actual=read(),raw=expected([.15,.3,.5],grade);for(let c=0;c<3;c++){const v=raw[c]/255,encoded=v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;check(Math.abs(actual[index+c]-Math.round(encoded*255))<=2,'duplicate/missing final output transfer');}fx.dispose();model.dispose();}
  check(!shaderError,'color grading shader compilation failed');
  const invalid=normalizeColorGrading({enabled:true,rgb:[NaN,1,1],bcs:[null,0,1]});check(invalid.rgb.join(',')==='1,1,1'&&invalid.bcs.join(',')==='0,0,1','invalid saved vectors did not restore neutral defaults');
  const originalFetch=window.fetch;window.fetch=async(url,options)=>{const path=String(url);
    if(path.startsWith('/api/model-browser'))return Response.json({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}});
    if(path.startsWith('/api/model-lighting'))return Response.json({profiles:[],color_grading_presets:[{key:'5',label:'원본 프리셋 5',scope:'color-grading-only',source_enabled:true,rgb:[1,1,1.100000023841858],bcs:[0,.05000000074505806,1.2999999523162842]},{key:'4',label:'원본 프리셋 4',scope:'color-grading-only',source_enabled:true,rgb:[1,1,1],bcs:[0,0,0]}]});
    if(path.startsWith('/api/model-scene'))return Response.json({...fixture(),sources:[{name:'fixture.X',entry_id:1}],skeleton_source:{name:'fixture.X',entry_id:1},motion:{candidates:[]},animation:{candidates:[]},warnings:[]});
    return originalFetch(url,options);
  };
  if(window.restoreColorGrading)localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({sourceColor:true,colorGrading:grade,colorGradingManual:{enabled:false,rgb:[.4,.5,.6],bcs:[0,0,1]}}));
  await import('/model.js');await modelViewer.loadModel([1]);
  const $=id=>document.getElementById(id),toggle=$('avatar-grade-enabled'),rawToggle=$('avatar-source-color'),red=$('avatar-grade-rgb-0'),frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),change=(input,value)=>{input.value=value;input.dispatchEvent(new Event('change'));};
  check(toggle.checked===!!window.restoreColorGrading,'grading default/saved preference');
  if(!window.restoreColorGrading){check(toggle.disabled&&red.disabled,'grading should wait for raw mode');rawToggle.click();toggle.click();change(red,.7);}else check(red.value==='0.7','saved grading vector not restored');
  await frame();check(!red.disabled&&$('avatar-grade-status').textContent.includes('비교 중'),'grading controls not active');
  check(JSON.parse(localStorage.getItem('closers-avatar-lighting-v2')).colorGrading.rgb[0]===.7,'grading choice not saved');
  if(window.restoreColorGrading){check(!$('avatar-grade-manual-restore').disabled,'saved manual backup was not restored');$('avatar-grade-manual-restore').click();check(red.value==='0.4'&&toggle.checked,'manual backup restoration changed enabled choice');change(red,.7);}
  change(red,'');check(red.value==='0.7','empty input corrupted saved coefficient');change(red,99);check(red.value==='2','coefficient outside UI range');
  $('open-avatar-lighting').click();for(let i=0;i<100&&$('avatar-grade-preset').options.length<3;i++)await frame();
  const preset=$('avatar-grade-preset'),bloom=$('avatar-emission-bloom').checked;
  change(preset,'5');$('avatar-grade-preset-apply').click();check(red.value==='1'&&$('avatar-grade-rgb-2').value==='1.1'&&$('avatar-grade-bcs-1').value==='0.05','preset source coefficients not copied');check(toggle.checked&&$('avatar-emission-bloom').checked===bloom,'preset changed enabled choice or bloom');
  change(preset,'4');$('avatar-grade-preset-apply').click();check($('avatar-grade-bcs-2').value==='0','zero saturation preset was replaced with a default');$('avatar-grade-manual-restore').click();check(red.value==='2'&&toggle.checked,'switching presets lost original manual values');
  toggle.click();change(preset,'5');$('avatar-grade-preset-apply').click();check(!toggle.checked,'applying preset silently enabled grading');$('avatar-grade-manual-restore').click();toggle.click();
  $('avatar-emission-solo').click();check($('avatar-grade-status').textContent.includes('보류'),'solo grading not marked paused');$('avatar-emission-solo').click();
  const bump=new T.DataTexture(new Uint8Array([128,128,255,128]),1,1);bump.needsUpdate=true;setMatcapNormalMap(modelViewer.state.model.materials[0],bump);$('open-avatar-lighting').click();$('avatar-matcap-mask-only').click();check($('avatar-grade-status').textContent.includes('보류'),'mask grading not marked paused');$('avatar-matcap-mask-only').click();
  $('avatar-grade-reset').click();check(red.value==='1'&&$('avatar-grade-bcs-2').value==='1'&&toggle.checked,'neutral reset changed enabled choice or values');
  rawToggle.click();check(toggle.disabled&&red.disabled&&toggle.checked,'raw OFF did not suspend grading preference');rawToggle.click();await modelViewer.loadModel([1]);await frame();check(toggle.checked&&!toggle.disabled&&red.value==='1','model reload lost grading preference');
  toggle.click();check(red.disabled&&$('avatar-grade-status').textContent.includes('꺼짐'),'grading OFF controls');$('clear-model').click();check(toggle.disabled,'cleared model left grading active');bump.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{emission.dispose();renderer.dispose();renderer.forceContextLoss();}
