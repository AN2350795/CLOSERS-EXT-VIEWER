import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setupAvatarLighting} from '/model-lighting.js';
import {normalizeViewerLights,setupViewerLight} from '/model-viewer-light.js';
import {createViewerLightHelpers} from '/model-viewer-light-helpers.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id);
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const change=(id,value)=>{const e=$(id);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
const vector=(name,values)=>['x','y','z'].forEach((axis,i)=>change('viewer-light-'+name+'-'+axis,values[i]));
try{
 localStorage.clear();
 const helpers=createViewerLightHelpers(),rig=normalizeViewerLights({showHelpers:true,enabled:true,lights:[{enabled:true,type:'point',position:[2,3,4],distance:10},{enabled:false,type:'spot',position:[0,0,0],target:[0,0,1],distance:20,angle:30}]});
 helpers.update(rig,true);
 const point=helpers.scene.children.find(o=>o.userData.kind==='point'),spot=helpers.scene.children.find(o=>o.userData.kind==='spot');
 check(point&&spot&&point.material.opacity===1&&spot.material.opacity===.3,'enabled/disabled guides');
 const vertices=point.geometry.attributes.position;
 for(let i=6;i<vertices.count;i++){const p=new T.Vector3().fromBufferAttribute(vertices,i);check(Math.abs(p.distanceTo(new T.Vector3(2,3,4))-10)<1e-5,'point range sphere');}
 // The ring following the spot's position/target/arrow marks the shader's
 // spherical cutoff at exactly distance 20, with half-angle 30 degrees.
 const spotVertices=spot.geometry.attributes.position;
 for(let i=18;i<18+96;i++){const p=new T.Vector3().fromBufferAttribute(spotVertices,i);check(Math.abs(p.length()-20)<1e-4&&Math.abs(p.z-20*Math.cos(Math.PI/6))<1e-4,'spot range and angle');}
 const original=point.geometry;helpers.update(rig,true);check(helpers.scene.children[0].geometry===original,'unchanged refresh rebuilt guides');
 let disposedGeometry=0,disposedMaterial=0;for(const object of helpers.scene.children){object.geometry.addEventListener('dispose',()=>disposedGeometry++);object.material.addEventListener('dispose',()=>disposedMaterial++);}
 const count=helpers.scene.children.length;rig.selected=1;helpers.update(rig,true);check(disposedGeometry===count&&disposedMaterial===count&&helpers.scene.children.find(o=>o.userData.selected).userData.viewerLightIndex===1,'selection/disposal');
 rig.lights=[{...rig.lights[0],type:'ambient'}];rig.selected=0;helpers.update(rig,true);check(!helpers.scene.children.length,'ambient invented a position');
 helpers.dispose();helpers.dispose();

 const model=buildModel({frames:[],meshes:[{name:'surface',source_id:1,frame:-1,vertices:[-8,-8,0,8,-8,0,0,8,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{texture:'BODY.PNG',color:[.3,.3,.3,1]}]}]});
 const state={model,data:{sources:[]}},ui=setupAvatarLighting({state,api:async()=>({profiles:[]}),element,getEmissionEnabled:()=>false});
 check(!$('viewer-light-show-helpers').checked,'guides enabled by default');
 const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.setClearColor(0x101010);
 const fx=createEmissionRenderer(renderer),scene=new T.Scene();scene.add(model.root);const camera=new T.OrthographicCamera(-20,20,20,-20,.1,100);camera.position.z=50;camera.lookAt(0,0,0);
 const capture=()=>{fx.render(scene,camera,state.model,ui.getRenderOptions());ui.renderHelpers(renderer,camera);const gl=renderer.getContext(),p=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
 const baseline=capture(),bounds=new T.Box3().setFromObject(model.root).clone(),children=scene.children.length;
 vector('position',[0,0,-3]);vector('target',[10,0,-3]);change('viewer-light-distance',10);change('viewer-light-show-helpers',true);
 const withHelpers=capture();check(withHelpers.some((v,i)=>v!==baseline[i]),'guide overlay invisible while lighting off');
 check(scene.children.length===children&&new T.Box3().setFromObject(model.root).equals(bounds)&&renderer.autoClear,'guides changed world bounds or renderer state');
 change('viewer-light-type','point');check(capture().some((v,i)=>v!==withHelpers[i]),'type edit did not update guides');
 const enabledBefore=$('viewer-light-enabled').checked;
 change('viewer-light-show-helpers',false);check(capture().every((v,i)=>v===baseline[i])&&$('viewer-light-enabled').checked===enabledBefore,'guide OFF changed shading');
 change('avatar-source-color',true);change('avatar-grade-enabled',true);change('avatar-grade-rgb-0',.1);
 const graded=capture();check(graded.some((v,i)=>v!==baseline[i]),'postprocess fixture unchanged');
 change('viewer-light-show-helpers',true);check(capture().some((v,i)=>v!==graded[i]),'postprocess hid guides');
 change('viewer-light-show-helpers',false);check(capture().every((v,i)=>v===graded[i]),'guides contaminated postprocess frame');
 change('avatar-grade-enabled',false);change('avatar-source-color',false);
 change('viewer-light-show-helpers',true);change('avatar-emission-solo',true);check(capture().every((v,i)=>i%4===3||v===0),'guides leaked into emission-only view');change('avatar-emission-solo',false);
 const guideCount=JSON.parse(localStorage.getItem('closers-viewer-light-v2')).lights.length;
 $('viewer-light-add').click();check(JSON.parse(localStorage.getItem('closers-viewer-light-v2')).lights.length===guideCount+1,'guide controls blocked adding lights');
 vector('position',[-10,0,0]);const added=capture();$('viewer-light-remove').click();check(capture().some((v,i)=>v!==added[i]),'deleted light guide remained');
 const restored=setupViewerLight({state,element});restored.refresh();check(restored.panel.querySelector('#viewer-light-show-helpers').checked,'guide display preference lost');restored.dispose();
 state.model=null;scene.remove(model.root);ui.refresh();const withoutModel=capture();check(withoutModel.every((v,i)=>i%4===3||v===16),'guides remained after clearing model');state.model=model;scene.add(model.root);ui.refresh();
 renderer.autoClear=false;ui.renderHelpers(renderer,camera);check(renderer.autoClear===false,'existing autoClear not restored');renderer.autoClear=true;
 ui.dispose();check(capture().every((v,i)=>v===baseline[i]),'disposed guides still rendered');ui.dispose();fx.dispose();renderer.dispose();model.dispose();
 document.body.dataset.checks='passed';
}catch(error){document.body.dataset.checks='failed';document.body.append(element('pre',error.stack));}
