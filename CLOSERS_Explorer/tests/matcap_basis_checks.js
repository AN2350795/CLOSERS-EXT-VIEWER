import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMatcapPreview,setMatcapPreviewMap,setMatcapNormalMap} from '/model-materials.js';
const check=(v,m)=>{if(!v)throw Error(m);},identity=new T.Matrix4().toArray();
function fixture(count=0,mirrorUv=false,degenerate=false){
  return {frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[{name:'surface',frame:-1,vertices:[-1.7,-.7,0,-.3,-.7,0,-1,.7,0],normals:[.6,0,.8,.6,0,.8,.6,0,.8],indices:[0,1,2],uv:degenerate?[0,0,0,0,0,0]:mirrorUv?[1,0,0,0,1,1]:[0,0,1,0,0,1],groups:[[0,3,0]],materials:[{color:[0,0,0,1],matcap_preview:{kind:'matcap',status:'approximate'}}],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}]};
}
try{
  const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(96,96);renderer.setClearColor(0);renderer.outputColorSpace=T.SRGBColorSpace;let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);const gl=renderer.getContext();
  const pixels=scene=>{renderer.render(scene,camera);const p=new Uint8Array(96*96*4);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;},srgb=x=>Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055));
  const ramp=new Uint8Array(256*4);for(let x=0;x<256;x++)ramp.set([x,0,0,255],x*4);
  const cap=new T.DataTexture(ramp,256,1);cap.needsUpdate=true;cap.magFilter=cap.minFilter=T.NearestFilter;cap.wrapS=cap.wrapT=T.ClampToEdgeWrapping;
  const bump=new T.DataTexture(new Uint8Array([255,128,128,255]),1,1);bump.needsUpdate=true;
  function setup(data){const model=buildModel(data),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);model.materials.forEach(m=>{setMatcapPreviewMap(m,cap);setMatcapNormalMap(m,bump);setMatcapPreview(m,true);});return {model,scene};}
  for(const mirrored of [false,true]){
    const data=fixture(0,mirrored),{model,scene}=setup(data),g=model.meshes[0].geometry,t=g.attributes.avatarUvTangent,b=g.attributes.avatarUvBitangent;
    check(t&&b,'generated UV tangent basis missing');
    for(const [key,source] of [['position','vertices'],['normal','normals'],['uv','uv']])check(g.attributes[key].array.every((v,i)=>Math.abs(v-data.meshes[0][source][i])<1e-6),'basis generation changed original '+key);
    check(g.index.array.every((v,i)=>v===data.meshes[0].indices[i]),'basis generation changed original indices');
    const expectedT=new T.Vector3(mirrored?-.8:.8,0,mirrored?.6:-.6),expectedB=new T.Vector3(0,1,0),n=new T.Vector3(.6,0,.8);
    for(let i=0;i<3;i++){check(new T.Vector3().fromBufferAttribute(t,i).distanceTo(expectedT)<1e-6,'tangent is not orthogonal to smooth source normal');check(new T.Vector3().fromBufferAttribute(b,i).distanceTo(expectedB)<1e-6,'mirrored UV bitangent handedness changed');}
    const expectedNormal=expectedT.clone().addScaledVector(expectedB,1/255).addScaledVector(n,1/255).normalize(),x=Math.min(255,Math.floor((expectedNormal.x*.5+.5)*256)),on=pixels(scene),index=(48*96+24)*4;
    check(Math.abs(on[index]-srgb(x/255))<=1,'GPU did not use generated vertex basis: '+mirrored);
    // Independently transform both basis axes across a mirrored model matrix.
    model.root.scale.x=-1;const flipped=pixels(scene),flippedX=Math.min(255,Math.floor((-expectedNormal.x*.5+.5)*256));check(Math.abs(flipped[(48*96+72)*4]-srgb(flippedX/255))<=1,'model reflection changed tangent handedness');model.dispose();
  }
  for(const count of [4,5]){
    const actual=setup(fixture(count)),reference=setup(fixture());actual.model.bones.forEach(b=>b.rotation.y=.4);reference.model.root.rotation.y=.4;actual.model.root.updateMatrixWorld(true);actual.model.skeletons.forEach(s=>s.update());
    const a=pixels(actual.scene),b=pixels(reference.scene);check(a.every((v,i)=>Math.abs(v-b[i])<=2),'vertex tangent/bitangent did not follow full skinning: '+count);actual.model.dispose();reference.model.dispose();
  }
  {
    const {model,scene}=setup(fixture()),g=model.meshes[0].geometry;
    g.attributes.avatarUvTangent.array.fill(0);g.attributes.avatarUvBitangent.array.fill(0);g.attributes.avatarUvTangent.needsUpdate=g.attributes.avatarUvBitangent.needsUpdate=true;
    const expectedNormal=new T.Vector3(1+.6/255,1/255,.8/255).normalize(),expected=srgb(Math.min(255,Math.floor((expectedNormal.x*.5+.5)*256))/255);
    check(Math.abs(pixels(scene)[(48*96+24)*4]-expected)<=1,'missing vertex basis lost derivative fallback');model.dispose();
  }
  {
    const {model,scene}=setup(fixture(0,false,true)),g=model.meshes[0].geometry;check([...g.attributes.avatarUvTangent.array,...g.attributes.avatarUvBitangent.array].every(v=>v===0),'degenerate UV created invalid basis');
    const on=pixels(scene),expected=srgb(Math.floor((.6*.5+.5)*256)/255);check(Math.abs(on[(48*96+24)*4]-expected)<=1,'degenerate UV lost vertex-normal fallback');setMatcapPreview(model.materials[0],false);check(pixels(scene).every((v,i)=>i%4===3||v===0),'basis OFF changed base color');model.dispose();
  }
  check(!shaderError,'vertex-basis shader failed');cap.dispose();bump.dispose();renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
