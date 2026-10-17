import * as T from '/vendor/three/three.module.min.js';
import {buildModel,applyPose,restorePose} from '/model-core.js';

const check=(value,message)=>{if(!value)throw Error(message);};
const identity=()=>new T.Matrix4().toArray();
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
renderer.setSize(96,96);renderer.setClearColor(0x000000);
const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);
camera.position.z=10;camera.updateMatrixWorld(true);
const gl=renderer.getContext(),errors=[];
renderer.debug.onShaderError=()=>errors.push('shader compilation failed');
function pixels(scene){
  renderer.render(scene,camera);
  const result=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,result);
  return result;
}
function fixture(count,tiny=false){
  const weights=Array.from({length:count},(_,i)=>tiny?(i===count-1?1e-6:(1-1e-6)/(count-1)):(i+1)/(count*(count+1)/2));
  const vertices=Array.from({length:count===17?30:1},()=>[-.7,-.7,0,.7,-.7,0,0,.7,0]).flat();
  const indices=Array.from({length:vertices.length/3},(_,i)=>i);
  return {frames:weights.map((_,i)=>({name:'bone'+i,parent:-1,matrix:identity()})),meshes:[0,1].map(k=>({
    name:'mesh'+k,frame:-1,vertices,indices,uv:[],groups:[[0,indices.length,0]],
    materials:[{color:k?[0,1,0,1]:[1,0,0,1]}],
    skin:weights.map((w,i)=>({bone:'bone'+i,offset:identity(),indices,weights:indices.map(()=>k?weights[count-1-i]:w)})),
  }))};
}
try{
  for(const [count,tiny] of [[1,false],[4,false],[5,false],[8,false],[17,false],[5,true]]){
    const data=fixture(count,tiny),original=JSON.stringify(data),model=buildModel(data),scene=new T.Scene();
    // Compare in source coordinates; the viewer's Z reflection is independent.
    model.root.scale.z=1;model.root.updateMatrixWorld(true);
    scene.add(model.root);
    const textures=new Set();
    model.materials.forEach(material=>{
      const compile=material.onBeforeCompile;
      material.onBeforeCompile=function(shader,...args){compile.call(this,shader,...args);if(shader.uniforms.influenceTexture)textures.add(shader.uniforms.influenceTexture.value);};
    });
    const transforms=data.frames.map((_,i)=>{
      const q=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),i*.07);
      return [...q.toArray(),1+i*.01,1,1,i*.025,0,0];
    });
    const clip={mapping:{frames:data.frames.map((_,i)=>i)},keys:[
      {time:0,transforms:data.frames.map(()=>[0,0,0,1,1,1,1,0,0,0])},{time:1,transforms},
    ]};
    for(const time of [0,.5,1]){
      applyPose(model,clip,time);
      const referenceScene=new T.Scene(),resources=[];
      for(let mi=0;mi<model.meshes.length;mi++){
        const source=data.meshes[mi],mesh=model.meshes[mi],vertices=[];
        for(let vi=0;vi<source.vertices.length/3;vi++){
          const expected=new T.Vector3(),input=new T.Vector3().fromArray(source.vertices,vi*3);
          const total=source.skin.reduce((sum,s)=>sum+s.weights[vi],0);
          for(let bi=0;bi<count;bi++){
            const t=transforms[bi],q=new T.Quaternion().slerp(new T.Quaternion(...t.slice(0,4)),time);
            const m=new T.Matrix4().compose(new T.Vector3(t[7]*time,0,0),q,new T.Vector3(1+(t[4]-1)*time,1,1));
            expected.addScaledVector(input.clone().applyMatrix4(m),source.skin[bi].weights[vi]/total);
          }
          const actual=mesh.getVertexPosition(vi,new T.Vector3());
          check(actual.distanceTo(expected)<1e-6,'CPU skin mismatch: '+count+' at '+time);
          vertices.push(...expected.toArray());
        }
        const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setIndex(source.indices);
        const material=new T.MeshBasicMaterial({color:mi?0x00ff00:0xff0000});
        referenceScene.add(new T.Mesh(geometry,material));resources.push(geometry,material);
      }
      const actual=pixels(scene),expected=pixels(referenceScene);
      check(actual.some((v,i)=>i%4!==3&&v>0),'empty render');
      check(actual.every((v,i)=>v===expected[i]),'GPU skin mismatch: '+count+' at '+time);
      resources.forEach(r=>r.dispose());
    }
    restorePose(model,data);
    check(model.meshes[0].getVertexPosition(0,new T.Vector3()).distanceTo(new T.Vector3(-.7,-.7,0))<1e-6,'restore pose mismatch');
    check(JSON.stringify(data)===original,'source mutated');
    check(textures.size===(count>4?2:0),'wrong shader path');
    let disposed=0;textures.forEach(t=>t.addEventListener('dispose',()=>disposed++));
    model.dispose();check(disposed===textures.size,'influence texture leaked');
  }
  const invalid=fixture(5);invalid.meshes[0].skin[0].weights[0]=2;
  let rejected=false;try{buildModel(invalid);}catch(e){rejected=e.message.includes('합이 1');}
  check(rejected,'invalid weight sum accepted');
  check(errors.length===0,errors.join('\n'));
  document.body.dataset.checks='passed';
}catch(e){
  document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);
}finally{renderer.dispose();renderer.forceContextLoss();}
