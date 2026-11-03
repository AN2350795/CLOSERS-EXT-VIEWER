import * as T from '/vendor/three/three.module.min.js';
import {applyBlend} from '/particle-model.js';
import {createDofDepthPass} from '/model-dof-depth.js';
const check=(v,m)=>{if(!v)throw Error(m);};
const renderer=new T.WebGLRenderer({alpha:true,antialias:!!window.occlusionAntialias,preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.setClearColor(0,0);
const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const avatar=new T.Mesh(new T.PlaneGeometry(1.4,1.4),new T.MeshBasicMaterial({color:0x4488cc}));scene.add(avatar);const model={root:avatar,materials:[avatar.material],meshes:[avatar]};
const opaque=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1),partial=new T.DataTexture(new Uint8Array([255,255,255,128]),1,1);opaque.needsUpdate=partial.needsUpdate=true;
const materials=[opaque,partial].map(map=>{const m=new T.MeshBasicMaterial({map,transparent:true,alphaTest:1/255,depthTest:true,depthWrite:true});applyBlend(m);m.userData.motionOpaqueOccluder=true;return m;});
const geometry=new T.PlaneGeometry(1.8,1.8,2,1);geometry.clearGroups();geometry.addGroup(0,6,0);geometry.addGroup(6,6,1);const prop=new T.Mesh(geometry,materials);prop.position.z=1;scene.add(prop);
const depth=createDofDepthPass(renderer),errors=[];renderer.debug.onShaderError=()=>errors.push('shader');
const encoded=()=>{depth.render(scene,camera,model,[0,4,8,.5],[prop]);const p=new Uint8Array(64*64*4);renderer.readRenderTargetPixels(depth.target,0,0,64,64,p);return p;};
const at=(p,x)=>p[(32*64+x)*4+3];
const normal=()=>{renderer.setRenderTarget(null);renderer.render(scene,camera);const p=new Uint8Array(64*64*4),gl=renderer.getContext();gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
try{
 const before=normal(),mixed=encoded();check(at(mixed,20)===0&&at(mixed,44)===255,'opaque effect group missing or partial group became a solid blocker');
 check(materials.every(m=>m.visible&&m.colorWrite)&&normal().every((v,i)=>v===before[i]),'group mask leaked into visible rendering');
 const m=materials[0];
 for(const change of [()=>m.opacity=.5,()=>m.depthWrite=false,()=>m.userData.motionOpaqueOccluder=false,()=>applyBlend(m,['SRCALPHA','ONE']),()=>m.map=partial]){
  change();check(at(encoded(),20)===255,'unsupported effect surface occluded avatar');m.opacity=1;m.depthWrite=true;m.userData.motionOpaqueOccluder=true;applyBlend(m);m.map=opaque;
 }
 check(at(encoded(),20)===0,'opaque map replacement did not restore occlusion');
 // Test mixed-material rollback while one group is suppressed and the other
 // writes depth only. A failed frame must restore both independently.
 const render=renderer.render;renderer.render=function(s,c){if(!m.colorWrite)throw Error('group failure');return render.call(this,s,c);};let caught=false;
 try{encoded();}catch(e){caught=e.message==='group failure';}finally{renderer.render=render;}
 check(caught&&materials.every(m=>m.visible&&m.colorWrite)&&prop.visible,'failure leaked material mask or color write');
 check(normal().every((v,i)=>v===before[i]),'normal frame changed after rollback');
 check(!errors.length&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'effect occlusion shader/GPU error');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{depth.dispose();avatar.geometry.dispose();avatar.material.dispose();geometry.dispose();materials.forEach(m=>m.dispose());opaque.dispose();partial.dispose();renderer.dispose();}
