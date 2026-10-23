const $=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+fn);};
const main={id:1,name:'HAIR.X',archive:'fixture',ordinal:0},child={id:2,name:'WING.X',archive:'fixture',ordinal:1};
const normal={...main,character:'STRIKER',part:'HAIR',variant:'BASE',family:'CLOTH',set_key:'STRIKER|CLOTH_123_A',item_id:100,appearance_key:'STRIKER:100:0',display_name:'일반 헤어',components:[{name:main.name,appearance_key:'STRIKER:100:0',candidates:[main],selected:1},{name:child.name,appearance_key:'STRIKER:100:0',candidates:[child],selected:2}]};
const another={...normal,item_id:101,appearance_key:'STRIKER:101:0',display_name:'어나더 헤어',components:[]};
const foot={...main,id:3,name:'FOOT.X',part:'FOOT',character:'STRIKER',variant:'BASE',family:'BASIC',display_name:'신발'};
const rows=[normal,another,foot],facets={character:[],kind:[],family:[],part:[],variant:[],costume_type:[]},requests=[];
const original=fetch;
window.fetch=async(url,options)=>{
 const u=new URL(url,location.href);
 if(u.pathname==='/api/model-browser'){const sets=u.searchParams.get('mode')==='sets',items=sets?[{key:normal.set_key,label:'테스트 의상',parts:['HAIR'],count:2}]:rows;return Response.json({items,total:items.length,facets});}
 if(u.pathname==='/api/model-bundle')return Response.json({key:normal.set_key,label:'테스트 의상',character:'STRIKER',slots:[{part:'HAIR',variant:'BASE',label:'헤어',checked:true,selected:null,candidates:[normal,another]}],face:{candidates:[],selected:null},motion:{candidates:[],selected:null},defaults:[]});
 if(u.pathname==='/api/model-scene'){
  requests.push(u);const items=JSON.parse(u.searchParams.get('items')||'{}'),ids=u.searchParams.get('entries').split(',').map(Number);
  if(items['1']===normal.appearance_key&&!ids.includes(2)){ids.push(2);items['2']=normal.appearance_key;}
  const sources=ids.map(id=>{const item=id===3?foot:items[String(id)]===another.appearance_key?another:normal;return {entry_id:id,name:id===2?'WING.X':item.name,display_name:item.display_name,appearance_key:items[String(id)],item_id:item.item_id,model_group:{kind:'avatar',character:'STRIKER',part:id===3?foot.part:'HAIR',set_key:normal.set_key}};});
  return Response.json({frames:[],meshes:ids.map(id=>({name:'triangle'+id,source_id:id,frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,0,0,1],image:null}]})),sources,skeleton_source:{name:'HAIR.X',entry_id:1},motion:{candidates:[]},animation:{name:'none',candidates:[]},warnings:[]});
 }
 return original(url,options);
};
try{
 await import('/model.js');$('model-character').value='STRIKER';$('model-mode').value='parts';$('model-character').dispatchEvent(new Event('change'));await until(()=>document.querySelectorAll('#model-results .model-row').length===3);
 document.querySelector('[data-appearance="STRIKER:100:0"] .model-open').click();await until(()=>!modelViewer.state.busy&&modelViewer.state.ids.length===2);
 check(modelViewer.state.ids.includes(2),'opening an item includes its secondary geometry');
 check(document.querySelectorAll('#model-parts .model-part').length===1,'components appear as one equipped item');
 check($('model-parts').textContent.includes('구성 모델 2개'),'component files remain inspectable');
 check(new URL(location.href).searchParams.get('entries')==='1,2','URL preserves complete composition');
 // The backend can complete older links containing only the main file.
 await modelViewer.loadModel([1]);check(modelViewer.state.ids.includes(2),'state follows expanded backend sources');
 document.querySelector('[data-appearance="STRIKER:101:0"] .actions [data-action="equip"]').click();await until(()=>!modelViewer.state.busy&&modelViewer.state.data.sources[0].item_id===101);
 check(modelViewer.state.ids.join(',')==='1','another appearance removes all normal-only geometry');
 document.querySelector('[data-appearance="STRIKER:100:0"] .actions [data-action="equip"]').click();await until(()=>!modelViewer.state.busy&&modelViewer.state.ids.includes(2));
 document.querySelector('[data-entry="3"] .actions [data-action="equip"]').click();await until(()=>!modelViewer.state.busy&&modelViewer.state.ids.length===3);
 [...$('model-parts').querySelectorAll('.model-part')].find(r=>r.textContent.includes('일반 헤어')).querySelector('button').click();await until(()=>!modelViewer.state.busy&&modelViewer.state.ids.length===1);
 check(modelViewer.state.ids[0]===3,'removing hair removes its wing and preserves unrelated equipment');
 check(!$('model-parts').querySelector('.empty-equipment').open,'empty equipment stays collapsed');
 foot.part='ACC_BODY_WING';await modelViewer.loadModel([3]);
 check($('model-parts').querySelector('.equipped-slot h3').textContent==='등·날개'&&$('model-parts').querySelector('.model-part').checkVisibility(),'equipped accessories are visible with a readable slot label');
 $('model-parts').querySelector('.model-part button').click();check(modelViewer.state.ids.length===0&&!$('model-parts').querySelector('.model-part'),'the last equipped item can be removed');foot.part='FOOT';
 document.querySelector('[data-mode="sets"]').click();await until(()=>document.querySelector('#model-results [data-set]'));document.querySelector('#model-results .model-open').click();await until(()=>!$('avatar-bundle').hidden);
 const select=$('avatar-bundle').querySelector('.bundle-slot>select');check(select.options.length===3,'normal and another are the only hair options');select.value='1|STRIKER:100:0';select.dispatchEvent(new Event('change'));
 check($('avatar-bundle').querySelectorAll('.bundle-components select').length===1,'normal composition includes a wing source');
 [...$('avatar-bundle').querySelectorAll('button')].find(b=>b.textContent==='묶음 열기').click();await until(()=>!modelViewer.state.busy&&modelViewer.state.ids.length===2);
 check(JSON.parse(requests.at(-1).searchParams.get('items'))['2']===normal.appearance_key,'bundle applies the item appearance to every component');
 select.value='1|STRIKER:101:0';select.dispatchEvent(new Event('change'));check(!$('avatar-bundle').querySelector('.bundle-components select'),'switching to another removes normal-only component controls');
 normal.components[1].selected=null;normal.components[1].candidates.push({...child,id:4,archive:'other'});
 document.querySelector('#model-results .model-open').click();await until(()=>$('avatar-bundle').querySelector('.bundle-slot>select')!==select);
 const ambiguous=$('avatar-bundle').querySelector('.bundle-slot>select');ambiguous.value='1|STRIKER:100:0';ambiguous.dispatchEvent(new Event('change'));
 const componentSelect=$('avatar-bundle').querySelector('.bundle-components select');
 check(componentSelect.checkVisibility()&&componentSelect.closest('details').open&&!componentSelect.value,'ambiguous component sources automatically expand their details');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
