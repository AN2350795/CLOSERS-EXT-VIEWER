import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setMatcapPreview,setMatcapPreviewMap} from '/model-materials.js';
const check=(value,message)=>{if(!value)throw Error(message);};
try{
  const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(512,512);renderer.setClearColor(0x202630);renderer.outputColorSpace=T.SRGBColorSpace;
  let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
  const loader=new T.TextureLoader(),maps=new Map();window.testCaptures=[];
  for(const [id,file] of Object.entries(matcapFixture.images)){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(file.body),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{const map=await loader.loadAsync(url);map.flipY=false;map.colorSpace=T.SRGBColorSpace;maps.set(Number(id),map);}finally{URL.revokeObjectURL(url);}
  }
  const model=buildModel(matcapFixture.data),scene=new T.Scene();scene.add(model.root);
  for(const material of model.materials){
    const input=material.userData.input;
    if(input.image?.selected){material.map=maps.get(input.image.selected);material.map.wrapS=material.map.wrapT=T.RepeatWrapping;material.color.set(0xffffff);material.needsUpdate=true;}
    if(material.userData.matcapPreview){
      const map=maps.get(input.matcap_preview.image.selected);check(map,'original MatCap map resolved');map.wrapS=map.wrapT=T.ClampToEdgeWrapping;setMatcapPreviewMap(material,map);
    }
  }
  const box=new T.Box3();for(const mesh of model.meshes)if(mesh.visible)box.expandByObject(mesh,true);
  const center=box.getCenter(new T.Vector3()),distance=box.getSize(new T.Vector3()).length()*1.45;
  const camera=new T.PerspectiveCamera(40,1,.1,100000),gl=renderer.getContext();
  const capture=(label)=>{renderer.render(scene,camera);window.testCaptures.push({name:'matcap-bunny-'+label,body:renderer.domElement.toDataURL('image/png')});const result=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,result);return result;};
  for(const [label,yaw] of [['front',0],['side',.7],['back',Math.PI]]){
    camera.position.copy(center).add(new T.Vector3(Math.sin(yaw)*distance,distance*.12,Math.cos(yaw)*distance));camera.lookAt(center);camera.updateMatrixWorld(true);
    model.materials.forEach(m=>setMatcapPreview(m,false));const off=capture(label+'-off');
    model.materials.forEach(m=>setMatcapPreview(m,true));const on=capture(label+'-on');
    let changed=0;for(let i=0;i<on.length;i++){if(i%4===3)check(on[i]===off[i],'real MatCap changed alpha');else if(on[i]!==off[i])changed++;}
    check(changed>100,'visible MatCap contribution missing: '+label+' '+changed);
    model.materials.forEach(m=>setMatcapPreview(m,true,0));check(capture(label+'-zero').every((v,i)=>v===off[i]),'zero strength does not restore real costume');
    model.materials.forEach(m=>setMatcapPreview(m,false));check(capture(label+'-restored').every((v,i)=>v===off[i]),'OFF does not restore real costume');
  }
  check(!shaderError,'real MatCap shader compilation failed');
  model.dispose();maps.forEach(m=>m.dispose());renderer.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
