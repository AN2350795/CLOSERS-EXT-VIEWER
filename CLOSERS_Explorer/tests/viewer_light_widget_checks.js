import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setupAvatarLighting} from '/model-lighting.js';
import {normalizeViewerLights} from '/model-viewer-light.js';
import {createViewerLightHelpers} from '/model-viewer-light-helpers.js';
const $=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);},frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const change=(id,value)=>{const e=$(id);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
try{
 localStorage.clear();
 const model=buildModel({frames:[],meshes:[{name:'surface',source_id:1,frame:-1,vertices:[-2,-2,0,2,-2,0,0,2,0],indices:[0,2,1],normals:[0,0,-1,0,0,-1,0,0,-1],uv:[],skin:[],groups:[[0,3,0]],materials:[{texture:'BODY.PNG',color:[.5,.5,.5,1],toon_preview:{status:'approximate'}}]}]});
 const state={model,data:{sources:[]}};let loads=0;
 const ui=setupAvatarLighting({state,element,api:async()=>{loads++;return {profiles:[{key:'fixture',label:'원본 조명',direction:[0,0,-1],color:[1,1,1,1],intensity:1}],color_grading_presets:[]};},getEmissionEnabled:()=>false});
 const button=$('viewer-light-menu-toggle'),menu=$('viewer-light-menu'),detail=$('viewer-light-details-dialog');
 check(menu.hidden&&button.getAttribute('aria-expanded')==='false'&&$('viewport').contains(button),'round entry not in viewport');
 const saved=localStorage.getItem('closers-viewer-light-v2');button.click();check(!menu.hidden&&button.getAttribute('aria-expanded')==='true','round button did not open');
 check(['viewer-light-enabled','viewer-light-list','viewer-light-type','viewer-light-color','viewer-light-intensity','viewer-light-hide-overlays'].every(id=>menu.contains($(id))),'basic controls not in viewport menu');
 button.click();check(menu.hidden&&localStorage.getItem('closers-viewer-light-v2')===saved,'closing menu changed lighting');button.click();
 $('viewer-light-open-details').click();await frame();check(detail.open&&loads>0,'independent detailed menu did not load sources');
 check(['viewer-light-position-x','viewer-light-name','avatar-toon-enabled','avatar-lighting-profile','avatar-lighting-base-region'].every(id=>detail.contains($(id))),'light details not moved');
 check(!$('avatar-lighting-dialog').contains($('viewer-light-enabled'))&&!$('avatar-lighting-dialog').contains($('avatar-toon-enabled')),'lighting remained in material menu');
 change('viewer-light-shading','diffuse');change('viewer-light-ambient',0);$('viewer-light-close-details').click();await frame();check(!detail.open&&document.activeElement===$('viewer-light-open-details'),'detail close focus');
 $('open-avatar-lighting').click();check($('avatar-lighting-dialog').open&&$('avatar-lighting-title').textContent.includes('재질'),'material menu unavailable');$('close-avatar-lighting').click();
 for(const [name,values] of [['position',[0,0,10]],['target',[0,0,0]]])for(const [i,axis] of ['x','y','z'].entries())change(`viewer-light-${name}-${axis}`,values[i]);
 change('viewer-light-intensity',.5);change('viewer-light-enabled',true);
 const renderer=new T.WebGLRenderer({canvas:$('model-canvas'),antialias:false,preserveDrawingBuffer:true});renderer.setSize(256,256,false);renderer.outputColorSpace=T.LinearSRGBColorSpace;
 const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=20;camera.lookAt(0,0,0);const scene=new T.Scene();scene.add(model.root);ui.bindGizmo(camera,renderer.domElement);
 const capture=()=>{renderer.render(scene,camera);ui.renderHelpers(renderer,camera);const p=new Uint8Array(256*256*4),gl=renderer.getContext();gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
 const clean=capture();$('viewer-light-edit-3d').click();const editing=capture();check(editing.some((v,i)=>v!==clean[i]),'editing marks invisible');window.testCaptures=[{name:'viewer-light-icons',body:renderer.domElement.toDataURL()}];
 change('viewer-light-hide-overlays',true);const hidden=capture();check(hidden.every((v,i)=>v===clean[i])&&model.materials[0].userData.viewerLight.viewerLightEnabled.value===1&&$('viewer-light-enabled').checked,'hide overlays changed illumination');
 check(normalizeViewerLights(JSON.parse(localStorage.getItem('closers-viewer-light-v2'))).hideOverlays,'hide display preference lost');
 button.click();check(menu.hidden&&capture().every((v,i)=>v===clean[i]),'closing basic menu changed effect');button.click();change('viewer-light-hide-overlays',false);check(capture().some((v,i)=>v!==clean[i]),'showing marks failed');change('viewer-light-hide-overlays',true);
 const beforePlacement=JSON.parse(localStorage.getItem('closers-viewer-light-v2')).lights[0],cameraBefore=camera.position.toArray();
 $('viewer-light-tab-place').click();check(!$('viewer-light-panel-place').hidden&&$('viewer-light-panel-look').hidden,'placement grouping');$('viewer-light-preset-left').click();let placed=JSON.parse(localStorage.getItem('closers-viewer-light-v2')).lights[0];
 check(placed.position[0]<0&&placed.color===beforePlacement.color&&placed.intensity===beforePlacement.intensity&&camera.position.toArray().join()===cameraBefore.join(),'preset changed appearance values or camera');
 $('viewer-light-placement-undo').click();placed=JSON.parse(localStorage.getItem('closers-viewer-light-v2')).lights[0];check(placed.position.join()===beforePlacement.position.join()&&placed.target.join()===beforePlacement.target.join(),'preset undo');
 $('viewer-light-preset-camera').click();placed=JSON.parse(localStorage.getItem('closers-viewer-light-v2')).lights[0];check(placed.position[2]>placed.target[2],'camera-relative preset');$('viewer-light-placement-undo').click();
 $('viewer-light-tab-look').click();const storedBeforeSlider=localStorage.getItem('closers-viewer-light-v2'),slider=$('viewer-light-intensity-slider');slider.value=.75;slider.dispatchEvent(new Event('input',{bubbles:true}));check($('viewer-light-intensity').value==='0.75'&&model.materials[0].userData.viewerLight.viewerLights.value[0].intensity===.75&&localStorage.getItem('closers-viewer-light-v2')===storedBeforeSlider,'live intensity slider');slider.dispatchEvent(new Event('change',{bubbles:true}));check(JSON.parse(localStorage.getItem('closers-viewer-light-v2')).lights[0].intensity===.75,'slider persistence');change('viewer-light-intensity',.5);
 $('viewer-light-tab-look').focus();$('viewer-light-tab-look').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));check(document.activeElement===$('viewer-light-tab-place')&&!$('viewer-light-panel-place').hidden,'keyboard tabs');$('viewer-light-tab-look').click();
 $('viewer-light-open-source').click();check(detail.open&&$('viewer-light-detail-tab-source').getAttribute('aria-selected')==='true'&&!$('viewer-light-detail-panel-source').hidden,'direct source shortcut');$('viewer-light-close-details').click();await frame();check(document.activeElement===$('viewer-light-open-source'),'source shortcut focus');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));check(menu.hidden,'Escape did not close basic menu');button.click();
 const guides=createViewerLightHelpers(),rig=normalizeViewerLights({enabled:true,selected:0,lights:[{enabled:true,type:'spot',position:[1,2,3],target:[4,5,6]}]});guides.update({...rig,showHelpers:false,showIcons:true},true);
 const sun=guides.icons.children.find(o=>o.userData.kind==='light-icon'),target=guides.icons.children.find(o=>o.userData.kind==='target-icon');
 check(!guides.scene.visible&&guides.icons.visible&&sun.position.toArray().join()==='1,2,3'&&target.position.toArray().join()==='4,5,6','icons do not mark light and target independently');
 check(sun.material.map.image.toDataURL()!==target.material.map.image.toDataURL(),'source and target icons identical');
 const iconCamera=new T.OrthographicCamera(-10,10,10,-10,.1,100);iconCamera.position.z=20;iconCamera.lookAt(0,0,0);renderer.clear();guides.renderIcons(renderer,iconCamera);const icons=new Uint8Array(256*256*4),gl=renderer.getContext();gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,icons);
 let yellow=0,cyan=0;for(let i=0;i<icons.length;i+=4){if(icons[i]>150&&icons[i+1]>100&&icons[i+2]<100)yellow++;if(icons[i]<120&&icons[i+1]>150&&icons[i+2]>150)cyan++;}check(yellow>10&&cyan>10,'sun/target icons did not render on GPU');
 let texturesDisposed=0;sun.material.map.addEventListener('dispose',()=>texturesDisposed++);target.material.map.addEventListener('dispose',()=>texturesDisposed++);guides.dispose();guides.dispose();check(texturesDisposed===2,'icon textures leaked');
 const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);check(ids.length===new Set(ids).size,'control IDs duplicated');
 state.model=null;ui.refresh();button.click();button.click();check(!button.disabled&&!menu.hidden,'entry cannot open without a model');state.model=model;ui.refresh();capture();
 window.checkViewerLightLayout=async()=>{
   if(menu.hidden)button.click();await frame();
   const message=$('model-status'),originalText=message.textContent;
   for(const text of [originalText,'메시지가 여러 줄일 때도 조명 버튼이 겹치지 않아야 합니다. '.repeat(12)]){
     message.textContent=text;await frame();const lamp=button.getBoundingClientRect(),msg=message.getBoundingClientRect(),reset=$('reset-camera').getBoundingClientRect();
     check(Math.abs(lamp.top-msg.bottom-8)<=1&&Math.abs(lamp.left-$('viewport').getBoundingClientRect().left-10)<=1,'light button not below message');
     check(lamp.right<=reset.left||lamp.left>=reset.right||lamp.bottom<=reset.top||lamp.top>=reset.bottom,'light button overlaps camera reset '+innerWidth+'/'+innerHeight+' '+JSON.stringify({lamp:lamp.toJSON(),reset:reset.toJSON()}));
   }
   message.textContent=originalText;await frame();
   const rect=menu.getBoundingClientRect(),viewport=$('viewport').getBoundingClientRect();
   check(rect.left>=-1&&rect.right<=innerWidth+1&&rect.top>=-1&&rect.bottom<=innerHeight+1&&menu.scrollWidth<=menu.clientWidth+1,'light popup outside screen '+innerWidth+'/'+innerHeight);
   const detailButton=$('viewer-light-open-details').getBoundingClientRect(),hit=document.elementFromPoint(detailButton.x+detailButton.width/2,detailButton.y+detailButton.height/2);check(hit?.closest('button')===$('viewer-light-open-details'),'light popup clipped '+innerWidth+'/'+innerHeight+' hit '+hit?.id+' '+JSON.stringify(detailButton.toJSON()));
   $('viewer-light-open-details').click();for(const d of detail.querySelectorAll('details'))d.open=true;await frame();
   const bounds=detail.getBoundingClientRect(),close=$('viewer-light-close-details').getBoundingClientRect(),body=$('viewer-light-details-body');body.scrollTop=body.scrollHeight;await frame();
   check(bounds.left>=-1&&bounds.right<=innerWidth+1&&bounds.top>=-1&&bounds.bottom<=innerHeight+1&&body.scrollWidth<=body.clientWidth+1&&Math.abs($('viewer-light-close-details').getBoundingClientRect().top-close.top)<1,'detail overflow or moving close button '+innerWidth+'/'+innerHeight);
   for(const key of ['light','source','conditions']){$('viewer-light-detail-tab-'+key).click();await frame();check(body.scrollWidth<=body.clientWidth+1&&!$('viewer-light-detail-panel-'+key).hidden,'detail tab layout '+key);}
   $('viewer-light-close-details').click();return {status:'passed'};
 };
 await window.checkViewerLightLayout();document.body.dataset.checks='passed';
 // Keep the widget alive for the harness's responsive checks.
}catch(error){document.body.dataset.checks='failed';document.body.append(element('pre',error.stack));}
