import * as T from '/vendor/three/three.module.min.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id);
const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+fn);};
const originalFetch=fetch,identity=new T.Matrix4().toArray(),frames=Array.from({length:5},(_,i)=>({name:'bone'+i,parent:-1,matrix:identity}));
const light={key:'fixture',label:'Distance fixture',color:[1,1,1,1],direction:[0,0,1],intensity:.4,near_intensity:1.2};
window.fetch=async(url,options)=>{
 const u=new URL(url,location.href);
 if(u.pathname==='/api/model-browser')return Response.json({items:[],total:0,facets:{character:[],kind:[],part:[],family:[],variant:[]}});
 if(u.pathname==='/api/model-lighting')return Response.json({profiles:[light],color_grading_presets:[]});
 if(u.pathname==='/api/model-scene')return Response.json({frames,meshes:[{name:'mesh',source_id:1,frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,2,1],uv:[],groups:[[0,3,0]],materials:[{color:[1,1,1,1],toon_preview:{status:'approximate'}}],skin:frames.map(f=>({bone:f.name,offset:identity,indices:[0,1,2],weights:[.2,.2,.2]}))}],sources:[{entry_id:1,name:'HAIR.X',model_group:{kind:'avatar',character:'REAPER',part:'HAIR'}}],skeleton_source:{name:'HAIR.X',entry_id:1},motion:{candidates:[]},animation:{candidates:[]},warnings:[],eye_avatar:null});
 return originalFetch(url,options);
};
try{
 localStorage.setItem('closers-avatar-lighting-v2',JSON.stringify({selected:light.key,toon:true,nearMix:.2}));
 await import('/model.js');await modelViewer.loadModel([1]);$('open-avatar-lighting').click();
 await until(()=>$('avatar-lighting-profile').value===light.key&&!$('avatar-camera-mix-mark-near').disabled);
 const model=modelViewer.state.model,generation=modelViewer.state.generation,u=model.materials[0].userData.avatarLighting;
 $('avatar-camera-mix-mark-near').click();const near=Number($('avatar-camera-mix-near').value);
 $('model-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:800,cancelable:true}));
 await until(()=>!$('avatar-camera-mix-mark-far').disabled);
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 $('avatar-camera-mix-mark-far').click();const far=Number($('avatar-camera-mix-far').value);check(far>near,'wheel did not change sampled world distance');
 $('avatar-camera-mix-enabled').click();await until(()=>Math.abs(u.avatarToonIntensity.value-.4)<1e-6);
 const saved=localStorage.getItem('closers-avatar-lighting-v2');
 $('model-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-800,cancelable:true}));
 await until(()=>Math.abs(u.avatarToonIntensity.value-1.2)<1e-6);
 check(modelViewer.state.model===model&&modelViewer.state.generation===generation,'distance update rebuilt the model');
 check(localStorage.getItem('closers-avatar-lighting-v2')===saved,'render loop persisted transient weights');
 $('avatar-camera-mix-enabled').click();check(Math.abs(u.avatarToonIntensity.value-.56)<1e-6,'manual backup lost');
 $('avatar-camera-mix-enabled').click();await modelViewer.loadModel([1]);
 check(Number($('avatar-camera-mix-near').value)===near&&Number($('avatar-camera-mix-far').value)===far,'same character reload lost calibration');
 $('clear-model').click();check(!modelViewer.state.model&&$('avatar-camera-mix-mark-near').disabled,'clear retained camera sample');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
