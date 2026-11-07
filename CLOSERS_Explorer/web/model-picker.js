import {pickerMemory} from './model-memory.js';
import {createListingStatus} from './model-list-progress.js';
import {characters,slots,partLabels,replacePart} from './avatar-navigation.js';
// Source choices remain explicit: matching names do not imply matching bytes.
export function setupPicker({state,api,operation,loadModel,applyEye,connectAnimation,element,previews}){
  setupViewerLayout();
  const $=id=>document.getElementById(id),keys=['character','kind','family','part','variant','costume_type','format'];
  const titles=['모든 캐릭터','모든 종류','모든 의상 분류','모든 부위','모든 메시'];
  let bundle=null,request=0,total=0,bundleRequest=0,displayedPage=1,cardSerial=0,searchController;
  const listStatus=createListingStatus({anchor:$('picker-status'),element,onCancel:cancelSearch,onRetry:()=>search()});
  function cancelSearch(){
    request++;searchController?.abort();state.page=displayedPage;updateNavigation();
    $('model-results').setAttribute('aria-busy','false');$('picker-status').textContent='';
    listStatus.failed('목록 불러오기를 취소했습니다.');
  }
  window.addEventListener('pagehide',()=>{request++;searchController?.abort();listStatus.stop();});
  const memory=pickerMemory();
  const settings=memory.data.settings;
  titles.push('\uBAA8\uB4E0 \uC544\uC774\uD15C \uD0C0\uC785');
  titles.push('모든 형식');
  const formatLabel=element('label','자료 형식'),formatSelect=element('select');
  formatSelect.id='model-format';formatSelect.append(new Option('모든 형식',''),new Option('DirectX 모델 · X','x'),new Option('모션 · XMD','xmd'),new Option('FBX 모델','fbx'),new Option('Spine 모델','skel'));
  formatSelect.value='x';formatLabel.append(formatSelect);$('model-saved').closest('label').before(formatLabel);
  const catalogLink=element('a','모델·모션 전체 분류표 저장');catalogLink.download='model-catalog.json';
  catalogLink.href='/api/model-catalog?token='+encodeURIComponent(document.querySelector('meta[name="explorer-token"]').content);
  $('picker-options').querySelector('.source-tools').append(catalogLink);
  $('open-picker-options').onclick=()=>{$('model-advanced').open=true;$('picker-options').showModal();};
  $('close-picker-options').onclick=()=>$('picker-options').close();
  for(const [value,label] of Object.entries(characters))$('model-character').append(new Option(label,value));
  for(const key of [...keys,'saved','mode','limit','sort']){const select=$('model-'+key),value=settings[key];if(typeof value!=='string')continue;if(['mode','limit','saved','sort'].includes(key)&&!Array.from(select.options).some(o=>o.value===value))continue;if(!Array.from(select.options).some(o=>o.value===value))select.append(new Option(value,value));select.value=value;}
  if(typeof settings.q==='string')$('model-search').value=settings.q;
  state.page=Number.isSafeInteger(settings.page)&&settings.page>0?settings.page:1;
  displayedPage=state.page;
  // Every ordinary visit starts with an explicit character choice.
  $('model-character').value='';state.page=1;displayedPage=1;
  if($('model-mode').value==='files')$('model-mode').value='sets';
  const partFilter=$('model-part').parentElement,partFilterPosition=document.createComment('part filter position');
  partFilter.before(partFilterPosition);
  function renderParts(){
    const inline=$('model-mode').value==='parts';
    partFilter.classList.toggle('inline-part-control',inline);
    partFilter.hidden=inline&&!$('model-character').value;
    const tools=document.querySelector('.picker-tools');
    if(inline){if(partFilter.parentElement!==tools)tools.prepend(partFilter);}
    else if(partFilter.previousSibling!==partFilterPosition)partFilterPosition.after(partFilter);
  }
  $('basic-avatar').onclick=()=>operation(()=>showBundle($('model-character').value+'|BASIC'));
  $('source-browser').onclick=()=>{$('picker-options').close();for(const key of keys)$('model-'+key).value='';$('model-mode').value='files';$('model-saved').value='';reset();};
  $('model-advanced').open=settings.advanced===true;
  function save(){if(!memory.save())$('model-memory-status').textContent='브라우저 저장 공간을 사용할 수 없어 이번 탭에서만 기억합니다.';}
  function rememberSettings(){memory.data.settings=Object.fromEntries([...keys,'saved','mode','limit','sort'].map(k=>[k,$('model-'+k).value]));Object.assign(memory.data.settings,{q:$('model-search').value,page:state.page,advanced:$('model-advanced').open});save();}
  function record(item,mode){return {identity:item.appearance_key?'item:'+item.appearance_key:mode==='eyes'?'eye:'+item.key:mode==='sets'?'set:'+item.key:'file:'+item.name,label:item.label||item.display_name||item.name,q:item.appearance_key?item.display_name:mode==='eyes'?item.label:mode==='sets'?item.key.split('|').slice(1).join('|'):item.name,character:item.character||'',mode};}
  function find(record){$('picker-options').close();record={...record,character:record.character||$('model-character').value};for(const key of keys)$('model-'+key).value='';if(record.character){const select=$('model-character');select.append(new Option(record.character,record.character));select.value=record.character;}$('model-mode').value=record.mode;$('model-search').value=record.q;$('model-saved').value='';reset();}
  function renderMemory(){for(const key of ['favorites','recent']){const list=$('model-'+key);list.replaceChildren();if(!memory.data[key].length)list.append(element('p',key==='favorites'?'즐겨찾기한 항목이 없습니다.':'최근 사용한 항목이 없습니다.'));for(const record of memory.data[key]){const row=element('div'),open=element('button',record.label);row.className='memory-row';open.className='secondary';open.title='현재 목록에서 다시 찾기';open.onclick=()=>find(record);const remove=element('button','삭제');remove.className='secondary';remove.setAttribute('aria-label',record.label+' 기록 삭제');remove.onclick=()=>{memory.data[key]=memory.data[key].filter(r=>r.identity!==record.identity);save();renderMemory();updateStars();};row.append(open,remove);list.append(row);}}}
  function updateStars(){for(const button of document.querySelectorAll('[data-favorite]')){const active=memory.data.favorites.some(r=>r.identity===button.dataset.favorite);button.textContent=active?'★':'☆';button.setAttribute('aria-pressed',String(active));const label=(active?'즐겨찾기 해제: ':'즐겨찾기 추가: ')+button.dataset.favoriteLabel;button.setAttribute('aria-label',label);button.title=label;}}
  function recent(item,mode){const r=record(item,mode);memory.data.recent=[r,...memory.data.recent.filter(v=>v.identity!==r.identity)].slice(0,20);save();renderMemory();}
  function favorite(row,item,mode){const r=record(item,mode),button=element('button');button.type='button';button.className='secondary favorite-button';button.dataset.favorite=r.identity;button.dataset.favoriteLabel=r.label;button.onclick=()=>{const exists=memory.data.favorites.some(v=>v.identity===r.identity);memory.data.favorites=exists?memory.data.favorites.filter(v=>v.identity!==r.identity):[r,...memory.data.favorites].slice(0,30);save();renderMemory();updateStars();};row.append(button);}
  function markSelection(){for(const row of $('model-results').children){const selected=row.dataset.appearance?(state.data?.sources||[]).some(s=>s.entry_id===Number(row.dataset.entry)&&JSON.parse(row.dataset.appearances||JSON.stringify([row.dataset.appearance])).includes(s.appearance_key)):row.dataset.eye?state.data?.eye_avatar?.key===row.dataset.eye:row.dataset.entry?state.ids.includes(Number(row.dataset.entry)):(state.data?.sources||[]).some(s=>s.model_group?.set_key===row.dataset.set);row.classList.toggle('is-selected',selected);row.querySelector('.selection-badge')?.remove();if(selected){const badge=element('span','현재 적용 중');badge.className='selection-badge';row.append(badge);}}}
  function filters(){const p=new URLSearchParams({items:'1',sort:$('model-sort').value,saved:$('model-saved').value,q:$('model-search').value,limit:$('model-limit').value,page:state.page});for(const key of keys)p.set(key,$('model-'+key).value);if($('model-mode').value!=='files')p.set('format','x');return p;}
  function bundleName(label,key){const code=key.split('|').slice(1).join('|'),suffix=' · '+code;return (label.endsWith(suffix)?label.slice(0,-suffix.length):label).replace(/\s*\[[^\]]*타입\]/g,'').trim();}
  function typeBadges(target,types){for(const type of [...new Set(types)]){const badge=element('span',type+'타입');badge.className='model-type-badge';target.append(badge);}}
  function sharedHairLabel(info){return info?info.source_type+'타입 공용 헤어':'';}
  function cardDetails(row,actions,details){
    const toggle=element('button','상세');toggle.type='button';toggle.className='secondary card-details-toggle set-details-toggle';toggle.dataset.action='details';
    details.id='model-details-'+(++cardSerial);details.querySelector('summary').hidden=true;toggle.setAttribute('aria-controls',details.id);toggle.setAttribute('aria-expanded',String(details.open));
    toggle.onclick=()=>{details.open=!details.open;toggle.setAttribute('aria-expanded',String(details.open));};details.ontoggle=()=>toggle.setAttribute('aria-expanded',String(details.open));
    actions.append(toggle);row.append(details);return toggle;
  }
  function cardContext(row,labels){const context=element('div');context.className='model-card-context';for(const text of labels.filter(Boolean)){const tag=element('span',text);context.append(tag);}row.append(context);return context;}
  function choices(info,{compact=false,label='모델'}={}){
    const select=element('select');select.setAttribute('aria-label',compact?label+' 선택':'파일 출처');select.append(new Option(info.candidates.length?(compact?'선택하세요':'출처 선택'):'후보 없음',''));
    const names=info.candidates.map(c=>{const name=c.display_name&&c.display_name!==c.name?c.display_name:label;return compact?name.replace(/\s*\[[^\]]*타입\]/g,'').trim():name;});
    info.candidates.forEach((c,i)=>{let text=names[i];if(names.filter(n=>n===text).length>1)text+=' · 출처 '+(i+1);const option=new Option(compact?text:(c.display_name||c.name)+' · '+c.name+' · '+c.archive+' · #'+c.ordinal,c.appearance_key?c.id+'|'+c.appearance_key:c.id);option.title=c.name+'\n'+c.archive+' · #'+c.ordinal;select.append(option);});
    select.avatarCandidates=info.candidates;if(info.selected){const c=info.candidates.find(c=>c.id===Number(info.selected));select.value=c?.appearance_key?c.id+'|'+c.appearance_key:info.selected;}return select;
  }
  function componentInputs(item,parent){
    const inputs=[];
    for(const component of item.components||[]){
      if(component.name.toUpperCase()===item.name.toUpperCase())continue;
      const label=element('label','함께 표시할 구성 모델 · '+component.name),select=choices(component);
      select.setAttribute('aria-label','구성 모델 출처 · '+component.name);label.append(select);parent.append(label);
      inputs.push({select,label:component.name,appearance_key:component.appearance_key});
    }
    return inputs;
  }
  function itemSelection(item,components){
    const ids=[item.id],appearances=item.appearance_key?{[item.id]:item.appearance_key}:{};
    for(const component of components){if(!component.select.value)throw Error(component.label+': 사용할 구성 모델 출처를 선택하세요.');const id=Number(component.select.value.split('|')[0]);ids.push(id);appearances[id]=component.appearance_key;}
    return {ids:[...new Set(ids)],appearances};
  }
  function picked(rows){const ids=[];for(const row of rows){if(!row.check.checked)continue;if(!row.select.value)throw Error(row.label+': 사용할 출처를 선택하세요.');ids.push(Number(row.select.value.split('|')[0]));for(const c of row.components||[]){if(!c.select.value)throw Error(c.label+': 사용할 구성 모델 출처를 선택하세요.');ids.push(Number(c.select.value.split('|')[0]));}}return [...new Set(ids)];}
  function eyeRow(item){
    const row=element('div');row.className='model-row model-card model-eye-row';row.dataset.eye=item.key;
    const title=element('button',item.label);title.type='button';title.className='model-open';row.append(title);
    const toolbar=element('div');toolbar.className='model-row-toolbar';const actions=element('div');actions.className='actions';toolbar.append(actions);
    const apply=element('button',item.basic?'기본으로 적용':'눈동자 적용');apply.dataset.action='apply-eye';actions.append(apply);
    const details=element('details');details.className='model-row-details';details.append(element('summary','상세'),element('small',(item.basic?'기본 눈동자':characterLabel(item.character)+' · 눈동자 아이템 '+(item.item_ids||[item.item_id]).join(', '))),element('small',item.texture_name||item.face_name));
    const face=choices({candidates:item.face_candidates,selected:item.face_id});face.setAttribute('aria-label','눈동자 얼굴 출처');
    const texture=choices({candidates:item.texture_candidates,selected:item.texture_id});texture.setAttribute('aria-label','눈동자 텍스처 출처');
    const base=choices({candidates:item.base_face_candidates||[],selected:item.base_face_id});base.setAttribute('aria-label','함께 표시할 기본 얼굴 출처');
    if(item.face_candidates.length!==1)details.append(element('small','얼굴 출처 선택'),face);
    if(!item.basic&&item.texture_candidates.length!==1)details.append(element('small','눈동자 텍스처 출처 선택'),texture);
    if(item.geometry&&item.base_face_candidates.length!==1)details.append(element('small','기본 얼굴 출처 선택'),base);
    if(!item.available){details.append(element('small','연결된 얼굴 또는 눈동자 이미지가 없습니다. 원본 폴더를 다시 분석하세요.'));row.classList.add('is-unavailable');}
    if(item.available&&(!item.face_id||!item.basic&&!item.texture_id)){details.open=true;details.append(element('small','적용할 출처를 선택하세요.'));}
    const missingSource=()=>!face.value?face:!item.basic&&!texture.value?texture:item.geometry&&!base.value?base:null;
    title.onclick=apply.onclick=()=>{const missing=missingSource();if(missing){details.open=true;missing.focus();return;}return operation(async()=>{await applyEye(item,Number(face.value),item.basic?null:Number(texture.value),base.value?Number(base.value):null);recent(item,'eyes');});};
    title.disabled=apply.disabled=state.busy||!item.available;title.dataset.unavailable=apply.dataset.unavailable=String(!item.available);
    const needsSource=item.available&&(!item.face_id||!item.basic&&!item.texture_id||item.geometry&&!item.base_face_id);
    if(needsSource)details.open=true;
    const context=cardContext(row,[characterLabel(item.character),item.basic?'기본 눈동자':'눈동자']),sourceState=element('span');sourceState.className='card-state';context.append(sourceState);
    const updateSource=()=>{const pending=item.available&&!!missingSource();row.classList.toggle('needs-source',pending);sourceState.textContent=!item.available?'자료 없음':pending?'출처 선택 필요':'';sourceState.hidden=!sourceState.textContent;apply.textContent=pending?'출처 선택':item.basic?'기본으로 적용':'눈동자 적용';};
    for(const select of [face,texture,base])select.addEventListener('change',updateSource);updateSource();
    const date=element('small',ResourceDates.label(item.updated_at));date.className='muted model-source-date';row.append(toolbar,date);cardDetails(row,actions,details);favorite(row,item,'eyes');$('model-results').append(row);previews?.attach(row,item,'eyes',$('model-saved').value);
  }
  function characterLabel(character){return [...$('model-character').options].find(o=>o.value===character)?.textContent.replace(/ · [\d,]+$/,'')||character;}
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
    const appearances=append?Object.fromEntries((state.data?.sources||[]).filter(s=>ids.includes(s.entry_id)&&s.appearance_key).map(s=>[s.entry_id,s.appearance_key])):{};for(const r of rows){if(!r.check.checked)continue;const [id,...key]=r.select.value.split('|');if(key.length)appearances[id]=key.join('|');for(const c of r.components||[])appearances[Number(c.select.value.split('|')[0])]=c.appearance_key;}await loadModel(ids,motion.value?Number(motion.value):(append?state.skeleton:null),undefined,appearances);
  }
  async function showBundle(key,types=[]){
    const serial=++bundleRequest;
    const result=await api('/api/model-bundle?'+new URLSearchParams({key,saved:$('model-saved').value,items:'1'}));
    if(serial!==bundleRequest)return;
    bundle=result;
    const name=bundleName(bundle.label,key);
    recent({key,label:name,character:bundle.character},'sets');
    const panel=$('avatar-bundle');panel.hidden=false;const heading=element('div');heading.className='bundle-heading';const close=element('button','닫기');close.className='secondary';close.onclick=()=>{panel.hidden=true;document.dispatchEvent(new Event('model-reveal-wardrobe'));};const headingTitle=element('h3',name);typeBadges(headingTitle,types);heading.append(headingTitle,close);panel.replaceChildren(heading);
    const metadata=element('details');metadata.className='bundle-metadata';metadata.append(element('summary','묶음 상세'));
    if(types.length)metadata.append(element('p','타입 · '+types.map(t=>t+'타입').join(', ')));
    metadata.append(element('p','세트 코드 · '+key.split('|').slice(1).join('|')),element('p',bundle.evidence));panel.append(metadata);
    const rows=[],slotsPanel=element('div');panel.append(slotsPanel);
    function slot(info,label,part,checked){
      const row=element('div');row.className='bundle-slot';const check=element('input');check.type='checkbox';check.checked=checked;check.setAttribute('aria-label',label+' 포함');const title=element('label',label.replace(/ · 기본 메시$/,''));title.prepend(check);const select=choices(info,{compact:true,label:part==='FACE'?'기본 얼굴':'아이템'}),details=element('details'),content=element('div');details.className='bundle-source-details';content.className='bundle-components';details.append(element('summary','상세'),content);row.append(title,select,details);slotsPanel.append(row);
      select.setAttribute('aria-label',label+' 선택');
      if(info.shared_hair){const badge=element('span',sharedHairLabel(info.shared_hair));badge.className='model-type-badge';title.append(badge);row.dataset.sharedSet=info.shared_hair.source_set_key;}
      const entry={check,select,part,label,variant:info.variant||'BASE',components:[]};rows.push(entry);
      select.onchange=()=>{
        content.replaceChildren();const candidate=info.candidates.find(c=>(c.appearance_key?c.id+'|'+c.appearance_key:String(c.id))===select.value);
        entry.components=[];
        if(candidate){
          if(candidate.shared_hair)content.append(element('p',candidate.shared_hair.source_type+'타입과 공유하는 헤어입니다.'));
          const fields=element('dl');for(const [key,value] of [['이름',candidate.display_name],['모델',candidate.name],['출처',candidate.archive+' · #'+candidate.ordinal],['아이템',(candidate.item_ids||[candidate.item_id]).filter(Boolean).join(', ')]]){if(value)fields.append(element('dt',key),element('dd',value));}content.append(fields);
          entry.components=componentInputs(candidate,content);
          if(entry.components.some(c=>!c.select.value))details.open=true;
        }else content.append(element('p','아이템을 선택하면 구성 정보를 확인할 수 있습니다.'));
      };select.onchange();return row;
    }
    for(const s of bundle.slots){if(s.part==='FACE'&&s.variant==='BASE')continue;slot(s,s.label,s.part,s.checked);}
    slot(bundle.face,'얼굴 (같은 캐릭터)','FACE',bundle.face.candidates.length>0);
    const motion=choices(bundle.motion,{compact:true,label:'캐릭터 동작'});motion.setAttribute('aria-label','공용 뼈 출처');metadata.append(element('label','동작 연결'),motion);if(bundle.motion.candidates.length>1)metadata.open=true;
    const present=new Set(bundle.slots.filter(s=>s.variant==='BASE').map(s=>s.part));const required=present.has('ONE_PIECE')?['HAIR','ONE_PIECE','FOOT','HAND']:['HAIR','UPBODY','LOWBODY','FOOT','HAND'];
    const missing=required.filter(p=>!present.has(p));if(missing.length)panel.append(element('p','빈 부위 · '+missing.map(p=>slots[p]||p).join(', ')));
    if(bundle.motion.candidates.length>1)metadata.append(element('p','동작에 사용할 출처를 선택하세요.'));
    const fill=element('button','빈 부위 채우기'),fillStatus=element('p');fill.className='secondary';fill.dataset.action='fill-defaults';fillStatus.setAttribute('role','status');
    fill.onclick=()=>{
      const defaults=bundle.defaults||[],selected=new Set(rows.filter(r=>r.check.checked&&r.variant==='BASE').map(r=>r.part));
      const needed=['HAIR','FACE','FOOT','HAND'].filter(p=>!selected.has(p));
      if(!selected.has('ONE_PIECE')){
        const body=['UPBODY','LOWBODY'].filter(p=>!selected.has(p));
        const has=p=>defaults.some(s=>s.part===p&&s.variant==='BASE');
        if(body.length===2&&has('ONE_PIECE')&&!(has('UPBODY')&&has('LOWBODY')))needed.push('ONE_PIECE');else needed.push(...body);
      }
      let added=0;const unavailable=[],ambiguous=[];
      for(const part of needed){
        const candidates=defaults.filter(s=>s.part===part);
        if(!candidates.some(s=>s.variant==='BASE')){unavailable.push(part);continue;}
        for(const info of candidates){
          // Reuse a previously inserted default row when the user unchecked it.
          const existing=rows.find(r=>r.defaultSlot&&r.part===part&&r.variant===info.variant);
          if(existing)existing.check.checked=true;
          else{slot(info,info.label,part,true);rows.at(-1).defaultSlot=true;}
          if(!info.selected)ambiguous.push(info.label);
        }
        added++;
      }
      fillStatus.textContent=(added?'기본 아바타 '+added+'개 부위를 구성에 추가했습니다. 묶음 열기 또는 현재 모델에 적용을 눌러 반영하세요.':'추가할 기본 부위가 없습니다.')+(unavailable.length?' 기본 파일을 찾지 못한 부위: '+unavailable.join(', ')+'.':'')+(ambiguous.length?' 출처를 선택하세요: '+ambiguous.join(', ')+'.':'');
    };
    panel.append(fill,fillStatus);
    const errors=new Map();let errorSerial=0;
    function clearError(control){
      const error=errors.get(control);if(!error)return;
      error.note.remove();control.classList.remove('needs-selection');control.removeAttribute('aria-invalid');
      if(error.description===null)control.removeAttribute('aria-describedby');else control.setAttribute('aria-describedby',error.description);
      errors.delete(control);
    }
    function markRequired(control,message){
      const note=element('p',message),description=control.getAttribute('aria-describedby');
      note.id='bundle-selection-error-'+(++errorSerial);note.className='bundle-selection-error';
      control.classList.add('needs-selection');control.setAttribute('aria-invalid','true');
      control.setAttribute('aria-describedby',[description,note.id].filter(Boolean).join(' '));
      (control.type==='checkbox'?control.closest('label'):control).after(note);
      errors.set(control,{note,description});
    }
    slotsPanel.addEventListener('change',()=>{
      for(const [control] of errors){
        const row=rows.find(r=>r.select===control||r.components.some(c=>c.select===control));
        if(!panel.contains(control)||(control.type==='checkbox'?rows.some(r=>r.check.checked):control.value||row&&!row.check.checked))clearError(control);
      }
    });
    function validateSelection(){
      for(const [control] of errors)clearError(control);
      const selected=rows.filter(r=>r.check.checked);
      if(!selected.length)markRequired(rows[0].check,'열 부위를 하나 이상 선택해 주세요.');
      for(const row of selected){
        for(const item of [row,...row.components]){
          if(item.select.value)continue;
          const available=item.select.options.length>1;
          markRequired(item.select,available?item.label+': 사용할 모델을 선택해 주세요.':item.label+': 선택할 모델이 없습니다. 이 부위를 제외하거나 원본을 확인해 주세요.');
        }
      }
      if(!errors.size)return true;
      document.dispatchEvent(new Event('model-reveal-equipment'));
      const first=errors.keys().next().value;
      for(let parent=first.parentElement;parent&&parent!==panel;parent=parent.parentElement){if(parent.tagName==='DETAILS')parent.open=true;}
      first.focus({preventScroll:true});
      first.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
      return false;
    }
    const open=element('button','묶음 열기'),add=element('button','현재 모델에 적용');open.title='현재 모델을 이 의상으로 교체';add.title='같은 캐릭터의 선택한 부위만 교체';add.className='secondary';open.onclick=()=>{if(validateSelection())return operation(()=>equip(rows,motion,false));};add.onclick=()=>{if(validateSelection())return operation(()=>equip(rows,motion,true));};panel.append(open,add);document.dispatchEvent(new Event('model-reveal-equipment'));panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  async function search(){
    const serial=++request;
    searchController?.abort();searchController=new AbortController();previews?.reset();
    const p=filters(),mode=$('model-mode').value;
    const chosen=$('model-character').value;
    const browsing=!!chosen||mode==='files';
    $('wardrobe-panel').classList.toggle('awaiting-character',!browsing);
    $('open-picker-options').textContent=browsing?'필터 · 기록':'기록';
    $('picker-options-title').textContent=browsing?'상세 필터 · 기록':'기록';
    $('picker-date-note').hidden=!browsing;
    for(const selector of ['#model-search-form','#wardrobe-tabs','#model-sort','#model-advanced','.filter-summary','.picker-pagination'])document.querySelector(selector).hidden=!browsing;
    $('model-costume_type').parentElement.hidden=['eyes','files'].includes(mode);$('model-kind').hidden=mode!=='files';$('model-variant').parentElement.hidden=mode!=='files';
    formatLabel.hidden=mode!=='files';
    $('basic-avatar').disabled=!chosen;
    renderParts();
    if(!chosen&&mode!=='files'){
      listStatus.finish();
      previews?.reset();$('model-results').replaceChildren(element('p','먼저 캐릭터를 선택하세요. 선택한 캐릭터의 아바타만 불러옵니다.'));$('picker-status').textContent='';$('model-page').textContent='';$('model-results').setAttribute('aria-busy','false');
      for(const id of ['model-first','model-prev','model-next','model-last'])$(id).disabled=true;
      return;
    }
    if(mode==='parts')p.set('variant','BASE');
    p.set('mode',mode);p.set('progress','1');$('picker-status').textContent='목록 불러오는 중…';$('picker-status').hidden=true;$('model-results').setAttribute('aria-busy','true');listStatus.start();
    let data;
    try{data=await api((mode==='eyes'?'/api/model-eyes?':'/api/model-browser?')+p,searchController.signal,value=>{if(serial===request)listStatus.update(value);});}catch(e){if(serial===request){state.page=displayedPage;updateNavigation();$('picker-status').textContent='목록을 불러오지 못했습니다: '+e.message;$('model-results').setAttribute('aria-busy','false');listStatus.failed($('picker-status').textContent);}return;}
    if(serial!==request)return;
    total=data.total;
    const pages=Math.max(1,Math.ceil(total/Number(p.get('limit'))));
    if(state.page>pages){state.page=pages;return search();}
    listStatus.update({label:'목록을 화면에 표시하는 중',done:0,total:data.items.length});
    const metadata=data;
    keys.forEach((key,i)=>{if(key==='character')return;const select=$('model-'+key),value=select.value;select.replaceChildren(new Option(titles[i],''));for(const f of metadata.facets[key]||[])select.append(new Option(f.label+' · '+f.count.toLocaleString(),f.value));if(value&&!Array.from(select.options).some(o=>o.value===value))select.append(new Option(value+' · 0',value));select.value=value;});renderParts();
    document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
    $('model-filter-summary').textContent=[...keys.map(k=>$('model-'+k))].filter(s=>s.value).map(s=>s.selectedOptions[0].textContent.replace(/ · [\d,]+$/,'')).concat($('model-search').value?['검색: '+$('model-search').value]:[]).join(' · ')||'전체 캐릭터';
    previews?.reset();$('model-results').replaceChildren();
    for(const item of data.items){if(mode==='eyes'){eyeRow(item);continue;}const row=element('div');row.className=mode==='files'?'model-row':'model-row model-card';if(mode==='sets'){row.dataset.set=item.key;row.classList.add('model-set-row');}else row.dataset.entry=item.id;if(item.appearance_key){row.dataset.appearance=item.appearance_key;row.dataset.appearances=JSON.stringify(item.appearance_keys||[item.appearance_key]);}
      let componentRows=[];const name=mode==='sets'?item.label:(item.display_name||item.name),title=element('button');title.type='button';title.className='model-open';title.append(element('span',mode==='sets'?bundleName(name,item.key):mode==='files'?name:name.replace(/\s*\[[^\]]*\uD0C0\uC785\]/g,'').trim()));if(mode!=='files')typeBadges(title,mode==='sets'?(item.costume_types?.length?item.costume_types:[...name.matchAll(/\[([^\]]*?)\s*\uD0C0\uC785\]/g)].map(m=>m[1].trim())):(item.costume_type?[item.costume_type]:[]));title.title=(mode==='sets'?'묶음 구성: ':'모델 열기: ')+name;title.onclick=()=>operation(()=>mode==='sets'?showBundle(item.key,item.costume_types||[]):loadModel(itemSelection(item,componentRows).ids,null,undefined,itemSelection(item,componentRows).appearances));row.append(title);const date=element('small',ResourceDates.label(item.updated_at));date.className='muted model-source-date';row.append(date);if(mode!=='sets'&&mode!=='files')cardContext(row,[partLabels[item.part]||'\uC544\uBC14\uD0C0',mode==='accessories'?(item.shared?'\uACF5\uC6A9':characterLabel(chosen)):null,item.components?.length>1?'\uAD6C\uC131 \uBAA8\uB378 '+item.components.length+'\uAC1C':null]);
      const toolbar=element('div');toolbar.className='model-row-toolbar';const actions=element('div');actions.className='actions';toolbar.append(actions);const details=element('details');details.className='model-row-details';details.append(element('summary','상세'));toolbar.append(details);row.append(toolbar);if(mode!=='sets')componentRows=componentInputs(item,details);
      if(item.item_id)details.append(element('small','아이템 '+(item.item_ids||[item.item_id]).join(', ')+' · '+item.type_label));if(item.shared)details.append(element('small','\uACF5\uC6A9 \uC561\uC138\uC11C\uB9AC \uBAA8\uB378'));if(item.game_names?.length)details.append(element('small',item.game_names.join('\n')));
      if(mode==='sets'){
        if(item.costume_types?.length)details.append(element('small','타입 · '+item.costume_types.map(t=>t+'타입').join(', ')));
        details.append(element('small','세트 코드 · '+item.key.split('|').slice(1).join('|')),element('small',(item.part_labels||item.parts).join(', ')));
        const configure=element('button','\uBB36\uC74C \uAD6C\uC131');configure.onclick=title.onclick;actions.append(configure);cardDetails(row,actions,details);
      }
      else{details.append(element('small',item.name),element('small',[item.character,item.family,item.part,item.variant].filter(Boolean).join(' · ')),element('small',item.archive+' · #'+item.ordinal+' · '+(item.saved_exists?'저장됨':'미저장')));const open=element('button','모델 열기'),add=element('button','부위 추가');open.title='현재 모델 교체';add.className='secondary';open.onclick=title.onclick;add.onclick=()=>operation(async()=>{const owner={...item,character:chosen},selection=itemSelection(item,componentRows);let additions=selection.ids.filter(id=>id!==item.id);if(item.item_code&&!item.appearance_key){const related=await api('/api/model-list?'+new URLSearchParams({items:'1',character:chosen,part:item.part,q:item.item_code,format:'x',limit:60}));const alpha=related.items.filter(r=>r.item_code===item.item_code&&r.set_name===item.set_name&&r.variant==='ALPHA'&&(!item.item_id||r.item_id===item.item_id));if(alpha.length===1){additions=[alpha[0].id];if(alpha[0].appearance_key)owner.alphaAppearance={[alpha[0].id]:alpha[0].appearance_key};}else if(alpha.length>1)throw Error('\uBCF4\uC870 \uBA54\uC2DC\uC758 \uCD9C\uCC98\uB97C \uC758\uC0C1 \uBB36\uC74C\uC5D0\uC11C \uC120\uD0DD\uD558\uC138\uC694.');}const ids=replacePart(state.data?.sources||[],owner,additions);if(ids.length>16)throw Error('\uBAA8\uB378 \uBD80\uC704\uB294 16\uAC1C\uAE4C\uC9C0 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.');await loadModel(ids,state.skeleton,undefined,{...Object.fromEntries((state.data?.sources||[]).filter(s=>ids.includes(s.entry_id)&&s.appearance_key).map(s=>[s.entry_id,s.appearance_key])),...selection.appearances,...owner.alphaAppearance});});if(mode==='files')actions.append(open,add);else{add.textContent='\uCC29\uC6A9';add.title='\uD604\uC7AC \uC544\uBC14\uD0C0\uC758 \uC774 \uBD80\uC704\uB9CC \uAD50\uCCB4';add.dataset.action='equip';open.textContent='\uB2E8\uB3C5 \uBCF4\uAE30';open.dataset.action='preview';open.className='secondary';add.className='';actions.append(add,open);cardDetails(row,actions,details);if(componentRows.some(c=>!c.select.value)){details.open=true;row.classList.add('needs-source');}}if(item.set_key){const group=element('button','의상 묶음');group.className='secondary';group.onclick=()=>operation(()=>showBundle(item.set_key,item.costume_type?[item.costume_type]:[]));if(mode==='files')actions.append(group);else details.append(group);}}
      if(item.shared_hair){row.dataset.sharedSet=item.shared_hair.source_set_key;const context=row.querySelector('.model-card-context')||cardContext(row,[]),note=element('span',sharedHairLabel(item.shared_hair));note.className='card-state';context.append(note);}
      favorite(row,item,mode);row.querySelectorAll('button:not(.favorite-button)').forEach(b=>b.disabled=state.busy);
      if(mode==='files'){
        const format=item.format||'x';
        details.append(element('small',item.kind_label||item.kind),element('small','형식 · '+format.toUpperCase()));
        if(format!=='x'){
          title.onclick=null;
          actions.replaceChildren();
          if(format==='xmd'&&connectAnimation){
            const connect=element('button','현재 모델에 동작 연결');
            connect.disabled=!state.model||state.busy;
            connect.title=state.model?'현재 모델의 뼈와 검증 후 연결합니다.':'먼저 X 모델을 여세요.';
            connect.onclick=()=>operation(()=>connectAnimation(item.id));actions.append(connect);
          }else details.append(element('small','이 형식은 원본 저장으로 확인할 수 있습니다.'));
          if(item.saved_exists){const save=element('a','원본 저장');save.href='/api/download/'+item.id+'?token='+encodeURIComponent(document.querySelector('meta[name="explorer-token"]').content);actions.append(save);}
        }
      }
      $('model-results').append(row);if(!item.format||item.format==='x'||mode==='eyes')previews?.attach(row,item,mode,$('model-saved').value);
    }
    if(!data.total)$('model-results').append(element('p','조건에 맞는 모델이 없습니다. 저장 상태와 필터를 확인하세요.'));
    displayedPage=state.page;markSelection();updateStars();rememberSettings();$('model-results').scrollTop=0;$('model-results').setAttribute('aria-busy','false');$('picker-status').textContent='';listStatus.finish();
    $('model-page').textContent=state.page+' / '+pages+' · '+total.toLocaleString()+(mode==='sets'?'묶음':'개');
    $('model-jump').value=state.page;$('model-jump').max=pages;
    $('model-first').disabled=$('model-prev').disabled=state.page<=1;$('model-last').disabled=$('model-next').disabled=state.page>=pages;
    $('model-pages').replaceChildren();for(let n=Math.max(1,state.page-2);n<=Math.min(pages,state.page+2);n++){const button=element('button',n);button.type='button';button.setAttribute('aria-label',n+'페이지');if(n===state.page)button.setAttribute('aria-current','page');button.onclick=()=>go(n);$('model-pages').append(button);}
  }
  function updateNavigation(){const pages=Math.max(1,Math.ceil(total/Number($('model-limit').value)));$('model-first').disabled=$('model-prev').disabled=state.page<=1;$('model-last').disabled=$('model-next').disabled=state.page>=pages;}
  function go(page){state.page=Math.min(Math.max(1,Math.floor(Number(page))||1),Math.max(1,Math.ceil(total/Number($('model-limit').value))));updateNavigation();return search();}
  function reset(){state.page=1;bundle=null;bundleRequest++;$('avatar-bundle').hidden=true;return search();}
  $('model-search-form').onsubmit=e=>{e.preventDefault();reset();};for(const key of [...keys,'saved','mode','sort'])$('model-'+key).onchange=reset;
  $('model-limit').onchange=reset;$('model-first').onclick=()=>go(1);$('model-last').onclick=()=>go(Infinity);
  $('model-prev').onclick=()=>go(state.page-1);$('model-next').onclick=()=>go(state.page+1);
  $('model-jump-form').onsubmit=e=>{e.preventDefault();go($('model-jump').value);};
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{for(const key of ['kind','family','part','variant','costume_type'])$('model-'+key).value='';$('model-search').value='';$('model-mode').value=b.dataset.mode;if(b.dataset.mode==='eyes')$('model-saved').value='';reset();});
  $('model-filter-clear').onclick=()=>{for(const key of keys.filter(k=>k!=='character'))$('model-'+key).value='';$('model-search').value='';$('model-saved').value='existing';reset();};
  $('model-advanced').ontoggle=rememberSettings;
  document.addEventListener('model-selection',()=>{for(const source of state.data?.sources||[])recent({...source,...source.model_group},'files');});
  document.addEventListener('model-selection',markSelection);
  renderMemory();
  return {search};
}

