import {MotionSequencePlayer} from '/motion-sequence-player.js';
const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<600;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
const $=id=>document.getElementById(id),original=fetch;
const step=(name,speed=1,cancel_time=0)=>({name,speed,start_time:0,cancel_time,animation_id:9,clip_index:{START:0,LOOP:1,END:2}[name],sha256:'motion',source:'state.LUA'});
const definition={key:'test',label:'시험 묶음',steps:[step('START'),step('LOOP',1,.02),step('END')],loop_index:1,end_index:2,status:'ready',skeleton_id:1,skill_table:'skills.LUA'};
const clips=[0,1,2].map(index=>({index,name:['START','LOOP','END'][index],duration:.08}));
let deferClip=false,releaseClip;
localStorage.setItem('closers-motion-extras',JSON.stringify({effects:true}));
const extra=index=>({key:'effect-'+index,kind:'effect',label:'stage effect',state:'',source:'fixture',status:'ready',resources:[{selected:20+index}],bone:'',offset:[100*(index+1),0,0],rotation:[0,0,0],at:0,anim_time:true,follow:true,state_end:true,animation:null,speed:1,loop:false,life:10,color:[1,1,1,1],fades:[],depth_test:true,depth_write:true});
window.fetch=async(url,options)=>{
  const path=String(url);let data;
  if(path.startsWith('/api/model-browser'))data={total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}};
  else if(path.startsWith('/api/model-scene'))data={frames:[],meshes:[{name:'triangle',frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,0,0,1]}]}],sources:[{name:'test.X',entry_id:1}],skeleton_source:{name:'test.X',entry_id:1,sha256:'rig'},motion:{candidates:[]},animation:{name:'test.XMD',selected:9,candidates:[]},warnings:[]};
  else if(path.startsWith('/api/model-animations'))data={skeleton_source:{sha256:'rig'},animation_source:{name:'test.XMD',sha256:'motion'},clips,mapping:{verified_bones:0,verified_keys:0,maximum_error:0}};
  else if(path.startsWith('/api/model-clip')){if(deferClip){deferClip=false;await new Promise(r=>releaseClip=r);}const index=Number(new URL(path,location.href).searchParams.get('clip'));data={skeleton_source:{sha256:'rig'},clip:clips[index],keys:[],mapping:{frames:[]},extras:[extra(index)]};}
  else if(path.startsWith('/api/model-motion-library'))data={skeleton_source:{sha256:'rig'},sequence_index_available:true,sequences:[definition],files:[{id:9,name:'test.XMD',category:'emotion',status:'ready',clips,skeleton_id:1}],categories:{emotion:'이모션'},evidence:'fixture'};
  else return original(url,options);
  return new Response(JSON.stringify(data));
};
try{
  // Deterministic timing checks supplement real frame playback below.
  const packets=clips.map(clip=>({clip})),player=new MotionSequencePlayer(definition,packets);
  player.advance(.08);check(player.phase==='반복','start automatically reaches loop');
  player.advance(1000);check(player.phase==='반복'&&!player.completed,'loop persists without an exit request');
  player.restart();player.requestFinish();player.advance(.09);
  check(player.phase==='반복','exit requested during intro waits for loop cancellation time');
  player.advance(.02);check(player.phase==='마무리','exit starts once cancellation boundary passes');
  player.advance(.2);check(player.completed&&player.time===.08,'end reaches final pose exactly');
  const slow=structuredClone(definition);slow.steps[0].speed=.5;
  const slower=new MotionSequencePlayer(slow,packets);slower.advance(.08);check(slower.phase==='시작'&&Math.abs(slower.time-.04)<1e-8,'game state playback rate is respected');
  const delayed=structuredClone(definition);delayed.steps[1].cancel_time=.3;
  const waiting=new MotionSequencePlayer(delayed,packets);waiting.advance(.08);waiting.requestFinish();waiting.advance(.2);
  check(waiting.phase==='반복','minimum cancellation time spans multiple loop cycles');
  waiting.advance(.11);check(waiting.phase==='마무리','elapsed state time allows exit after multiple cycles');
  await import('/model.js');await until(()=>window.modelViewer&&!modelViewer.state.busy);
  await modelViewer.loadModel([1]);await until(()=>modelViewer.state.animation);
  $('open-motions').click();await until(()=>document.querySelector('.motion-modes [data-motion-mode="sequences"]'));
  await until(()=>document.querySelector('#motion-results button'));
  document.querySelector('.motion-modes [data-motion-mode="sequences"]').click();
  check($('motion-results').textContent.includes('시험 묶음'),'sequence list is separate from individual clips');
  document.querySelector('#motion-results .motion-select').click();await until(()=>modelViewer.state.sequence&&!modelViewer.state.busy);
  check($('current-motion').textContent==='시험 묶음'&&$('animation-loop').disabled&&!$('finish-motion').disabled,'group label and exit controls are visible');
  await until(()=>modelViewer.extras.assets.size===3);
  $('model-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:200,cancelable:true}));
  const sequenceView=JSON.stringify(modelViewer.view);
  $('animation-loop').checked=false;$('play-animation').click();await until(()=>modelViewer.state.sequence?.phase==='반복');
  await new Promise(r=>setTimeout(r,230));
  check(modelViewer.state.sequence?.phase==='반복'&&modelViewer.state.playing,'group loops independently of the individual repeat option');
  check(JSON.stringify(modelViewer.view)===sequenceView,'new effects across sequence stages preserve the user camera');
  $('play-animation').click();check(!modelViewer.state.playing,'group playback can pause');
  $('sequence-finish-mode').value='hold';$('finish-motion').click();await until(()=>modelViewer.state.sequence?.completed);
  check(!modelViewer.state.playing&&modelViewer.state.clip.clip.index===2&&$('finish-motion').disabled,'finish from pause plays exit and holds last pose');
  check(JSON.stringify(modelViewer.view)===sequenceView,'exit-stage effects preserve the user camera');
  $('reset-camera').click();check(JSON.stringify(modelViewer.view)!==sequenceView,'manual camera reset remains available during sequences');
  $('play-animation').click();await until(()=>modelViewer.state.sequence?.phase==='반복');
  $('sequence-finish-mode').value='bind';$('finish-motion').click();await until(()=>!modelViewer.state.sequence);
  check(!modelViewer.state.clip&&!modelViewer.state.playing&&$('current-motion').textContent==='기본 자세'&&$('play-animation').disabled,'finish can return to bind pose');
  $('open-motions').click();document.querySelector('#motion-results .motion-select').click();await until(()=>modelViewer.state.sequence&&!modelViewer.state.busy);
  $('model-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:200,cancelable:true}));const beforeIndividual=JSON.stringify(modelViewer.view);
  $('open-motions').click();document.querySelector('.motion-modes [data-motion-mode="clips"]').click();document.querySelector('#motion-results .motion-select').click();await until(()=>!modelViewer.state.sequence&&!modelViewer.state.busy);
  await until(()=>JSON.stringify(modelViewer.view)!==beforeIndividual);
  check(modelViewer.state.clip&&!$('animation-loop').disabled,'individual selection clears group playback');
  $('open-motions').click();document.querySelector('.motion-modes [data-motion-mode="sequences"]').click();deferClip=true;
  document.querySelector('#motion-results .motion-select').click();await until(()=>releaseClip);
  const replacement=modelViewer.loadModel([1]);releaseClip();await replacement;await new Promise(r=>setTimeout(r,30));
  check(!modelViewer.state.sequence&&document.querySelector('.sequence-controls').hidden,'stale sequence loading cannot replace a newer model');
  $('clear-model').click();check(!modelViewer.state.sequence&&document.querySelector('.sequence-controls').hidden,'reset removes all group controls');
  await modelViewer.loadModel([1]);await until(()=>modelViewer.state.animation);
  $('open-motions').click();await until(()=>document.querySelector('#motion-results .motion-select'));
  document.querySelector('#motion-results .motion-select').click();await until(()=>modelViewer.state.sequence&&!modelViewer.state.busy);
  window.checkMotionLayout=async()=>{
    const panel=document.querySelector('.viewport-panel').getBoundingClientRect();
    for(const id of ['finish-motion','sequence-finish-mode','play-animation','animation-speed','motion-extras-settings']){
      const bounds=$(id).getBoundingClientRect();
      check(bounds.left>=panel.left&&bounds.right<=panel.right+1&&bounds.bottom<=panel.bottom+1,'sequence control fits viewport: '+id);
    }
    check(document.documentElement.scrollWidth<=innerWidth+1,'sequence controls cause no horizontal overflow');
  };
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
