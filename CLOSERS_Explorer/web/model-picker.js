// Source choices remain explicit: matching names do not imply matching bytes.
export function setupPicker({state,api,operation,loadModel,element}){
  const $=id=>document.getElementById(id),keys=['character','kind','family','part','variant'];
  const titles=['모든 캐릭터','모든 종류','모든 의상 분류','모든 부위','모든 메시'];
  let bundle=null;
  function filters(){const p=new URLSearchParams({format:'x',saved:$('model-saved').value,q:$('model-search').value,limit:20,page:state.page});for(const key of keys)p.set(key,$('model-'+key).value);return p;}
  function choices(info){const select=element('select');select.setAttribute('aria-label','파일 출처');select.append(new Option(info.candidates.length?'출처 선택':'후보 없음',''));for(const c of info.candidates)select.append(new Option(c.name+' · '+c.archive+' · #'+c.ordinal,c.id));if(info.selected)select.value=info.selected;return select;}
  function picked(rows){const ids=[];for(const row of rows){if(!row.check.checked)continue;if(!row.select.value)throw Error(row.label+': 사용할 출처를 선택하세요.');ids.push(Number(row.select.value));}return [...new Set(ids)];}
  async function equip(rows,motion,append){
    let ids=picked(rows);if(!ids.length)throw Error('추가할 부위를 선택하세요.');
    if(append&&state.data){
      if(state.data.sources.some(s=>s.model_group.kind!=='avatar'||s.model_group.character!==bundle.character))throw Error('현재 모델과 캐릭터가 다릅니다. 묶음 열기를 사용하세요.');
      const parts=new Set(rows.filter(r=>r.check.checked).map(r=>r.part));
      if(parts.has('ONE_PIECE')){parts.add('UPBODY');parts.add('LOWBODY');}
      if(parts.has('UPBODY')||parts.has('LOWBODY'))parts.add('ONE_PIECE');
      ids=[...state.data.sources.filter(s=>!parts.has(s.model_group.part)).map(s=>s.entry_id),...ids];
    }
    ids=[...new Set(ids)];if(ids.length>16)throw Error('모델 부위는 16개까지 선택해 주세요.');
    await loadModel(ids,motion.value?Number(motion.value):(append?state.skeleton:null));
  }
  async function showBundle(key){
    bundle=await api('/api/model-bundle?'+new URLSearchParams({key,saved:$('model-saved').value}));
    const panel=$('avatar-bundle');panel.hidden=false;panel.replaceChildren(element('h3',bundle.label),element('p',bundle.evidence));
    const rows=[];
    function slot(info,label,part,checked){const row=element('div');row.className='bundle-slot';const check=element('input');check.type='checkbox';check.checked=checked;check.setAttribute('aria-label',label+' 포함');const title=element('label',label);title.prepend(check);const select=choices(info);row.append(title,select);panel.append(row);rows.push({check,select,part,label});return row;}
    for(const s of bundle.slots){if(s.part==='FACE'&&s.variant==='BASE')continue;slot(s,s.label,s.part,s.checked);}
    slot(bundle.face,'얼굴 (같은 캐릭터)','FACE',bundle.face.candidates.length>0);
    const motion=choices(bundle.motion);motion.setAttribute('aria-label','공용 뼈 출처');panel.append(element('label','공용 MOTION 뼈'),motion);
    const present=new Set(bundle.slots.filter(s=>s.variant==='BASE').map(s=>s.part));const required=present.has('ONE_PIECE')?['HAIR','ONE_PIECE','FOOT','HAND']:['HAIR','UPBODY','LOWBODY','FOOT','HAND'];
    const missing=required.filter(p=>!present.has(p));panel.append(element('p',missing.length?'목록에 없는 기본 부위: '+missing.join(', '):'기본 의상 부위 후보가 있습니다. 출처와 표시 결과를 확인하세요.'));
    if(bundle.motion.candidates.length>1)panel.append(element('p','공용 뼈 출처가 여러 개입니다. 동작 연결에 사용할 출처를 선택하세요.'));
    const open=element('button','묶음 열기'),add=element('button','현재 모델에 적용');add.className='secondary';open.onclick=()=>operation(()=>equip(rows,motion,false));add.onclick=()=>operation(()=>equip(rows,motion,true));panel.append(open,add);
  }
  async function search(){
    const p=filters(),mode=$('model-mode').value;
    p.set('mode',mode);$('model-results').replaceChildren(element('p','목록 불러오는 중…'));
    const data=await api('/api/model-browser?'+p),metadata=data;
    keys.forEach((key,i)=>{const select=$('model-'+key),value=select.value;select.replaceChildren(new Option(titles[i],''));for(const f of metadata.facets[key])select.append(new Option(f.label+' · '+f.count.toLocaleString(),f.value));if(value&&!Array.from(select.options).some(o=>o.value===value))select.append(new Option(value+' · 0',value));select.value=value;});
    $('model-results').replaceChildren();
    for(const item of data.items){const row=element('div');row.className='model-row';row.append(element('span',mode==='sets'?item.label:item.name));
      if(mode==='sets'){row.append(element('small',item.count+'개 파일 · '+item.parts.join(', ')));const button=element('button','묶음 구성');button.onclick=()=>operation(()=>showBundle(item.key));row.append(button);}
      else{row.append(element('small',[item.character,item.family,item.part,item.variant].filter(Boolean).join(' · ')),element('small',item.archive+' · #'+item.ordinal+' · '+(item.saved_exists?'저장됨':'미저장')));const actions=element('div');actions.className='actions';const open=element('button','열기'),add=element('button','부위 추가');add.className='secondary';open.onclick=()=>operation(()=>loadModel([item.id]));add.onclick=()=>operation(async()=>{if(state.ids.includes(item.id))return;if(state.ids.length>=16)throw Error('모델 부위는 16개까지 선택해 주세요.');await loadModel([...state.ids,item.id],state.skeleton);});actions.append(open,add);if(item.set_key){const group=element('button','의상 묶음');group.className='secondary';group.onclick=()=>operation(()=>showBundle(item.set_key));actions.append(group);}row.append(actions);}
      $('model-results').append(row);
    }
    if(!data.total)$('model-results').append(element('p','조건에 맞는 모델이 없습니다. 저장 상태와 필터를 확인하세요.'));
    $('model-page').textContent=state.page+' / '+Math.max(1,Math.ceil(data.total/20))+' · '+data.total.toLocaleString()+(mode==='sets'?'묶음':'개');$('model-prev').disabled=state.page<=1;$('model-next').disabled=state.page*20>=data.total;
  }
  function reset(){if(state.busy)return;state.page=1;bundle=null;$('avatar-bundle').hidden=true;operation(search);}
  $('model-search-form').onsubmit=e=>{e.preventDefault();reset();};for(const key of [...keys,'saved','mode'])$('model-'+key).onchange=reset;
  $('model-prev').onclick=()=>{if(state.busy)return;state.page--;operation(search);};$('model-next').onclick=()=>{if(state.busy)return;state.page++;operation(search);};
  return {search};
}
