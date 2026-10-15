'use strict';
const $=id=>document.getElementById(id),token=document.querySelector('meta[name="explorer-token"]').content;
const Core=CompositionCore,images=new Map();
let sourceSequence=0,layerSequence=0,selectedLayer=null,busy=false,pickerPage=1,pickerGeneration=0,searchTimer,toastTimer,canvasExplicit=false,drag=null;
let composition={schema:'closers-composition',version:1,kind:'composition',canvas:{width:1024,height:1024,transparent:true,color:'#172033'},sources:[],layers:[]};
const roles={illustration:'일러스트',frame:'프레임',fragment:'조각'};
function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function toast(message){$('editor-toast').textContent=message;$('editor-toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('editor-toast').hidden=true,10000);}
async function api(path,data){const response=await fetch(path,{headers:{'X-Explorer-Token':token,...(data?{'Content-Type':'application/json'}:{})},...(data?{method:'POST',body:JSON.stringify(data)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error||'요청 실패');return result;}
async function operation(action){if(busy)return;busy=true;updateControls();try{await action();}catch(e){toast(e.message);$('editor-status').textContent=e.message;}finally{busy=false;updateControls();}}
function currentLayer(){return composition.layers.find(l=>l.id===selectedLayer);}
function snapshot(){return JSON.parse(JSON.stringify(composition));}
function validateCurrent(){composition=Core.validate(composition);}
function updateControls(){
  for(const id of ['export-png','save-project','load-project','save-template','load-template','new-project','canvas-width','canvas-height','canvas-transparent','canvas-color'])$(id).disabled=busy;
  $('save-template').disabled=busy||!composition.layers.some(l=>l.role!=='illustration');
  $('layer-fields').disabled=busy||!currentLayer();
  for(const id of ['layer-up','layer-down','duplicate-layer','remove-layer'])$(id).disabled=busy||!currentLayer();
  for(const button of document.querySelectorAll('#image-results button'))button.disabled=busy;
}
function pruneImages(){const used=new Set(composition.layers.map(l=>l.source));composition.sources=composition.sources.filter(s=>used.has(s.key));for(const [key,value] of images)if(!used.has(key)){value.bitmap.close();images.delete(key);}}
function commit(){pruneImages();renderLayers();renderFields();renderCanvas();updateControls();}
function renderLayers(){
  $('layers').replaceChildren();
  for(const l of [...composition.layers].reverse()){
    const button=node('button','layer-row'+(l.id===selectedLayer?' active':''));button.append(node('span','',l.name+(l.visible?'':' (숨김)')+(l.locked?' · 잠금':'')),node('span','layer-type',roles[l.role]));
    button.onclick=()=>{if(busy)return;selectedLayer=l.id;commit();};$('layers').append(button);
  }
}
function renderFields(){
  const l=currentLayer();$('layer-fields').disabled=busy||!l;if(!l)return;
  for(const key of ['name','role','x','y','width','height'])$('layer-'+key).value=l[key];
  for(const key of ['x','y','width','height'])$('crop-'+key).value=l.crop[key];
  $('layer-opacity').value=l.opacity*100;$('layer-ratio').checked=l.keepRatio;$('layer-visible').checked=l.visible;$('layer-locked').checked=l.locked;
  for(const id of ['layer-x','layer-y','layer-width','layer-height','layer-ratio','crop-x','crop-y','crop-width','crop-height','fit-layer','fill-layer','native-layer','reset-crop'])$(id).disabled=l.locked;
  const s=composition.sources.find(s=>s.key===l.source);$('layer-source').textContent=`원본 ${s.width} × ${s.height}px · ${s.name} · ${s.archive} · 항목 ${s.ordinal}`;
}
function renderCanvas(){
  const canvas=$('composition-canvas'),c=composition.canvas,available=Math.max(100,$('canvas-stage').clientWidth-4),scale=Math.min(1,available/c.width,650/c.height);
  canvas.width=Math.max(1,Math.round(c.width*scale));canvas.height=Math.max(1,Math.round(c.height*scale));
  const context=canvas.getContext('2d');Core.draw(context,composition,new Map([...images].map(([key,v])=>[key,v.bitmap])),canvas.width,canvas.height);
  const l=currentLayer();if(l&&l.visible){const sx=canvas.width/c.width,sy=canvas.height/c.height;context.save();context.strokeStyle=l.locked?'#b3bdcf':'#83dfc5';context.lineWidth=1.5;context.setLineDash([5,3]);context.strokeRect(l.x*sx,l.y*sy,l.width*sx,l.height*sy);if(!l.locked){context.setLineDash([]);context.fillStyle='#83dfc5';context.fillRect((l.x+l.width)*sx-5,(l.y+l.height)*sy-5,10,10);}context.restore();}
  $('canvas-width').value=c.width;$('canvas-height').value=c.height;$('canvas-transparent').checked=c.transparent;$('canvas-color').value=c.color;
  const pixels=[...images.values()].reduce((n,v)=>n+v.bitmap.width*v.bitmap.height,0);
  $('canvas-summary').textContent=`출력 ${c.width} × ${c.height}px · 레이어 ${composition.layers.length}/20 · 원본 픽셀 ${(pixels/1000000).toFixed(1)}M / 33.6M · 표시 ${(scale*100).toFixed(0)}%`;
}
async function loadSource(id,expected=null,staged=[]){
  const metadata=await api('/api/composition-source/'+id);
  if(expected&&['archive','ordinal','name','source_sha256','image_sha256','width','height'].some(key=>metadata[key]!==expected[key]))throw Error('조합 원본이 변경되었습니다: '+expected.name+' · 현재 조합을 유지합니다.');
  for(const [key,value] of images)if(value.metadata.archive===metadata.archive&&value.metadata.ordinal===metadata.ordinal&&value.metadata.image_sha256===metadata.image_sha256)return {key,value,reused:true};
  const pixels=[...images.values(),...staged.filter(s=>!s.reused).map(s=>s.value)].reduce((n,v)=>n+v.bitmap.width*v.bitmap.height,0);
  if(pixels+metadata.width*metadata.height>Core.MAX_TOTAL_PIXELS)throw Error('동시에 불러올 원본은 합계 33,554,432픽셀까지입니다. 불필요한 레이어를 삭제하거나 새 조합을 시작하세요.');
  const response=await fetch('/api/composition-image/'+id+'?sha256='+metadata.image_sha256,{headers:{'X-Explorer-Token':token}});
  if(!response.ok)throw Error((await response.json()).error);
  const blob=await response.blob();if(blob.size>64*1024*1024)throw Error('합성 입력이 64 MiB를 초과했습니다.');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==metadata.image_sha256)throw Error('합성 입력 검증에 실패했습니다. 다시 선택해 주세요.');
  const bitmap=await createImageBitmap(blob,{imageOrientation:'none'});
  if(bitmap.width!==metadata.width||bitmap.height!==metadata.height){bitmap.close();throw Error('원본 해상도와 불러온 이미지가 일치하지 않습니다.');}
  return {key:'s'+(++sourceSequence),value:{metadata,bitmap},reused:false};
}
async function addImage(id){
  if(composition.layers.length>=Core.MAX_LAYERS)throw Error('레이어는 최대 20개입니다.');
  $('editor-status').textContent='원본 해상도 이미지를 확인하고 있습니다…';
  const loaded=await loadSource(id),s=loaded.value.metadata;
  if(!loaded.reused){images.set(loaded.key,loaded.value);composition.sources.push({...s,key:loaded.key});}
  if(!composition.layers.length&&!canvasExplicit){const scale=Math.min(1,8192/s.width,8192/s.height);composition.canvas.width=Math.max(1,Math.round(s.width*scale));composition.canvas.height=Math.max(1,Math.round(s.height*scale));}
  const l={id:'l'+(++layerSequence),source:loaded.key,name:s.name.slice(0,200),role:/FRAME/i.test(s.name)?'frame':'illustration',x:0,y:0,width:s.width,height:s.height,crop:{x:0,y:0,width:s.width,height:s.height},opacity:1,visible:true,locked:false,keepRatio:true};
  composition.layers.push(l);selectedLayer=l.id;fitLayer(l,false);validateCurrent();commit();$('editor-status').textContent='이미지를 추가했습니다. 레이어를 선택해 배치와 자르기를 편집하세요.';
}
function fitLayer(l,fill){const c=composition.canvas,r=(fill?Math.max:Math.min)(c.width/l.crop.width,c.height/l.crop.height);l.width=l.crop.width*r;l.height=l.crop.height*r;l.x=(c.width-l.width)/2;l.y=(c.height-l.height)/2;}
function changeLayer(change){if(busy)return;const l=currentLayer();if(!l)return;const previous=snapshot();try{change(l);validateCurrent();commit();}catch(e){composition=previous;commit();toast(e.message);}}
function changeCanvas(){if(busy)return;const previous=snapshot();try{composition.canvas={width:Number($('canvas-width').value),height:Number($('canvas-height').value),transparent:$('canvas-transparent').checked,color:$('canvas-color').value};validateCurrent();canvasExplicit=true;commit();}catch(e){composition=previous;commit();toast(e.message);}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function makeExportCanvas(){validateCurrent();const canvas=document.createElement('canvas');canvas.width=composition.canvas.width;canvas.height=composition.canvas.height;Core.draw(canvas.getContext('2d'),composition,new Map([...images].map(([key,v])=>[key,v.bitmap])));return canvas;}
async function exportPNG(){
  $('editor-status').textContent='원본 해상도로 PNG를 만들고 있습니다…';
  const canvas=makeExportCanvas();
  try{const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG 생성에 실패했습니다. 출력 크기를 줄여 주세요.');downloadBlob(blob,'closers-composition.png');$('editor-status').textContent=`PNG 저장 요청 완료 · ${canvas.width} × ${canvas.height}px`;}finally{canvas.width=1;canvas.height=1;}
}
function projectForSave(template=false){
  const value=snapshot();value.kind=template?'frame-template':'composition';
  if(template){value.layers=value.layers.filter(l=>l.role!=='illustration');const used=new Set(value.layers.map(l=>l.source));value.sources=value.sources.filter(s=>used.has(s.key));if(!value.layers.length)throw Error('저장할 프레임·조각 레이어가 없습니다.');}
  return Core.validate(value);
}
function saveProject(template){const value=projectForSave(template);downloadBlob(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),template?'closers-frame-template.json':'closers-composition.json');$('editor-status').textContent=template?'프레임 템플릿 저장 요청 완료':'조합 설정 저장 요청 완료';}
async function importProject(raw,append=false){
  const value=Core.validate(raw);
  if(append&&value.kind!=='frame-template')throw Error('프레임 템플릿 파일을 선택해 주세요.');
  if(append&&composition.layers.length+value.layers.length>Core.MAX_LAYERS)throw Error('추가 후 레이어가 20개를 초과합니다.');
  $('editor-status').textContent='설정에 기록된 원본 출처와 해시를 확인하고 있습니다…';
  const needed=new Set(value.layers.map(l=>l.source)),sources=value.sources.filter(s=>needed.has(s.key)),staged=[];
  try{
    const resolved=sources.length?await api('/api/composition-resolve',{sources}):{ids:[]};
    for(let i=0;i<sources.length;i++){const loaded=await loadSource(resolved.ids[i],sources[i],staged);staged.push({...loaded,oldKey:sources[i].key});}
    const mapping=new Map(staged.map(s=>[s.oldKey,s.key]));
    const next=append?snapshot():{...value,sources:[],layers:[]};
    if(append){const scale=Math.min(next.canvas.width/value.canvas.width,next.canvas.height/value.canvas.height),dx=(next.canvas.width-value.canvas.width*scale)/2,dy=(next.canvas.height-value.canvas.height*scale)/2;for(const l of value.layers){l.x=l.x*scale+dx;l.y=l.y*scale+dy;l.width*=scale;l.height*=scale;}}
    for(const s of staged)if(!next.sources.some(source=>source.key===s.key))next.sources.push({...s.value.metadata,key:s.key});
    for(const l of value.layers)next.layers.push({...l,id:'l'+(++layerSequence),source:mapping.get(l.source)});
    const checked=Core.validate(next);
    for(const s of staged)if(!s.reused)images.set(s.key,s.value);
    composition=checked;selectedLayer=composition.layers.at(-1)?.id||null;canvasExplicit=true;commit();$('editor-status').textContent=append?'프레임 템플릿을 현재 화면 비율에 맞춰 추가했습니다.':'출처와 해시를 확인해 조합을 복원했습니다.';
  }catch(e){for(const s of staged)if(!s.reused)s.value.bitmap.close();throw e;}
}
async function loadFile(file,append){if(!file)return;if(file.size>1024*1024)throw Error('조합 설정은 1 MiB까지 지원합니다.');await importProject(JSON.parse(await file.text()),append);}
async function searchImages(){
  const seq=++pickerGeneration;
  try{
    const result=await api('/api/entries?'+new URLSearchParams({category:'images',q:$('image-query').value,page:pickerPage,limit:12}));if(seq!==pickerGeneration)return;
    $('image-results').replaceChildren();
    for(const item of result.items){
      const row=node('article','image-result'),image=node('img');image.loading='lazy';image.alt=item.name;image.src='/api/media/'+item.id+'?token='+encodeURIComponent(token);image.onerror=()=>{image.removeAttribute('src');image.alt='미리보기 없음';};
      const content=node('div');content.append(node('div','image-name',item.name),node('div','image-origin',item.archive));
      const button=node('button','','추가');button.disabled=busy;button.onclick=()=>operation(()=>addImage(item.id));content.append(button);row.append(image,content);$('image-results').append(row);
    }
    const pages=Math.max(1,Math.ceil(result.total/12));$('image-page').textContent=`${pickerPage} / ${pages}`;$('image-prev').disabled=pickerPage<=1;$('image-next').disabled=pickerPage>=pages;
    if(!result.items.length)$('image-results').append(node('p','muted','조건에 맞는 이미지가 없습니다. 라이브러리에서 원본 폴더를 먼저 분석하세요.'));
  }catch(e){if(seq===pickerGeneration)toast(e.message);}
}
function pointerPosition(event){const rect=$('composition-canvas').getBoundingClientRect();return {x:(event.clientX-rect.left)*composition.canvas.width/rect.width,y:(event.clientY-rect.top)*composition.canvas.height/rect.height};}
$('composition-canvas').onpointerdown=event=>{
  if(busy||event.button!==0)return;const p=pointerPosition(event),selected=currentLayer(),rect=$('composition-canvas').getBoundingClientRect(),tolerance=12*composition.canvas.width/rect.width;
  const resizing=selected&&selected.visible&&!selected.locked&&Math.abs(p.x-selected.x-selected.width)<tolerance&&Math.abs(p.y-selected.y-selected.height)<tolerance;
  const l=resizing?selected:[...composition.layers].reverse().find(l=>l.visible&&!l.locked&&p.x>=l.x&&p.y>=l.y&&p.x<=l.x+l.width&&p.y<=l.y+l.height);
  if(!l)return;selectedLayer=l.id;drag={id:event.pointerId,x:p.x,y:p.y,layer:JSON.parse(JSON.stringify(l)),resize:resizing};$('composition-canvas').setPointerCapture(event.pointerId);$('composition-canvas').focus();commit();event.preventDefault();
};
$('composition-canvas').onpointermove=event=>{
  if(!drag||busy||event.pointerId!==drag.id)return;const p=pointerPosition(event),original=drag.layer;
  changeLayer(l=>{if(drag.resize){l.width=Math.max(.01,Math.min(65536,original.width+p.x-drag.x));l.height=l.keepRatio?l.width*original.height/original.width:Math.max(.01,Math.min(65536,original.height+p.y-drag.y));}else{l.x=Math.max(-100000,Math.min(100000,original.x+p.x-drag.x));l.y=Math.max(-100000,Math.min(100000,original.y+p.y-drag.y));}});
};
const endDrag=()=>{drag=null;};$('composition-canvas').onpointerup=endDrag;$('composition-canvas').onpointercancel=endDrag;$('composition-canvas').onlostpointercapture=endDrag;
$('composition-canvas').onkeydown=event=>{if(busy||!currentLayer()||currentLayer().locked)return;const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},move=moves[event.key];if(move){event.preventDefault();changeLayer(l=>{l.x+=move[0]*(event.shiftKey?10:1);l.y+=move[1]*(event.shiftKey?10:1);});}};
for(const key of ['name','role','x','y','width','height'])$('layer-'+key).onchange=()=>changeLayer(l=>{const value=['name','role'].includes(key)?$('layer-'+key).value:Number($('layer-'+key).value);if(l.keepRatio&&key==='width')l.height*=value/l.width;if(l.keepRatio&&key==='height')l.width*=value/l.height;l[key]=value;});
for(const key of ['x','y','width','height'])$('crop-'+key).onchange=()=>changeLayer(l=>{l.crop[key]=Number($('crop-'+key).value);});
$('layer-ratio').onchange=()=>changeLayer(l=>l.keepRatio=$('layer-ratio').checked);
$('layer-opacity').oninput=()=>changeLayer(l=>l.opacity=Number($('layer-opacity').value)/100);
$('layer-visible').onchange=()=>changeLayer(l=>l.visible=$('layer-visible').checked);$('layer-locked').onchange=()=>changeLayer(l=>l.locked=$('layer-locked').checked);
$('fit-layer').onclick=()=>changeLayer(l=>fitLayer(l,false));$('fill-layer').onclick=()=>changeLayer(l=>fitLayer(l,true));$('native-layer').onclick=()=>changeLayer(l=>{l.width=l.crop.width;l.height=l.crop.height;});
$('reset-crop').onclick=()=>changeLayer(l=>{const s=composition.sources.find(s=>s.key===l.source);l.crop={x:0,y:0,width:s.width,height:s.height};});
for(const [id,delta] of [['layer-up',1],['layer-down',-1]])$(id).onclick=()=>{if(busy)return;const index=composition.layers.findIndex(l=>l.id===selectedLayer),next=index+delta;if(index>=0&&next>=0&&next<composition.layers.length){[composition.layers[index],composition.layers[next]]=[composition.layers[next],composition.layers[index]];commit();}};
$('remove-layer').onclick=()=>{if(busy)return;composition.layers=composition.layers.filter(l=>l.id!==selectedLayer);selectedLayer=composition.layers.at(-1)?.id||null;commit();};
$('duplicate-layer').onclick=()=>{if(busy)return;if(composition.layers.length>=20){toast('레이어는 최대 20개입니다.');return;}const l=currentLayer();if(l){const copy=JSON.parse(JSON.stringify(l));copy.id='l'+(++layerSequence);copy.role='fragment';copy.name=(l.name+' 조각').slice(0,200);composition.layers.push(copy);selectedLayer=copy.id;commit();}};
for(const id of ['canvas-width','canvas-height','canvas-transparent','canvas-color'])$(id).onchange=changeCanvas;
$('export-png').onclick=()=>operation(exportPNG);$('save-project').onclick=()=>operation(()=>saveProject(false));$('save-template').onclick=()=>operation(()=>saveProject(true));
$('load-project').onclick=()=>$('project-file').click();$('load-template').onclick=()=>$('template-file').click();
for(const [id,append] of [['project-file',false],['template-file',true]])$(id).onchange=()=>{const file=$(id).files[0];$(id).value='';operation(()=>loadFile(file,append));};
$('new-project').onclick=()=>{if(busy)return;for(const value of images.values())value.bitmap.close();images.clear();composition={schema:'closers-composition',version:1,kind:'composition',canvas:{width:1024,height:1024,transparent:true,color:'#172033'},sources:[],layers:[]};selectedLayer=null;canvasExplicit=false;commit();$('editor-status').textContent='새 조합을 시작했습니다. 이전 조합을 보관하려면 먼저 설정을 저장하세요.';};
$('image-query').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{pickerPage=1;searchImages();},250);};
for(const [id,query] of [['find-illustrations','DLG_PVP_LOADING'],['find-frames','DLG_FRAME'],['find-all','']])$(id).onclick=()=>{$('image-query').value=query;pickerPage=1;searchImages();};
$('image-prev').onclick=()=>{pickerPage--;searchImages();};$('image-next').onclick=()=>{pickerPage++;searchImages();};
new ResizeObserver(()=>renderCanvas()).observe($('canvas-stage'));
commit();searchImages();
const initialIds=new URLSearchParams(location.search).get('entries');
if(initialIds)operation(async()=>{const ids=initialIds.split(',');if(ids.length>20||ids.some(id=>!/^\d{1,12}$/.test(id)))throw Error('한 번에 이미지 20개까지 선택해 주세요.');for(const id of ids)await addImage(Number(id));});
