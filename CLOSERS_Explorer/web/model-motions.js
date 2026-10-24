// Search across packs and clips without downloading their keyframes.
export function setupMotions({state,api,operation,connectAnimation,chooseClip,loadModel,element}){
  const $=id=>document.getElementById(id),dialog=$('motion-library');
  let data=null,generation=-1,page=0,request=0;
  const limit=60;
  function reset(){
    if(dialog.open)dialog.close();
    request++;data=null;generation=-1;page=0;
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
        if(query&&!`${file.name} ${clip?.name||''} ${clip?.secondary||''}`.toUpperCase().includes(query))continue;
        rows.push({file,clip});
      }
    }
    const total=data.files.reduce((n,f)=>n+f.clips.length,0),failed=data.files.filter(f=>f.status!=='ready').length;
    $('motion-summary').textContent=`파일 ${data.files.length}개 · 동작 ${total}개 · 재생 확인 필요 ${failed}개 · 검색 결과 ${rows.length}개`;
    page=Math.min(page,Math.max(0,Math.ceil(rows.length/limit)-1));
    $('motion-results').replaceChildren();
    for(const {file,clip} of rows.slice(page*limit,(page+1)*limit)){
      const row=element('div');row.className='motion-result';
      const button=element('button',clip?clip.name:'동작 목록을 읽을 수 없음');
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
      const info=element('small',`${data.categories[file.category]} · ${clip?clip.duration.toFixed(2)+'초 · ':''}${file.name}`);
      const source=element('small',`${file.archive} · 항목 ${file.ordinal}`);
      row.append(button,info,source);
      if(clip?.secondary&&clip.secondary!==clip.name)row.append(element('small',clip.secondary));
      if(file.error)row.append(element('p',file.error));
      if(file.skeleton_name)row.append(element('small','선택 시 전용 뼈 연결: '+file.skeleton_name));
      $('motion-results').append(row);
    }
    if(!rows.length)$('motion-results').append(element('p','조건에 맞는 동작이 없습니다.'));
    $('motion-page').textContent=`${page+1} / ${Math.max(1,Math.ceil(rows.length/limit))}`;
    $('motion-prev').disabled=page===0;$('motion-next').disabled=(page+1)*limit>=rows.length;
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
      $('motion-category').firstChild.value='';
      for(const [key,label] of Object.entries(result.categories)){
        const count=result.files.filter(f=>f.category===key).reduce((n,f)=>n+f.clips.length,0);
        const option=element('option',`${label} (${count})`);option.value=key;$('motion-category').append(option);
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
