import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {composeAvatarLight,interpolateAvatarLight,setAvatarToon,setAvatarToonMap,setupAvatarLighting} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);},close=(a,b)=>Math.abs(a-b)<1e-6,$=id=>document.getElementById(id),identity=new T.Matrix4().toArray();
const base={key:'world:fixture',label:'지역',color:[.8,.9,1,.25],direction:[0,0,-1],position:[20,30,-40],intensity:1.4,near_intensity:1.8,
 global_specular:{color:[.4,.5,.6,1],intensity:3,power:7},global_rim:{width:1.2,power:.1},sources:['WORLD.LUA']};
const skin={key:'skin:211',label:'스킨',group_id:211,light_id:2,characters:['REAPER'],selection_binding:{status:'source-verified',type:5,value:211,light_data_id:2},
 color:[.6,.25,.75,.1],direction:[0,0,1],intensity:.5,near_intensity:.2,extra_value:.75,sources:['LIGHT_CONVERT_DATA.NTF']};
const fixture=count=>({frames:Array.from({length:count},(_,i)=>({name:'b'+i,parent:-1,matrix:identity})),meshes:[{name:'mesh',source_id:1,frame:-1,
 vertices:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,1,0,0,1],groups:[[0,3,0]],
 materials:[{color:[.2,.3,.4,1],toon_preview:{status:'approximate'},ext_preview:{status:'approximate'},matcap_preview:{status:'approximate',kind:'matcap',specular:{color:[1,1,1,1],power:10}}}],
 skin:Array.from({length:count},(_,i)=>({bone:'b'+i,offset:identity,indices:[0,1,2],weights:[1/count,1/count,1/count]}))}]});
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.outputColorSpace=T.LinearSRGBColorSpace;
let shaderError=false;renderer.debug.onShaderError=()=>shaderError=true;const camera=new T.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=10;camera.updateMatrixWorld(true);
const map=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1);map.needsUpdate=true;const gl=renderer.getContext(),read=scene=>{renderer.render(scene,camera);const p=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
let uiModel,failProfiles=false;
try{
 const before=JSON.stringify([base,skin]),merged=composeAvatarLight(base,skin);
 check(merged.color.join(',')==='0.6,0.25,0.75,0.25','skin RGB/base alpha copy');
 check(merged.intensity===1.4&&merged.near_intensity===.2&&merged.extra_value===.75,'far max/near direct copy');
 check(merged.direction===base.direction&&merged.position===base.position&&merged.global_specular===base.global_specular&&merged.global_rim===base.global_rim,'base light fields replaced by skin');
 check(composeAvatarLight(null,skin)===skin&&composeAvatarLight(base,null)===base,'disabled/base-only changed input');
 check(close(interpolateAvatarLight(merged,.5).intensity,.8),'merge must precede distance interpolation');
 check(composeAvatarLight(base,{...skin,intensity:2}).intensity===2,'stronger skin intensity ignored');
 check(composeAvatarLight(base,{...skin,near_intensity:0}).near_intensity===0,'zero near lost');
 for(const [b,s,p] of [[{...base,intensity:NaN},skin,'maximum'],[base,{...skin,near_intensity:undefined},'maximum'],[base,{...skin,selection_binding:null},'maximum'],[base,skin,'unknown']])check(composeAvatarLight(b,s,p)===null,'invalid source silently guessed');
 check(JSON.stringify([base,skin])===before,'original sources mutated');
 for(const count of [0,4,5]){
  const model=buildModel(fixture(count)),scene=new T.Scene();model.root.scale.z=1;scene.add(model.root);const material=model.materials[0];setAvatarToonMap(material,map);
  setAvatarToon(material,true,skin);const standalone=read(scene);
  // Literal scalar oracles: max(1.4,.5) -> near .2 -> midpoint .8;
  // direct .5 -> near .2 -> midpoint .35. Neither uses base near 1.8.
  for(const [policy,intensity] of [['maximum',.8],['replace',.35]]){
   const profile=interpolateAvatarLight(composeAvatarLight(base,skin,policy),.5);setAvatarToon(material,true,profile);const pixels=read(scene),index=(32*64+32)*4;
   for(let c=0;c<3;c++)check(Math.abs(pixels[index+c]-Math.round(255*[.2,.3,.4][c]*[.6,.25,.75][c]*intensity))<=1,'GPU composition scalar oracle '+count+'/'+policy+'/'+c);
   check(pixels[index+3]===255,'composition changed material alpha');
  }
  setAvatarToon(material,true,composeAvatarLight(null,skin));check(read(scene).every((v,i)=>v===standalone[i]),'composition OFF did not restore exact pixels');model.dispose();
 }
 check(!shaderError,'composition shader failed');
 localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({selected:skin.key,toon:true,regionMixVersion:1,baseRegion:window.restoreLightComposition?base.key:'',intensityPolicy:window.restoreLightComposition?'replace':'maximum'}));
 localStorage.setItem('closers-avatar-matcap-v1',JSON.stringify({lightMode:'region'}));
 uiModel=buildModel(fixture(0));setAvatarToonMap(uiModel.materials[0],map);
 const state={model:uiModel,data:{sources:[{entry_id:1,model_group:{kind:'avatar',character:'REAPER'}}]}};
 const ui=setupAvatarLighting({state,api:async()=>{if(failProfiles)throw Error('composition source unavailable');return {profiles:[skin,base],color_grading_presets:[]};},element:(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;},getEmissionEnabled:()=>false});
 $('open-avatar-lighting').click();for(let i=0;i<100&&$('avatar-lighting-base-region').options.length<2;i++)await new Promise(r=>setTimeout(r,10));
 const region=$('avatar-lighting-base-region'),policy=$('avatar-lighting-intensity-policy'),u=uiModel.materials[0].userData.avatarLighting,change=(e,value)=>{e.value=value;e.dispatchEvent(new Event('change'));};
 check(region.value===(window.restoreLightComposition?base.key:''),'default/restored base region');
 check(policy.value===(window.restoreLightComposition?'replace':'maximum'),'default/restored intensity policy');
 if(!window.restoreLightComposition)change(region,base.key);
 change(policy,'maximum');check(close(u.avatarToonIntensity.value,1.4)&&u.avatarToonDirection.value.z===1,'UI max or base direction not applied');
 check(close(u.avatarExtIntensity.value,3)&&close(u.avatarRimWidth.value,1.2),'regional specular/rim lost');
 check(uiModel.materials[0].userData.matcapPreview.uniforms.avatarSpecularLightPosition.value.join(',')==='20,30,40','MatCap reflection lost base position');
 const mix=$('avatar-lighting-near-mix');mix.value='.5';mix.dispatchEvent(new Event('input'));check(close(u.avatarToonIntensity.value,.8),'UI applied max after near mix');
 change(policy,'replace');check(close(u.avatarToonIntensity.value,.35),'UI direct path missing');
 const info=JSON.parse($('avatar-lighting-source').textContent);check(info.composition.policy==='replace'&&info.global_specular.intensity===3&&info.color[3]===.25,'composed inspector incorrect');
 let saved=JSON.parse(localStorage.getItem('closers-avatar-lighting-v2'));check(saved.baseRegion===base.key&&saved.intensityPolicy==='replace'&&saved.selected===skin.key,'composition overwrote manual choice');
 $('avatar-lighting-auto').click();change($('avatar-skin-light-selection'),'none');check(close(u.avatarToonIntensity.value,1.6)&&u.avatarToonColor.value.r===.8,'no skin did not retain regional base');
 change($('avatar-skin-light-selection'),skin.key);check(close(u.avatarToonIntensity.value,.35),'explicit skin composition did not resume');
 change(region,'');check(close(u.avatarToonIntensity.value,.35)&&u.avatarToonDirection.value.z===-1&&policy.disabled,'OFF retained regional direction');
 change(region,base.key);document.querySelector('#avatar-lighting-dialog button').click();failProfiles=true;$('open-avatar-lighting').click();for(let i=0;i<100&&!$('avatar-lighting-status').textContent.includes('composition source unavailable');i++)await new Promise(r=>setTimeout(r,10));
 check(u.avatarToonEnabled.value===0&&$('avatar-lighting-composition-status').textContent.includes('보류'),'source failure kept stale composition');
 document.querySelector('#avatar-lighting-dialog button').click();failProfiles=false;$('open-avatar-lighting').click();for(let i=0;i<100&&u.avatarToonEnabled.value===0;i++)await new Promise(r=>setTimeout(r,10));check(u.avatarToonEnabled.value===1&&close(u.avatarToonIntensity.value,.35),'source retry did not restore composition');
 $('avatar-toon-enabled').click();check(!u.avatarToonEnabled.value&&!$('avatar-toon-enabled').checked,'composition silently enabled toon');
 check(!$('avatar-second-enabled').checked,'composition enabled hyper tint');
 state.model=null;ui.refresh();check(!u.avatarToonEnabled.value,'clear changed disposed material state');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{uiModel?.dispose();map.dispose();renderer.dispose();renderer.forceContextLoss();}
