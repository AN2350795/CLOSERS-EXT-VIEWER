import * as T from '/vendor/three/three.module.min.js';
import {createLightGizmo} from '/model-light-gizmo.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id),frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const change=(id,value)=>{const e=$(id);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
const canvas=$('model-canvas'),capture=new Set();
// Synthetic pointer events have no browser hardware capture. Model the capture
// lifecycle here while exercising real raycasts, cameras, DOM and GPU rendering.
canvas.setPointerCapture=id=>capture.add(id);canvas.hasPointerCapture=id=>capture.has(id);canvas.releasePointerCapture=id=>capture.delete(id);
const point=(world,camera)=>{const p=world.clone().project(camera),rect=canvas.getBoundingClientRect();return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};};
const pointer=(type,p,id=1)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,clientX:p.x,clientY:p.y,pointerId:id,button:0,buttons:type==='pointerup'?0:1}));
try{
 const renderer=new T.WebGLRenderer({canvas,antialias:false});renderer.setSize(400,400,false);
 const camera=new T.PerspectiveCamera(40,1,.1,1000);camera.position.set(7,5,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 let position=[0,0,0],commits=0,orbitEvents=0;
 canvas.onpointerdown=canvas.onpointermove=canvas.onpointerup=()=>orbitEvents++;
 const gizmo=createLightGizmo({camera,canvas,onChange:v=>position=v,onCommit:()=>commits++}),owner={};
 const axes=[new T.Vector3(1,0,0),new T.Vector3(0,1,0),new T.Vector3(0,0,1)];
 function activate(){gizmo.update({enabled:true,position,model:owner,selection:'0:position'});gizmo.render(renderer);}
 for(let axis=0;axis<3;axis++){
   position=[0,0,0];activate();const scale=gizmo.handleSize;
   const start=axes[axis].clone().multiplyScalar(scale*.6),end=start.clone().addScaledVector(axes[axis],scale*.4);
   const before=commits;pointer('pointerdown',point(start,camera));pointer('pointermove',point(end,camera));
   check(position.every((v,i)=>Math.abs(v-(i===axis?scale*.4:0))<1e-4),'world axis translation '+axis+': '+position);
   pointer('pointerup',point(end,camera));check(commits===before+1&&!capture.size,'commit or release '+axis);
 }
 check(orbitEvents===0,'gizmo drag leaked into camera handlers');
 // An off-center light can expose Z even with a camera looking down -Z.
 camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 position=[3,0,0];activate();const offsetScale=gizmo.handleSize,offsetStart=new T.Vector3(3,0,offsetScale*.6),offsetEnd=offsetStart.clone().add(new T.Vector3(0,0,offsetScale*.3));
 const offsetOrbit=orbitEvents;pointer('pointerdown',point(offsetStart,camera));pointer('pointermove',point(offsetEnd,camera));gizmo.render(renderer);check(gizmo.handleSize===offsetScale,'handle size changed during drag');pointer('pointerup',point(offsetEnd,camera));
 check(Math.abs(position[2]-offsetScale*.3)<1e-4&&orbitEvents===offsetOrbit,'off-center Z handle failed or rotated camera: '+position);
 camera.position.set(7,5,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 position=[0,0,0];activate();const scale=gizmo.handleSize,start=point(new T.Vector3(scale*.6,0,0),camera),end={x:start.x+30,y:start.y};
 const beforeCancel=commits;pointer('pointerdown',start);pointer('pointermove',end);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));check(position.every(v=>Math.abs(v)<1e-6)&&commits===beforeCancel&&!capture.size,'Escape rollback');
 activate();pointer('pointerdown',start);pointer('pointermove',end);pointer('pointercancel',end);check(position.every(v=>Math.abs(v)<1e-6),'pointer cancellation rollback');
 activate();pointer('pointerdown',start);pointer('pointermove',end);window.dispatchEvent(new Event('blur'));check(position.every(v=>Math.abs(v)<1e-6)&&commits===beforeCancel&&!capture.size,'window blur rollback');
 activate();const center=point(new T.Vector3(),camera);pointer('pointerdown',center);pointer('pointermove',{x:center.x+20,y:center.y+15});pointer('pointerup',{x:center.x+20,y:center.y+15});check(new T.Vector3(...position).length()>.1,'screen-plane center movement');
 position=[0,0,0];activate();pointer('pointerdown',start);pointer('pointermove',end);gizmo.update({enabled:false,position,model:null,selection:'none'});check(position.every(v=>Math.abs(v)<1e-6)&&!capture.size,'model/selection change did not cancel');
 for(const [plane,normal] of [['XY',[0,0,10]],['YZ',[10,0,0]],['XZ',[0,10,0]]]){
   camera.up.set(...(plane==='XZ'?[0,0,1]:[0,1,0]));camera.position.set(...normal);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);position=[0,0,0];activate();
   const a='XYZ'.indexOf(plane[0]),b='XYZ'.indexOf(plane[1]),size=gizmo.handleSize,first=axes[a].clone().add(axes[b]).multiplyScalar(size*.3),delta=axes[a].clone().multiplyScalar(size*.2).addScaledVector(axes[b],-size*.1);
   pointer('pointerdown',point(first,camera));check(gizmo.controls.axis===plane,'plane picker '+plane);pointer('pointermove',point(first.clone().add(delta),camera));pointer('pointerup',point(first.clone().add(delta),camera));check(position.every((v,i)=>Math.abs(v-delta.getComponent(i))<1e-4),'plane translation '+plane);
 }
 camera.up.set(0,1,0);camera.position.set(7,5,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);position=[0,0,0];gizmo.update({enabled:true,position,model:owner,selection:'snap',snap:1});gizmo.render(renderer);
 const snapStart=new T.Vector3(gizmo.handleSize*.9,0,0),snapEnd=snapStart.clone().add(new T.Vector3(.8,0,0));pointer('pointerdown',point(snapStart,camera));pointer('pointermove',point(snapEnd,camera));pointer('pointerup',point(snapEnd,camera));check(position[0]===1&&position[1]===0&&position[2]===0,'translation snap');
 gizmo.dispose();gizmo.dispose();renderer.dispose();canvas.onpointerdown=canvas.onpointermove=canvas.onpointerup=null;

 // Exercise the actual model.js orbit handlers, toolbar, storage and shader path.
 const originalFetch=fetch;window.fetch=async(url,options)=>{
   const u=new URL(url,location.href);
   if(u.pathname==='/api/model-browser')return Response.json({items:[],total:0,facets:{character:[],kind:[],part:[],family:[],variant:[]}});
   if(u.pathname==='/api/model-lighting')return Response.json({profiles:[],color_grading_presets:[]});
   if(u.pathname==='/api/model-scene')return Response.json({frames:[],meshes:[{name:'mesh',source_id:1,frame:-1,vertices:[-20,0,0,20,0,0,0,60,0],indices:[0,2,1],uv:[],groups:[[0,3,0]],materials:[{color:[.5,.5,.5,1]}],skin:[]}],sources:[{entry_id:1,name:'HAIR.X',model_group:{kind:'avatar',character:'REAPER',part:'HAIR'}}],motion:{candidates:[]},animation:{candidates:[]},warnings:[],eye_avatar:null});
   return originalFetch(url,options);
 };
 localStorage.clear();await import('/model.js');await modelViewer.loadModel([1]);await frame();
 $('open-avatar-lighting').click();$('viewer-light-edit-3d').click();check(!$('avatar-lighting-dialog').open&&!$('viewer-light-gizmo-toolbar').hidden,'modal blocked viewport editing');
 $('viewer-light-gizmo-collapse').click();check($('viewer-light-gizmo-collapse').getAttribute('aria-expanded')==='false'&&JSON.parse(localStorage.getItem('closers-viewer-light-v2')).gizmoEnabled,'collapsing toolbar disabled gizmo');$('viewer-light-gizmo-collapse').click();
 change('viewer-light-gizmo-snap',5);check(JSON.parse(localStorage.getItem('closers-viewer-light-v2')).gizmoSnap===5,'snap persistence');change('viewer-light-gizmo-snap',0);
 $('viewer-light-gizmo-place').click();await frame();
 const values=()=>['x','y','z'].map(axis=>Number($('viewer-light-position-'+axis).value)),original=values(),savedBefore=localStorage.getItem('closers-viewer-light-v2');
 const view=modelViewer.view,rect=canvas.getBoundingClientRect(),cam=new T.PerspectiveCamera(40,rect.width/rect.height,.01,100000);
 const c=Math.cos(view.pitch);cam.position.set(view.target[0]+Math.sin(view.yaw)*c*view.distance,view.target[1]+Math.sin(view.pitch)*view.distance,view.target[2]+Math.cos(view.yaw)*c*view.distance);cam.lookAt(new T.Vector3(...view.target));cam.updateMatrixWorld(true);
 const origin=new T.Vector3(...original),depth=-origin.clone().applyMatrix4(cam.matrixWorldInverse).z,size=2*depth*Math.tan(Math.PI/9)*85/rect.height;
 const from=point(origin.clone().add(new T.Vector3(size*.9,0,0)),cam),to=point(origin.clone().add(new T.Vector3(size*1.2,0,0)),cam);
 pointer('pointerdown',from);pointer('pointermove',to);check(values()[0]>original[0]&&values()[1]===original[1]&&values()[2]===original[2],'actual UI live coordinates');
 check(localStorage.getItem('closers-viewer-light-v2')===savedBefore,'drag wrote storage before commit');
 pointer('pointerup',to);await frame();const saved=JSON.parse(localStorage.getItem('closers-viewer-light-v2'));
 check(Math.abs(saved.lights[0].position[0]-values()[0])<1e-6&&JSON.stringify(modelViewer.view)===JSON.stringify(view),'actual drag storage or camera conflict');
 change('viewer-light-gizmo-target','target');$('viewer-light-gizmo-place').click();await frame();check(JSON.parse(localStorage.getItem('closers-viewer-light-v2')).gizmoTarget==='target','target mode');
 const targetBefore=['x','y','z'].map(axis=>Number($('viewer-light-target-'+axis).value)),positionBefore=values(),targetOrigin=new T.Vector3(...targetBefore),targetDepth=-targetOrigin.clone().applyMatrix4(cam.matrixWorldInverse).z,targetSize=2*targetDepth*Math.tan(Math.PI/9)*85/rect.height;
 const targetFrom=point(targetOrigin.clone().add(new T.Vector3(0,targetSize*.9,0)),cam),targetTo=point(targetOrigin.clone().add(new T.Vector3(0,targetSize*1.2,0)),cam);
 pointer('pointerdown',targetFrom);pointer('pointermove',targetTo);pointer('pointerup',targetTo);
 const movedTarget=JSON.parse(localStorage.getItem('closers-viewer-light-v2')).lights[0];check(movedTarget.target[1]>targetBefore[1]&&movedTarget.target[0]===targetBefore[0]&&movedTarget.target[2]===targetBefore[2]&&JSON.stringify(movedTarget.position)===JSON.stringify(positionBefore),'target drag changed position');
 change('avatar-emission-solo',true);check($('viewer-light-gizmo-toolbar').hidden,'diagnostic retained editing controls');change('avatar-emission-solo',false);
 $('viewer-light-gizmo-close').click();check($('viewer-light-gizmo-toolbar').hidden&&!JSON.parse(localStorage.getItem('closers-viewer-light-v2')).gizmoEnabled,'finish editing');
 $('clear-model').click();check($('viewer-light-edit-3d').disabled&&$('viewer-light-gizmo-toolbar').hidden,'empty model editing');window.dispatchEvent(new Event('pagehide'));
 document.body.dataset.checks='passed';
}catch(error){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:error.stack}));}
