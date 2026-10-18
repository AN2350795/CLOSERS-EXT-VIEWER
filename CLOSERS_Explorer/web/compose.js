'use strict';
const $=id=>document.getElementById(id),token=document.querySelector('meta[name="explorer-token"]').content;
const Core=CompositionCore,images=new Map();
let sourceSequence=0,layerSequence=0,selectedLayer=null,busy=false,pickerPage=1,pickerGeneration=0,searchTimer,toastTimer,canvasExplicit=false,drag=null;
let composition={schema:'closers-composition',version:1,kind:'composition',canvas:{width:1,height:1,transparent:true,color:'#172033'},sources:[],layers:[]};
const roles={illustration:'일러스트',frame:'프레임',fragment:'조각'};
let gamePlan=null,gamePresets=null,atlasRegions={},atlasSource=null,animationTime=0,playing=false,lastTick=0;
let pickerKind='illustration',selectedFrameId=null,selectedMarkId=null;
let gameLayout=null;
let animationPreviewURL=null;
const pickerLabels={illustration:'일러스트',frame:'프레임',mark:'마크'};
function fixedCanvas(project){
  if(!gameLayout)throw Error('게임 로딩 화면 크기를 먼저 불러와 주세요.');
  const sx=gameLayout.width/project.canvas.width,sy=gameLayout.height/project.canvas.height;
  for(const l of project.layers)if(!l.markParent){l.x*=sx;l.y*=sy;l.width*=sx;l.height*=sy;}
  project.canvas.width=gameLayout.width;project.canvas.height=gameLayout.height;return project;
}
async function ensureLayout(){
  if(!gameLayout){const layout=await api('/api/loading-layout');if(!Number.isInteger(layout.width)||!Number.isInteger(layout.height)||layout.width<1||layout.height<1)throw Error('게임 로딩 크기가 올바르지 않습니다.');gameLayout=layout;composition=Core.validate(fixedCanvas(snapshot()));}
  return gameLayout;
}
function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function setMessage(id,message,state='info'){
  const target=$(id),labels={info:'안내',loading:'불러오는 중',working:'처리 중',success:'완료',warning:'확인 필요',error:'오류'};
  target.dataset.state=state;target.dataset.label=labels[state];target.textContent=message;
}
function editorStatus(message,state='success'){setMessage('editor-status',message,state);}
function toast(message){$('editor-toast').textContent=message;$('editor-toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('editor-toast').hidden=true,10000);}
async function api(path,data){const response=await fetch(path,{headers:{'X-Explorer-Token':token,...(data?{'Content-Type':'application/json'}:{})},...(data?{method:'POST',body:JSON.stringify(data)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error||'요청 실패');return result;}
async function operation(action){if(busy)return;busy=true;editorStatus('요청한 작업을 처리하고 있습니다…','working');updateControls();try{await action();}catch(e){toast(e.message);editorStatus(e.message,'error');}finally{busy=false;if($('editor-status').dataset.state==='working')editorStatus('작업을 완료했습니다.');updateControls();}}
function currentLayer(){return composition.layers.find(l=>l.id===selectedLayer);}
function snapshot(){return JSON.parse(JSON.stringify(composition));}
function validateCurrent(){composition=Core.validate(gameLayout?fixedCanvas(composition):composition);}
function updateControls(){
  for(const id of ['export-png','save-project','load-project','save-template','load-template','new-project','canvas-width','canvas-height','canvas-transparent','canvas-color','refresh-picker','export-apng','play-effects','animation-time','animation-format','animation-duration','animation-fps','animation-loop'])$(id).disabled=busy;
  $('match-animation-cycle').disabled=busy||AnimationLoop.textureCycle(composition,Number($('animation-fps').value))===null;
  $('canvas-width').disabled=true;$('canvas-height').disabled=true;
  $('export-png').disabled=busy||!gameLayout;$('export-apng').disabled=busy||!gameLayout;
  $('save-template').disabled=busy||!composition.layers.some(l=>l.role!=='illustration');
  $('layer-fields').disabled=busy||!currentLayer();
  for(const id of ['layer-up','layer-down','duplicate-layer','remove-layer'])$(id).disabled=busy||!currentLayer();
  for(const button of document.querySelectorAll('#image-results button'))button.disabled=busy;
  for(const card of document.querySelectorAll('.asset-card'))card.setAttribute('aria-pressed',String(card.dataset.kind==='frame'?Number(card.dataset.id)===selectedFrameId:card.dataset.kind==='mark'?Number(card.dataset.id)===selectedMarkId:false));
}
function pruneImages(){const used=Core.usedSources(composition.layers);composition.sources=composition.sources.filter(s=>used.has(s.key));for(const [key,value] of images)if(!used.has(key)){value.bitmap.close();images.delete(key);}}
function commit(){pruneImages();renderLayers();renderFields();renderCanvas();renderAnimationTiming();updateControls();}
function renderAnimationTiming(){
  const format=value=>Number(value.toFixed(4))+'초',rows=AnimationLoop.timings(composition);
  $('animation-timings').replaceChildren();
  for(const row of rows){
    const life=row.life===null?'':Math.max(...(Array.isArray(row.life)?row.life:[row.life]))>60?' · 지속 효과':' · 입자 수명 '+(Array.isArray(row.life)?row.life.map(format).join('~'):format(row.life));
    $('animation-timings').append(node('li','',row.name+' · '+(row.texture===null?'반복 텍스처 없음':'텍스처 '+format(row.texture)+' ('+row.frames+'장 · 한 장 '+format(row.shortest)+'~'+format(row.longest)+')')+' · 시작 지연 '+format(row.delay)+life));
  }
  if(!rows.length)$('animation-timings').append(node('li','','선택한 애니메이션 효과가 없습니다.'));
  const cycle=AnimationLoop.textureCycle(composition,Number($('animation-fps').value));
  $('animation-loop-info').textContent=($('animation-loop').checked?'저장 시 초기 지연을 제외하고 마지막 구간을 시작 장면에 부드럽게 연결합니다. 원래 재생 속도는 유지하며 연결 구간에는 두 시점이 겹쳐 보일 수 있습니다.':'순환 보정 없이 효과가 시작되는 시점부터 저장합니다.')+(cycle===null?' 짧은 공통 텍스처 주기는 없습니다.':' 공통 텍스처 주기: '+format(cycle)+'. 입자 효과는 별도의 수명·방출 규칙을 사용합니다.');
  if(Number($('animation-fps').value)<60&&rows.some(row=>row.texture!==null&&row.shortest<1/Number($('animation-fps').value)-1e-9))$('animation-loop-info').textContent+=' 원본에 짧은 표시 시간이 있습니다. FPS를 높이면 짧은 프레임을 더 촘촘하게 담을 수 있습니다.';
}
$('animation-loop').onchange=renderAnimationTiming;
$('animation-fps').onchange=()=>{renderAnimationTiming();updateControls();};
$('match-animation-cycle').onclick=()=>{if(busy)return;const cycle=AnimationLoop.textureCycle(composition,Number($('animation-fps').value));if(cycle!==null){$('animation-duration').value=Number(cycle.toFixed(6));renderAnimationTiming();}};
function renderLayers(){
  $('layers').replaceChildren();
  for(const l of [...composition.layers].reverse()){
    const button=node('button','layer-row'+(l.id===selectedLayer?' active':''));button.append(node('span','',l.name+(l.visible?'':' (숨김)')+(l.locked?' · 잠금':'')),node('span','layer-type',roles[l.role]));
    button.onclick=()=>{if(busy)return;selectedLayer=l.id;commit();};$('layers').append(button);
  }
}
function renderFields(){
  const l=currentLayer();
  if(atlasSource!==(l?.source||null)){atlasSource=l?.source||null;atlasRegions={};$('atlas-region').replaceChildren(node('option','','전체 이미지'));$('atlas-region').firstChild.value='';}
  $('layer-fields').disabled=busy||!l;if(!l)return;
  $('atlas-region').value=Object.keys(atlasRegions).find(key=>['x','y','width','height'].every(field=>atlasRegions[key][field]===l.crop[field]))||'';
  for(const key of ['name','role','x','y','width','height'])$('layer-'+key).value=l[key];
  for(const key of ['x','y','width','height'])$('crop-'+key).value=l.crop[key];
  $('layer-opacity').value=l.opacity*100;$('layer-ratio').checked=l.keepRatio;$('layer-visible').checked=l.visible;$('layer-locked').checked=l.locked;
  for(const id of ['layer-x','layer-y','layer-width','layer-height','layer-ratio','crop-x','crop-y','crop-width','crop-height','fit-layer','fill-layer','native-layer','reset-crop'])$(id).disabled=l.locked;
  for(const id of ['crop-x','crop-y','crop-width','crop-height','reset-crop','load-atlas','atlas-region'])$(id).disabled=l.locked||Boolean(l.animation);
  const s=composition.sources.find(s=>s.key===l.source);$('layer-source').textContent=`원본 ${s.width} × ${s.height}px · ${s.name} · ${s.archive} · 항목 ${s.ordinal}`;
}
async function loadGameFrames(){
  const result=await api('/api/loading-presets');return result.items;
}
async function applyGameFrame(mark=false,ident=mark?selectedMarkId:selectedFrameId){
  await ensureLayout();
  editorStatus('게임 정의와 연결된 에셋을 확인하고 있습니다…','working');
  const plan=await api('/api/loading-plan/'+Number(ident)+(mark?'?mark=1':''));
  if(mark&&!plan.mark)throw Error('연결된 마크가 없습니다.');
  const previousMark=composition.layers.find(l=>l.gameMark&&!l.markParent);
  const placement=plan.mark?.placement||(previousMark?{x:previousMark.x,y:previousMark.y,width:previousMark.width,height:previousMark.height}:null);
  const definitions=mark?[{...plan.mark,name:'마크 · '+plan.mark.key,role:'fragment',x:0,y:0,width:plan.mark.crop.width,height:plan.mark.crop.height,...placement},...plan.effects]: [...plan.layers,...plan.effects];
  const next=snapshot(),staged=[],mapping=new Map();
  if(!next.layers.length&&!canvasExplicit&&!mark){next.canvas.width=plan.width;next.canvas.height=plan.height;}
  if(!definitions.length)throw Error(plan.warnings.join(' ')||'적용할 프레임 이미지가 없습니다.');
  next.layers=next.layers.filter(l=>mark?!l.gameMark:!l.gameFrame);
  if(next.layers.length+definitions.length>Core.MAX_LAYERS)throw Error('레이어는 최대 20개입니다.');
  try{
    const ids=[...new Set(definitions.flatMap(d=>[...(d.frames?d.frames.map(f=>f.entry_id):[d.entry_id]),...(d.particle?.mask_entry_id?[d.particle.mask_entry_id]:[])]))];
    if(ids.length>Core.MAX_SOURCES)throw Error('원본은 애니메이션 프레임 포함 256개까지입니다.');
    for(const id of ids){
      editorStatus(`원본 해상도 에셋을 불러오고 있습니다… ${mapping.size+1}/${ids.length}`,'working');
      const loaded=await loadSource(id,null,staged);staged.push(loaded);mapping.set(id,loaded.key);
      if(!next.sources.some(s=>s.key===loaded.key))next.sources.push({...loaded.value.metadata,key:loaded.key});
    }
    const target=null,sx=1,sy=1;let markParent=null;
    for(const d of definitions){
      const source=mapping.get(d.entry_id||d.frames[0].entry_id),metadata=next.sources.find(s=>s.key===source);
      const particle=d.particle?{...d.particle,...(d.particle.mask_entry_id?{mask:mapping.get(d.particle.mask_entry_id)}:{})}:null;
      if(particle)delete particle.mask_entry_id;
      const id='l'+(++layerSequence);
      next.layers.push({id,source,name:d.name,role:d.role,crop:d.crop||{x:0,y:0,width:metadata.width,height:metadata.height},x:(target?.x||0)+d.x*sx,y:(target?.y||0)+d.y*sy,width:d.width*sx,height:d.height*sy,opacity:1,visible:true,locked:mark&&Boolean(d.frames),keepRatio:true,...(mark?{gameMark:true,...(markParent?{markParent}:{})}:{gameFrame:true}),...(d.frames?{animation:{frames:d.frames.map(f=>({source:mapping.get(f.entry_id),duration:f.duration})),delay:d.delay,color:d.color,blend:d.blend,...(particle?{particle}:{})}}:{})});
      if(mark&&!markParent)markParent=id;
    }
    const used=Core.usedSources(next.layers);next.sources=next.sources.filter(s=>used.has(s.key));
    const checked=Core.validate(next);for(const s of staged)if(!s.reused)images.set(s.key,s.value);
    composition=checked;selectedLayer=markParent||composition.layers.at(-1)?.id||null;gamePlan=plan;animationTime=0;lastTick=0;
    playing=composition.layers.some(l=>l.visible&&l.animation);$('play-effects').textContent=playing?'효과 일시 정지':'효과 재생';$('animation-time').value='0';
    if(mark)selectedMarkId=Number(ident);else selectedFrameId=Number(ident);commit();
    const warnings=[...plan.warnings,...(mark&&!plan.mark.placement?['이 던전 로딩 화면에는 별도 마크의 기본 위치가 등록되어 있지 않습니다. 마크 위치는 직접 조정하세요.']:[]),...(mark&&plan.effects.length?['마크 효과는 마크 중심에 연결했습니다. 마크를 이동하거나 크기를 바꾸면 효과도 함께 바뀝니다.']:[])];
    setMessage('game-frame-status',warnings.length?warnings.join(' '):'게임 정의의 영역과 배치를 적용했습니다.',warnings.length?'warning':'success');
    editorStatus(mark?(plan.mark.placement?'게임 기본 위치에 마크를 적용했습니다.':previousMark?'이전 마크 위치를 유지해 교체했습니다.':'마크를 추가했습니다. 기본 위치가 없어 직접 조정할 수 있습니다.'):'일러스트 테두리에 게임 프레임을 적용했습니다.');
  }catch(e){for(const s of staged)if(!s.reused)s.value.bitmap.close();throw e;}
}
$('load-atlas').onclick=()=>operation(async()=>{const l=currentLayer(),s=images.get(l.source).metadata;const result=await api('/api/loading-atlas/'+s.entry_id);atlasRegions=result.regions;$('atlas-region').replaceChildren(node('option','','전체 이미지'));$('atlas-region').firstChild.value='';for(const key of Object.keys(atlasRegions)){const option=node('option','',key);option.value=key;$('atlas-region').append(option);}});
$('atlas-region').onchange=()=>{const l=currentLayer();if(!l||l.locked||l.animation)return;const s=composition.sources.find(s=>s.key===l.source),crop=atlasRegions[$('atlas-region').value]||{x:0,y:0,width:s.width,height:s.height};changeLayer(l=>{l.crop={...crop};l.width=crop.width;l.height=crop.height;});};
function renderCanvas(){
  const canvas=$('composition-canvas'),c=composition.canvas,available=Math.max(100,$('canvas-stage').clientWidth-4),scale=Math.min(1,available/c.width,650/c.height);
  canvas.width=Math.max(1,Math.round(c.width*scale));canvas.height=Math.max(1,Math.round(c.height*scale));
  const context=canvas.getContext('2d');Core.draw(context,composition,new Map([...images].map(([key,v])=>[key,v.bitmap])),canvas.width,canvas.height,animationTime);
  const selected=currentLayer(),l=selected?Core.placement(selected,composition.layers):null;if(l&&l.visible){const sx=canvas.width/c.width,sy=canvas.height/c.height;context.save();context.strokeStyle=l.locked?'#b3bdcf':'#83dfc5';context.lineWidth=1.5;context.setLineDash([5,3]);context.strokeRect(l.x*sx,l.y*sy,l.width*sx,l.height*sy);if(!l.locked){context.setLineDash([]);context.fillStyle='#83dfc5';context.fillRect((l.x+l.width)*sx-5,(l.y+l.height)*sy-5,10,10);}context.restore();}
  $('canvas-width').value=c.width;$('canvas-height').value=c.height;$('canvas-transparent').checked=c.transparent;$('canvas-color').value=c.color;
  const pixels=[...images.values()].reduce((n,v)=>n+v.bitmap.width*v.bitmap.height,0);
  $('canvas-summary').textContent=`출력 ${c.width} × ${c.height}px · 레이어 ${composition.layers.length}/20 · 원본 픽셀 ${(pixels/1000000).toFixed(1)}M / 134.2M · 표시 ${(scale*100).toFixed(0)}%`;
}
async function loadSource(id,expected=null,staged=[]){
  const metadata=await api('/api/composition-source/'+id);
  if(expected&&['archive','ordinal','name','source_sha256','image_sha256','width','height'].some(key=>metadata[key]!==expected[key]))throw Error('조합 원본이 변경되었습니다: '+expected.name+' · 현재 조합을 유지합니다.');
  for(const {key,value} of [...images].map(([key,value])=>({key,value})).concat(staged))if(value.metadata.archive===metadata.archive&&value.metadata.ordinal===metadata.ordinal&&value.metadata.image_sha256===metadata.image_sha256)return {key,value,reused:images.has(key)};
  const pixels=[...images.values(),...staged.filter(s=>!s.reused).map(s=>s.value)].reduce((n,v)=>n+v.bitmap.width*v.bitmap.height,0);
  if(pixels+metadata.width*metadata.height>Core.MAX_TOTAL_PIXELS)throw Error('동시에 불러올 원본은 합계 134,217,728픽셀까지입니다. 불필요한 레이어를 삭제하거나 새 조합을 시작하세요.');
  const response=await fetch('/api/composition-image/'+id+'?sha256='+metadata.image_sha256,{headers:{'X-Explorer-Token':token}});
  if(!response.ok)throw Error((await response.json()).error);
  const blob=await response.blob();if(blob.size>64*1024*1024)throw Error('합성 입력이 64 MiB를 초과했습니다.');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==metadata.image_sha256)throw Error('합성 입력 검증에 실패했습니다. 다시 선택해 주세요.');
  const bitmap=await createImageBitmap(blob,{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});
  if(bitmap.width!==metadata.width||bitmap.height!==metadata.height){bitmap.close();throw Error('원본 해상도와 불러온 이미지가 일치하지 않습니다.');}
  return {key:'s'+(++sourceSequence),value:{metadata,bitmap},reused:false};
}
async function addImage(id){
  await ensureLayout();
  const plan=await api('/api/loading-illustration/'+id),definition=plan.layers[0],next=snapshot();
  next.layers=next.layers.filter(l=>l.role!=='illustration');
  if(next.layers.length>=Core.MAX_LAYERS)throw Error('레이어는 최대 20개입니다.');
  const loaded=await loadSource(id);
  try{
    if(!next.sources.some(s=>s.key===loaded.key))next.sources.push({...loaded.value.metadata,key:loaded.key});
    const layer={...definition,id:'l'+(++layerSequence),source:loaded.key,opacity:1,visible:true,locked:true,keepRatio:true};
    delete layer.entry_id;next.layers.unshift(layer);
    const used=Core.usedSources(next.layers);next.sources=next.sources.filter(s=>used.has(s.key));
    const checked=Core.validate(fixedCanvas(next));if(!loaded.reused)images.set(loaded.key,loaded.value);
    composition=checked;selectedLayer=layer.id;commit();
    editorStatus(definition.name+' \u00b7 '+gameLayout.width+' \u00d7 '+gameLayout.height+'px');
  }catch(e){if(!loaded.reused)loaded.value.bitmap.close();throw e;}
}
function fitLayer(l,fill){const c=composition.canvas,r=(fill?Math.max:Math.min)(c.width/l.crop.width,c.height/l.crop.height);l.width=l.crop.width*r;l.height=l.crop.height*r;l.x=(c.width-l.width)/2;l.y=(c.height-l.height)/2;}
function changeLayer(change){if(busy)return;const l=currentLayer();if(!l)return;const previous=snapshot();try{change(l);validateCurrent();commit();}catch(e){composition=previous;commit();toast(e.message);}}
function changeCanvas(){if(busy)return;const previous=snapshot();try{composition.canvas.transparent=$('canvas-transparent').checked;composition.canvas.color=$('canvas-color').value;composition=fixedCanvas(composition);validateCurrent();commit();}catch(e){composition=previous;commit();toast(e.message);}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function clearAnimationPreview(){
  $('animation-preview-image').removeAttribute('src');
  if(animationPreviewURL){URL.revokeObjectURL(animationPreviewURL);animationPreviewURL=null;}
}
$('close-animation-preview').onclick=()=>$('animation-preview').close();
$('animation-preview').addEventListener('close',clearAnimationPreview);
window.addEventListener('pagehide',clearAnimationPreview);
function makeExportCanvas(time=animationTime,validated=false){if(!validated)validateCurrent();const canvas=document.createElement('canvas');canvas.width=composition.canvas.width;canvas.height=composition.canvas.height;Core.draw(canvas.getContext('2d'),composition,new Map([...images].map(([key,v])=>[key,v.bitmap])),canvas.width,canvas.height,time);return canvas;}
async function exportPNG(){
  editorStatus('원본 해상도로 PNG를 만들고 있습니다…','working');
  const canvas=makeExportCanvas();
  try{const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG 생성에 실패했습니다. 출력 크기를 줄여 주세요.');downloadBlob(blob,'closers-composition.png');editorStatus(`PNG 저장 요청 완료 · ${canvas.width} × ${canvas.height}px`);}finally{canvas.width=1;canvas.height=1;}
}
async function exportAnimation(){
  playing=false;$('play-effects').textContent='효과 재생';
  validateCurrent();
  const duration=Number($('animation-duration').value),fps=Number($('animation-fps').value);
  const format=$('animation-format').value;
  if(!['webp','apng'].includes(format))throw Error('지원하지 않는 애니메이션 형식입니다.');
  if(!Number.isFinite(duration)||duration<.1||duration>10)throw Error('저장 길이는 0.1~10초입니다.');
  const loop=AnimationLoop.plan(composition,duration,fps,$('animation-loop').checked),count=loop.count;
  const render=AnimationLoop.renderer(time=>makeExportCanvas(time,true),loop);
  let blob=await AnimationPNG.encode({width:composition.canvas.width,height:composition.canvas.height,count,fps,requireMotion:true,render,progress:(n,total)=>editorStatus(`애니메이션 생성 중 · ${n}/${total}`,'working')});
  if(format==='webp'){
    editorStatus('무손실 WebP로 저장하고 있습니다…','working');
    const response=await fetch('/api/composition-animation/webp',{method:'POST',headers:{'X-Explorer-Token':token,'Content-Type':'image/apng'},body:blob});
    if(!response.ok)throw Error((await response.json()).error||'WebP 저장에 실패했습니다.');
    blob=await response.blob();
    if(blob.type!=='image/webp'||!blob.size||blob.size>128*1024*1024)throw Error('WebP 저장 결과가 올바르지 않습니다.');
  }
  downloadBlob(blob,'closers-composition.'+format);
  const summary=`${format==='webp'?'WebP':'APNG'} · ${count}프레임 · ${fps} FPS · ${Number((count/fps).toFixed(3))}초 · ${composition.canvas.width} × ${composition.canvas.height}px${loop.blend?' · 순환 보정':''}`;
  editorStatus('애니메이션 저장 요청 완료 · '+summary);
  clearAnimationPreview();animationPreviewURL=URL.createObjectURL(blob);$('animation-preview-image').src=animationPreviewURL;
  $('animation-preview-info').textContent=summary;$('animation-preview').showModal();
}
$('export-apng').onclick=()=>operation(exportAnimation);
$('play-effects').onclick=()=>{playing=!playing;lastTick=0;$('play-effects').textContent=playing?'효과 일시 정지':'효과 재생';};
$('animation-time').oninput=()=>{animationTime=Math.max(0,Math.min(60,Number($('animation-time').value)||0));lastTick=0;renderCanvas();};
function animateEffects(now){
  if(playing&&!busy){if(lastTick)animationTime+=(now-lastTick)/1000;lastTick=now;if(animationTime>60)animationTime=0;$('animation-time').value=animationTime.toFixed(2);renderCanvas();}else lastTick=0;
  requestAnimationFrame(animateEffects);
}
requestAnimationFrame(animateEffects);
function projectForSave(template=false){
  const value=snapshot();value.kind=template?'frame-template':'composition';
  if(template){value.layers=value.layers.filter(l=>l.role!=='illustration');const used=Core.usedSources(value.layers);value.sources=value.sources.filter(s=>used.has(s.key));if(!value.layers.length)throw Error('저장할 프레임·조각 레이어가 없습니다.');}
  return Core.validate(value);
}
function saveProject(template){const value=projectForSave(template);downloadBlob(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),template?'closers-frame-template.json':'closers-composition.json');editorStatus(template?'프레임 템플릿 저장 요청 완료':'조합 설정 저장 요청 완료');}
async function importProject(raw,append=false){
  await ensureLayout();
  const value=Core.validate(raw);
  if(append&&value.kind!=='frame-template')throw Error('프레임 템플릿 파일을 선택해 주세요.');
  if(append&&composition.layers.length+value.layers.length>Core.MAX_LAYERS)throw Error('추가 후 레이어가 20개를 초과합니다.');
  editorStatus('설정에 기록된 원본 출처와 해시를 확인하고 있습니다…','working');
  const needed=Core.usedSources(value.layers),sources=value.sources.filter(s=>needed.has(s.key)),staged=[];
  try{
    const resolved={ids:[]};for(let offset=0;offset<sources.length;offset+=20){const batch=await api('/api/composition-resolve',{sources:sources.slice(offset,offset+20)});resolved.ids.push(...batch.ids);}
    for(let i=0;i<sources.length;i++){const loaded=await loadSource(resolved.ids[i],sources[i],staged);staged.push({...loaded,oldKey:sources[i].key});}
    const mapping=new Map(staged.map(s=>[s.oldKey,s.key]));
    const next=append?snapshot():{...value,sources:[],layers:[]};
    if(append){const scale=Math.min(next.canvas.width/value.canvas.width,next.canvas.height/value.canvas.height),dx=(next.canvas.width-value.canvas.width*scale)/2,dy=(next.canvas.height-value.canvas.height*scale)/2;for(const l of value.layers)if(!l.markParent){l.x=l.x*scale+dx;l.y=l.y*scale+dy;l.width*=scale;l.height*=scale;}}
    for(const s of staged)if(!next.sources.some(source=>source.key===s.key))next.sources.push({...s.value.metadata,key:s.key});
    const layerMapping=new Map(value.layers.map(l=>[l.id,'l'+(++layerSequence)]));
    for(const l of value.layers)next.layers.push({...l,id:layerMapping.get(l.id),...(l.markParent?{markParent:layerMapping.get(l.markParent)}:{}),source:mapping.get(l.source),...(l.animation?{animation:{...l.animation,frames:l.animation.frames.map(f=>({...f,source:mapping.get(f.source)})),...(l.animation.particle?{particle:{...l.animation.particle,...(l.animation.particle.mask?{mask:mapping.get(l.animation.particle.mask)}:{})}}:{})}}:{})});
    const checked=Core.validate(fixedCanvas(next));
    for(const s of staged)if(!s.reused)images.set(s.key,s.value);
    composition=checked;selectedLayer=composition.layers.at(-1)?.id||null;canvasExplicit=true;commit();editorStatus(append?'프레임 템플릿을 현재 화면 비율에 맞춰 추가했습니다.':'출처와 해시를 확인해 조합을 복원했습니다.');
  }catch(e){for(const s of staged)if(!s.reused)s.value.bitmap.close();throw e;}
}
async function loadFile(file,append){if(!file)return;if(file.size>1024*1024)throw Error('조합 설정은 1 MiB까지 지원합니다.');await importProject(JSON.parse(await file.text()),append);}
async function searchImages(){
  const seq=++pickerGeneration,kind=pickerKind,query=$('image-query').value.trim(),limit=12;
  setMessage('picker-summary',pickerLabels[kind]+' 목록을 불러오고 있습니다…','loading');
  $('image-results').setAttribute('aria-busy','true');$('image-prev').disabled=true;$('image-next').disabled=true;
  try{
    let result;
    if(kind==='illustration')result=await api('/api/loading-illustrations?'+new URLSearchParams({q:query,page:pickerPage}));
    else{
      if(!gamePresets){const presets=await loadGameFrames();if(seq!==pickerGeneration)return;gamePresets=presets;}
      let choices=gamePresets;
      if(kind==='mark'){
        const unique=new Map();for(const p of choices)if(p.mark&&p.mark_key){const key=p.mark.toUpperCase()+'|'+p.mark_key;if(!unique.has(key))unique.set(key,p);}
        choices=[...unique.values()];
      }
      const text=query.toLocaleLowerCase();choices=choices.filter(p=>(kind==='mark'?`${p.id} ${p.mark} ${p.mark_key}`:`${p.id} ${p.image} ${p.name} ${p.display_name||''}`).toLocaleLowerCase().includes(text));
      const pages=Math.max(1,Math.ceil(choices.length/limit));pickerPage=Math.min(pickerPage,pages);
      result={total:choices.length,items:choices.slice((pickerPage-1)*limit,pickerPage*limit)};
    }
    if(seq!==pickerGeneration)return;
    $('image-results').replaceChildren();
    for(const item of result.items){
      const label=kind==='frame'?(item.display_name||`프레임 ${item.id}`):kind==='mark'?item.mark_key:(item.display_name||item.name.replace(/^DLG_PVP_LOADING_?/i,'').replace(/\.[^.]+$/,'')),
        button=node('button','asset-card'),thumb=node('span','asset-thumbnail'),image=node('img');
      button.type='button';button.dataset.kind=kind;button.dataset.id=item.id;button.disabled=busy;
      button.title=kind==='frame'?`${label} · ${item.image||'움직이는 프레임'}`:kind==='mark'?`${label} · ${item.mark}`:item.name;
      button.setAttribute('aria-label',label+' 적용');button.setAttribute('aria-pressed','false');
      image.loading='lazy';image.decoding='async';image.alt=label;image.width=kind==='mark'?128:144;image.height=kind==='mark'?128:205;
      const loading=node('span','asset-loading','썸네일 로딩 중');thumb.dataset.state='loading';
      image.onload=()=>{thumb.dataset.state='ready';loading.remove();};
      image.onerror=()=>{thumb.dataset.state='error';thumb.replaceChildren(node('span','asset-missing','미리보기 없음'));};
      image.src='/api/loading-thumbnail/'+kind+'/'+item.id+'?token='+encodeURIComponent(token);
      thumb.append(image,loading);button.append(thumb,node('span','asset-name',label));
      if(kind==='frame'&&item.effects.trim()){
        const badge=node('span','asset-badge','게임 효과');
        badge.title='게임에 효과가 등록된 프레임입니다. 현재 재현하지 못하는 효과는 선택 후 안내됩니다.';
        button.append(badge);
      }
      button.append(node('span','asset-caption',kind==='frame'?`프레임 ${item.id}`:kind==='mark'?'마크 적용':(item.character||'로딩 일러스트 적용')));
      button.onclick=()=>operation(()=>kind==='illustration'?addImage(item.id):applyGameFrame(kind==='mark',item.id));$('image-results').append(button);
    }
    const pages=Math.max(1,Math.ceil(result.total/limit));$('image-page').textContent=`${pickerPage} / ${pages}`;$('image-prev').disabled=pickerPage<=1;$('image-next').disabled=pickerPage>=pages;
    setMessage('picker-summary',result.items.length?`${pickerLabels[kind]} ${result.total}개 · 썸네일을 눌러 적용하세요.`:query?'검색 결과가 없습니다. 다른 이름으로 검색해 주세요.':'선택할 에셋이 없습니다. 라이브러리에서 원본 폴더를 먼저 분석하세요.',result.items.length?'success':'warning');
    if(!result.items.length)$('image-results').append(node('p','muted',query?'검색 결과가 없습니다.':'선택할 에셋이 없습니다. 라이브러리에서 원본 폴더를 먼저 분석하세요.'));
    updateControls();
  }catch(e){if(seq===pickerGeneration){$('image-results').replaceChildren(node('p','picker-error',e.message));setMessage('picker-summary','목록을 불러오지 못했습니다. 새로고침으로 다시 시도하세요.','error');$('image-page').textContent='';}}
  finally{if(seq===pickerGeneration)$('image-results').setAttribute('aria-busy','false');}
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
$('remove-layer').onclick=()=>{if(busy)return;composition.layers=composition.layers.filter(l=>l.id!==selectedLayer&&l.markParent!==selectedLayer);selectedLayer=composition.layers.at(-1)?.id||null;commit();};
$('duplicate-layer').onclick=()=>{
  if(busy)return;const l=currentLayer();if(!l)return;
  const children=composition.layers.filter(child=>child.markParent===l.id);
  if(composition.layers.length+1+children.length>Core.MAX_LAYERS){toast('레이어는 최대 20개입니다.');return;}
  const copy=JSON.parse(JSON.stringify(l));copy.id='l'+(++layerSequence);copy.role='fragment';copy.name=(l.name+' 조각').slice(0,200);composition.layers.push(copy);
  for(const child of children)composition.layers.push({...JSON.parse(JSON.stringify(child)),id:'l'+(++layerSequence),markParent:copy.id});
  selectedLayer=copy.id;commit();
};
for(const id of ['canvas-width','canvas-height','canvas-transparent','canvas-color'])$(id).onchange=changeCanvas;
$('export-png').onclick=()=>operation(exportPNG);$('save-project').onclick=()=>operation(()=>saveProject(false));$('save-template').onclick=()=>operation(()=>saveProject(true));
$('load-project').onclick=()=>$('project-file').click();$('load-template').onclick=()=>$('template-file').click();
for(const [id,append] of [['project-file',false],['template-file',true]])$(id).onchange=()=>{const file=$(id).files[0];$(id).value='';operation(()=>loadFile(file,append));};
$('new-project').onclick=()=>{if(busy)return;selectedFrameId=null;selectedMarkId=null;playing=false;animationTime=0;lastTick=0;$('animation-time').value='0';$('play-effects').textContent='효과 재생';for(const value of images.values())value.bitmap.close();images.clear();composition={schema:'closers-composition',version:1,kind:'composition',canvas:{width:1,height:1,transparent:true,color:'#172033'},sources:[],layers:[]};selectedLayer=null;canvasExplicit=false;if(gameLayout)composition=fixedCanvas(composition);commit();editorStatus('새 조합을 시작했습니다. 이전 조합을 보관하려면 먼저 설정을 저장하세요.','info');};
$('image-query').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{pickerPage=1;searchImages();},250);};
function selectPicker(kind){
  pickerKind=kind;pickerPage=1;$('image-query').value='';clearTimeout(searchTimer);
  for(const value of Object.keys(pickerLabels)){const tab=$('pick-'+value);tab.setAttribute('aria-selected',String(value===kind));tab.tabIndex=value===kind?0:-1;}
  $('asset-query-label').textContent=pickerLabels[kind]+(kind==='frame'?' 번호 · 이름 검색':' 이름 검색');
  $('image-results').setAttribute('aria-labelledby','pick-'+kind);searchImages();
}
for(const kind of Object.keys(pickerLabels)){
  $('pick-'+kind).onclick=()=>selectPicker(kind);
  $('pick-'+kind).onkeydown=event=>{const kinds=Object.keys(pickerLabels),index=kinds.indexOf(kind);let next;
    if(event.key==='ArrowRight')next=kinds[(index+1)%kinds.length];if(event.key==='ArrowLeft')next=kinds[(index+kinds.length-1)%kinds.length];if(event.key==='Home')next=kinds[0];if(event.key==='End')next=kinds.at(-1);
    if(next){event.preventDefault();selectPicker(next);$('pick-'+next).focus();}
  };
}
$('refresh-picker').onclick=()=>{gamePresets=null;pickerPage=1;searchImages();};
$('image-prev').onclick=()=>{pickerPage--;searchImages();};$('image-next').onclick=()=>{pickerPage++;searchImages();};
new ResizeObserver(()=>renderCanvas()).observe($('canvas-stage'));
commit();
const initialIds=new URLSearchParams(location.search).get('entries');
operation(async()=>{editorStatus('게임 로딩 화면을 준비하고 있습니다…','working');await Promise.all([ensureLayout(),searchImages()]);commit();if(initialIds){const ids=initialIds.split(',');if(ids.length>20||ids.some(id=>!/^\d{1,12}$/.test(id)))throw Error('한 번에 이미지 20개까지 선택해 주세요.');for(const id of ids)await addImage(Number(id));}else editorStatus('로딩 일러스트를 선택하세요.','info');});
