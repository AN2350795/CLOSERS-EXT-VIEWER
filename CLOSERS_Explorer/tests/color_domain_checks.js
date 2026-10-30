import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {applyAvatarColorSpace,createEmissionRenderer} from '/model-emission.js';
import {setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
import {setMaterialPreviewMap,setMatcapPreview,setMatcapPreviewMap,setMatcapNormalMap} from '/model-materials.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
function fixture(count=0){return {frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[{name:'mesh',source_id:1,frame:-1,vertices:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,1,0,.5,1],groups:[[0,3,0]],materials:[{color:[1,1,1,1],toon_preview:{kind:'toon',status:'approximate'},matcap_preview:{kind:'matcap',status:'approximate'},material_preview:{kind:'emissive',status:'approximate',color:[1,.5,.25,1],strength:.1}}],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}]};}
function map(r,g,b,a=255){const t=new T.DataTexture(new Uint8Array([r,g,b,a]),1,1);t.needsUpdate=true;return t;}
const base=map(128,64,32),toon=map(128,128,128),cap=map(16,8,4),bump=map(128,128,255,128),emission=map(32,16,8),maps=new Map([['base:1',base],['toon:2',toon],['matcap:3',cap],['matcap-normal:4',bump],['auxiliary:5',emission]]);
const srgb=v=>v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055,decode=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4,light={direction:[0,0,-1],color:[.8,.7,.6,1],intensity:1.025};
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.setClearColor(0);const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext(),read=()=>{const p=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},draw=scene=>{renderer.render(scene,camera);return read();};
try{
  for(const count of [0,4,5]){
    const model=buildModel(fixture(count)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0];m.map=base;m.needsUpdate=true;setAvatarToonMap(m,toon);setAvatarToon(m,true,light);setMatcapPreviewMap(m,cap);setMatcapNormalMap(m,bump);setMatcapPreview(m,true);setMaterialPreviewMap(m,emission);const index=(32*64+32)*4;
    applyAvatarColorSpace(renderer,maps,false);const before=draw(scene);
    for(const source of [true,false]){
      applyAvatarColorSpace(renderer,maps,source);const actual=draw(scene);
      for(let c=0;c<3;c++){const b=[128,64,32][c]/255,linear=((source?b:decode(b))+[16,8,4][c]/255*128/255)*128/255*light.color[c]*light.intensity+[32,16,8][c]/255*[1,.5,.25][c]*.1;const expected=Math.round(255*(source?linear:srgb(linear)));check(Math.abs(actual[index+c]-expected)<=1,'paired input/output color domain mismatch '+count+'/'+source+'/'+c);}
      check(actual[index+3]===before[index+3],'color domain changed alpha');if(source)check(actual.some((v,i)=>i%4!==3&&v!==before[i]),'raw mode had no effect on lit/material composition');else check(actual.every((v,i)=>v===before[i]),'viewer domain did not restore exact pixels');
      const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{bloom:true,strength:0});check(read().every((v,i)=>Math.abs(v-actual[i])<=1),'composite doubled/skipped output transfer');fx.render(scene,camera,model,{solo:true,bloom:false});const solo=read();for(let c=0;c<3;c++){const e=[32,16,8][c]/255*[1,.5,.25][c]*.1;check(Math.abs(solo[index+c]-Math.round(255*(source?e:srgb(e))))<=1,'emission output domain mismatch');}fx.dispose();
    }
    model.dispose();
  }
  // An unshaded source texture stays byte-identical when both ends switch.
  {const model=buildModel(fixture()),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0];m.map=base;m.needsUpdate=true;applyAvatarColorSpace(renderer,maps,false);const a=draw(scene);applyAvatarColorSpace(renderer,maps,true);const b=draw(scene);check(a.every((v,i)=>Math.abs(v-b[i])<=1),'paired raw path changed an unshaded base image');model.dispose();}
  const originalFetch=window.fetch;
  window.fetch=async(url,options)=>{const path=String(url);
    if(path.startsWith('/api/model-browser'))return Response.json({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}});
    if(path.startsWith('/api/composition-source/'))return Response.json({width:4,height:4,image_sha256:'color-domain-fixture'});
    if(path.startsWith('/api/model-lighting'))return Response.json({profiles:[]});
    if(path.startsWith('/api/model-scene')){const data=fixture();data.meshes[0].materials[0].image={name:'BASE.PNG',candidates:[{id:71,archive:'fixture',ordinal:0}],selected:71};return Response.json({...data,sources:[{name:'fixture.X',entry_id:1}],skeleton_source:{name:'fixture.X',entry_id:1},motion:{candidates:[]},animation:{candidates:[]},warnings:[]});}
    return originalFetch(url,options);
  };
  if(window.restoreRawColor)localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({sourceColor:true}));
  await import('/model.js');await modelViewer.loadModel([1]);const $=id=>document.getElementById(id),toggle=$('avatar-source-color'),frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),baseMap=()=>modelViewer.state.textures.get('base:71');
  check(toggle.checked===!!window.restoreRawColor&&!toggle.disabled,'raw comparison default/restored choice');await frame();if(window.restoreRawColor){check(baseMap().colorSpace===T.NoColorSpace,'saved raw preference not applied to first upload');toggle.click();await frame();}check(baseMap().colorSpace===T.SRGBColorSpace,'default base color changed');toggle.click();await frame();check(baseMap().colorSpace===T.NoColorSpace&&$('avatar-source-color-status').textContent.includes('후처리 미포함'),'raw input did not follow frame mode');check(JSON.parse(localStorage.getItem('closers-avatar-lighting-v2')).sourceColor===true,'raw comparison not saved');
  await modelViewer.loadModel([1]);await frame();check(toggle.checked&&baseMap().colorSpace===T.NoColorSpace,'reused GPU cache lost raw interpretation');toggle.click();await frame();check(baseMap().colorSpace===T.SRGBColorSpace,'raw OFF left cache in raw color mode');$('clear-model').click();check(toggle.disabled,'clear left color mode control active');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{for(const t of maps.values())t.dispose();renderer.dispose();renderer.forceContextLoss();}
