const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
try{
  const {setupMotions}=await import('/model-motions.js');
  const $=id=>document.getElementById(id),element=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const state={model:{},generation:1,ids:[1],data:{skeleton_source:{entry_id:1,sha256:'rig'},sources:[]},animation:null};
  const clip=(index,name)=>({index,name,duration:1,secondary:name,...(name==='IDLE'?{display_name:'인사하기',game_names:['인사하기']}: {})});
  const pack=(id,name,category,clips)=>({id,name,category,clips,archive:'archive-'+id,ordinal:id,status:'ready',skeleton_id:1});
  const files=[pack(10,'MOTION_STRIKER.XMD','basic',[clip(0,'IDLE'),clip(1,'_DEFAULT')]),
    pack(11,'MOTION_STRIKER_SKILL.XMD','skill',Array.from({length:65},(_,i)=>clip(i,'SKILL_'+i))),
    pack(12,'MOTION_STRIKER_SKILL.XMD','skill',[clip(0,'SKILL_DUPLICATE')]),
    {...pack(13,'MOTION_STRIKER_BROKEN.XMD','other',[]),status:'unavailable',error:'검증 실패'},
    {...pack(14,'MOTION_STRIKER_EMOTION_BIKE.XMD','emotion',[clip(0,'BIKE')]),skeleton_id:2,skeleton_name:'MOTION_STRIKER_EMOTION_BIKE.X'}];
  let selected=null,rig=null,release=null,delay=false;
  files[1].clips[0].motion_categories=['town'];
  files[1].clips[0].motion_registrations=[{type:'SCT_TOWN_MOTION',group:210,state:'USN_IDLE',source:'TOWN_MOTION_CONVERT_DATA.NTF'}];
  files[1].saved_exists=true;
  const api=async()=>{if(delay)await new Promise(r=>release=r);return {files,categories:{basic:'기본',skill:'스킬',emotion:'이모션',other:'기타',town:'아바타 타운'},skeleton_source:{sha256:'rig'},evidence:'파일명 기준'};};
  setupMotions({state,api,element,operation:async fn=>fn(),
    connectAnimation:async id=>{state.animation={id};},chooseClip:async index=>{state.clip={clip:{index}};selected=[state.animation.id,index];},
    loadModel:async(ids,id)=>{rig=id;state.data.skeleton_source.entry_id=id;state.generation++;document.dispatchEvent(new Event('model-selection'));}});
  $('open-motions').click();await until(()=>$('motion-results').children.length);
  check($('motion-library').open,'library opens');
  check(document.querySelector('.motion-name').textContent==='인사하기','game name is the clear primary title');
  check(!document.querySelector('.motion-detail-body').checkVisibility(),'source metadata starts collapsed');
  check(!document.querySelector('.motion-details').open,'details are optional for each item');
  document.querySelector('.motion-details summary').click();
  check(document.querySelector('.motion-detail-body').checkVisibility()&&document.querySelector('.motion-detail-body').textContent.includes('archive-10'),'source is available when requested');
  document.querySelector('.motion-details summary').click();
  check(document.querySelectorAll('.motion-categories button').length===6,'categories appear as compact tabs');
  document.querySelector('.motion-categories [data-category="town"]').click();
  check($('motion-results').children.length===1&&$('motion-results').textContent.includes('SKILL 0'),'table registration finds town clips outside TOWN filename packs');
  check($('motion-results').textContent.includes('타운 그룹 210'),'registered town group is visible in source details');
  check(document.querySelector('#motion-results a').getAttribute('href').startsWith('/api/download/11?token='),'original XMD download retains the exact source');
  $('motion-category').value='';$('motion-category').dispatchEvent(new Event('change'));
  $('motion-search').value='타운 그룹 210';$('motion-search').dispatchEvent(new Event('input'));
  check($('motion-results').children.length===1,'town group is searchable across packs');
  $('motion-search').value='인사하기';$('motion-search').dispatchEvent(new Event('input'));
  check($('motion-results').children.length===1,'Korean game name is searchable across the library');
  $('motion-search').value='';$('motion-search').dispatchEvent(new Event('input'));
  check($('motion-results').children.length===60,'large libraries use pagination');
  $('motion-next').click();check($('motion-results').textContent.includes('검증 실패'),'unreadable packs remain visible');
  check([...$('motion-results').querySelectorAll('button')].some(b=>b.disabled),'failed mappings cannot play');
  $('motion-search').value='SKILL_DUPLICATE';$('motion-search').dispatchEvent(new Event('input'));
  check($('motion-results').children.length===1,'search spans packs');
  document.querySelector('#motion-results button').click();await until(()=>selected);
  check(selected[0]===12&&selected[1]===0&&!$('motion-library').open,'duplicate pack keeps exact source ID');
  $('open-motions').click();check(document.querySelector('.motion-result.is-selected'),'selected motion is highlighted on return');$('motion-search').value='';$('motion-search').dispatchEvent(new Event('input'));
  document.querySelector('.motion-categories [data-category="basic"]').click();
  check(document.querySelector('.motion-categories [data-category="basic"]').getAttribute('aria-pressed')==='true','active category is announced');
  check($('motion-results').children.length===1,'default verification poses hidden initially');
  $('motion-defaults').checked=true;$('motion-defaults').dispatchEvent(new Event('change'));
  check($('motion-results').children.length===2,'verification poses can be included');
  check([...document.querySelectorAll('.motion-result')].every(row=>row.getBoundingClientRect().height<=64),'motion rows remain compact with details closed');
  $('motion-category').value='emotion';$('motion-category').dispatchEvent(new Event('change'));
  check($('motion-results').textContent.includes('전용 뼈'),'alternate rig is explained before selection');
  selected=null;document.querySelector('#motion-results button').click();await until(()=>selected);
  check(rig===2&&selected[0]===14,'verified alternate skeleton is loaded before clip selection');
  state.generation++;state.data.skeleton_source={entry_id:1,sha256:'rig'};document.dispatchEvent(new Event('model-selection'));
  delay=true;$('open-motions').click();await until(()=>release);
  state.generation++;document.dispatchEvent(new Event('model-selection'));release();await new Promise(r=>setTimeout(r,20));
  check(!$('motion-results').children.length&&!$('motion-library').open,'old responses cannot populate a different model');
  delay=false;$('open-motions').click();await until(()=>$('motion-results').children.length);
  window.checkMotionLayout=async()=>{
    const bounds=$('motion-library').getBoundingClientRect(),results=$('motion-results');
    check(bounds.left>=0&&bounds.right<=innerWidth+1,'motion dialog stays inside viewport');
    check(results.scrollWidth<=results.clientWidth+1,'motion list has no horizontal overflow');
    check($('close-motions').getBoundingClientRect().right<=bounds.right,'close button stays visible');
    check(document.querySelector('.motion-result').getBoundingClientRect().height<=70,'rows stay compact at every viewport');
  };
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
