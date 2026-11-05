import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setupAvatarLighting} from '/model-lighting.js';
import {normalizeViewerLight,setupViewerLight} from '/model-viewer-light.js';
import {setMaterialPreviewMap,setMaterialPreview} from '/model-materials.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id);
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
try{
 localStorage.clear();
 const normalized=normalizeViewerLight({type:'__proto__',position:[NaN,Infinity,1e40],intensity:-2,angle:900,color:'invalid'});
 check(normalized.type==='directional'&&normalized.position.join(',')==='100,200,100000'&&normalized.intensity===0&&normalized.angle===89&&normalized.color==='#ffffff','invalid saved settings');
 const identity=new T.Matrix4().toArray();
 const make=(count=0)=>buildModel({frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[{name:'surface',source_id:1,frame:-1,vertices:[-2,-2,0,2,-2,0,0,2,0],normals:[0,0,-1,0,0,-1,0,0,-1],indices:[0,2,1],uv:[0,0,1,0,.5,1],skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]})),groups:[[0,3,0]],materials:[{texture:'BODY.PNG',color:[.6,.6,.6,1],material_preview:{kind:'emissive',status:'approximate',color:[1,1,1,1],strength:1}}]}]});
 const model=make(),state={model,data:{sources:[]}};
 const ui=setupAvatarLighting({state,api:async()=>({profiles:[]}),element,getEmissionEnabled:()=>false});
 check($('avatar-lighting-panel-light').contains($('viewer-light-controls')),'viewer controls not inside viewer menu');
 const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true,alpha:true});renderer.setSize(32,32);renderer.outputColorSpace=T.LinearSRGBColorSpace;
 const scene=new T.Scene();scene.add(model.root);const camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);
 const pixel=()=>{renderer.render(scene,camera);const p=new Uint8Array(4);renderer.getContext().readPixels(16,16,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,p);return [...p];};
 const change=(id,value)=>{const e=$(id);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
 const vector=(name,values)=>['x','y','z'].forEach((axis,i)=>change('viewer-light-'+name+'-'+axis,values[i]));
 const baseline=pixel();check(baseline[0]>0,'baseline invisible');
 vector('position',[0,0,10]);vector('target',[0,0,0]);change('viewer-light-ambient',0);change('viewer-light-enabled',true);
 const front=pixel();check(Math.abs(front[0]-baseline[0])<=1,'directional front shading');
 vector('position',[0,0,-10]);const back=pixel();check(back[0]===0&&back[3]===baseline[3],'directional back or alpha');
 change('viewer-light-enabled',false);check(pixel().join()===baseline.join(),'OFF must restore exact pixels');
 change('viewer-light-enabled',true);vector('position',[0,0,10]);change('viewer-light-type','point');change('viewer-light-distance',20);
 const point=pixel();check(point[0]>0&&point[0]<front[0]&&$('viewer-light-target-x').closest('.viewer-light-vector').hidden,'point attenuation or controls');
 change('viewer-light-distance',5);check(pixel()[0]===0,'point range');
 change('viewer-light-distance',30);change('viewer-light-type','spot');const spot=pixel();check(spot[0]>0,'spot aimed at model');vector('target',[0,0,20]);check(pixel()[0]===0,'spot cone');
 change('viewer-light-type','ambient');change('viewer-light-intensity',.5);change('viewer-light-color','#ff0000');const ambient=pixel();check(ambient[0]>0&&ambient[1]===0&&ambient[2]===0,'ambient color');
 const mat=model.materials[0];mat.userData.avatarLighting.avatarEmissionPass.value=1;check(pixel()[0]===0,'viewer light affected emission-only pass');mat.userData.avatarLighting.avatarEmissionPass.value=0;
 const stored=localStorage.getItem('closers-viewer-light-v1');change('viewer-light-intensity','');check($('viewer-light-intensity').value==='0.5'&&localStorage.getItem('closers-viewer-light-v1')===stored,'empty input lost valid value');
 change('viewer-light-intensity',99);check($('viewer-light-intensity').value==='0.5','invalid input accepted');
 // Animated four- and five-weight paths share the position/normal contract.
 scene.remove(model.root);
 for(const count of [4,5]){
   const skinned=make(count);state.model=skinned;scene.add(skinned.root);ui.refresh();
   change('viewer-light-type','directional');change('viewer-light-color','#ffffff');change('viewer-light-intensity',1);vector('position',[0,0,10]);vector('target',[0,0,0]);
   check(Math.abs(pixel()[0]-baseline[0])<=1,'skinned normal '+count);
   for(const bone of skinned.bones)bone.position.z=-10;skinned.root.updateMatrixWorld(true);for(const skeleton of skinned.skeletons||[])skeleton.update();
   change('viewer-light-type','point');vector('position',[0,0,15]);change('viewer-light-distance',10);
   // World Z becomes +10 after the source coordinate reflection. An unskinned
   // position would lie outside the range, so this also checks deformation.
   camera.position.z=30;camera.updateMatrixWorld(true);check(pixel()[0]>0,'skinned world position '+count);camera.position.z=10;camera.updateMatrixWorld(true);
   scene.remove(skinned.root);skinned.dispose();
 }
 state.model=model;scene.add(model.root);ui.refresh();
 vector('position',[0,0,-10]);change('viewer-light-type','directional');
 const emission=new T.DataTexture(new Uint8Array([64,32,16,255]),1,1);emission.needsUpdate=true;setMaterialPreviewMap(mat,emission);setMaterialPreview(mat,true);
 const litEmission=pixel();check(litEmission[0]>0&&litEmission[1]>0,'surface lighting darkened self emission');
 mat.userData.avatarLighting.avatarEmissionPass.value=1;check(pixel().join()===litEmission.join(),'emission-only output changed');mat.userData.avatarLighting.avatarEmissionPass.value=0;emission.dispose();
 change('viewer-light-type','ambient');
 const replacement=make();scene.remove(model.root);scene.add(replacement.root);state.model=replacement;
 // A reopened controller restores storage and applies it to a different model.
 const restored=setupViewerLight({state,element});restored.refresh();check(replacement.materials[0].userData.viewerLight.viewerLightType.value===3&&replacement.materials[0].userData.viewerLight.viewerLightEnabled.value===1,'model replacement or persistence');
 state.model=null;restored.refresh();check(restored.panel.querySelector('[role=status]').textContent.includes('모델을 선택'),'empty model state');state.model=replacement;
 $('viewer-light-reset').click();check(!$('viewer-light-enabled').checked&&JSON.parse(localStorage.getItem('closers-viewer-light-v1')).type==='directional','reset');
 check(renderer.info.programs.every(p=>p.diagnostics?.runnable!==false),'shader compile failure');
 renderer.dispose();model.dispose();replacement.dispose();document.body.dataset.checks='passed';
}catch(error){document.body.dataset.checks='failed';document.body.append(element('pre',error.stack));}
