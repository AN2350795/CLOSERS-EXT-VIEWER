import * as T from '/vendor/three/three.module.min.js';
import {buildModel} from '/model-core.js';
import {setupAvatarLighting,setAvatarToonMap} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id),until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+fn);};
const common={key:'CVN_SKIN_COMMON:1411',group_id:1411,label:'일반 스킨',characters:['REAPER'],color:[1,1,1,1],direction:[0,0,-1],intensity:1,near_intensity:1},nether={...common,key:'CVN_COSTUME_UNIQUE_NETHERWORLD:211',group_id:211,label:'황천의 사자',color:[.3,.3,.3,1],intensity:1.025,near_intensity:1.025};
common.light_id=3;common.selection_binding={status:'source-verified',type:5,value:1411,light_data_id:3};nether.light_id=2;nether.selection_binding={status:'source-verified',type:5,value:211,light_data_id:2};
const condition=(status,target=211)=>({status,target_group:target,scope:'preview-items-only',candidates:[{status:status==='ready'?'ready':'incomplete',target_group:target,condition_id:211,matched_count:status==='ready'?10:8,required_count:10}]});
let model,map;
try{
 localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({selected:common.key,toon:true,autoProfile:!!window.restoreAutoProfile,skinSelectionVersion:1,skinSelection:window.restoreAutoProfile?common.key:'unknown'}));
 model=buildModel({frames:[],meshes:[{name:'mesh',source_id:1,frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],uv:[0,0,1,0,0,1],skin:[],groups:[[0,3,0]],materials:[{color:[1,1,1,1],toon_preview:{status:'approximate'}}]}]});
 map=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1);map.needsUpdate=true;setAvatarToonMap(model.materials[0],map);
 const state={model,data:{sources:[{entry_id:1,model_group:{kind:'avatar',character:'REAPER'}}],lighting_conditions:condition('ready')}},u=model.materials[0].userData.avatarLighting;
 const ui=setupAvatarLighting({state,api:async()=>({profiles:[common,nether],color_grading_presets:[]}),element:(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;},getEmissionEnabled:()=>false});
 $('open-avatar-lighting').click();await until(()=>$('avatar-lighting-profile').options.length===3);
 const auto=$('avatar-lighting-auto'),select=$('avatar-lighting-profile'),skin=$('avatar-skin-light-selection'),chooseSkin=value=>{skin.value=value;skin.dispatchEvent(new Event('change'));};
 check(auto.checked===!!window.restoreAutoProfile,'auto preference default/restoration');
 if(window.restoreAutoProfile){check(skin.value===common.key&&select.value===common.key&&u.avatarToonColor.value.r===1,'saved skin selection did not override inferred outfit');chooseSkin('unknown');}
 if(!auto.checked){check(select.value===common.key&&u.avatarToonColor.value.r===1,'manual default lost');auto.click();}
 check(select.disabled&&select.value===nether.key&&u.avatarToonEnabled.value===1&&Math.abs(u.avatarToonColor.value.r-.3)<1e-6,'auto target did not reach toon uniforms');
 check(u.avatarToonIntensity.value===1.025,'auto target source intensity not used');
 let saved=JSON.parse(localStorage.getItem('closers-avatar-lighting-v2'));check(saved.selected===common.key,'auto overwrote manual backup');
 check($('avatar-toon-enabled').checked&&!$('avatar-lighting-enabled').checked&&!$('avatar-second-enabled').checked,'auto changed effect switches');
 for(const status of ['incomplete','ambiguous','unverified','unavailable']){state.data.lighting_conditions=condition(status);ui.refresh();check(u.avatarToonEnabled.value===0&&select.value===''&&$('avatar-lighting-auto-status').textContent.includes('보류'),'invalid candidate retained automatic lighting: '+status);}
 state.data.lighting_conditions=condition('ready');state.data.lighting_conditions.candidates.push({status:'unverified',target_group:1411});ui.refresh();check(u.avatarToonEnabled.value===0,'unverified competing condition ignored');
 state.data.lighting_conditions=condition('ready',1411);ui.refresh();check(select.value===common.key&&u.avatarToonColor.value.r===1,'equipment change did not switch auto light');
 state.data.lighting_conditions=condition('ready');state.data.sources[0].model_group.character='CASTER';ui.refresh();check(u.avatarToonEnabled.value===0,'wrong-character auto light applied');
 state.data.sources[0].model_group.character='REAPER';ui.refresh();check(u.avatarToonEnabled.value===1,'valid candidate failed to resume');
 chooseSkin(common.key);check(select.value===common.key&&u.avatarToonColor.value.r===1,'selected skin did not take priority over outfit');
 state.data.lighting_conditions=condition('ambiguous');ui.refresh();check(u.avatarToonEnabled.value===1&&select.value===common.key,'explicit selection was blocked by competing equipment candidates');
 state.data.lighting_conditions=condition('incomplete');ui.refresh();check(u.avatarToonEnabled.value===1,'explicit selection inferred missing equipment instead of reading chosen state');
 chooseSkin('none');check(u.avatarToonEnabled.value===0&&select.value===''&&$('avatar-skin-light-status').textContent.includes('선택 없음'),'explicit zero selection applied inferred skin');
 state.data.lighting_conditions=condition('ready');ui.refresh();check(u.avatarToonEnabled.value===0,'eligible outfit overrode explicit no selection');
 chooseSkin(common.key);state.data.sources[0].model_group.character='CASTER';ui.refresh();check(u.avatarToonEnabled.value===0,'explicit selection bypassed character check');
 state.data.sources[0].model_group.character='REAPER';state.data.sources[0].model_group.kind='npc';ui.refresh();check(u.avatarToonEnabled.value===0,'NPC accepted selected skin');
 state.data.sources[0].model_group.kind='avatar';common.selection_binding.type=7;ui.refresh();check(u.avatarToonEnabled.value===0,'another effect kind was accepted as a skin light');common.selection_binding.type=5;
 chooseSkin('unknown');check(select.value===nether.key&&u.avatarToonEnabled.value===1,'unknown state did not return to equipment inference');
 auto.click();check(!select.disabled&&select.value===common.key&&u.avatarToonColor.value.r===1,'auto OFF did not restore manual profile');
 $('avatar-toon-enabled').click();auto.click();check(!u.avatarToonEnabled.value&&!$('avatar-toon-enabled').checked,'auto enabled previously disabled toon');
 saved=JSON.parse(localStorage.getItem('closers-avatar-lighting-v2'));check(saved.autoProfile&&saved.selected===common.key&&!saved.toon,'auto/manual preference persistence');
 chooseSkin('none');saved=JSON.parse(localStorage.getItem('closers-avatar-lighting-v2'));check(saved.skinSelectionVersion===1&&saved.skinSelection==='none','explicit zero state not saved');
 state.model=null;ui.refresh();check(select.value===''&&select.disabled,'cleared scene retained auto profile');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{model?.dispose();map?.dispose();}
