// Search across packs and clips without downloading their keyframes.
export function setupMotions({state,api,operation,connectAnimation,chooseClip,chooseSequence,loadModel,element}){
  const $=id=>document.getElementById(id),dialog=$('motion-library');
  let data=null,generation=-1,page=0,request=0,pending=null,application=null,listController;
  const disabledControls=new Map(),openLabel=$('open-motions').textContent;
  const progress=element('div');progress.id='motion-progress';progress.hidden=true;progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');progress.setAttribute('aria-atomic','true');
  const spinner=element('span');spinner.className='motion-progress-spinner';spinner.setAttribute('aria-hidden','true');
  const progressText=element('div'),progressTitle=element('strong'),progressDetail=element('span'),retry=element('button','다시 불러오기');retry.type='button';retry.className='secondary';retry.hidden=true;
  progressText.append(progressTitle,progressDetail);progress.append(spinner,progressText,retry);dialog.querySelector('.view-settings-heading').after(progress);
  function showProgress(kind,title,detail){
    pending=kind;progress.hidden=false;progress.dataset.state=kind;progressTitle.textContent=title;progressDetail.textContent=detail;retry.hidden=true;
    dialog.dataset.loading=kind;$('motion-results').setAttribute('aria-busy','true');$('open-motions').setAttribute('aria-busy','true');$('open-motions').textContent=kind==='list'?'목록 불러오는 중…':'동작 적용 중…';
    for(const control of dialog.querySelectorAll('button,input,select')){
      if(control.id==='close-motions'||control===retry||(kind==='list'&&control.id==='bind-pose'))continue;
      if(!disabledControls.has(control))disabledControls.set(control,control.disabled);control.disabled=true;
    }
  }
  function clearProgress(){
    pending=null;progress.hidden=true;delete dialog.dataset.loading;$('motion-results').setAttribute('aria-busy','false');$('open-motions').removeAttribute('aria-busy');$('open-motions').textContent=openLabel;
    for(const [control,disabled] of disabledControls)control.disabled=disabled;disabledControls.clear();
  }
  function showError(title,error,canRetry=false){
    progress.hidden=false;progress.dataset.state='error';progressTitle.textContent=title;progressDetail.textContent=error.message;retry.hidden=!canRetry;
  }
  const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  async function applySelection(button,label,work){
    if(pending||state.busy||generation!==state.generation)return;
    const active={changingModel:false,cancelled:false};application=active;let error;
    showProgress('apply',label+' 적용 중…','선택한 동작을 준비하고 있습니다.');button.classList.add('is-loading');button.setAttribute('aria-busy','true');
    try{
      await operation(async()=>{
        await paint();if(active.cancelled)return;
        try{await work(active);if(!active.cancelled)dialog.close();}catch(e){error=e;}
      });
    }finally{
      if(application===active){
        application=null;clearProgress();button.classList.remove('is-loading');button.removeAttribute('aria-busy');
        if(!active.cancelled){updateBind();render();if(error)showError('동작을 적용하지 못했습니다',error);}
      }
    }
  }
  const limit=60;
  const bindRow=element('div');bindRow.className='motion-bind motion-result';
  const bindButton=element('button','기본 자세');bindButton.id='bind-pose';bindButton.type='button';bindButton.className='motion-select';
  bindRow.append(bindButton,element('span','동작 없이 모델 보기'));progress.after(bindRow);
  let mode='clips';const modes=element('div');modes.className='motion-modes';modes.setAttribute('role','group');modes.setAttribute('aria-label','동작 목록 방식');
  for(const [key,label] of [['clips','개별 동작'],['sequences','묶음 동작']]){
    const button=element('button',label);button.type='button';button.dataset.motionMode=key;
    button.onclick=()=>{mode=key;page=0;render();};modes.append(button);
  }
  bindRow.after(modes);
  function updateBind(){
    bindButton.disabled=!state.model||state.busy||pending==='apply';
    bindRow.classList.toggle('is-selected',!!state.model&&!state.clip);
    bindButton.setAttribute('aria-pressed',String(!!state.model&&!state.clip));
  }
  const filters=dialog.querySelector('.motion-filters'),categories=element('div');
  categories.className='motion-categories';categories.setAttribute('role','group');categories.setAttribute('aria-label','동작 종류');
  filters.after(categories);
  $('motion-category').closest('label').hidden=true;
  const searchLabel=$('motion-search').closest('label');searchLabel.firstChild.textContent='동작 찾기';
  $('motion-search').placeholder='이름·동작 코드·타운 그룹으로 검색';
  const options=element('details'),optionsTitle=element('summary','탐색 옵션 · 안내');options.className='motion-options';
  options.append(optionsTitle,$('motion-defaults').closest('label'),$('motion-evidence'));
  $('motion-summary').after(options);
  const footer=$('motion-page').parentElement;footer.classList.add('motion-pagination');
  function title(clip){
    if(!clip)return '읽을 수 없는 동작';
    if(clip.display_name)return clip.display_name;
    if(clip.game_names?.length)return clip.game_names[0];
    return clip.name.replace(/^MOTION_[A-Z]+_/,'').replace(/_(START|LOOP|END)$/,'').replace(/_/g,' ').trim();
  }
  function phase(clip){
    if(!clip)return '';
    if(clip.name.startsWith('_DEFAULT'))return '기본 자세';
    return /_LOOP$/.test(clip.name)?'반복':/_END$/.test(clip.name)?'마무리':/_START$/.test(clip.name)?'시작':'';
  }
  function reset(){
    const keepApplication=application?.changingModel&&!application.cancelled;
    if(!keepApplication){if(application)application.cancelled=true;application=null;clearProgress();if(dialog.open)dialog.close();}
    listController?.abort();
    request++;data=null;generation=-1;page=0;
    categories.replaceChildren();
    $('motion-search').value='';$('motion-category').value='';
    $('motion-results').replaceChildren();$('motion-summary').textContent=keepApplication?'':'모델을 선택한 뒤 모든 동작을 탐색하세요.';
    $('open-motions').disabled=!state.model||state.busy;
    $('motion-prev').disabled=$('motion-next').disabled=true;
    updateBind();
  }
  function render(){
    if(!data)return;
    for(const button of modes.children)button.setAttribute('aria-pressed',String(button.dataset.motionMode===mode));
    categories.hidden=mode==='sequences';
    if(mode==='sequences'){renderSequences();return;}
    const query=$('motion-search').value.trim().toUpperCase(),kind=$('motion-category').value;
    const rows=[];
    for(const file of data.files){
      for(const clip of file.clips.length?file.clips:[null]){
        if(kind&&file.category!==kind&&!clip?.motion_categories?.includes(kind))continue;
        if(!$('motion-defaults').checked&&clip?.name.startsWith('_DEFAULT'))continue;
        const registrations=(clip?.motion_registrations||[]).map(r=>`${r.type==='SCT_TOWN_MOTION'?'타운':'던전'} 그룹 ${r.group} ${r.state} ${r.source}`).join(' ');
        if(query&&!`${file.name} ${clip?.name||''} ${clip?.secondary||''} ${clip?.display_name||''} ${(clip?.game_names||[]).join(' ')} ${registrations}`.toUpperCase().includes(query))continue;
        rows.push({file,clip});
      }
    }
    $('motion-summary').textContent=`${rows.length.toLocaleString()}개 동작`;
    for(const button of categories.children)button.setAttribute('aria-pressed',String(button.dataset.category===kind));
    page=Math.min(page,Math.max(0,Math.ceil(rows.length/limit)-1));
    $('motion-results').replaceChildren();
    for(const {file,clip} of rows.slice(page*limit,(page+1)*limit)){
      const row=element('div');row.className='motion-result';
      const button=element('button');button.className='motion-select';
      const selected=!!clip&&state.animation?.id===file.id&&state.clip?.clip.index===clip.index;
      row.classList.toggle('is-selected',selected);
      const icon=element('span',selected?'✓':'▷');icon.className='motion-select-icon';icon.setAttribute('aria-hidden','true');
      const name=element('span',title(clip));name.className='motion-name';
      button.append(icon,name);button.setAttribute('aria-label',title(clip)+' 선택');
      button.type='button';button.disabled=file.status!=='ready'||!clip||state.busy;
      button.title=file.error||'동작 선택 후 재생 버튼으로 재생합니다.';
      button.onclick=()=>applySelection(button,title(clip),async active=>{
        if(file.skeleton_id!==state.data.skeleton_source.entry_id){
          progressDetail.textContent='이 동작에 필요한 전용 모델을 불러오는 중입니다.';active.changingModel=true;
          const items=Object.fromEntries(state.data.sources.filter(s=>s.appearance_key).map(s=>[s.entry_id,s.appearance_key]));
          try{await loadModel(state.ids,file.skeleton_id,state.eye,items);}finally{active.changingModel=false;}
        }
        if(active.cancelled)return;
        const current=state.generation;
        progressDetail.textContent='동작 파일을 연결하는 중입니다.';
        if(state.animation?.id!==file.id)await connectAnimation(file.id);
        if(current!==state.generation||active.cancelled)return;
        if(!state.animation||state.animation.id!==file.id)throw Error('동작 연결을 다시 시도해 주세요.');
        progressDetail.textContent='선택한 동작을 적용하는 중입니다.';
        await chooseClip(clip.index);
      });
      const meta=element('div');meta.className='motion-row-meta';
      if(phase(clip))meta.append(element('span',phase(clip)));
      if(selected)meta.append(element('span','선택됨'));
      if(file.status!=='ready'){row.classList.add('is-unavailable');meta.append(element('span','연결 확인 필요'));}
      if(clip)meta.append(element('span',clip.duration.toFixed(1)+'초'));
      const details=element('details'),summary=element('summary','정보');details.className='motion-details';details.append(summary);
      summary.setAttribute('aria-label',title(clip)+' 상세 정보');
      const body=element('div');body.className='motion-detail-body';
      body.append(element('small','동작 코드 · '+(clip?.name||'없음')),element('small','종류 · '+data.categories[file.category]),
        element('small','파일 · '+file.name),element('small','출처 · '+file.archive+' · 항목 '+file.ordinal));
      if(clip?.secondary&&clip.secondary!==clip.name)body.append(element('small','보조 이름 · '+clip.secondary));
      for(const registration of clip?.motion_registrations||[]){
        body.append(element('small',`${registration.type==='SCT_TOWN_MOTION'?'타운':'던전'} 그룹 ${registration.group} · ${registration.state} · ${registration.source}${registration.ambiguous?' · 등록 충돌':''}`));
      }
      if(file.saved_exists){
        const download=element('a','원본 XMD 저장');
        download.href='/api/download/'+file.id+'?token='+encodeURIComponent(document.querySelector('meta[name="explorer-token"]').content);
        body.append(download);
      }
      if(clip?.game_names?.length>1)body.append(element('small','연결된 명칭 · '+clip.game_names.join(' / ')));
      if(clip?.name_kind==='reference')body.append(element('small','공용 클립을 사용하는 스킬의 명칭입니다. 이 동작 자체의 이름으로 확정하지 않습니다.'));
      if(clip?.name_sources?.length){
        for(const source of clip.name_sources)body.append(element('small',source.kind==='skin'
          ?`${source.label} · 스킨 그룹 ${source.group} → ${source.state} · ${source.skill_table} · ${source.string_table}: ${source.string_key}`
          :`${source.label} · ${source.skill_id} → ${source.state} · ${source.state_table} · ${source.string_table}: ${source.string_key}`));
      }
      if(file.error)body.append(element('p',file.error));
      if(file.skeleton_name)body.append(element('small','선택 시 전용 뼈 연결: '+file.skeleton_name));
      details.append(body);row.append(button,meta,details);
      $('motion-results').append(row);
    }
    if(!rows.length)$('motion-results').append(element('p','조건에 맞는 동작이 없습니다.'));
    $('motion-page').textContent=`${page+1} / ${Math.max(1,Math.ceil(rows.length/limit))}`;
    $('motion-prev').disabled=page===0;$('motion-next').disabled=(page+1)*limit>=rows.length;
    $('motion-results').scrollTop=0;
  }
  function renderSequences(){
    const query=$('motion-search').value.trim().toUpperCase();
    const sequences=(data.sequences||[]).filter(s=>`${s.label} ${s.key} ${s.steps.map(v=>v.name).join(' ')}`.toUpperCase().includes(query));
    page=Math.min(page,Math.max(0,Math.ceil(sequences.length/limit)-1));
    $('motion-summary').textContent=`${sequences.length}개 묶음 동작`;$('motion-results').replaceChildren();
    for(const sequence of sequences.slice(page*limit,(page+1)*limit)){
      const row=element('div');row.className='motion-result';
      row.classList.toggle('is-selected',state.sequence?.definition.key===sequence.key);
      const button=element('button');button.type='button';button.className='motion-select';
      const icon=element('span','▷');icon.className='motion-select-icon';icon.setAttribute('aria-hidden','true');
      const name=element('span',sequence.label);name.className='motion-name';button.append(icon,name);
      button.disabled=sequence.status!=='ready'||state.busy;
      button.onclick=()=>applySelection(button,sequence.label,async active=>{
        active.changingModel=sequence.skeleton_id!==state.data.skeleton_source.entry_id;
        try{await chooseSequence(sequence,message=>{if(application===active&&!active.cancelled)progressDetail.textContent=message;});}
        finally{active.changingModel=false;}
      });
      const meta=element('div',sequence.status==='ready'?(sequence.loop_index===0?'반복 → 종료':'시작 → 반복 → 종료'):'구성 확인 필요');meta.className='motion-row-meta';
      const details=element('details');details.className='motion-details';
      const summary=element('summary','정보');summary.setAttribute('aria-label',sequence.label+' 구성 정보');details.append(summary);
      const body=element('div');body.className='motion-detail-body';
      sequence.steps.forEach((step,i)=>body.append(element('small',`${i<sequence.loop_index?'시작':i===sequence.loop_index?'반복':'종료'} · ${step.name} · ${step.speed}× · ${step.source}`)));
      body.append(element('small',sequence.skill_table+' · '+sequence.key));
      if(sequence.error)body.append(element('p',sequence.error));
      details.append(body);row.append(button,meta,details);$('motion-results').append(row);
    }
    if(!sequences.length)$('motion-results').append(element('p',data.sequence_index_available?'연결이 확인된 묶음 동작이 없습니다.':'묶음 동작 정보를 추가하려면 라이브러리에서 후처리만 실행해 주세요.'));
    $('motion-page').textContent=`${page+1} / ${Math.max(1,Math.ceil(sequences.length/limit))}`;
    $('motion-prev').disabled=page===0;$('motion-next').disabled=(page+1)*limit>=sequences.length;
    $('motion-results').scrollTop=0;
  }
  async function open(){
    if(!state.model||pending)return;
    clearProgress();if(!dialog.open)dialog.showModal();
    updateBind();
    if(data&&generation===state.generation){render();return;}
    const version=++request,current=state.generation;
    listController?.abort();listController=new AbortController();
    $('motion-results').replaceChildren();$('motion-summary').textContent='';
    showProgress('list','동작 목록을 불러오는 중…','캐릭터의 개별 동작과 묶음 정보를 정리하고 있습니다.');
    try{
      await paint();if(version!==request)return;
      const result=await api('/api/model-motion-library?'+new URLSearchParams({skeleton:state.data.skeleton_source.entry_id,entries:state.ids.join(',')}),listController.signal);
      if(version!==request||current!==state.generation)return;
      if(result.skeleton_source.sha256!==state.data.skeleton_source.sha256)throw Error('뼈 파일이 변경되었습니다. 모델을 다시 열어 주세요.');
      data=result;generation=current;
      $('motion-evidence').textContent=result.evidence;
      if(result.registration_index_available===false)$('motion-evidence').textContent+=' 타운·던전 그룹 검색을 사용하려면 라이브러리에서 후처리만 실행하세요.';
      if(result.missing_registrations?.length)$('motion-evidence').textContent+=` 등록 테이블의 ${result.missing_registrations.length}개 동작 코드가 현재 캐릭터 파일에 없습니다. 등록은 해당 캐릭터의 착용 가능 여부를 보장하지 않습니다.`;
      $('motion-category').replaceChildren(element('option','모든 종류'));
      categories.replaceChildren();
      $('motion-category').firstChild.value='';
      for(const [key,label] of Object.entries(result.categories)){
        const count=result.files.reduce((n,f)=>n+f.clips.filter(c=>f.category===key||c.motion_categories?.includes(key)).length,0);
        const option=element('option',`${label} (${count})`);option.value=key;$('motion-category').append(option);
      }
      for(const option of $('motion-category').options){
        const button=element('button',option.value?result.categories[option.value]:'전체');button.type='button';button.dataset.category=option.value;
        button.onclick=()=>{$('motion-category').value=option.value;page=0;render();};categories.append(button);
      }
      clearProgress();render();updateBind();
    }catch(e){if(version===request){clearProgress();showError('동작 목록을 불러오지 못했습니다',e,true);updateBind();}}
  }
  retry.onclick=open;
  dialog.addEventListener('close',()=>{if(!dialog.open&&pending==='list'){request++;listController?.abort();clearProgress();updateBind();}});
  $('open-motions').onclick=open;$('close-motions').onclick=()=>dialog.close();
  $('motion-search').oninput=$('motion-category').onchange=$('motion-defaults').onchange=()=>{page=0;render();};
  $('motion-prev').onclick=()=>{page--;render();};$('motion-next').onclick=()=>{page++;render();};
  document.addEventListener('model-selection',reset);
  reset();
  return {reset};
}
