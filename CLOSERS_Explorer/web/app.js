'use strict';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="explorer-token"]').content;
const labels = {images:'이미지',audio:'오디오',models:'3D 모델',scripts:'스크립트·설정',other:'기타',encrypted:'암호화'};
const icons = {'':'▦',images:'▧',audio:'♫',models:'◇',scripts:'⌘',other:'▤',encrypted:'▣'};
const statuses = {indexed:'분석 완료',extracted:'추출 완료',error:'오류',encrypted:'암호화',raw:'원본 보존'};
let category='', page=1, total=0, mode='list', items=[], selected=new Set(), stats={}, running=false, initialized=false, activeId=null, generation=0, previewGeneration=0, lastJob='', toastTimer;
let groupValue=null, groupRows=[], textLimit=4096, resetPending=false;
const fmt = n => Number(n || 0).toLocaleString('ko-KR');
function bytes(n){ if(!n)return '0 B'; const units=['B','KiB','MiB','GiB','TiB']; const i=Math.min(4,Math.floor(Math.log(n)/Math.log(1024))); return (n/1024**i).toFixed(i?1:0)+' '+units[i]; }
function node(tag, className, text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,8000);}
async function api(path, data){const response=await fetch(path,{headers:{'X-Explorer-Token':token,...(data?{'Content-Type':'application/json'}:{})},...(data?{method:'POST',body:JSON.stringify(data)}:{})});const result=await response.json();if(!response.ok)throw new Error(result.error||'요청에 실패했습니다.');return result;}
const modelFilterKeys=['character','kind','family','part','variant'];
function filters(){return {category,q:$('search').value,detail:$('detail').value,format:$('format').value,status:$('status').value,saved:$('saved').value,duplicate:$('duplicate').value,...(category==='models'?Object.fromEntries(modelFilterKeys.map(k=>['model_'+k,$('library-model-'+k).value])):{}),...($('group-axis').value?{group_axis:$('group-axis').value,...(groupValue!==null?{group_value:groupValue}:{})}:{})};}
async function modelFilters(seq){
  $('library-model-filters').hidden=category!=='models';if(category!=='models')return;
  const params=Object.fromEntries(modelFilterKeys.map(k=>[k,$('library-model-'+k).value]));
  const data=await api('/api/model-facets?'+new URLSearchParams(params));if(seq!==generation)return;
  const titles=['모든 캐릭터','모든 종류','모든 의상 분류','모든 부위','모든 메시'];
  modelFilterKeys.forEach((k,i)=>{const s=$('library-model-'+k),value=s.value;s.replaceChildren(new Option(titles[i],''),...data.facets[k].map(f=>new Option(f.label+' · '+fmt(f.count),f.value)));if(value&&!Array.from(s.options).some(o=>o.value===value))s.add(new Option(value+' · 0',value));s.value=value;});
}
function mediaUrl(id){return `/api/media/${id}?token=${encodeURIComponent(token)}`;}
function setBusy(value){value=value||resetPending;running=value;$('select-page').disabled=!!$('group-axis').value&&groupValue===null;for(const id of ['manage-data','scan','process','compare','workers','browse-source','browse-output','preserve-filtered','export-index','source','output','verify','retry-errors','raw','register-preservation'])$(id).disabled=value;$('cancel').disabled=!value||resetPending;$('extract-filtered').disabled=value||!total;$('extract-selected').disabled=value||!selected.size;$('extract-one').disabled=value||activeId===null;$('selected-count').textContent=selected.size?`(${selected.size})`:'';updateSavedActions();updateScopePreview();}
function categoryNav(){const counts={};for(const g of stats.groups||[])counts[g.category]=(counts[g.category]||0)+g.count;const nav=$('categories');nav.replaceChildren();for(const [key,label] of Object.entries({'':'모든 리소스',...labels})){const button=node('button',category===key?'active':'');button.append(node('span','icon',icons[key]),node('span','',label),node('span','count',fmt(key?counts[key]:Object.values(counts).reduce((a,b)=>a+b,0))));button.onclick=()=>{category=key;page=1;groupValue=null;$('detail').value='';renderDetails();categoryNav();$('category-title').textContent=label;refresh();};nav.append(button);}}
function renderDetails(){const current=$('detail').value;const details=[...new Set((stats.groups||[]).filter(g=>!category||g.category===category).map(g=>g.detail))];$('detail').replaceChildren(new Option('모든 세부 분류',''),...details.map(v=>new Option(v,v)));if(details.includes(current))$('detail').value=current;}
async function loadStats(){stats=await api('/api/stats');renderLibraryStats();await loadPreservationSources();}
async function refresh(){const seq=++generation;$('group-back').hidden=groupValue===null;$('group-edit').hidden=groupValue===null;modelFilters(seq).catch(e=>toast(e.message));if($('group-axis').value&&groupValue===null)return refreshGroups(seq);try{const result=await api('/api/entries?'+new URLSearchParams({...filters(),page,limit:60}));if(seq!==generation)return;items=result.items;total=result.total;selected.clear();$('select-page').checked=false;$('result-count').textContent=fmt(total)+'개 항목';const pages=Math.max(1,Math.ceil(total/60));if(page>pages){page=pages;return refresh();}$('page-label').textContent=`${page} / ${pages}`;$('prev').disabled=page<=1;$('next').disabled=page>=pages;render();setBusy(running);}catch(e){toast(e.message);}}
function checkbox(item){const box=node('input');box.type='checkbox';box.checked=selected.has(item.id);box.setAttribute('aria-label',item.name+' 선택');box.onclick=e=>e.stopPropagation();box.onchange=()=>{if(box.checked)selected.add(item.id);else selected.delete(item.id);$('select-page').checked=items.length>0&&selected.size===items.length;setBusy(running);};return box;}
function badge(item){const stack=node('span','status-stack');stack.append(node('span','badge '+item.status,item.issue?item.issue.label+' 실패':statuses[item.status]||item.status));stack.append(node('span','badge '+(item.output&&!item.saved_exists?'missing':''),item.saved_exists?'저장 파일 있음':item.output?'저장 파일 없음':'미저장'));if(item.same_name_count>1)stack.append(node('span','badge duplicate','같은 이름 '+fmt(item.same_name_count)));if(item.same_content_count>1)stack.append(node('span','badge duplicate','같은 내용 '+fmt(item.same_content_count)));return stack;}
function render(){const target=$('results');target.replaceChildren();$('empty').hidden=items.length>0;if(!items.length){$('empty').querySelector('h3').textContent=(stats.archives?.count||0)?'조건에 맞는 리소스가 없습니다':'리소스 라이브러리를 시작하세요';return;}if(mode==='grid'){const grid=node('div','grid');for(const item of items){const card=node('article','card');card.tabIndex=0;card.setAttribute('aria-label',item.name+' 미리보기');const check=checkbox(item);check.className='card-check';const art=node('div','card-art');if(item.category==='images'&&item.size<=64*1024*1024){const image=node('img');image.loading='lazy';image.alt=item.name;image.src=mediaUrl(item.id);image.onerror=()=>art.replaceChildren(node('span','',icons.images));art.append(image);}else art.textContent=icons[item.category]||'▤';const info=node('div','card-info');const name=node('div','filename',item.name);name.title=item.name;info.append(name,node('div','subline',`${item.detail} · ${item.format.toUpperCase()} · ${bytes(item.size)}`),sourceLine(item),badge(item));card.append(check,art,info);card.onclick=()=>preview(item.id);card.onkeydown=e=>{if(e.key==='Enter')preview(item.id);};grid.append(card);}target.append(grid);}else{const table=node('table');const head=node('thead'),hr=node('tr');for(const text of ['','파일명 / 원본 아카이브','세부 분류','형식','크기','상태'])hr.append(node('th','',text));head.append(hr);table.append(head);const body=node('tbody');for(const item of items){const row=node('tr');row.tabIndex=0;const check=node('td');check.append(checkbox(item));const name=node('td');const title=node('div','filename',item.name);title.title=item.name;name.append(title,sourceLine(item));const type=node('td');type.append(node('span','type-tag',item.format.toUpperCase()));const status=node('td');status.append(badge(item));row.append(check,name,node('td','muted',item.detail),type,node('td','muted',bytes(item.size)),status);row.onclick=()=>preview(item.id);row.onkeydown=e=>{if(e.key==='Enter')preview(item.id);};body.append(row);}table.append(body);target.append(table);}}
async function preview(id){return inspectResource(id);}
async function extract(selection,force=false){try{const f=selection?{ids:selection}:filters();await api('/api/extract',{output:$('output').value,filters:f,raw:$('raw').checked,verify:$('verify').value,retry_errors:force||$('retry-errors').checked});setBusy(true);}catch(e){toast(e.message);}}
async function poll(){
  try{
    if(resetPending)return;
    const state=await api('/api/state');
    if(resetPending)return;
    if(!initialized){$('source').value=state.default_input;$('output').value=state.default_output;$('preservation-output').value=state.workspace+'/stored-preservation';$('workspace').textContent=state.workspace;$('manifest').href='/api/manifest?token='+encodeURIComponent(token);initialized=true;await loadStats();await refresh();}
    const job=state.job,key=String(job.started||'')+':'+job.running,finished=lastJob!==key&&!job.running;lastJob=key;setBusy(job.running);
    $('job-label').textContent=job.running?(job.operation==='reset'?'전체 초기화 중':job.operation==='compare'?'원본 변경 비교 중':job.operation==='preserve'?'저장 바이트 보존 중 · 원문 미복원':job.operation==='index'?'인덱스 내보내기 중':job.operation==='scan'?'CMF 목록 분석 중':job.operation==='process'?'분석·추출 중 · 전체 수량 탐색 중':'원본 형식 파일 추출 중'):job.status==='issues'?'처리 종료 · 오류 확인 필요':job.status==='error'?'작업 오류':job.status==='cancelled'?'작업 중단':job.status==='completed'?'작업 완료':'준비됨';
    if(job.operation==='reset')$('cancel').disabled=true;
    $('job-current').textContent=job.current;$('job-current').title=job.current;
    const result=job.result||{};
    $('job-numbers').textContent=job.started?`${fmt(job.done)}${job.total!==undefined&&job.total!==null?' / '+fmt(job.total):''}개 · ${job.elapsed}s · 아카이브 실패 ${fmt(job.archive_failed)} · 항목 실패 ${fmt(job.entry_failed??job.failed)} · 완료 재사용 ${fmt(job.skipped)} · 암호화 정책 제외 ${fmt(result.encrypted??job.encrypted)} · 인덱스 ${fmt(result.indexes??job.indexes)}${job.written?' · '+bytes(job.written):''}${result.outside_scope!==undefined?' · 범위 밖 '+fmt(result.outside_scope)+'개 (실패 아님)':''}${job.status==='cancelled'&&job.total!=null?' · 미처리 '+fmt(Math.max(0,job.total-job.done))+'개':''}`:'';
    $('job-scope').textContent=job.scope?'이번 작업 범위: '+describeScope(job.scope):'';
    if(job.started)$('job-numbers').textContent+=' · 복원 실패 재사용 '+fmt(result.cached_failures??job.cached_failures);
    if(result.counts)showUpdateComparison(result);
    if(job.running&&!job.total)$('progress').removeAttribute('value');else $('progress').value=job.total?job.done/job.total*100:['completed','issues'].includes(job.status)?100:0;
    if(finished){await loadStats();await refresh();if(activeId!==null&&$('preview').open)await inspectResource(activeId);}
  }catch(e){toast('서버 상태를 확인할 수 없습니다: '+e.message);}finally{setTimeout(poll,1000);}
}
$('scan').onclick=async()=>{try{await api('/api/scan',{paths:[$('source').value],retry_errors:$('retry-errors').checked});setBusy(true);}catch(e){toast(e.message);}};
for(const key of ['source','output'])$('browse-'+key).onclick=async()=>{try{const result=await api('/api/folder',{});if(result.path)$(key).value=result.path;}catch(e){toast(e.message);}};
$('cancel').onclick=async()=>{try{await api('/api/cancel',{});$('job-current').textContent='중단 요청 중…';}catch(e){toast(e.message);}};
$('extract-filtered').onclick=()=>extract();$('extract-selected').onclick=()=>{if(selected.size)extract([...selected]);};$('extract-one').onclick=()=>{if(activeId!==null)extract([activeId],true);};
$('close-preview').onclick=()=>$('preview').close();$('preview').addEventListener('close',()=>{if($('preview').open)return;previewGeneration++;document.querySelectorAll('#preview audio').forEach(a=>{a.pause();a.removeAttribute('src');a.load();});activeId=null;activeResource=null;$('preview-content').replaceChildren();setBusy(running);});
let searchTimer;$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=1;refresh();},250);};for(const key of ['detail','format','status','saved','duplicate'])$(key).onchange=()=>{page=1;refresh();};
for(const key of modelFilterKeys)$('library-model-'+key).onchange=()=>{page=1;groupValue=null;refresh();};
$('prev').onclick=()=>{page--;refresh();};$('next').onclick=()=>{page++;refresh();};$('select-page').onchange=()=>{selected=$('select-page').checked?new Set(items.map(i=>i.id)):new Set();render();setBusy(running);};
for(const kind of ['list','grid'])$(kind+'-mode').onclick=()=>{mode=kind;$('list-mode').classList.toggle('active',kind==='list');$('grid-mode').classList.toggle('active',kind==='grid');if($('group-axis').value&&groupValue===null)refresh();else render();};
poll();
$('process').onclick=async()=>{try{await api('/api/process',{paths:[$('source').value],output:$('output').value,filters:filters(),raw:$('raw').checked,verify:$('verify').value,retry_errors:$('retry-errors').checked,workers:Number($('workers').value)});setBusy(true);}catch(e){toast(e.message);}};

