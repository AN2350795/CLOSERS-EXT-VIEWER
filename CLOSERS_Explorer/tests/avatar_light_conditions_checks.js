import {setupAvatarLighting} from '/model-lighting.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id);
try{
  localStorage.removeItem('closers-avatar-lighting-v2');
  const state={model:{materials:[],meshes:[]},data:{sources:[{model_group:{kind:'avatar',character:'REAPER'}}]}};
  const profile={key:'CVN_COSTUME_UNIQUE_NETHERWORLD:211',group_id:211,label:'황천의 사자',characters:['REAPER'],color:[.3,.3,.3,1],direction:[-30,10,-100],intensity:1.025,near_intensity:1.025};
  const ui=setupAvatarLighting({state,api:async()=>({profiles:[profile],color_grading_presets:[]}),element:(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;},getEmissionEnabled:()=>false});
  const report=(status,count=10)=>({status,scope:'preview-items-only',target_group:211,candidates:[{status:status==='ready'?'ready':'incomplete',target_group:211,condition_id:211,matched_count:count,required_count:10}]});
  state.data.lighting_conditions=report('ready');ui.refresh();
  check($('avatar-lighting-condition-select').disabled,'selection enabled before profiles loaded');
  $('open-avatar-lighting').click();for(let i=0;i<20&&$('avatar-lighting-condition-select').disabled;i++)await new Promise(r=>setTimeout(r,10));
  check(!$('avatar-lighting-condition-select').disabled,'unique complete candidate unavailable');
  check($('avatar-lighting-profile').value===''&&!$('avatar-toon-enabled').checked,'diagnosis changed settings automatically');
  $('avatar-lighting-condition-select').click();
  check($('avatar-lighting-profile').value===profile.key,'candidate profile not selected');
  const saved=JSON.parse(localStorage.getItem('closers-avatar-lighting-v2'));
  check(saved.selected===profile.key&&!saved.toon&&!saved.enabled&&!saved.second,'selection enabled an effect');
  state.data.lighting_conditions=report('incomplete',8);ui.refresh();
  check($('avatar-lighting-condition-select').disabled&&$('avatar-lighting-conditions').textContent.includes('8 / 10'),'incomplete outfit allowed');
  check($('avatar-lighting-profile').value===profile.key,'changing outfit lost manual preference');
  state.data.lighting_conditions=report('ambiguous');ui.refresh();check($('avatar-lighting-condition-select').disabled&&$('avatar-lighting-condition-status').textContent.includes('여러'),'ambiguous conditions chose a light');
  state.data.lighting_conditions=report('unverified');ui.refresh();check($('avatar-lighting-condition-select').disabled,'unverified conditions chose a light');
  state.data.lighting_conditions=report('ready');state.data.sources[0].model_group.character='CASTER';ui.refresh();check($('avatar-lighting-condition-select').disabled,'wrong character accepted');
  state.data.sources[0].model_group.character='REAPER';state.model=null;ui.refresh();check($('avatar-lighting-condition-select').disabled,'cleared scene retained candidate');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
