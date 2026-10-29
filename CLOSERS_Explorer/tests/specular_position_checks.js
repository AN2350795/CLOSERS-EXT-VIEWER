import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMatcapPreview,setMatcapPreviewMap,setMatcapNormalMap,setSpecularPreview,setSpecularLight} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
function fixture(count=0){return {frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[0,1].map(k=>({name:'mesh'+k,source_id:k+1,frame:-1,vertices:[-1.7+k*2,-.7,0,-.3+k*2,-.7,0,-1+k*2,.7,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,1,0,0,1],groups:[[0,3,0]],materials:[{color:[.1,.08,.05,1],...(!k?{matcap_preview:{kind:'matcap',status:'approximate',texture:'CAP.PNG',specular:{status:'approximate',color:[.4,.2,.1,1],power:20}}}:{})}],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}))};}
function map(r,g,b,a=255){const t=new T.DataTexture(new Uint8Array([r,g,b,a]),1,1);t.needsUpdate=true;return t;}
const cap=map(0,0,0),bump=map(128,128,255,128),renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(96,96);renderer.setClearColor(0);renderer.outputColorSpace=T.SRGBColorSpace;let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext(),pixels=scene=>{renderer.render(scene,camera);const p=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},srgb=x=>Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055));
function setup(count=0){const model=buildModel(fixture(count)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const m=model.materials[0];setMatcapPreviewMap(m,cap);setMatcapNormalMap(m,bump);setMatcapPreview(m,true);return {model,scene,m};}
try{
  for(const count of [0,4,5]){
    const {model,scene,m}=setup(count),index=(48*96+24)*4,off=pixels(scene);setSpecularPreview(m,true);const cameraLight=pixels(scene);
    for(const angle of [0,.3]){
      camera.position.set(Math.sin(angle)*10,0,Math.cos(angle)*10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);setSpecularLight(m,'region',[6,4,-8]);const actual=pixels(scene);
      const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((24.5/96)*2-1,(48.5/96)*2-1),camera);const point=ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,0,1),0),new T.Vector3());
      const normal=new T.Vector3(1/255,1/255,1).normalize(),light=new T.Vector3(6,4,8).sub(point).normalize(),view=camera.position.clone().sub(point).normalize(),half=light.add(view).normalize(),term=Math.max(0,normal.dot(half))**20*128/255;
      for(let c=0;c<3;c++)check(Math.abs(actual[index+c]-srgb([.1,.08,.05][c]+[.4,.2,.1][c]*term))<=2,'regional point-light half-vector mismatch '+count+'/'+angle+'/'+c);
      if(angle===0){check(actual.some((v,i)=>v!==cameraLight[i]),'region light did not differ from camera');for(let i=0;i<actual.length;i++)if(i%4===3||(i/4|0)%96>=48)check(actual[i]===off[i],'region reflection changed alpha/unrelated material');}
    }
    camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    setSpecularLight(m,'region',null);check(m.userData.matcapPreview.uniforms.avatarSpecularEnabled.value===0&&pixels(scene).every((v,i)=>v===off[i]),'missing position fell back to camera');
    for(const bad of [[1,2],[NaN,0,0],[Infinity,0,0],[1e39,0,0]]){setSpecularLight(m,'region',bad);check(m.userData.matcapPreview.uniforms.avatarSpecularEnabled.value===0,'invalid source position was accepted');}
    if(!count){const x=24.5/96*4-2,y=48.5/96*4-2;for(const position of [[x,y,0],[2*x,2*y,10]]){setSpecularLight(m,'region',position);const degenerate=pixels(scene);for(let c=0;c<3;c++)check(Math.abs(degenerate[index+c]-off[index+c])<=1,'degenerate point-light/half-vector produced reflection');}}
    setSpecularLight(m,'camera');check(pixels(scene).every((v,i)=>v===cameraLight[i]),'camera mode did not restore exact reflection');setSpecularLight(m,'region',[6,4,-8]);
    const fx=createEmissionRenderer(renderer);fx.render(scene,camera,model,{solo:true,bloom:true});const solo=new Uint8Array(off.length);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,solo);check(solo.every((v,i)=>i%4===3||v===0),'region reflection leaked into emission');fx.dispose();
    if(count){const rigid=setup();model.bones.forEach(b=>b.rotation.y=.4);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());rigid.model.root.rotation.y=.4;setSpecularLight(rigid.m,'region',[6,4,-8]);setSpecularPreview(rigid.m,true);const actual=pixels(scene),expected=pixels(rigid.scene);check(actual.every((v,i)=>Math.abs(v-expected[i])<=2),'region reflection skin/rigid mismatch');rigid.model.dispose();}
    setSpecularPreview(m,false);if(!count)check(pixels(scene).every((v,i)=>v===off[i]),'reflection OFF did not restore surface');model.dispose();
  }
  check(!shaderError,'regional reflection shader failed');
  const originalFetch=window.fetch;let fail=false;
  window.fetch=async(url,options)=>{const path=String(url);
    if(path.startsWith('/api/model-browser'))return Response.json({total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}});
    if(path.startsWith('/api/composition-source/'))return Response.json({width:4,height:4,image_sha256:'position-fixture'});
    if(path.startsWith('/api/model-lighting')){if(fail)throw Error('position source failed');return Response.json({profiles:[{key:'region',label:'지역',position:[6,4,-8],direction:[0,0,1],color:[1,1,1,1],intensity:1},{key:'costume',label:'의상',direction:[6,4,-8],color:[1,1,1,1],intensity:1}]});}
    if(path.startsWith('/api/model-scene')){const data=fixture(),p=data.meshes[0].materials[0].matcap_preview,info={name:'SHARED.PNG',candidates:[{id:71,archive:'fixture',ordinal:0}],selected:71};p.image=info;p.normal_image=info;return Response.json({...data,sources:[{name:'fixture.X',entry_id:1}],skeleton_source:{name:'fixture.X',entry_id:1},motion:{candidates:[]},animation:{candidates:[]},warnings:[]});}
    return originalFetch(url,options);
  };
  if(window.restoreRegionalSettings){localStorage.setItem('closers-avatar-matcap-v1',JSON.stringify({enabled:true,useSpecular:true,lightMode:'region'}));localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({selected:'region'}));}
  await import('/model.js');await modelViewer.loadModel([1]);const $=id=>document.getElementById(id),select=$('avatar-lighting-profile'),mode=$('avatar-specular-light'),u=()=>modelViewer.state.model.materials[0].userData.matcapPreview.uniforms;
  check(mode.value===(window.restoreRegionalSettings?'region':'camera'),'default/restored reflection mode');
  if(window.restoreRegionalSettings){for(let i=0;i<100&&u().avatarSpecularEnabled.value===0;i++)await new Promise(r=>setTimeout(r,5));check(u().avatarSpecularEnabled.value===1&&u().avatarSpecularUsePosition.value===1,'saved region reflection did not load source without opening dialog');mode.value='camera';mode.dispatchEvent(new Event('change'));}
  $('open-avatar-lighting').click();for(let i=0;i<100&&!select.querySelector('option[value="region"]');i++)await new Promise(r=>setTimeout(r,5));if(!$('avatar-matcap-enabled').checked)$('avatar-matcap-enabled').click();if(!$('avatar-matcap-specular').checked)$('avatar-matcap-specular').click();check(u().avatarSpecularEnabled.value===1,'camera reflection missing');
  select.value='';select.dispatchEvent(new Event('change'));
  mode.value='region';mode.dispatchEvent(new Event('change'));check(u().avatarSpecularEnabled.value===0&&u().avatarMatcapEnabled.value===1&&$('avatar-specular-status').textContent.includes('보류'),'missing region did not preserve MatCap alone');select.value='region';select.dispatchEvent(new Event('change'));check(u().avatarSpecularEnabled.value===1&&u().avatarSpecularLightPosition.value.join(',')==='6,4,8','explicit region position/mirror not bound');
  await modelViewer.loadModel([1]);check(mode.value==='region'&&u().avatarSpecularEnabled.value===1,'region mode lost on reload');check(JSON.parse(localStorage.getItem('closers-avatar-matcap-v1')).lightMode==='region','region mode not saved');select.value='costume';select.dispatchEvent(new Event('change'));check(u().avatarSpecularEnabled.value===0,'direction-only costume was treated as a position');select.value='region';select.dispatchEvent(new Event('change'));
  document.querySelector('#avatar-lighting-dialog button').click();fail=true;$('open-avatar-lighting').click();for(let i=0;i<100&&!$('avatar-lighting-status').textContent.includes('position source failed');i++)await new Promise(r=>setTimeout(r,5));check(u().avatarSpecularEnabled.value===0&&u().avatarMatcapEnabled.value===1,'source failure kept stale region reflection');document.querySelector('#avatar-lighting-dialog button').click();fail=false;$('open-avatar-lighting').click();for(let i=0;i<100&&u().avatarSpecularEnabled.value===0;i++)await new Promise(r=>setTimeout(r,5));check(u().avatarSpecularEnabled.value===1,'regional source recovery failed');$('clear-model').click();check(mode.disabled,'clear left region control active');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{cap.dispose();bump.dispose();renderer.dispose();renderer.forceContextLoss();}