// Use an established asset route so running Explorer servers can load new controls.
export function setupViewerLayout(){
  // Layout controls stay independent of WebGL and preserve the current scene.
  const $=id=>document.getElementById(id);
  const layout=document.querySelector('.model-layout');
  const compact=matchMedia('(max-width:1500px)');
  function updateCollapsedRow(){
    const equipment=layout.classList.contains('show-equipment');
    layout.classList.toggle('active-panel-collapsed',layout.classList.contains(equipment?'info-collapsed':'wardrobe-collapsed'));
  }
  function setPanelVisible(id,buttonId,className,label,visible){
    layout.classList.toggle(className,!visible);
    $(id).classList.toggle('is-collapsed',!visible);
    const button=$(buttonId);
    button.setAttribute('aria-expanded',String(visible));
    button.setAttribute('aria-label',label+(visible?' 접기':' 펼치기'));
    button.title=label+(visible?' 접기':' 펼치기');
    button.textContent=visible?'접기':'펼치기';
    updateCollapsedRow();
  }
  function setEquipmentVisible(visible){
    setPanelVisible('equipment-panel','toggle-model-info','info-collapsed','장착 부위',visible);
  }
  function setWardrobeVisible(visible){
    setPanelVisible('wardrobe-panel','toggle-wardrobe','wardrobe-collapsed','아바타 꾸미기',visible);
  }
  setEquipmentVisible(!compact.matches||innerWidth<=900);
  setWardrobeVisible(true);
  $('toggle-model-info').onclick=()=>setEquipmentVisible(layout.classList.contains('info-collapsed'));
  $('toggle-wardrobe').onclick=()=>setWardrobeVisible(layout.classList.contains('wardrobe-collapsed'));

  // Keep the small-screen picker short enough to show results below the search.
  const narrow=matchMedia('(max-width:900px)');
  const filters=document.createElement('div');
  filters.className='mobile-picker-filters';
  $('model-advanced').before(filters);
  const relocated=[document.querySelector('.filter-summary')].map(node=>{
    const position=document.createComment((node.id||node.className)+' position');
    node.before(position);
    return {node,position};
  });
  function placeFilters(){
    for(const {node,position} of relocated){
      if(narrow.matches)filters.append(node);
      else position.after(node);
    }
  }
  placeFilters();
  narrow.addEventListener('change',placeFilters);

  function selectPanel(equipment){
    layout.classList.toggle('show-equipment',equipment);
    $('show-wardrobe').setAttribute('aria-pressed',String(!equipment));
    $('show-equipment').setAttribute('aria-pressed',String(equipment));
    updateCollapsedRow();
  }
  $('show-wardrobe').onclick=()=>selectPanel(false);
  $('show-equipment').onclick=()=>selectPanel(true);
  document.addEventListener('model-reveal-equipment',()=>{setEquipmentVisible(true);selectPanel(true);});
  document.addEventListener('model-reveal-wardrobe',()=>{setWardrobeVisible(true);selectPanel(false);});
  $('open-view-settings').onclick=()=>$('view-settings').showModal();
  $('close-view-settings').onclick=()=>$('view-settings').close();
  $('open-stage-settings').onclick=()=>$('stage-settings').showModal();
  $('close-stage-settings').onclick=()=>$('stage-settings').close();
  $('stage-settings').addEventListener('close',()=>$('open-stage-settings').focus());

  const panel=document.querySelector('.viewport-panel'),dialog=$('viewer-dialog');
  const anchor=document.createComment('viewer position');
  panel.before(anchor);
  function updateExpandButton(expanded){
    const button=$('expand-viewer'),label=expanded?'원래 크기':'크게 보기';
    button.setAttribute('aria-expanded',String(expanded));
    button.setAttribute('aria-label',label);button.title=label;
  }
  $('expand-viewer').onclick=()=>{
    if(dialog.open){dialog.close();return;}
    dialog.append(panel);
    updateExpandButton(true);
    dialog.showModal();
    $('expand-viewer').focus();
  };
  dialog.addEventListener('close',()=>{
    anchor.after(panel);
    updateExpandButton(false);
    $('expand-viewer').focus();
  });
}
