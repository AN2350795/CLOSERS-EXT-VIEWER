const check=(v,message)=>{if(!v)throw Error(message);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+fn);};
const source=(id,part)=>({entry_id:id,name:part+'.X',archive:'fixture',ordinal:id,model_group:{kind:'avatar',character:'STRIKER',part}});
const candidate=id=>({id,name:id+'.X',archive:'fixture',ordinal:id});
const eyeItems=[{key:'STRIKER:basic',label:'기본 눈동자',basic:true,geometry:false,character:'STRIKER',face_id:1,face_candidates:[candidate(1)],texture_id:null,texture_candidates:[],available:true},
 {key:'STRIKER:10',label:'붉은 눈동자',basic:false,geometry:false,character:'STRIKER',face_id:1,face_candidates:[candidate(1)],texture_id:10,texture_candidates:[candidate(10)],available:true},
 {key:'STRIKER:20',label:'별도 메시 눈동자',basic:false,geometry:true,character:'STRIKER',face_id:3,face_candidates:[candidate(3)],texture_id:20,texture_candidates:[candidate(20)],base_face_id:1,base_face_candidates:[candidate(1)],available:true}];
const facets={character:[],kind:[],part:[],family:[],variant:[]},requests=[],originalFetch=fetch;
window.fetch=async(url,options)=>{
 const u=new URL(url,location.href);
 if(u.pathname==='/api/model-browser')return Response.json({items:[],total:0,facets});
 if(u.pathname==='/api/model-eyes')return Response.json({items:eyeItems,total:3,facets});
 if(u.pathname==='/api/model-scene'){
  requests.push(u);const ids=u.searchParams.get('entries').split(',').map(Number),key=u.searchParams.get('eye'),eye=eyeItems.find(i=>i.key===key);
  return Response.json({frames:[],meshes:[{name:'triangle',frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,0,0,1],image:null}]}],sources:ids.map(i=>source(i,{1:'FACE',2:'HAIR',3:'ACC_RING_RIGHT'}[i])),
   skeleton_source:{name:'FACE.X',entry_id:1},motion:{candidates:[]},animation:{name:'none',candidates:[]},warnings:[],eye_avatar:eye?{key,face_id:eye.face_id,texture_id:eye.texture_id,geometry:eye.geometry}:null});
 }
 return originalFetch(url,options);
};
try{
 await import('/model.js');await modelViewer.loadModel([2,1]);document.querySelector('#model-character').value='STRIKER';
 document.querySelector('[data-mode=eyes]').click();await until(()=>document.querySelectorAll('[data-eye]').length===3);
 document.querySelector('[data-eye="STRIKER:10"] .model-open').click();await until(()=>!modelViewer.state.busy&&modelViewer.state.eye?.key==='STRIKER:10');
 check(modelViewer.state.ids.join(',')==='2,1'&&requests.at(-1).searchParams.get('eye_texture')==='10','eye change preserves hair and sends texture selection');
 document.querySelector('[data-eye="STRIKER:20"] .model-open').click();await until(()=>!modelViewer.state.busy&&modelViewer.state.eye?.key==='STRIKER:20');
 check(modelViewer.state.ids.join(',')==='2,1,3','separate eyes keep base face and outfit');
 check([...document.querySelectorAll('#model-parts .equipped-slot h3')].some(e=>e.textContent==='눈동자'),'equipped eye geometry has a visible eye slot');
 document.querySelector('[data-eye="STRIKER:basic"] .model-open').click();await until(()=>!modelViewer.state.busy&&modelViewer.state.eye?.key==='STRIKER:basic');
 check(modelViewer.state.ids.join(',')==='2,1'&&!requests.at(-1).searchParams.has('eye_texture'),'basic restores base face and removes previous eye mesh');
 check(new URL(location.href).searchParams.get('eye')==='STRIKER:basic','reload URL retains selected eye');
 document.querySelector('#clear-model').click();check(modelViewer.state.eye===null,'clear resets selected eye');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
