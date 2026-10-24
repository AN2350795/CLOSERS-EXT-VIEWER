const check=(value,message)=>{if(!value)throw Error(message);};
const $=id=>document.getElementById(id),key='closers-model-preserve-view-v1';
const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const originalFetch=fetch;
window.fetch=async(url,options)=>{
  const u=new URL(url,location.href);
  if(u.pathname==='/api/model-browser')return Response.json({items:[],total:0,facets:{}});
  if(u.pathname==='/api/model-scene'){
    const ids=u.searchParams.get('entries').split(',').map(Number),height=ids.includes(3)?4:ids.includes(2)?3:2;
    return Response.json({frames:[],meshes:[{name:'triangle',frame:-1,vertices:[-1,0,0,1,0,0,0,height,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,0,0,1],image:null}]}],
      sources:ids.map(id=>({entry_id:id,name:id+'.X',archive:'fixture',ordinal:id,model_group:{kind:id===4?'npc':'avatar',character:id===3?'CASTER':id===5?'':'STRIKER',part:id===2?'UPBODY':'HAIR'}})),
      skeleton_source:{name:'fixture.X',entry_id:1},motion:{candidates:[]},animation:{name:'none',candidates:[]},warnings:[]});
  }
  return originalFetch(url,options);
};
const view=()=>JSON.stringify(modelViewer.view);
function moveView(){
  const canvas=$('model-canvas'),capture=canvas.setPointerCapture;canvas.setPointerCapture=()=>{};
  try{
    for(const button of [0,2]){
      canvas.onpointerdown({pointerId:1,clientX:100,clientY:100,button});
      canvas.onpointermove({pointerId:1,clientX:130,clientY:120});canvas.onpointerup({pointerId:1});
    }
    canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-300,cancelable:true}));
  }finally{canvas.setPointerCapture=capture;}
}
try{
  check($('preserve-view').checked,'new option defaults to enabled');
  localStorage.setItem(key,'false');await import('/model.js');
  check(!$('preserve-view').checked,'stored disabled preference restored at startup');
  const toggle=enabled=>{$('preserve-view').checked=enabled;$('preserve-view').dispatchEvent(new Event('change'));};
  toggle(true);check(localStorage.getItem(key)==='true','enabled preference saved');
  await modelViewer.loadModel([1]);await frame();const first=view();
  moveView();await frame();const adjusted=view();check(adjusted!==first,'rotation zoom and pan changed');
  await modelViewer.loadModel([1,2]);check(view()===adjusted,'adding a part preserves full view despite different bounds');
  await modelViewer.loadModel([2]);check(view()===adjusted,'outfit replacement preserves view without shared source IDs');
  await modelViewer.loadModel([1]);check(view()===adjusted,'part removal preserves view');
  await modelViewer.loadModel([1,5]);check(view()===adjusted,'shared accessory without character metadata preserves avatar view');
  $('reset-camera').click();check(view()===first,'manual camera reset still frames the model');
  moveView();await frame();toggle(false);await modelViewer.loadModel([1]);
  check(view()===first&&localStorage.getItem(key)==='false','disabled preference resets and saves');
  toggle(true);moveView();await frame();await modelViewer.loadModel([3]);
  check(modelViewer.view.yaw===0&&modelViewer.view.pitch===.12&&view()!==first,'different character automatically frames new model');
  moveView();await frame();await modelViewer.loadModel([4]);check(modelViewer.view.yaw===0,'non-avatar model automatically framed');
  moveView();await frame();await modelViewer.loadModel([1,3]);check(modelViewer.view.yaw===0,'mixed characters automatically framed');
  moveView();await frame();$('clear-model').click();await modelViewer.loadModel([1]);check(view()===first,'first model after clearing is framed');
  localStorage.removeItem(key);document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
