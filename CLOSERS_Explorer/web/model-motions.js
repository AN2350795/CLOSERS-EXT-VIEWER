// Search across packs and clips without downloading their keyframes.
export function setupMotions({state,api,operation,connectAnimation,chooseClip,loadModel,element}){
  const $=id=>document.getElementById(id),dialog=$('motion-library');
  let data=null,generation=-1,page=0,request=0;
  const limit=60;
  const filters=dialog.querySelector('.motion-filters'),categories=element('div');
  categories.className='motion-categories';categories.setAttribute('role','group');categories.setAttribute('aria-label','동작 종류');
  filters.after(categories);
  $('motion-category').closest('label').hidden=true;
  const searchLabel=$('motion-search').closest('label');searchLabel.firstChild.textContent='동작 찾기';
  $('motion-search').placeholder='이름이나 동작 코드로 검색';
  const options=element('details'),optionsTitle=element('summary','탐색 옵션 · 안내');options.className='motion-options';
  options.append(optionsTitle,$('motion-defaults').closest('label'),$('motion-evidence'));
  $('motion-summary').after(options);
  const footer=$('motion-page').parentElement;footer.classList.add('motion-pagination');
  function title(clip){
    if(!clip)return '읽을 수 없는 동작';
    if(clip.game_names?.length)return clip.game_names[0];
    if(clip.display_name)return clip.display_name;
    return clip.name.replace(/^MOTION_[A-Z]+_/,'').replace(/_(START|LOOP|END)$/,'').replace(/_/g,' ').trim();
  }
  function phase(clip){
    if(!clip)return '';
    if(clip.name.startsWith('_DEFAULT'))return '기본 자세';
    return /_LOOP$/.test(clip.name)?'반복':/_END$/.test(clip.name)?'마무리':/_START$/.test(clip.name)?'시작':'';
  }
  function reset(){
    if(dialog.open)dialog.close();
    request++;data=null;generation=-1;page=0;
    categories.replaceChildren();
    $('motion-search').value='';$('motion-category').value='';
    $('motion-results').replaceChildren();$('motion-summary').textContent='모델을 선택한 뒤 모든 동작을 탐색하세요.';
    $('open-motions').disabled=!state.model;
  }
  function render(){
    if(!data)return;
    const query=$('motion-search').value.trim().toUpperCase(),kind=$('motion-category').value;
    const rows=[];
    for(const file of data.files){
      if(kind&&file.category!==kind)continue;
      for(const clip of file.clips.length?file.clips:[null]){
        if(!$('motion-defaults').checked&&clip?.name.startsWith('_DEFAULT'))continue;
        if(query&&!`${file.name} ${clip?.name||''} ${clip?.secondary||''} ${clip?.display_name||''} ${(clip?.game_names||[]).join(' ')}`.toUpperCase().includes(query))continue;
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
      button.onclick=()=>operation(async()=>{
        if(generation!==state.generation)return;
        if(file.skeleton_id!==state.data.skeleton_source.entry_id){
          const items=Object.fromEntries(state.data.sources.filter(s=>s.appearance_key).map(s=>[s.entry_id,s.appearance_key]));
          await loadModel(state.ids,file.skeleton_id,state.eye,items);
        }
        const current=state.generation;
        if(state.animation?.id!==file.id)await connectAnimation(file.id);
        if(current!==state.generation)return;
        if(!state.animation||state.animation.id!==file.id)throw Error('동작 연결을 다시 시도해 주세요.');
        await chooseClip(clip.index);
        dialog.close();
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
      if(clip?.game_names?.length>1)body.append(element('small','연결된 명칭 · '+clip.game_names.join(' / ')));
      if(clip?.name_sources?.length){
        for(const source of clip.name_sources)body.append(element('small',`${source.label} · ${source.skill_id} → ${source.state} · ${source.state_table} · ${source.string_table}: ${source.string_key}`));
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
  async function open(){
    if(!state.model)return;
    dialog.showModal();
    if(data&&generation===state.generation){render();return;}
    const version=++request,current=state.generation;
    $('motion-results').replaceChildren();$('motion-summary').textContent='캐릭터의 동작 파일과 개별 동작을 정리하고 있습니다…';
    try{
      const result=await api('/api/model-motion-library?'+new URLSearchParams({skeleton:state.data.skeleton_source.entry_id,entries:state.ids.join(',')}));
      if(version!==request||current!==state.generation)return;
      if(result.skeleton_source.sha256!==state.data.skeleton_source.sha256)throw Error('뼈 파일이 변경되었습니다. 모델을 다시 열어 주세요.');
      data=result;generation=current;
      $('motion-evidence').textContent=result.evidence;
      $('motion-category').replaceChildren(element('option','모든 종류'));
      categories.replaceChildren();
      $('motion-category').firstChild.value='';
      for(const [key,label] of Object.entries(result.categories)){
        const count=result.files.filter(f=>f.category===key).reduce((n,f)=>n+f.clips.length,0);
        const option=element('option',`${label} (${count})`);option.value=key;$('motion-category').append(option);
      }
      for(const option of $('motion-category').options){
        const button=element('button',option.value?result.categories[option.value]:'전체');button.type='button';button.dataset.category=option.value;
        button.onclick=()=>{$('motion-category').value=option.value;page=0;render();};categories.append(button);
      }
      render();
    }catch(e){if(version===request)$('motion-summary').textContent=e.message;}
  }
  $('open-motions').onclick=open;$('close-motions').onclick=()=>dialog.close();
  $('motion-search').oninput=$('motion-category').onchange=$('motion-defaults').onchange=()=>{page=0;render();};
  $('motion-prev').onclick=()=>{page--;render();};$('motion-next').onclick=()=>{page++;render();};
  document.addEventListener('model-selection',reset);
  reset();
  return {reset};
}