async function refreshGroups(seq){
  try{
    const r=await api('/api/groups?'+new URLSearchParams({...filters(),page,limit:30}));
    if(seq!==generation)return;groupRows=r.items;items=[];selected.clear();total=r.total;
    const pages=Math.max(1,Math.ceil(total/30));if(page>pages){page=pages;return refresh();}
    $('result-count').textContent=fmt(total)+'개 그룹';$('page-label').textContent=page+' / '+pages;
    $('prev').disabled=page<=1;$('next').disabled=page>=pages;$('select-page').checked=false;
    $('group-evidence').textContent=r.evidence;$('empty').hidden=total>0;
    const grid=node('div','grid');for(const g of groupRows){
      const card=node('article','card'),info=node('div','card-info');
      info.append(node('div','filename',g.label||g.value),node('div','subline',fmt(g.count)+'개 · '+bytes(g.bytes)),node('div','subline',g.tags||''));
      const open=node('button','secondary','그룹 열기');open.onclick=()=>{groupValue=g.value;page=1;$('group-label').value=g.label||'';$('group-tags').value=g.tags||'';$('group-evidence').textContent=g.value+' · '+r.evidence;refresh();};
      const representative=node('button','secondary','대표 미리보기');representative.onclick=()=>preview(g.representative);
      info.append(open,representative);card.append(info);grid.append(card);
    }
    $('results').replaceChildren(grid);setBusy(running);
  }catch(e){toast(e.message);}
}
$('group-axis').onchange=()=>{groupValue=null;page=1;$('group-evidence').textContent='';refresh();};
$('group-back').onclick=()=>{groupValue=null;page=1;refresh();};
$('group-save').onclick=async()=>{try{await api('/api/group-note',{axis:$('group-axis').value,value:groupValue,label:$('group-label').value,tags:$('group-tags').value});toast('그룹 이름과 태그를 저장했습니다.');}catch(e){toast(e.message);}};
async function textViewer(id,seq,content){
  const controls=node('div','filters'),encoding=node('select'),find=node('input'),more=node('button','secondary','더 보기'),copy=node('button','secondary','본문 복사'),message=node('p','muted'),body=node('pre','script-body');
  encoding.setAttribute('aria-label','텍스트 인코딩');for(const v of ['auto','utf-8-sig','utf-16','utf-16-le','utf-16-be','cp949'])encoding.add(new Option(v==='auto'?'인코딩 자동':v,v));
  find.placeholder='불러온 본문 검색';find.setAttribute('aria-label','불러온 본문 검색');controls.append(encoding,find,more,copy);content.append(controls,message,body);
  let limit=4096,text='',revision=0;
  function renderText(){const lines=text.split('\n',10001).slice(0,10000);let matches=0;const q=find.value.toLocaleLowerCase();body.replaceChildren();lines.forEach((line,i)=>{const el=node('div','',String(i+1).padStart(5)+'  '+line);if(q&&line.toLocaleLowerCase().includes(q)){el.className='text-match';matches++;}body.append(el);});if(q)message.textContent='불러온 본문에서 일치하는 줄 '+matches+'개';}
  async function load(){const rev=++revision;const r=await api('/api/text/'+id+'?'+new URLSearchParams({limit,encoding:encoding.value}));if(seq!==previewGeneration||rev!==revision)return;text=r.text;renderText();message.textContent=r.error||((r.encoding||'')+' · '+bytes(r.consumed)+' / '+bytes(r.full_size)+(r.truncated?' · 앞부분만 표시':' · 전체 본문')+' · 검색 표시: 최대 10,000줄, 복사: 불러온 본문');more.disabled=!r.truncated||limit>=1024*1024||!!r.error;}
  more.onclick=()=>{limit=Math.min(1024*1024,limit*4);load().catch(e=>toast(e.message));};encoding.onchange=()=>load().catch(e=>toast(e.message));find.oninput=renderText;copy.onclick=()=>navigator.clipboard.writeText(text).catch(e=>toast(e.message));await load();
}

