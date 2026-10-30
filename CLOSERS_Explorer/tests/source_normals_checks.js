import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMatcapPreview,setMatcapPreviewMap} from '/model-materials.js';
import {setAvatarToon,setAvatarToonMap} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
function fixture(count){return {frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[{name:'normal-oracle',frame:-1,vertices:[-1,-1,0,1,-1,0,0,1,0],normals:[.8,0,.6,0,.6,.8,-.6,0,.8],indices:[0,1,2],uv:[0,0,1,0,.5,1],groups:[[0,3,0]],materials:[{color:[0,0,0,1],matcap_preview:{kind:'matcap',status:'approximate'},toon_preview:{kind:'toon',status:'approximate'}}],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[i===0?1:0,1/count,i===1?1:0]}))}]};}
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(96,96);renderer.setClearColor(0);renderer.outputColorSpace=T.LinearSRGBColorSpace;
const camera=new T.OrthographicCamera(-3,3,3,-3,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext();let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
const capBytes=new Uint8Array(256*256*4),toonBytes=new Uint8Array(256*4);for(let y=0;y<256;y++)for(let x=0;x<256;x++)capBytes.set([x,y,0,255],(y*256+x)*4);for(let x=0;x<256;x++)toonBytes.set([x,0,0,255],x*4);
const cap=new T.DataTexture(capBytes,256,256),toon=new T.DataTexture(toonBytes,256,1);for(const t of [cap,toon]){t.needsUpdate=true;t.minFilter=t.magFilter=T.NearestFilter;t.wrapS=t.wrapT=T.ClampToEdgeWrapping;}
const capture=scene=>{renderer.render(scene,camera);const p=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
function oracle(data,model,count){
  const source=data.meshes[0],positions=[],normals=[];
  for(let v=0;v<3;v++){
    const p=new T.Vector3().fromArray(source.vertices,v*3),n=new T.Vector3().fromArray(source.normals,v*3),worldP=new T.Vector3(),worldN=new T.Vector3();
    if(count){for(let b=0;b<count;b++){const weight=source.skin[b].weights[v];worldP.addScaledVector(p.clone().applyMatrix4(model.bones[b].matrixWorld),weight);worldN.addScaledVector(n.clone().applyMatrix3(new T.Matrix3().setFromMatrix4(model.bones[b].matrixWorld)),weight);}}
    else{worldP.copy(p).applyMatrix4(model.root.matrixWorld);worldN.copy(n).applyMatrix3(new T.Matrix3().setFromMatrix4(model.root.matrixWorld));}
    positions.push(worldP.project(camera));normals.push(worldN.normalize());
  }
  for(let y=35;y<61;y++)for(let x=35;x<61;x++){
    const p=new T.Vector2((x+.5)/48-1,(y+.5)/48-1),[a,b,c]=positions,den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y),u=((b.y-c.y)*(p.x-c.x)+(c.x-b.x)*(p.y-c.y))/den,v=((c.y-a.y)*(p.x-c.x)+(a.x-c.x)*(p.y-c.y))/den,w=1-u-v;
    if(Math.min(u,v,w)<.2)continue;
    return {index:(y*96+x)*4,normal:normals[0].clone().multiplyScalar(u).addScaledVector(normals[1],v).addScaledVector(normals[2],w).normalize(),normals,weights:[u,v,w]};
  }
  throw Error('oracle triangle has no interior sample');
}
try{
  for(const count of [0,4,5])for(const mirror of [false,true])for(const scale of [1,1.8]){
    const data=fixture(count),model=buildModel(data),scene=new T.Scene();scene.add(model.root);model.root.scale.set(mirror?-scale:scale,scale===1?1:.7,scale===1?1:1.2);model.bones.forEach((b,i)=>b.rotation.y=i%2?-.7:.9);model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());const m=model.materials[0];
    setMatcapPreviewMap(m,cap);setMatcapPreview(m,true,1,false);const original=capture(scene),o=oracle(data,model,count),sample=original.slice(o.index,o.index+4),want=[o.normal.x*.5+.5,-o.normal.y*.5+.5].map(v=>Math.max(0,Math.min(255,Math.floor(v*256))));
    for(let c=0;c<2;c++)check(Math.abs(sample[c]-want[c])<=1,'source vertex-normal transform/normalization mismatch '+count+'/'+mirror+'/'+c+': '+sample[c]+' vs '+want[c]);
    setMatcapPreview(m,false);m.color.setRGB(1,1,1);setAvatarToonMap(m,toon);const direction=new T.Vector3(.6,.2,.8).normalize();setAvatarToon(m,true,{color:[1,1,1,1],direction:[direction.x,direction.y,-direction.z],intensity:1});
    const shaded=capture(scene),coordinate=o.normals.reduce((sum,n,i)=>sum+n.dot(direction)*o.weights[i],0),expected=Math.max(0,Math.min(255,Math.floor(coordinate*256)));
    check(Math.abs(shaded[o.index]-expected)<=1,'source toon vertex normal mismatch '+count+'/'+mirror);
    setAvatarToon(m,false,null);check(capture(scene)[o.index]===255,'normal correction changed unlit base material');model.dispose();
  }
  check(!shaderError,'source normal shaders failed');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{cap.dispose();toon.dispose();renderer.dispose();renderer.forceContextLoss();}
