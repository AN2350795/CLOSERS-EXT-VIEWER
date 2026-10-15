'use strict';
let activeResource = null;

function sourceLine(item){
  const line=node('div','subline source-path',item.archive);line.title=item.archive;return line;
}

function describeFilters(f={}){
  const parts=[];
  if(f.ids)parts.push('선택한 '+fmt(f.ids.length)+'개');
  if(f.category)parts.push(labels[f.category]||f.category);
  if(f.q)parts.push('검색: '+f.q);
  if(f.detail)parts.push(f.detail);
  if(f.format)parts.push('형식: '+f.format.toUpperCase());
  if(f.status)parts.push('상태: '+(statuses[f.status]||f.status));
  if(f.saved)parts.push(f.saved==='recorded'?'저장 경로 기록 있음':'저장 경로 기록 없음');
  if(f.duplicate)parts.push(f.duplicate==='name'?'같은 이름':'같은 내용 해시');
  if(f.group_axis)parts.push('그룹: '+(f.group_value??f.group_axis));
  for(const [key,title] of Object.entries({character:'캐릭터',kind:'모델 종류',family:'의상 분류',part:'부위',variant:'보조 메시'}))if(f['model_'+key])parts.push(title+': '+f['model_'+key]);
  return parts.length?parts.join(' · '):'모든 출처별 리소스';
}

function describeScope(scope){
  if(scope.phase==='compare')return '원본 변경 비교 · '+(scope.paths||[]).join(', ')+' · 저장 파일 유지';
  if(scope.phase==='scan')return '목록 분석만 · '+(scope.paths||[]).join(', ')+' · 파일 저장 없음';
  if(scope.phase==='index')return 'HEADER 인덱스 목록 · '+scope.path+' → '+scope.destination+' · 본문 없음';
  return (scope.phase==='process'?'원본: '+(scope.paths||[]).join(', ')+' · ':'')+
    describeFilters(scope.filters)+' → '+(scope.output||scope.destination)+
    (scope.phase==='preserve'?' · 저장 바이트 보존 (원문 미복원)':scope.raw?' · 암호화 저장 바이트 포함':' · 암호화 항목 정책 제외')+
    (scope.phase==='process'?' · CMF 동시 처리 '+(scope.workers||1)+'개':'')+
    (scope.retry_errors?' · 이전 실패도 다시 시도':'');
}

function updateScopePreview(){
  $('scope-preview').textContent='추출 범위: '+describeFilters(filters())+' → '+($('output').value||'저장 폴더를 입력하세요')+
    ' · 현재 선택 '+fmt(selected.size)+'개 · 중복도 출처별 저장';
}

function setDownload(id,url){
  const link=$(id);link.setAttribute('aria-disabled',url?'false':'true');
  if(url){link.href=url;link.target='_blank';link.rel='noopener';}else link.removeAttribute('href');
}

function updateSavedActions(){
  const item=activeResource,ready=!!item;
  $('reveal-one').disabled=!ready||!item.saved_exists;
  $('rescan-one').disabled=running||!ready;
  $('preserve-one').disabled=running||!ready||item.archive_status!=='ready';
  const suffix='?token='+encodeURIComponent(token);
  setDownload('download-one',ready&&item.saved_exists&&item.flag!==2?'/api/download/'+item.id+suffix:null);
  const preserved=item?.preservations?.find(p=>p.current&&p.exists);
  setDownload('download-stored',preserved?'/api/download/'+item.id+suffix+'&kind=stored&catalog='+encodeURIComponent(preserved.catalog):null);
  setDownload('compose-one',ready&&item.category==='images'&&item.flag!==2?'/compose?entries='+item.id:null);
  setDownload('model-one',ready&&item.format==='x'&&item.flag!==2?'/model?entries='+item.id:null);
  $('compose-selected').disabled=running||!items.some(i=>selected.has(i.id)&&i.category==='images');
}

async function loadPreservationSources(){
  const result=await api('/api/preservation-sources');
  $('preservation-sources').textContent=result.sources.length?'연결된 보존 폴더: '+result.sources.join(' · '):'연결된 보존 결과가 없습니다.';
}

