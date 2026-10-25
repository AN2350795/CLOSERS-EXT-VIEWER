import {setupMotions} from '/model-motions.js';
const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn+' '+JSON.stringify({open:document.getElementById('motion-library').open,disabled:document.getElementById('open-motions').disabled,loading:document.getElementById('motion-library').dataset.loading,progress:document.getElementById('motion-progress').textContent}));};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const $=id=>document.getElementById(id),element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
try{
  const state={model:{},generation:1,ids:[1],data:{skeleton_source:{entry_id:1,sha256:'rig'},sources:[]},animation:null,busy:false};
  const files=[{id:10,name:'BASIC.XMD',category:'basic',clips:[{index:0,name:'IDLE',duration:1}],status:'ready',skeleton_id:1},
    {id:11,name:'BROKEN.XMD',category:'basic',clips:[{index:0,name:'BROKEN',duration:1}],status:'unavailable',error:'mapping failed',skeleton_id:1},
    {id:12,name:'BIKE.XMD',category:'basic',clips:[{index:0,name:'BIKE',duration:1}],status:'ready',skeleton_id:2}];
  const sequence={key:'sequence',label:'Test sequence',status:'ready',skeleton_id:1,steps:[{name:'START',speed:1},{name:'LOOP',speed:1},{name:'END',speed:1}],loop_index:1};
  const response={files,sequences:[sequence],categories:{basic:'Basic'},skeleton_source:{sha256:'rig'},evidence:'fixture'};
  let listGate=deferred(),clipGate=null,sequenceGate=null,modelGate=null,listCalls=0,clipCalls=0,signals=[];
  const motions=setupMotions({state,element,api:async(url,signal)=>{listCalls++;signals.push(signal);if(listGate)await listGate.promise;return response;},
    operation:async fn=>{state.busy=true;try{await fn();}finally{state.busy=false;$('open-motions').disabled=false;}},
    connectAnimation:async id=>{state.animation={id};},
    chooseClip:async index=>{clipCalls++;if(clipGate)await clipGate.promise;state.clip={clip:{index}};},
    chooseSequence:async(definition,report)=>{report('Preparing sequence 1/3');if(sequenceGate)await sequenceGate.promise;state.sequence={definition};},
    loadModel:async(ids,id)=>{state.generation++;state.data.skeleton_source.entry_id=id;document.dispatchEvent(new Event('model-selection'));if(modelGate)await modelGate.promise;}});
  $('open-motions').click();await until(()=>listCalls===1);
  check($('motion-library').open&&!$('motion-progress').hidden&&$('motion-library').dataset.loading==='list','list loading is prominent inside the open dialog');
  check($('motion-results').getAttribute('aria-busy')==='true'&&$('motion-search').disabled&&!$('close-motions').disabled,'loading is announced and filters wait while closing remains possible');
  listGate.resolve();listGate=null;await until(()=>document.querySelectorAll('#motion-results .motion-select').length===3);
  check($('motion-progress').hidden&&!$('motion-search').disabled&&$('motion-results').getAttribute('aria-busy')==='false','successful list load clears all busy indicators');
  const broken=[...document.querySelectorAll('#motion-results .motion-select')].find(b=>b.textContent.includes('BROKEN'));check(broken.disabled,'unavailable clips remain disabled');
  clipGate=deferred();let first=document.querySelector('#motion-results .motion-select');first.click();await until(()=>clipCalls===1);
  check($('motion-library').open&&$('motion-library').dataset.loading==='apply'&&first.classList.contains('is-loading')&&first.getAttribute('aria-busy')==='true','selected clip remains visible with an applying spinner');
  check([...document.querySelectorAll('#motion-results button')].every(b=>b.disabled),'other selections cannot overlap an in-flight application');
  first.click();check(clipCalls===1,'double clicks do not start duplicate applications');clipGate.reject(Error('fixture apply failed'));clipGate=null;
  await until(()=>$('motion-progress').dataset.state==='error');
  check($('motion-library').open&&$('motion-progress').textContent.includes('fixture apply failed')&&!$('motion-search').disabled,'application failures stay visible and allow retry');
  first=document.querySelector('#motion-results .motion-select');first.click();await until(()=>!$('motion-library').open);
  check($('motion-progress').hidden&&!$('open-motions').hasAttribute('aria-busy'),'successful retry clears busy state and closes only after application');
  $('open-motions').click();modelGate=deferred();const alternate=[...document.querySelectorAll('#motion-results .motion-select')].find(b=>b.textContent.includes('BIKE'));alternate.click();await until(()=>state.generation===2);
  check($('motion-library').open&&$('motion-library').dataset.loading==='apply'&&$('motion-progress').textContent.includes('BIKE'),'switching skeletons keeps the selected motion loading message visible');modelGate.resolve();modelGate=null;await until(()=>!$('motion-library').open);
  state.data.skeleton_source.entry_id=1;state.generation++;document.dispatchEvent(new Event('model-selection'));
  const beforeCloseLoad=listCalls;listGate=deferred();$('open-motions').click();await until(()=>listCalls>beforeCloseLoad);const closingSignal=signals.at(-1);$('close-motions').click();await until(()=>closingSignal.aborted);
  check($('motion-progress').hidden&&!$('motion-search').disabled,'closing aborts list loading and restores controls');listGate.resolve();listGate=null;await new Promise(r=>setTimeout(r,20));check(!$('motion-results').children.length,'closed stale requests cannot populate the results');
  const beforeFailedLoad=listCalls;listGate=deferred();$('open-motions').click();await until(()=>listCalls>beforeFailedLoad);listGate.reject(Error('fixture list failed'));listGate=null;await until(()=>$('motion-progress').dataset.state==='error');
  check(!$('motion-progress').querySelector('button').hidden,'failed list fetch offers a visible retry action');$('motion-progress').querySelector('button').click();await until(()=>document.querySelector('#motion-results .motion-select'));
  document.querySelector('[data-motion-mode="sequences"]').click();sequenceGate=deferred();document.querySelector('#motion-results .motion-select').click();await until(()=>$('motion-progress').textContent.includes('1/3'));
  check($('motion-library').open&&$('motion-library').dataset.loading==='apply','group application reports preparation progress');sequenceGate.resolve();sequenceGate=null;await until(()=>!$('motion-library').open);
  state.generation++;document.dispatchEvent(new Event('model-selection'));listGate=deferred();$('open-motions').click();await until(()=>$('motion-library').dataset.loading==='list');
  window.checkMotionLayout=async()=>{
    const bounds=$('motion-library').getBoundingClientRect(),progress=$('motion-progress').getBoundingClientRect(),close=$('close-motions').getBoundingClientRect();
    check(bounds.left>=0&&bounds.right<=innerWidth+1,'loading dialog fits the viewport');check(progress.left>=bounds.left&&progress.right<=bounds.right+1,'loading message stays inside the dialog');check(close.right<=bounds.right&&close.top>=0,'close remains visible during loading');check(document.documentElement.scrollWidth<=innerWidth+1,'loading causes no horizontal overflow');
  };
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
