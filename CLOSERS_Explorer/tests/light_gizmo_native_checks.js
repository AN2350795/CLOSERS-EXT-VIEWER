import * as T from '/vendor/three/three.module.min.js';
import {createLightGizmo} from '/model-light-gizmo.js';
const canvas=document.getElementById('model-canvas'),check=(v,m)=>{if(!v)throw Error(m);};
const renderer=new T.WebGLRenderer({canvas,antialias:false});renderer.setSize(400,400,false);
const rect=canvas.getBoundingClientRect(),camera=new T.PerspectiveCamera(40,rect.width/rect.height,.1,100);
camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
let position=[0,0,0],commits=0,orbit=0,expected,beforeCommits,beforeOrbit,active=false;
canvas.onpointerdown=canvas.onpointermove=event=>{if(event.type==='pointerdown')active=true;if(active)orbit++;};
canvas.onpointerup=()=>active=false;
const changes=[];const gizmo=createLightGizmo({camera,canvas,onChange:value=>{position=value;changes.push(value);},onCommit:()=>commits++}),model={};
let lastDown,events=[];document.addEventListener('pointerdown',e=>lastDown={x:e.clientX,y:e.clientY,target:e.target.id},true);
for(const name of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'])document.addEventListener(name,e=>events.push([name,e.clientX,e.clientY,e.buttons,e.target.id]),true);
window.addEventListener('error',e=>events.push(['error',e.message]));
window.addEventListener('blur',()=>events.push(['blur']));
const project=world=>{const p=world.clone().project(camera);return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};};
const scale=2*10*Math.tan(Math.PI/9)*85/rect.height,axis=[new T.Vector3(1,0,0),new T.Vector3(0,1,0),new T.Vector3(0,0,1)];
window.prepareNativeGizmo=index=>{
 active=false;events=[];changes.length=0;position=index===0?[3,0,0]:[0,0,0];gizmo.update({enabled:true,position,model,selection:'position'});gizmo.render(renderer);
 beforeCommits=commits;beforeOrbit=orbit;
 let from,to,moves,cancel=false;
 if(index<3||index===4||index===5){
   const a=index===0?2:index===2?1:0,origin=new T.Vector3(...position),start=origin.clone().addScaledVector(axis[a],scale*.6),delta=scale*(index===4?-.3:.3);
   from=project(start);to=project(start.clone().addScaledVector(axis[a],delta));expected=origin.addScaledVector(axis[a],delta).toArray();moves=[to];
   if(index===4){cancel=true;expected=[0,0,0];}
   if(index===5)moves=[project(start.clone().addScaledVector(axis[a],delta*.5))];
 }else if(index===3){
   from=project(new T.Vector3());to=project(new T.Vector3(scale*.3,scale*.2,0));expected=[scale*.3,scale*.2,0];moves=[to];
 }else{
   from=project(new T.Vector3(scale*.6,0,0));to={x:rect.left-15,y:from.y};moves=[to];
   const x=(to.x-rect.left)/rect.width*2-1;expected=[x*10*Math.tan(Math.PI/9)*camera.aspect-scale*.6,0,0];
 }
 window.nativePlanDebug={from,to,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},element:document.elementFromPoint(from.x,from.y)?.id};return {from,to,moves,cancel};
};
window.verifyNativeGizmo=index=>{
 check(position.every((value,i)=>Math.abs(value-expected[i])<1e-4),'native drag '+index+': '+position+' expected '+expected+' '+JSON.stringify({...window.nativePlanDebug,lastDown,orbit,beforeOrbit,events,changes,commits,beforeCommits}));
 check(orbit===beforeOrbit,'native drag reached orbit '+index);check(commits===beforeCommits+(index===4?0:1),'native commit '+index);
 check(!canvas.hasPointerCapture(1),'native pointer capture not released');
 if(index===6){renderer.setAnimationLoop(null);gizmo.dispose();renderer.dispose();}
 return true;
};
document.body.dataset.checks='ready';
