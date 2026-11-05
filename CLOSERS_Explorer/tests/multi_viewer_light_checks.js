import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setupAvatarLighting} from '/model-lighting.js';
import {setupViewerLight,normalizeViewerLights,maxViewerLights} from '/model-viewer-light.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id);
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const change=(id,value)=>{const e=$(id);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
const select=index=>change('viewer-light-list',index),read=()=>JSON.parse(localStorage.getItem('closers-viewer-light-v2'));
const vector=(name,values)=>['x','y','z'].forEach((axis,i)=>change('viewer-light-'+name+'-'+axis,values[i]));
try{
 localStorage.clear();
 const legacy={enabled:false,mode:'diffuse',type:'ambient',color:'#ff0000',intensity:.25,ambient:0,position:[12,34,56],target:[1,2,3]};
 localStorage.setItem('closers-viewer-light-v1',JSON.stringify(legacy));
 const invalid=normalizeViewerLights({enabled:true,selected:99,ambient:NaN,lights:[null,...Array.from({length:8},()=>({enabled:true,name:'  ',type:'bad'}))]});
 check(invalid.lights.length===maxViewerLights&&invalid.selected===maxViewerLights-1&&invalid.ambient===.3&&invalid.lights[0].name==='조명 1','invalid rig normalization');
 check(normalizeViewerLights({lights:[]}).lights.length===1,'empty rig');
 const model=buildModel({frames:[],meshes:[{name:'surface',frame:-1,vertices:[-2,-2,0,2,-2,0,0,2,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{texture:'BODY.PNG',color:[.4,.4,.4,1]}]}]});
 const state={model,data:{sources:[]}};setupAvatarLighting({state,api:async()=>({profiles:[]}),element,getEmissionEnabled:()=>false});
 check(!$('viewer-light-enabled').checked&&$('viewer-light-item-enabled').checked&&$('viewer-light-type').value==='ambient'&&$('viewer-light-position-x').value==='12','legacy migration');
 const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true,alpha:true});renderer.setSize(32,32);renderer.outputColorSpace=T.LinearSRGBColorSpace;
 let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;
 const scene=new T.Scene();scene.add(model.root);const camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=10;camera.lookAt(0,0,0);
 const pixel=()=>{renderer.render(scene,camera);const p=new Uint8Array(4),gl=renderer.getContext();gl.readPixels(16,16,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};
 const baseline=pixel();change('viewer-light-enabled',true);const red=pixel();check(Math.abs(red[0]-baseline[0]*.25)<2&&red[1]===0&&red[2]===0,'legacy pixels');
 $('viewer-light-add').click();check(read().lights.length===2&&read().selected===1,'add selects new light');
 change('viewer-light-name','보조광');change('viewer-light-type','ambient');change('viewer-light-color','#0000ff');change('viewer-light-intensity',.5);
 const combined=pixel();check(combined[0]===red[0]&&combined[1]===0&&Math.abs(combined[2]-baseline[2]*.5)<2&&combined[3]===baseline[3],'lights must add, not multiply');
 const materialVersion=model.materials[0].version;
 change('viewer-light-item-enabled',false);check(pixel().join()===red.join(),'individual OFF');
 select(0);check($('viewer-light-color').value==='#ff0000'&&$('viewer-light-intensity').value==='0.25','select lost per-light settings');
 change('viewer-light-item-enabled',false);check(pixel().join()===baseline.join(),'all individual OFF must restore original');
 select(1);change('viewer-light-item-enabled',true);change('viewer-light-enabled',false);check(pixel().join()===baseline.join(),'master OFF');
 change('viewer-light-enabled',true);const blue=pixel();check(blue[0]===0&&blue[2]>0,'master ON lost individual state');
 select(0);change('viewer-light-item-enabled',true);change('viewer-light-ambient',.2);const withAmbient=pixel();
 check(Math.abs(withAmbient[1]-baseline[1]*.2)<2,'ambient counted once');
 $('viewer-light-add').click();$('viewer-light-add').click();check(read().lights.length===maxViewerLights&&$('viewer-light-add').disabled,'light limit');
 // All four shader branches contribute to one surface in the same draw call.
 select(1);change('viewer-light-type','spot');vector('position',[0,0,10]);vector('target',[0,0,0]);change('viewer-light-distance',20);
 select(2);change('viewer-light-type','directional');change('viewer-light-color','#00ff00');change('viewer-light-intensity',.25);vector('position',[0,0,10]);vector('target',[0,0,0]);
 select(3);vector('position',[0,0,10]);change('viewer-light-distance',20);
 const mixed=pixel(),expected=[.575,.575,.45];check(expected.every((factor,i)=>Math.abs(mixed[i]-baseline[i]*factor)<2),'mixed ambient/spot/directional/point sum');
 check(model.materials[0].version===materialVersion,'editing rebuilt shader');
 select(1);const before=read();check(before.lights[1].name==='보조광','renamed light lost');
 // A controller restored on the same material must replace all uniform slots.
 $('viewer-light-controls').remove();const restored=setupViewerLight({state,element});document.body.append(restored.panel);restored.refresh();
 check($('viewer-light-list').options.length===4&&$('viewer-light-list').value==='1'&&$('viewer-light-name').value==='보조광'&&read().lights[0].enabled,'rig persistence');
 $('viewer-light-remove').click();check(read().lights.length===3&&read().lights.every(light=>light.name!=='보조광')&&model.materials[0].userData.viewerLight.viewerLights.value[3].enabled===0,'deleted slot remained active');
 while(!$('viewer-light-remove').disabled)$('viewer-light-remove').click();
 check(read().lights.length===1&&read().selected===0&&model.materials[0].userData.viewerLight.viewerLights.value.slice(1).every(light=>light.enabled===0),'last light or stale slots');
 change('viewer-light-ambient',0);check(pixel().join()===red.join(),'deletion changed remaining light');
 // v2 takes priority over an older single-light entry on subsequent loads.
 localStorage.setItem('closers-viewer-light-v1','{"enabled":false,"type":"point"}');
 const another=setupViewerLight({state,element});another.refresh();check(model.materials[0].userData.viewerLight.viewerLightEnabled.value===1&&model.materials[0].userData.viewerLight.viewerLights.value[0].type===3,'legacy overwrote v2');
 $('viewer-light-reset').click();check(read().lights.length===1&&!read().enabled&&read().ambient===.3&&pixel().join()===baseline.join(),'whole rig reset');
 $('viewer-light-add').click();check(!read().enabled&&read().lights.length===2&&pixel().join()===baseline.join(),'adding light enabled master');
 check(!shaderError,'shader failed');renderer.dispose();model.dispose();document.body.dataset.checks='passed';
}catch(error){document.body.dataset.checks='failed';document.body.append(element('pre',error.stack));}
