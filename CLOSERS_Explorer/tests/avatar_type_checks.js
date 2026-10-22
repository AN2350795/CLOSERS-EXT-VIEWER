const $=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+fn);};
const rows=['A','B','C','SP'].map((type,i)=>({id:1,name:'SHARED.X',character:'STRIKER',part:'UPBODY',family:'CLOTH',variant:'BASE',archive:'fixture',set_name:'CLOTH_123_'+type,set_key:'STRIKER|CLOTH_123_'+type,type_label:type,costume_type:type,item_id:100+i,appearance_key:'STRIKER:'+i+':0',display_name:'상의 ['+type+'타입]'}));
const facets={character:[],kind:[],family:[],part:[{value:'UPBODY',label:'상의',count:4}],variant:[],costume_type:rows.map(r=>({value:r.costume_type,label:r.costume_type,count:1}))};
const original=fetch;
window.fetch=async(url,options)=>{
 const u=new URL(url,location.href);
 if(u.pathname==='/api/model-browser'){const type=u.searchParams.get('costume_type'),items=rows.filter(r=>!type||r.costume_type===type);return Response.json({items,total:items.length,facets});}
 if(u.pathname==='/api/model-scene'){
  const items=JSON.parse(u.searchParams.get('items')||'{}'),item=rows.find(r=>r.appearance_key===items['1']);
  return Response.json({frames:[],meshes:[{name:'triangle',frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,0,0,1],image:null}]}],sources:[{entry_id:1,name:'SHARED.X',display_name:item.display_name,appearance_key:item.appearance_key,item_id:item.item_id,model_group:{kind:'avatar',character:'STRIKER',part:'UPBODY',set_key:item.set_key}}],skeleton_source:{name:'SHARED.X',entry_id:1},motion:{candidates:[]},animation:{name:'none',candidates:[]},warnings:[]});
 }
 return original(url,options);
};
try{
 await import('/model.js');$('model-character').value='STRIKER';$('model-mode').value='parts';$('model-character').dispatchEvent(new Event('change'));await until(()=>document.querySelectorAll('[data-appearance]').length===4);
 document.querySelectorAll('.favorite-button')[0].click();document.querySelectorAll('.favorite-button')[1].click();check($('model-favorites').children.length===2,'shared mesh types have separate favorites');
 document.querySelector('[data-appearance="STRIKER:0:0"] .model-open').click();await until(()=>!modelViewer.state.busy&&modelViewer.state.data?.sources[0].item_id===100);
 document.querySelector('[data-appearance="STRIKER:1:0"] .actions button:nth-child(2)').click();await until(()=>!modelViewer.state.busy&&modelViewer.state.data?.sources[0].item_id===101);
 check(document.querySelectorAll('.model-row.is-selected').length===1,'only selected item type is highlighted');
 check(JSON.parse(new URL(location.href).searchParams.get('items'))['1']==='STRIKER:1:0','URL preserves selected item type');
 $('model-costume_type').value='SP';$('model-costume_type').dispatchEvent(new Event('change'));await until(()=>document.querySelectorAll('[data-appearance]').length===1);
 check($('model-results').textContent.includes('[SP타입]'),'additional registered types can be filtered');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
