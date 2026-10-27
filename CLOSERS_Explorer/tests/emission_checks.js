import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMaterialPreviewMap,setMaterialPreview} from '/model-materials.js';
import {createEmissionRenderer} from '/model-emission.js';
const check=(v,m)=>{if(!v)throw Error(m);};
try{
  const renderer=new T.WebGLRenderer({antialias:false});renderer.setSize(96,96);renderer.setClearColor(0x111823);let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const fx=createEmissionRenderer(renderer),scene=new T.Scene(),background=new T.Color(.02,.02,.02);scene.background=background;
  const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
  const data={frames:[],meshes:[0,1].map(k=>({name:'mesh'+k,frame:-1,vertices:[-1.7+k*2,-.7,0,-.3+k*2,-.7,0,-1+k*2,.7,0],indices:[0,1,2],uv:[0,0,1,0,0,1],skin:[],groups:[[0,3,0]],materials:[{color:k?[1,1,1,1]:[.1,.1,.1,1],...(k?{}:{material_preview:{kind:'emissive',status:'approximate',color:[1,.5,.1,1],strength:.8}})}]}))};
  const model=buildModel(data);model.root.scale.z=1;scene.add(model.root);const map=new T.DataTexture(new Uint8Array([128,64,32,255]),1,1);map.needsUpdate=true;setMaterialPreviewMap(model.materials[0],map);
  const gl=renderer.getContext(),capture=options=>{fx.render(scene,camera,model,options);const p=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
  const base=capture({bloom:false}),glow=capture({bloom:true,strength:1});let halo=0;
  for(let i=0;i<base.length;i+=4)if(base[i]<50&&glow[i]>base[i]+3)halo++;
  check(halo>50,'emission creates a halo outside its surface: '+halo);const right=(48*96+72)*4;check([0,1,2].every(c=>Math.abs(glow[right+c]-base[right+c])<=1),'white unlit clothing is not a bloom source');
  const solo=capture({solo:true,bloom:false});check(solo[(48*96+24)*4]>100&&solo[right]===0,'emission-only view shows the emitting region and blacks out unlit material');
  setMaterialPreview(model.materials[0],false);const off=capture({solo:true,bloom:true});check(off.every((v,i)=>i%4===3||v===0),'global emission off also removes the halo');setMaterialPreview(model.materials[0],true);
  model.meshes[1].position.set(-2,0,1);model.root.updateMatrixWorld(true);const covered=capture({bloom:false}),coveredGlow=capture({bloom:true});check(coveredGlow.every((v,i)=>Math.abs(v-covered[i])<=2),'opaque avatar geometry occludes emission and cannot leak a halo');
  check(scene.background===background&&renderer.getRenderTarget()===null&&model.materials.every(m=>m.userData.avatarLighting.avatarEmissionPass.value===0),'render pass restores model and renderer state');
  renderer.setSize(128,64);fx.render(scene,camera,model,{bloom:true});check(!shaderError,'emission and composite shaders compile across resize');
  const aa=new T.WebGLRenderer({antialias:true});aa.setSize(96,96);aa.autoClear=false;const aaFx=createEmissionRenderer(aa);aaFx.render(scene,camera,model,{bloom:true});const aaGl=aa.getContext(),aaPixels=new Uint8Array(96*96*4);aaGl.readPixels(0,0,96,96,aaGl.RGBA,aaGl.UNSIGNED_BYTE,aaPixels);check(aaGl.getError()===aaGl.NO_ERROR&&aaPixels.some((v,i)=>i%4!==3&&v>50),'antialiased viewer can resolve selective emission targets');check(!aa.autoClear,'postprocess restores an existing auto-clear setting');aaFx.dispose();aa.dispose();
  fx.dispose();model.dispose();map.dispose();renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
