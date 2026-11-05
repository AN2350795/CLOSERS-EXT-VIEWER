const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id);
const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const change=(id,value)=>{const e=$(id);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
const originalFetch=fetch;
window.fetch=async(url,options)=>{
 const u=new URL(url,location.href);
 if(u.pathname==='/api/model-browser')return Response.json({items:[],total:0,facets:{character:[],kind:[],part:[],family:[],variant:[]}});
 if(u.pathname==='/api/model-lighting')return Response.json({profiles:[],color_grading_presets:[]});
 if(u.pathname==='/api/model-scene')return Response.json({frames:[],meshes:[{name:'mesh',source_id:1,frame:-1,vertices:[-20,0,0,20,0,0,0,60,0],indices:[0,2,1],uv:[],groups:[[0,3,0]],materials:[{color:[.5,.5,.5,1]}],skin:[]}],sources:[{entry_id:1,name:'HAIR.X',model_group:{kind:'avatar',character:'REAPER',part:'HAIR'}}],motion:{candidates:[]},animation:{candidates:[]},warnings:[],eye_avatar:null});
 return originalFetch(url,options);
};
try{
 localStorage.clear();await import('/model.js');await modelViewer.loadModel([1]);await frame();
 const capture=()=>{const source=$('model-canvas'),canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;};
 const baseline=capture(),view=JSON.stringify(modelViewer.view),model=modelViewer.state.model;
 for(const [name,values] of [['position',[0,30,20]],['target',[30,30,20]]])for(const [i,axis] of ['x','y','z'].entries())change(`viewer-light-${name}-${axis}`,values[i]);
 change('viewer-light-show-helpers',true);await frame();check(capture().some((v,i)=>v!==baseline[i]),'actual viewer did not draw guides');
 check(JSON.stringify(modelViewer.view)===view&&modelViewer.state.model===model&&!$('viewer-light-enabled').checked,'guides changed camera/model/lighting');
 change('viewer-light-show-helpers',false);await frame();check(capture().every((v,i)=>v===baseline[i]),'actual viewer guide OFF failed to restore frame');
 change('viewer-light-show-helpers',true);$('clear-model').click();await frame();check(!modelViewer.state.model&&$('viewer-light-show-helpers').checked,'clearing model lost guide preference');
 const empty=capture();change('viewer-light-show-helpers',false);await frame();check(capture().every((v,i)=>v===empty[i]),'guides remained visible with no model');
 window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pagehide'));document.body.dataset.checks='passed';
}catch(error){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:error.stack}));}
