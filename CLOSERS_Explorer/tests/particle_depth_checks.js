import * as T from '/vendor/three/three.module.min.js';
import {createParticleModel} from '/particle-model.js';
import {buildModel} from '/model-core.js';
import {createDofDepthPass} from '/model-dof-depth.js';
const check=(v,m)=>{if(!v)throw Error(m);};
const renderer=new T.WebGLRenderer({alpha:true,antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.setClearColor(0,0);renderer.outputColorSpace=T.LinearSRGBColorSpace;
const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const white=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
const cutout=new T.DataTexture(new Uint8Array([255,255,255,0,255,255,255,255]),2,1);cutout.needsUpdate=true;
const probe=new T.Mesh(new T.PlaneGeometry(1.5,1.5),new T.MeshBasicMaterial({color:0x00ff00,transparent:true}));probe.position.z=-.2;probe.renderOrder=200;scene.add(probe);
const rule={seed:1,max_particles:1,rate:0,instant:1,life:2,emitter_life:2,deaths:1,radius:[0,0,0],radius_min:[0,0,0],gravity:[0,0,0],billboard:'BBT_NONE',layer:'ROL_EFFECT_0',frames:[]};
const gl=renderer.getContext(),errors=[];renderer.debug.onShaderError=()=>errors.push('shader');
const render=()=>{renderer.setRenderTarget(null);renderer.render(scene,camera);const out=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,out);return out;};
const pixel=(image,x=32)=>image.slice((32*64+x)*4,(32*64+x)*4+4);
const models=[];let avatar,depth,cases=0;
try{
  for(const blend of [['SRCALPHA','INVSRCALPHA'],['SRCALPHA','ONE']])for(const depth_test of [false,true])for(const depth_write of [false,true])for(const alpha of [0,.5]){
    const particle=createParticleModel({...rule,blend,depth_test,depth_write,tracks:[{property:'size',mode:'initial',value:[1.5,1.5,1]},{property:'color',mode:'initial',value:[1,0,0,alpha]}]},null,[white]);models.push(particle);scene.add(particle.root);scene.updateMatrixWorld(true);particle.update(.1,camera,particle.root);
    const out=pixel(render()),blocked=depth_test&&depth_write&&alpha>0;
    check(blocked?out[0]>100&&out[1]===0:out[0]===0&&out[1]===255,'particle depth mismatch '+JSON.stringify({blend,depth_test,depth_write,alpha,out:[...out]}));
    check(particle.meshes[0].isInstancedMesh&&particle.meshes[0].count===1,'test must draw the real instanced particle path');
    check(particle.meshes[0].material[0].depthWrite===depth_write&&particle.meshes[0].material[0].depthTest===depth_test,'declared flags changed');scene.remove(particle.root);particle.dispose();models.pop();cases++;
  }
  const particle=createParticleModel({...rule,blend:['SRCALPHA','ONE'],depth_test:true,depth_write:true,tracks:[{property:'size',mode:'initial',value:[1.5,1.5,1]},{property:'color',mode:'initial',value:[1,0,0,.5]}]},null,[cutout]);models.push(particle);scene.add(particle.root);scene.updateMatrixWorld(true);particle.update(.1,camera,particle.root);
  const holes=render();check(pixel(holes,20)[1]===255&&pixel(holes,44)[1]===0,'clear texels must not write particle depth');scene.remove(probe);
  avatar=buildModel({frames:[],meshes:[{name:'depth',frame:-1,vertices:[-.9,-.9,-1,.9,-.9,-1,.9,.9,-1,-.9,.9,-1],indices:[0,1,2,0,2,3],uv:[],skin:[],groups:[[0,6,0]],materials:[{color:[.1,.2,.3,1]}]}]});avatar.root.scale.z=1;scene.add(avatar.root);depth=createDofDepthPass(renderer);
  const encoded=()=>{depth.render(scene,camera,avatar,[0,4,8,.5],particle.meshes);const p=new Uint8Array(64*64*4);renderer.readRenderTargetPixels(depth.target,0,0,64,64,p);return p;};
  const before=render(),withParticle=encoded();particle.root.visible=false;const withoutParticle=encoded();particle.root.visible=true;
  check(withParticle.every((v,i)=>v===withoutParticle[i]),'blended particle must not invent encoded MRT2 coverage');
  check(render().every((v,i)=>v===before[i]),'DOF preparation changed normal particle rendering');
  check(cases===16&&errors.length===0&&gl.getError()===gl.NO_ERROR,'particle depth GPU checks incomplete');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{depth?.dispose();avatar?.dispose();for(const model of models)model.dispose();probe.geometry.dispose();probe.material.dispose();white.dispose();cutout.dispose();renderer.dispose();}
