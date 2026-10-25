const check=(value,message)=>{if(!value)throw Error(message);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
const $=id=>document.getElementById(id),original=fetch;
const clip={index:0,name:'EMOTION_HELLO',game_names:['인사하기'],duration:2};
window.fetch=async(url,options)=>{
  const path=String(url);
  let data;
  if(path.startsWith('/api/model-browser'))data={total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}};
  else if(path.startsWith('/api/model-scene'))data={frames:[],meshes:[{name:'triangle',frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,0,0,1]}]}],sources:[{name:'test.X',entry_id:1}],skeleton_source:{name:'test.X',entry_id:1,sha256:'rig'},motion:{candidates:[]},animation:{name:'test.XMD',selected:9,candidates:[]},warnings:[]};
  else if(path.startsWith('/api/model-animations'))data={skeleton_source:{sha256:'rig'},animation_source:{name:'test.XMD',sha256:'motion'},clips:[clip],mapping:{verified_bones:0,verified_keys:0,maximum_error:0}};
  else if(path.startsWith('/api/model-clip'))data={skeleton_source:{sha256:'rig'},clip,keys:[],mapping:{frames:[]}};
  else if(path.startsWith('/api/model-motion-library'))data={skeleton_source:{sha256:'rig'},files:[],categories:{},evidence:'fixture'};
  else return original(url,options);
  return new Response(JSON.stringify(data));
};
try{
  await import('/model.js');await until(()=>window.modelViewer&&!modelViewer.state.busy);
  check($('open-motions').disabled&&$('current-motion').textContent==='모델을 선택하세요','empty viewer has no selectable motion');
  await modelViewer.loadModel([1]);await until(()=>modelViewer.state.animation);
  check($('current-motion').textContent==='기본 자세','new model shows its actual pose');
  check($('play-animation').disabled&&$('animation-speed').disabled&&$('animation-loop').disabled,'bind pose disables playback controls');
  check($('open-motions').textContent==='동작 변경'&&$('animation-clip').hidden,'selection has a single visible entry point');
  await modelViewer.chooseClip(0);
  check($('current-motion').textContent==='인사하기'&&!$('play-animation').disabled,'selected motion updates heading and enables playback');
  $('play-animation').click();check(modelViewer.state.playing&&$('play-animation').getAttribute('aria-pressed')==='true','play state is reflected');
  $('open-motions').click();await until(()=>$('motion-library').open);
  check($('motion-library').contains($('bind-pose'))&&!document.querySelector('.animation-controls').contains($('bind-pose')),'bind pose is a motion choice');
  $('bind-pose').click();
  check(!$('motion-library').open&&!modelViewer.state.clip&&!modelViewer.state.playing,'bind pose closes selection and stops motion');
  check($('current-motion').textContent==='기본 자세'&&$('animation-seek').disabled&&$('animation-speed').disabled&&$('animation-loop').disabled,'bind pose resets name and playback');
  await modelViewer.chooseClip(0);check($('current-motion').textContent==='인사하기'&&!$('play-animation').disabled,'motion can be selected again after bind pose');
  $('clear-model').click();check($('current-motion').textContent==='모델을 선택하세요'&&$('open-motions').disabled,'clear resets selection heading');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
