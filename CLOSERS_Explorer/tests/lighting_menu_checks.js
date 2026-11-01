import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setupAvatarLighting,setAvatarToonMap,setAvatarExtMap} from '/model-lighting.js';
import {setMatcapPreviewMap,setMaterialPreviewMap} from '/model-materials.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id),frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const model=buildModel({frames:[],meshes:[{name:'상의',source_id:1,frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,1,2],uv:[0,0,1,0,0,1],skin:[],groups:[[0,3,0]],materials:[{texture:'BODY.PNG',color:[1,1,1,1],toon_preview:{status:'approximate',texture:'TOON.BMP'},second_preview:{status:'approximate'},ext_preview:{status:'approximate',texture:'BODY_EXT.PNG'},matcap_preview:{kind:'matcap',status:'approximate',texture:'GLOSS.PNG'},material_preview:{kind:'emissive',status:'approximate',texture:'LIGHT.PNG',color:[1,1,1,1],strength:1}}]}]});
model.materials[0].userData.input.second_preview.speed=[0,0];
const map=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1);map.needsUpdate=true;setAvatarToonMap(model.materials[0],map);setAvatarExtMap(model.materials[0],map);setMatcapPreviewMap(model.materials[0],map);setMaterialPreviewMap(model.materials[0],map);$('material-preview').disabled=false;
const profile={key:'source',label:'지역 · 평화의 광장 (황혼)',color:[1,.96,1,1],intensity:1,near_intensity:1.2,direction:[1,2,-3]};
const saved={selected:'source',enabled:true,legacyExplicit:true,toon:true,second:true,extSurfaceVersion:1,extSurface:true,extSurfaceFactor:.75,toonRotationVersion:1,toonRotation:{enabled:true,angles:[10,20,30]},cameraMixVersion:1,cameraMix:{enabled:true,calibrations:{REAPER:{near:10,far:20}}}};
saved.secondVersion=2;saved.bloomMode='source';localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify(saved));const state={model,data:{sources:[{entry_id:1,display_name:'성야의 바니 · 상의',model_group:{kind:'avatar',character:'REAPER'}}]}};
try{
 const ui=setupAvatarLighting({state,api:async()=>({profiles:[profile],color_grading_presets:[]}),element:(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;},getEmissionEnabled:()=>$('material-preview').checked});
 check(ui.getRenderOptions().bloomMode==='source'&&$('avatar-emission-mode').value==='source','saved bloom mode was lost');
 const opener=$('open-avatar-lighting');opener.focus();opener.click();for(let i=0;i<100&&$('avatar-lighting-profile').value!=='source';i++)await new Promise(r=>setTimeout(r,10));
 check(!$('avatar-lighting-enabled')&&!$('avatar-lighting-influence')&&model.materials[0].userData.avatarLighting.avatarLightEnabled.value===0,'retired comparison survived');
 check(document.querySelectorAll('#avatar-lighting-dialog [role=tab]').length===4&&$('avatar-lighting-tab-light').getAttribute('aria-selected')==='true','simple initial navigation');
 check($('avatar-lighting-experiments-notice').textContent.includes('4개')&&!$('avatar-lighting-experiments-notice').hidden,'saved experiments hidden without notice');
 check(!$('avatar-lighting-panel-advanced').contains($('avatar-matcap-enabled'))&&$('avatar-lighting-panel-advanced').contains($('avatar-second-enabled')),'normal effects and experiments mixed');
 $('avatar-lighting-review-advanced').click();check(!$('avatar-lighting-panel-advanced').hidden,'review action did not reveal saved experiments');
 $('avatar-lighting-experiments-off').click();const after=JSON.parse(localStorage.getItem('closers-avatar-lighting-v2'));
 check(!after.second&&!after.extSurface&&!after.toonRotation.enabled&&!after.cameraMix.enabled,'batch OFF lost effect state');
 check(after.toon&&after.selected==='source'&&after.extSurfaceFactor===.75&&after.toonRotation.angles.join(',')==='10,20,30'&&after.cameraMix.calibrations.REAPER.far===20,'batch OFF destroyed useful settings or calibration');
 check($('avatar-lighting-experiments-notice').hidden&&$('avatar-lighting-experiments-off').disabled,'notice stayed stale after OFF');
 const keys=['light','material','color','advanced'];for(const key of keys){$('avatar-lighting-tab-'+key).click();check(keys.every(other=>$('avatar-lighting-panel-'+other).hidden===(other!==key)),'multiple panels visible');}
 $('avatar-lighting-tab-light').focus();$('avatar-lighting-tab-light').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));check(document.activeElement===$('avatar-lighting-tab-material')&&!$('avatar-lighting-panel-material').hidden,'keyboard tab navigation');
 $('close-avatar-lighting').click();check(!$('avatar-lighting-dialog').open&&document.activeElement===opener,'close did not restore focus');opener.click();
 const ids=[...document.querySelectorAll('#avatar-lighting-dialog [id]')].map(e=>e.id);check(new Set(ids).size===ids.length,'moved controls duplicated IDs');
 window.checkLightingMenuLayout=async()=>{
  const dialog=$('avatar-lighting-dialog'),body=$('avatar-lighting-scroll'),close=$('close-avatar-lighting'),rect=e=>e.getBoundingClientRect(),inside=(a,b)=>a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;
  $('avatar-second-enabled').checked=true;$('avatar-second-enabled').dispatchEvent(new Event('change',{bubbles:true}));
  $('avatar-lighting-tab-advanced').click();for(const d of $('avatar-lighting-panel-advanced').querySelectorAll('details'))d.open=true;await frame();
  const top=rect(close);body.scrollTop=body.scrollHeight;await frame();const bottom=rect(close),bounds=rect(dialog);
  if(!inside(bounds,{left:0,right:innerWidth,top:0,bottom:innerHeight})||!inside(bottom,bounds)||Math.abs(top.top-bottom.top)>1||Math.abs(top.right-bottom.right)>1)return {status:'failed',errors:'Close button moves outside fixed header '+innerWidth+'/'+innerHeight};
  if(body.scrollHeight<=body.clientHeight||body.scrollTop<=0||body.scrollWidth>body.clientWidth+1||dialog.scrollWidth>dialog.clientWidth+1)return {status:'failed',errors:'Dialog scrolling or overflow '+innerWidth+'/'+innerHeight};
  for(const key of ['material','color','light']){
   $('avatar-lighting-tab-'+key).click();for(const d of $('avatar-lighting-panel-'+key).querySelectorAll('details'))d.open=true;await frame();
   if(body.scrollTop!==0||body.scrollWidth>body.clientWidth+1)return {status:'failed',errors:key+' panel overflow/reset'};
  }
  $('avatar-second-enabled').checked=false;$('avatar-second-enabled').dispatchEvent(new Event('change',{bubbles:true}));
  return {status:'passed'};
 };
 await window.checkLightingMenuLayout().then(result=>check(result.status==='passed',result.errors));
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