function renderLibraryStats(){
  const groups=stats.groups||[],s=stats.statuses||{};
  $('archive-count').textContent=fmt(stats.archives.count);$('archive-bytes').textContent=bytes(stats.archives.bytes);
  $('entry-count').textContent=fmt(groups.reduce((n,g)=>n+g.count,0));$('entry-bytes').textContent='추출 예상 크기 '+bytes(groups.reduce((n,g)=>n+g.bytes,0));
  $('extracted-count').textContent=fmt(s.extracted);$('issue-count').textContent=fmt(stats.issue_entry_count+stats.error_count);
  $('diagnostic-count').textContent=`· 아카이브 오류 ${fmt(stats.error_count)}개 · 인덱스 ${fmt(stats.index_count)}개 · 내부 본문 오류 ${fmt(stats.entry_error_count)}개`;
  $('errors').replaceChildren();
  for(const item of stats.entry_issues||[])$('errors').append(node('p','',item.label+' · '+fmt(item.count)+'개 — '+item.reason+' '+item.action));
  for(const item of stats.errors||[])$('errors').append(node('p','',`아카이브 목록 읽기 실패: ${item.path} — ${item.error}`));
  const previous=$('format').value;$('format').replaceChildren(new Option('모든 형식',''),...stats.formats.map(v=>new Option(v.toUpperCase(),v)));
  if(stats.formats.includes(previous))$('format').value=previous;renderDetails();categoryNav();
}

function resourceFields(item){
  const preserved=item.preservations||[],current=preserved.filter(p=>p.current&&p.exists);
  return {
    '목록 상태':item.archive_status==='ready'?'CMF 목록 해석 완료':item.archive_status==='index'?'별도 인덱스 (본문 없음)':'아카이브 다시 분석 필요',
    '본문 복원':item.status==='extracted'?'복원 완료 기록':item.flag===2?'암호화 플래그 · 기본 정책 제외':item.issue?.stage==='decode'?(item.status==='indexed'?'앞부분 판별 실패 · 전체 복원은 미확인':'본문 복원 실패 · 미지원 가능'):'완전한 본문 복원 미확인',
    '로컬 저장':item.saved_exists?(item.status==='extracted'?'원본 형식 파일 있음':item.status==='raw'?'암호화 저장 바이트 파일 있음':'이전 저장 파일 있음'):item.output?'저장 경로 기록은 있으나 파일 없음':'원본 형식 미저장',
    '저장 바이트 보존':current.length?'보존 파일 '+current.length+'개 있음 · 원문 미복원':preserved.length?'이전 원본의 보존 기록 또는 누락된 보존 파일':'연결된 보존 기록 없음',
    '저장 방식':item.flag===1?'플래그 1 · 표준 zlib 또는 미지원 저장 형식':item.flag===2?'암호화 플래그':'비압축',
    '추출 오류 단계':item.issue?.label||'없음',
    '추출 오류 사유':item.issue?.reason||'없음',
    '다음 조치':item.issue?.action||(item.saved_exists?'파일 위치 확인 또는 원본 형식 내려받기':item.output?'저장 경로를 확인하거나 다시 추출하세요.':'이 파일 추출을 눌러 원본 형식으로 저장하세요.'),
    '원문 오류':item.error||'없음',
    '복원 실패 재사용':item.failure_key?'동일 원본·복원기 버전에서 재사용 · 이 파일 추출·재시도는 강제 실행':'실패 캐시 없음',
    '전체 복원 시도':fmt(item.error_attempts)+'회',
    '미리보기 읽기 오류':item.preview_error||'없음 · 브라우저 표시 결과는 위에서 확인',
    '같은 이름':fmt(item.same_name_count)+'항목 · 내용이 같다는 뜻은 아님',
    '같은 내용':item.sha256?fmt(item.same_content_count)+'항목 · 기록된 SHA-256 기준':'미확인 · 정상 추출 후 SHA-256 계산',
    ...(item.metadata||{}),
    '원본 CMF':item.archive,'CMF 버전':item.version,'원래 이름':item.name,
    '실제 파일 형식':item.format.toUpperCase(),'크기':`${bytes(item.size)} (CMF 저장 ${bytes(item.stored)})`,
    '추출 경로':item.output||'없음','SHA-256':item.sha256||'미기록',
    '보존 경로':preserved.map(p=>p.output+(p.current?'':' (이전 원본 기록)')+(p.exists?'':' (파일 없음)')).join('\n')||'없음',
  };
}

