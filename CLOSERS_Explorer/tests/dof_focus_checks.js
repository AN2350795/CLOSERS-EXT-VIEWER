import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {measureDofFocus} from '/model-dof.js';
import {setupAvatarLighting} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);},close=(a,b)=>Math.abs(a-b)<1e-5,$=id=>document.getElementById(id),identity=new T.Matrix4().toArray();
const camera=new T.PerspectiveCamera(40,1,.1,1000);camera.position.z=10;camera.updateMatrixWorld(true);
const data={frames:[{name:'unused',parent:-1,matrix:new T.Matrix4().makeTranslation(1000,1000,1000).toArray()}],meshes:[{name:'visible',frame:-1,vertices:[-1,-1,0,1,-1,0,0,1,0,10000,10000,10000],indices:[0,1,2],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,1,1,1]}]},{name:'equipment-hidden',frame:-1,equipment_hidden:true,vertices:[-1,-1,100,1,-1,100,0,1,100],indices:[0,1,2],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,1,1,1]}]}]};
let model,skin;const geometries=[],materials=[];
try{
 model=buildModel(data);model.root.scale.z=1;
 const expectedRange=Math.sqrt(8)/4,baseline=measureDofFocus(model,camera);check(close(baseline.focus,10)&&close(baseline.range,expectedRange),'hidden equipment, unused vertex or unused bone entered focus');
 const mesh=model.meshes[0],parent=new T.Group();model.root.add(parent);parent.add(mesh);parent.visible=false;check(measureDofFocus(model,camera)===null,'hidden ancestor entered focus');parent.visible=true;
 mesh.material[0].visible=false;check(measureDofFocus(model,camera)===null,'hidden material entered focus');mesh.material[0].visible=true;
 mesh.layers.set(1);check(measureDofFocus(model,camera)===null,'camera layer ignored');mesh.layers.set(0);
 model.root.visible=false;check(measureDofFocus(model,camera)===null,'hidden root entered focus');model.root.visible=true;
 parent.remove(mesh);check(measureDofFocus(model,camera)===null,'detached mesh entered focus');parent.add(mesh);
 mesh.geometry.setDrawRange(0,0);check(measureDofFocus(model,camera)===null,'empty draw range entered focus');mesh.geometry.setDrawRange(0,Infinity);
 // Only groups with actual visible materials participate. An unused group or
 // a triangle beyond drawRange must not expand the world geometry bounds.
 const extra=new T.BufferGeometry();geometries.push(extra);extra.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0,-1,-1,100,1,-1,100,0,1,100],3));extra.setIndex([0,1,2,3,4,5]);extra.addGroup(0,3,0);extra.addGroup(3,3,1);
 const hidden=new T.MeshBasicMaterial({visible:false});materials.push(hidden);const originalGeometry=mesh.geometry,originalMaterial=mesh.material;mesh.geometry=extra;mesh.material=[originalMaterial[0],hidden];check(close(measureDofFocus(model,camera).focus,10),'hidden material group entered focus');hidden.visible=true;extra.setDrawRange(0,3);check(close(measureDofFocus(model,camera).focus,10),'drawRange group intersection ignored');extra.setDrawRange(3,3);check(measureDofFocus(model,camera)===null,'behind-camera model accepted');mesh.geometry=originalGeometry;mesh.material=originalMaterial;
 parent.position.z=2;check(close(measureDofFocus(model,camera).focus,8),'parent transform did not update before click');parent.position.z=0;
 const nonIndexed=new T.BufferGeometry();geometries.push(nonIndexed);nonIndexed.setAttribute('position',new T.Float32BufferAttribute([-1,-1,2,1,-1,2,0,1,2,100,100,100],3));mesh.geometry=nonIndexed;mesh.material=originalMaterial[0];check(close(measureDofFocus(model,camera).focus,8),'non-indexed triangles or trailing vertex mishandled');mesh.geometry=originalGeometry;mesh.material=originalMaterial;
 // Five influences must follow the same CPU skinning override as the GPU.
 skin=buildModel({frames:Array.from({length:5},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[{...data.meshes[0],vertices:data.meshes[0].vertices.slice(0,9),skin:Array.from({length:5},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[.2,.2,.2]}))}]});skin.root.scale.z=1;
 check(close(measureDofFocus(skin,camera).focus,10),'initial skinned focus');for(const bone of skin.bones)bone.position.z=2;check(close(measureDofFocus(skin,camera).focus,8),'current five-weight pose ignored');skin.bones[4].position.z=7;check(close(measureDofFocus(skin,camera).focus,7),'fifth bone influence omitted');
 const rig=new T.Group();rig.position.z=3;rig.add(camera);check(close(measureDofFocus(model,camera).focus,13),'parented camera world position ignored');rig.position.z=0;camera.lookAt(0,0,20);check(measureDofFocus(model,camera)===null,'backward camera accepted');camera.lookAt(0,0,0);
 localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({sourceColor:true,dofVersion:1,dof:{enabled:false,focus:6,range:2,strength:.4}}));
 const state={model,data:{sources:[]}},ui=setupAvatarLighting({state,api:async()=>({profiles:[],color_grading_presets:[]}),element:(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;},getEmissionEnabled:()=>true});ui.updateCamera(camera);ui.refresh();
 $('avatar-dof-focus-model').click();check(close(Number($('avatar-dof-focus').value),10)&&close(Number($('avatar-dof-range').value),expectedRange)&&!$('avatar-dof-enabled').checked,'UI used total root bounds or enabled effect');
 const saved=localStorage.getItem('closers-avatar-lighting-v2');mesh.visible=false;$('avatar-dof-focus-model').click();check(localStorage.getItem('closers-avatar-lighting-v2')===saved&&Number($('avatar-dof-focus').value)===10&&$('avatar-dof-status').textContent.includes('기존 초점값은 유지'),'empty focus changed saved values or lacked feedback');mesh.visible=true;$('avatar-dof-focus-model').click();check($('avatar-dof-status').textContent==='심도 비교 꺼짐','focus failure notice did not clear');
 check(!measureDofFocus(null,camera)&&!measureDofFocus(model,null),'missing inputs accepted');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{model?.dispose();skin?.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
