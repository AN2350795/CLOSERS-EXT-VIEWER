const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id);
const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+fn);};
const originalFetch=fetch,sceneRequests=[],conditionRequests=[];let reject=false;
const report=ids=>({status:ids.length===2?'ready':'incomplete',scope:'preview-items-only',target_group:211,selected_items:ids,
  candidates:[{condition_id:211,target_group:211,matched_count:8+ids.length,required_count:10,status:ids.length===2?'ready':'incomplete'}],
  additional_items:[{item_id:12,label:'램프',part_label:'등·날개 액세서리'},{item_id:13,label:'권위',part_label:'오른손 반지'}]});
window.fetch=async(url,options)=>{
 const u=new URL(url,location.href),ids=JSON.parse(u.searchParams.get('condition_items')||'[]');
 if(u.pathname==='/api/model-browser')return Response.json({items:[],total:0,facets:{character:[],kind:[],part:[],family:[],variant:[]}});
 if(u.pathname==='/api/model-lighting')return Response.json({profiles:[],color_grading_presets:[]});
 if(u.pathname==='/api/model-lighting-conditions'){conditionRequests.push(u);if(reject)return Response.json({error:'invalid source gear'},{status:400});return Response.json(report(ids));}
 if(u.pathname==='/api/model-scene'){
  sceneRequests.push(u);const entry=Number(u.searchParams.get('entries'));
  return Response.json({frames:[],meshes:[{name:'mesh',source_id:entry,frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,0,0,1],image:null}]}],
   sources:[{entry_id:entry,name:'HAIR.X',archive:'fixture',ordinal:1,appearance_key:'REAPER:11:0',item_id:11,model_group:{kind:'avatar',character:'REAPER',part:'HAIR'}}],
   skeleton_source:{name:'HAIR.X',entry_id:entry},motion:{candidates:[]},animation:{candidates:[]},warnings:[],eye_avatar:null,lighting_conditions:report(ids)});
 }
 return originalFetch(url,options);
};
try{
 await import('/model.js');await modelViewer.loadModel([1],null,null,{'1':'REAPER:11:0'});
 $('open-avatar-lighting').click();const gear=id=>document.querySelector(`#avatar-lighting-condition-items input[data-item-id="${id}"]`);
 const model=modelViewer.state.model,generation=modelViewer.state.generation;model.root.rotation.y=.3;
 $('model-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,cancelable:true}));const view=JSON.stringify(modelViewer.view);
 gear(12).click();await until(()=>gear(12)?.checked&&!gear(12).disabled);
 check(conditionRequests.length===1&&conditionRequests[0].searchParams.get('entries')==='1','condition endpoint lost selected entries');
 check(JSON.parse(conditionRequests[0].searchParams.get('items'))['1']==='REAPER:11:0','condition endpoint lost item identity');
 check(modelViewer.state.model===model&&modelViewer.state.generation===generation&&model.root.rotation.y===.3&&JSON.stringify(modelViewer.view)===view,'gear update rebuilt model, pose or camera');
 check(JSON.parse(new URLSearchParams(location.search).get('condition_items')).join(',')==='12','gear choice missing from URL');
 gear(13).click();await until(()=>modelViewer.state.data.lighting_conditions.status==='ready'&&!gear(13).disabled);
 await modelViewer.loadModel([1]);check(JSON.parse(sceneRequests.at(-1).searchParams.get('condition_items')).join(',')==='12,13','same scene reload lost additional gear');
 reject=true;gear(12).click();await until(()=>$('avatar-lighting-condition-item-status').textContent.includes('invalid source gear'));
 check(gear(12).checked&&modelViewer.state.data.lighting_conditions.selected_items.length===2,'rejected gear changed selected items');
 await modelViewer.loadModel([2]);check(!sceneRequests.at(-1).searchParams.has('condition_items'),'new outfit inherited previous additional gear');
 $('clear-model').click();check(!modelViewer.state.model&&!new URLSearchParams(location.search).has('condition_items'),'clear retained gear');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