async function inspectResource(id){
  $('resource-history')?.remove();
  const seq=++previewGeneration;activeId=id;activeResource=null;setBusy(running);
  $('preview-name').textContent='불러오는 중…';$('preview-state').textContent='';$('preview-info').replaceChildren();$('preview-hex').textContent='';$('preview-note').textContent='';
  const content=$('preview-content');content.replaceChildren(node('p','muted','파일 정보와 저장 상태를 확인하고 있습니다.'));
  if(!$('preview').open)$('preview').showModal();
  let item;
  try{
    item=await api('/api/info/'+id);if(seq!==previewGeneration)return;
    activeResource=item;updateSavedActions();$('preview-name').textContent=item.name;$('preview-kind').textContent=(labels[item.category]||'기타')+' / '+item.detail;
    showResourceHistory(item,seq);
    for(const [key,value] of Object.entries(resourceFields(item)))$('preview-info').append(node('dt','',key),node('dd','',String(value)));
    $('preview-hex').textContent=item.hex||'복원된 본문 헤더가 없습니다.';
    $('preview-note').textContent='원본 내려받기는 저장된 바이트 그대로 · 변환·축소 미리보기와 별개 · 원래 파일명 사용';
  }catch(e){if(seq===previewGeneration)content.replaceChildren(node('p','placeholder',e.message));return;}
  const previewFailure=message=>{if(seq===previewGeneration)$('preview-state').textContent='미리보기 오류: '+message+' · 추출·보존 상태는 아래에서 별도로 확인하세요.';};
  content.replaceChildren();
  try{
    if(item.preview_error)previewFailure(item.preview_error);
    if(item.category==='scripts')await textViewer(id,seq,content);
    else if(item.flag===2)content.append(node('p','placeholder','암호화 플래그 항목은 본문을 미리볼 수 없습니다. 저장 바이트 보존이 가능합니다.'));
    else if(item.size>64*1024*1024)content.append(node('p','placeholder','크기 제한으로 미리보기를 생략합니다. 저장된 원본 형식 파일은 내려받을 수 있습니다.'));
    else if(item.category==='images'){
      const response=await fetch(mediaUrl(id));if(!response.ok)throw Error((await response.json()).error);
      const blob=await response.blob();if(seq!==previewGeneration)return;
      const image=node('img');image.alt=item.name;image.src=URL.createObjectURL(blob);
      image.onload=()=>URL.revokeObjectURL(image.src);
      image.onerror=()=>{URL.revokeObjectURL(image.src);previewFailure('브라우저가 이 이미지 형식을 표시할 수 없습니다.');};content.append(image);
    }else if(item.category==='audio'){
      const audio=node('audio');audio.controls=true;audio.preload='metadata';audio.src=mediaUrl(id);
      audio.onerror=()=>previewFailure('이 오디오를 읽거나 재생할 수 없습니다.');content.append(audio);
    }else if(item.text)content.append(node('pre','',item.text));
    else content.append(node('p','placeholder',item.format==='x'?'3D 보기에서 모델·텍스처를 확인하고, 연결을 검증한 XMD 동작을 재생할 수 있습니다.':item.category==='models'?'이 모델 형식은 아직 웹 미리보기를 지원하지 않습니다. 원본 저장 후 외부 프로그램으로 확인할 수 있습니다.':'현재는 파일 정보와 복원 가능한 바이너리 헤더를 제공합니다.'));
  }catch(e){if(seq===previewGeneration){previewFailure(e.message);content.replaceChildren(node('p','placeholder','미리보기를 표시하지 못했습니다. 파일 정보와 저장 상태를 확인하세요.'));}}
}

function initLibraryUi(){
  const compose=node('a','button secondary','이미지 조합에 추가');compose.id='compose-one';compose.setAttribute('aria-disabled','true');$('download-one').before(compose);
  const model=node('a','button secondary','3D 보기');model.id='model-one';model.setAttribute('aria-disabled','true');$('download-one').before(model);
  $('compose-selected').onclick=()=>{const ids=items.filter(i=>selected.has(i.id)&&i.category==='images').map(i=>i.id);if(ids.length>20){toast('이미지 조합은 한 번에 20개까지 선택해 주세요.');return;}if(ids.length)window.open('/compose?entries='+ids.join(','),'_blank','noopener');};
  for(const id of ['source','output'])$(id).addEventListener('input',updateScopePreview);
  $('open-output').onclick=async()=>{try{await api('/api/open-folder',{path:$('output').value});}catch(e){toast(e.message);}};
  $('reveal-one').onclick=async()=>{try{await api('/api/reveal-file',{id:activeId});}catch(e){toast(e.message);}};
  $('rescan-one').onclick=async()=>{try{await api('/api/scan',{paths:[activeResource.archive],retry_errors:true});setBusy(true);}catch(e){toast(e.message);}};
  $('preserve-one').onclick=async()=>{try{await api('/api/preserve',{destination:$('preservation-output').value,filters:{ids:[activeId]}});setBusy(true);}catch(e){toast(e.message);}};
  $('register-preservation').onclick=async()=>{try{await api('/api/register-preservation',{path:$('preservation-output').value});await loadPreservationSources();if(activeId!==null)await inspectResource(activeId);toast('기존 보존 결과를 연결했습니다.');}catch(e){toast(e.message);}};
}
