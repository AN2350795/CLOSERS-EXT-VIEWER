const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
try{
  const {setupMotions}=await import('/model-motions.js');
  const $=id=>document.getElementById(id),element=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const state={model:{},generation:1,ids:[1],data:{skeleton_source:{entry_id:1,sha256:'rig'},sources:[]},animation:null};
  const clip=(index,name)=>({index,name,duration:1,secondary:name});
  const pack=(id,name,category,clips)=>({id,name,category,clips,archive:'archive-'+id,ordinal:id,status:'ready',skeleton_id:1});
  const files=[pack(10,'MOTION_STRIKER.XMD','basic',[clip(0,'IDLE'),clip(1,'_DEFAULT')]),
    pack(11,'MOTION_STRIKER_SKILL.XMD','skill',Array.from({length:65},(_,i)=>clip(i,'SKILL_'+i))),
    pack(12,'MOTION_STRIKER_SKILL.XMD','skill',[clip(0,'SKILL_DUPLICATE')]),
    {...pack(13,'MOTION_STRIKER_BROKEN.XMD','other',[]),status:'unavailable',error:'검증 실패'},
    {...pack(14,'MOTION_STRIKER_EMOTION_BIKE.XMD','emotion',[clip(0,'BIKE')]),skeleton_id:2,skeleton_name:'MOTION_STRIKER_EMOTION_BIKE.X'}];
  let selected=null,rig=null,release=null,delay=false;
  const api=async()=>{if(delay)await new Promise(r=>release=r);return {files,categories:{basic:'기본',skill:'스킬',emotion:'이모션',other:'기타'},skeleton_source:{sha256:'rig'},evidence:'파일명 기준'};};
  setupMotions({state,api,element,operation:async fn=>fn(),
    connectAnimation:async id=>{state.animation={id};},chooseClip:async index=>{selected=[state.animation.id,index];},
    loadModel:async(ids,id)=>{rig=id;state.data.skeleton_source.entry_id=id;state.generation++;document.dispatchEvent(new Event('model-selection'));}});
  $('open-motions').click();await until(()=>$('motion-results').children.length);
  check($('motion-library').open,'library opens');
  check($('motion-results').children.length===60,'large libraries use pagination');
  $('motion-next').click();check($('motion-results').textContent.includes('검증 실패'),'unreadable packs remain visible');
  check([...$('motion-results').querySelectorAll('button')].some(b=>b.disabled),'failed mappings cannot play');
  $('motion-search').value='SKILL_DUPLICATE';$('motion-search').dispatchEvent(new Event('input'));
  check($('motion-results').children.length===1,'search spans packs');
  document.querySelector('#motion-results button').click();await until(()=>selected);
  check(selected[0]===12&&selected[1]===0&&!$('motion-library').open,'duplicate pack keeps exact source ID');
  $('open-motions').click();$('motion-search').value='';$('motion-search').dispatchEvent(new Event('input'));
  $('motion-category').value='basic';$('motion-category').dispatchEvent(new Event('change'));
  check($('motion-results').children.length===1,'default verification poses hidden initially');
  $('motion-defaults').checked=true;$('motion-defaults').dispatchEvent(new Event('change'));
  check($('motion-results').children.length===2,'verification poses can be included');
  $('motion-category').value='emotion';$('motion-category').dispatchEvent(new Event('change'));
  check($('motion-results').textContent.includes('전용 뼈'),'alternate rig is explained before selection');
  selected=null;document.querySelector('#motion-results button').click();await until(()=>selected);
  check(rig===2&&selected[0]===14,'verified alternate skeleton is loaded before clip selection');
  state.generation++;state.data.skeleton_source={entry_id:1,sha256:'rig'};document.dispatchEvent(new Event('model-selection'));
  delay=true;$('open-motions').click();await until(()=>release);
  state.generation++;document.dispatchEvent(new Event('model-selection'));release();await new Promise(r=>setTimeout(r,20));
  check(!$('motion-results').children.length&&!$('motion-library').open,'old responses cannot populate a different model');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