$('group-audio').onclick=async()=>{
  if(groupValue===null)return;
  const seq=++previewGeneration,selection={...filters(),category:'audio'};
  activeId=null;activeResource=null;setBusy(running);$('preview-name').textContent=$('group-label').value||groupValue;
  $('preview-kind').textContent='그룹 음성 · 목록 순서 (실제 대화 순서 미확정)';
  $('preview-info').replaceChildren();$('preview-hex').textContent='';$('preview-state').textContent='';$('preview-note').textContent='파일명 후보 관계입니다. 퀘스트·장면·화자·분기는 확인되지 않았습니다.';
  const audio=node('audio'),previous=node('button','secondary','이전 음성'),next=node('button','secondary','다음 음성'),label=node('p','muted'),controls=node('div','filters');
  audio.controls=true;controls.append(previous,next);$('preview-content').replaceChildren(label,audio,controls);if(!$('preview').open)$('preview').showModal();
  let offset=0,revision=0;
  async function play(delta){
    const target=Math.max(0,offset+delta),rev=++revision;
    const result=await api('/api/entries?'+new URLSearchParams({...selection,page:Math.floor(target/200)+1,limit:200}));
    if(seq!==previewGeneration||rev!==revision)return;
    if(!result.total){label.textContent='이 그룹에는 재생할 음성이 없습니다.';previous.disabled=next.disabled=true;return;}
    if(target>=result.total)return;
    offset=target;const item=result.items[offset%200];label.textContent=(offset+1)+' / '+result.total+' · '+item.name;
    previous.disabled=offset===0;next.disabled=offset+1>=result.total;audio.src=mediaUrl(item.id);
    audio.play().catch(()=>{if(seq===previewGeneration)label.textContent+=' · 재생 버튼을 누르거나 지원 형식을 확인해 주세요.';});
  }
  previous.onclick=()=>play(-1).catch(e=>toast(e.message));next.onclick=()=>play(1).catch(e=>toast(e.message));audio.onended=()=>play(1).catch(e=>toast(e.message));
  try{await play(0);}catch(e){label.textContent=e.message;}
};

$('preserve-filtered').onclick=async()=>{try{await api('/api/preserve',{destination:$('preservation-output').value,filters:filters()});setBusy(true);}catch(e){toast(e.message);}};
$('open-preservation').onclick=async()=>{try{await api('/api/open-folder',{path:$('preservation-output').value});}catch(e){toast(e.message);}};
$('export-index').onclick=async()=>{try{const source=$('source').value.trim().replace(/[\\/]+$/,'');await api('/api/index',{path:/\.cmf$/i.test(source)?source:source+'/HEADER.CMF',destination:$('preservation-output').value+'/index-'+Date.now()});setBusy(true);}catch(e){toast(e.message);}};

initLibraryUi();
initStage2Ui();
