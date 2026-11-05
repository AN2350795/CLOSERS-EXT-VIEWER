// Presentation only: move the existing controls so their bindings and saved
// values stay intact. Diagnostics and manual experiments are kept out of basics.
export function setupLightingMenu({dialog,state,element,toonField,colorField,conditionBox,nearLabel,nearStatus,distanceField,rotationField,regionField,extSurfaceField,secondDetails}){
  const controls=new Map([...dialog.querySelectorAll('[id]')].map(e=>[e.id,e]));
  const $=id=>controls.get(id)||dialog.querySelector('#'+id),label=id=>$(id).closest('label');
  const details=(title,...nodes)=>{const e=element('details');e.append(element('summary',title),...nodes);return e;};
  const rename=(id,text)=>{const e=label(id);for(const node of [...e.childNodes])if(node.nodeType===Node.TEXT_NODE)node.remove();e.append(document.createTextNode(' '+text));};
  const heading=dialog.querySelector('.view-settings-heading'),title=element('div');title.className='lighting-menu-title';
  title.append($('avatar-lighting-title'),$('avatar-lighting-summary'));heading.prepend(title);heading.classList.add('lighting-menu-heading');
  $('avatar-lighting-title').textContent='재질 · 화면 효과';
  const notice=element('div');notice.id='avatar-lighting-experiments-notice';notice.hidden=true;const noticeText=element('span'),review=element('button','선택된 설정 보기');review.type='button';review.className='secondary';review.id='avatar-lighting-review-advanced';notice.append(noticeText,review);heading.append(notice);
  const nav=element('div');nav.className='lighting-menu-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','재질·화면 효과 설정 분류');
  const scroll=element('div');scroll.id='avatar-lighting-scroll';const panels=new Map(),tabs=new Map();let current='light';
  for(const [key,text] of [['light','기본 꾸미기'],['color','화면 효과'],['advanced','고급 설정']]){
    const tab=element('button',text);tab.id='avatar-lighting-tab-'+key;tab.type='button';tab.setAttribute('role','tab');
    const panel=element('div');panel.id='avatar-lighting-panel-'+key;panel.className='lighting-menu-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);tab.setAttribute('aria-controls',panel.id);
    panels.set(key,panel);tabs.set(key,tab);nav.append(tab);scroll.append(panel);tab.onclick=()=>activate(key);
    tab.onkeydown=event=>{const keys=[...tabs.keys()],i=keys.indexOf(key);let next;
      if(event.key==='ArrowRight')next=keys[(i+1)%keys.length];else if(event.key==='ArrowLeft')next=keys[(i+keys.length-1)%keys.length];else if(event.key==='Home')next=keys[0];else if(event.key==='End')next=keys.at(-1);else return;
      event.preventDefault();activate(next);tabs.get(next).focus();
    };
  }
  function activate(key){current=key;for(const [name,panel] of panels){panel.hidden=name!==key;const tab=tabs.get(name);tab.setAttribute('aria-selected',String(name===key));tab.tabIndex=name===key?0:-1;}scroll.scrollTop=0;}
  review.onclick=()=>{activate('advanced');tabs.get('advanced').focus();};
  const advanced=panels.get('advanced'),material=panels.get('light');
  const off=element('button','추가 설정 모두 끄기');off.id='avatar-lighting-experiments-off';off.type='button';off.className='secondary';
  const experimentEntries=[['avatar-source-color','화면 효과','color'],['avatar-grade-enabled','색상 조절','color'],['avatar-sharpen-enabled','또렷하게','color'],['avatar-dof-enabled','초점 밖 흐림','color'],['avatar-second-enabled','하이퍼 색상','advanced'],['avatar-camera-mix-enabled','거리별 밝기','advanced'],['avatar-toon-rotation-enabled','조명 방향 회전','advanced'],['avatar-ext-surface-enabled','표면색 가산','advanced'],['avatar-glow-enabled','표면 밝기 보조','advanced'],['avatar-ext-enabled','환경 반사','advanced'],['avatar-rim-enabled','가장자리 빛','advanced'],['avatar-matcap-mask-only','광택 범위진단','advanced'],['avatar-emission-solo','발광 전용 표시','advanced']];
  for(const id of ['avatar-camera-mix-enabled','avatar-toon-rotation-enabled']){const index=experimentEntries.findIndex(entry=>entry[0]===id);if(index>=0)experimentEntries.splice(index,1);}
  const selected=entry=>{const input=$(entry[0]);return input.type==='checkbox'?input.checked:!!input.value;};
  const note=text=>{const e=element('p',text);e.className='lighting-help';return e;};
  const activeCard=element('div');activeCard.id='avatar-lighting-active-settings';const activeList=element('div');activeList.className='lighting-active-list';activeCard.append(note('선택된 추가 설정 · 이름을 누르면 해당 위치로 이동합니다.'),activeList);advanced.prepend(activeCard);
  off.onclick=()=>{for(const entry of experimentEntries){if(!selected(entry))continue;const input=$(entry[0]);if(input.type==='checkbox')input.checked=false;else input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));}sync();};
  const experimentNote=element('p','기본 음영·광택·발광과 입력 수치는 유지합니다. 화면 효과·고급 효과·진단 표시만 끕니다.');experimentNote.className='muted';activeCard.append(off,experimentNote);
  panels.get('light').append(toonField);toonField.querySelector('legend').textContent='음영 · 밝은 면과 그림자';
  rename('avatar-toon-enabled','의상 음영 사용');rename('avatar-face-sdf-enabled','얼굴 음영 포함');rename('avatar-lighting-auto','착용 조건으로 조명 선택');
  const autoLabel=label('avatar-lighting-auto'),autoStatus=$('avatar-lighting-auto-status');$('avatar-toon-profile').after(autoLabel,autoStatus);
  const lightSettings=details('조명 선택·거리·방향',details('조명 선택 조건',conditionBox),details('지역 조명 합성',regionField),details('거리·방향 조절',nearLabel,nearStatus,distanceField,rotationField));
  const matcap=label('avatar-matcap-enabled').closest('fieldset'),emission=$('avatar-emission-master').closest('fieldset');material.append(matcap,emission);
  matcap.querySelector('legend').textContent='광택 · 반짝이는 표면';rename('avatar-matcap-enabled','광택 사용');
  const glossDetails=details('광택 세부 설정',label('avatar-matcap-normal'),label('avatar-matcap-specular'),label('avatar-specular-light'),$('avatar-specular-status'),$('avatar-matcap-status'),details('부위별 광택',$('avatar-matcap-items')));matcap.append(glossDetails);
  advanced.append(details('추가 표면 효과',note('의상에 해당 데이터가 있을 때만 적용됩니다. 색이나 밝기가 예상과 다르면 꺼서 비교하세요.'),label('avatar-glow-enabled'),$('avatar-glow-status'),label('avatar-ext-enabled'),$('avatar-ext-status'),label('avatar-rim-enabled'),$('avatar-rim-status'),extSurfaceField));
  advanced.append(details('표시 범위 확인',note('효과가 적용되는 부분을 흑백 또는 발광 전용 화면으로 확인합니다.'),details('광택 범위 확인',label('avatar-matcap-mask-only'),$('avatar-matcap-mask-status')),details('발광 부위 확인',label('avatar-emission-solo'),label('avatar-emission-exposure'))));
  panels.get('color').append(colorField);colorField.querySelector('legend').textContent='화면 효과';
  secondDetails.querySelector('summary').textContent='하이퍼 모드 색상 실험';secondDetails.open=false;advanced.append(secondDetails);
  // Keep the basic page limited to three familiar effects and their strengths.
  panels.get('light').prepend(note('광택·발광을 조절하세요. 조명과 음영은 뷰어 안의 둥근 조명 버튼에서 설정합니다.'));
  emission.querySelector('legend').textContent='발광 · 스스로 빛나는 부분';
  rename('avatar-emission-bloom','빛 번짐 · 발광 주변에 빛 퍼뜨리기');
  const toonDetail=details('음영 세부 설정',label('avatar-face-sdf-enabled'),autoLabel,autoStatus,$('avatar-toon-status'));
  toonField.append(toonDetail);label('avatar-toon-enabled').after(note('의상에 연결된 조명으로 밝은 면과 그림자를 만듭니다. 조명 선택 후 켜세요.'));
  label('avatar-matcap-enabled').after(note('유광 의상의 반짝임을 표시합니다. 연결된 광택 텍스처와 마스크가 필요합니다.'));
  const emissionDetail=details('발광 세부 설정',label('avatar-emission-mode'),$('avatar-emission-mode-status'),details('부위별 발광',$('avatar-emission-items')));emission.append(emissionDetail);
  $('avatar-emission-master').after(note('발광 무늬와 장식의 빛을 표시합니다. 일반 옷을 발광 재질로 바꾸지는 않습니다.'));
  const brief=[];for(const [card,id] of [[toonField,'toon'],[matcap,'gloss'],[emission,'emission']]){const text=element('p');text.id='avatar-lighting-basic-'+id;text.className='lighting-brief';text.setAttribute('role','status');card.append(text);brief.push(text);}
  panels.get('color').prepend(note('화면 전체의 색감·또렷함·흐림을 조절합니다. 각 효과는 따로 켤 수 있습니다.'));
  rename('avatar-source-color','화면 효과 사용');label('avatar-source-color').after(note('켜면 색상 계산 방식도 함께 바뀝니다. 아래에서 사용할 효과를 선택하세요.'));
  const colorSource=details('색상 계산 방식·지원 범위',$('avatar-source-color-status'));colorField.append(colorSource);
  const featureCards=[['avatar-grade-enabled','색상 조절','밝기·대비·채도를 바꿉니다. 프리셋을 고르거나 직접 입력하세요.'],['avatar-sharpen-enabled','또렷하게','주변 픽셀을 이용해 윤곽을 강조합니다. 샘플 거리가 0이면 효과가 없습니다.'],['avatar-dof-enabled','초점 밖 흐림','모델과 일반 평면 효과에 흐림을 적용합니다. 먼저 현재 모델에 초점을 맞추세요.']];
  for(const [id,title,help] of featureCards){const section=$(id).closest('details');section.dataset.effectTitle=title;section.querySelector('summary').after(note(help));rename(id,title+' 사용');const notes=[...section.children].filter(e=>e.tagName==='P'&&!e.id&&!e.classList.contains('lighting-help'));if(notes.length)section.append(details('자세한 설명',...notes));}
  rename('avatar-glow-enabled','표면 밝기 보조 · GLOW');rename('avatar-ext-enabled','환경 반사 더하기 · EXT');rename('avatar-rim-enabled','가장자리 빛 더하기');
  secondDetails.querySelector('summary').after(note('하이퍼 모드 효과 텍스처의 색을 더합니다. 모델이 푸르게 보이면 이 설정을 끄세요.'));
  advanced.prepend(note('의상별 추가 효과와 확인용 도구입니다. 기본 화면에서는 조절하지 않아도 됩니다.'));
  // Detailed support notes stay available without dominating every card.
  for(const card of [toonField,matcap,emission,colorField]){
    const notes=[...card.children].filter(e=>e.tagName==='P'&&!e.id&&!e.classList.contains('lighting-help'));
    if(notes.length)(card===toonField?toonDetail:card===matcap?glossDetails:card===emission?emissionDetail:colorSource).append(details('자세한 설명',...notes));
  }
  const unmoved=[...dialog.children].filter(e=>e!==heading&&e!==nav&&e!==scroll);
  // All functional controls should now live in a section; retain any future
  // additions visibly in advanced instead of dropping them during a UI update.
  advanced.append(...unmoved);
  toonField.remove();
  dialog.append(heading,nav,scroll);for(const section of dialog.querySelectorAll('details'))section.open=false;activate(current);
  function sync(){
    const active=experimentEntries.filter(selected);notice.hidden=!active.length;noticeText.textContent=`추가 설정 ${active.length}개 선택됨`;activeCard.hidden=!active.length;off.disabled=!active.length;activeList.replaceChildren();
    for(const entry of active){const jump=element('button',entry[1]);jump.type='button';jump.className='secondary';jump.onclick=()=>{activate(entry[2]);const input=$(entry[0]);for(let node=input.parentElement;node&&node!==scroll;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;input.scrollIntoView({block:'nearest'});if(!input.disabled)input.focus();else input.closest('details')?.querySelector('summary').focus();};activeList.append(jump);}
    const colorCount=active.filter(e=>e[2]==='color').length,advancedCount=active.length-colorCount;tabs.get('color').textContent=colorCount?`화면 효과 · ${colorCount}`:'화면 효과';tabs.get('advanced').textContent=advancedCount?`고급 설정 · ${advancedCount}`:'고급 설정';
    $('avatar-lighting-summary').textContent=!state.model?'모델을 선택하면 사용할 수 있는 효과를 확인할 수 있습니다.':`광택 ${$('avatar-matcap-enabled').checked?'켬':'끔'} · 발광 ${$('material-preview').checked?'켬':'끔'}`;
    const toonReady=(state.model?.materials||[]).some(m=>{const u=m.userData.avatarLighting;return u&&(u.avatarToonEnabled.value>0||u.avatarFaceEnabled.value>0||u.avatarGlowEnabled.value>0);});
    brief[0].textContent=state.viewerSourceLighting?(toonReady?'뷰어 주광원으로 원본 툰·얼굴 음영 표시':'뷰어 주광원 선택됨 · 원본 음영 데이터 연결 대기'):$('avatar-toon-enabled').disabled?'이 모델에는 연결된 음영 데이터가 없습니다.':!$('avatar-toon-enabled').checked?'음영 꺼짐':!$('avatar-lighting-profile').value?'사용할 조명을 선택하세요.':!toonReady?'음영 사용 대기 · 세부 설정에서 연결 상태를 확인하세요.':'선택한 조명으로 의상 음영 표시';
    const glossReady=(state.model?.materials||[]).some(m=>m.userData.matcapPreview?.uniforms.avatarMatcapEnabled.value>0);
    brief[1].textContent=$('avatar-matcap-enabled').disabled?'이 모델에는 연결된 광택 데이터가 없습니다.':!$('avatar-matcap-enabled').checked?'광택 꺼짐':!glossReady?'광택 사용 대기 · 세부 설정에서 텍스처와 마스크를 확인하세요.':Number($('avatar-matcap-strength').value)===0?'강도 0 · 반짝임 없음':'광택 표시';
    const emissionReady=(state.model?.materials||[]).some(m=>m.userData.materialPreview?.uniforms.avatarMaterialEnabled.value>0);
    brief[2].textContent=$('material-preview').disabled?'이 모델에는 연결된 발광 데이터가 없습니다.':!$('material-preview').checked?'발광 꺼짐':!emissionReady?'표시할 발광 부위가 없습니다. 세부 설정을 확인하세요.':$('avatar-emission-bloom').checked?'발광과 주변 빛 번짐 표시':'발광 표시 · 주변 빛 번짐 꺼짐';
    glossDetails.querySelector('summary').textContent=$('avatar-matcap-normal').checked?'광택 세부 설정':'광택 세부 설정 · 표면 전체에 적용';
    for(const [id] of featureCards){const section=$(id).closest('details');section.querySelector('summary').textContent=section.dataset.effectTitle+($(id).checked?($(id).disabled?' · 선택됨 (사용 대기)':' · 선택됨'):'');}
    toonField.classList.toggle('lighting-unavailable',$('avatar-toon-enabled').disabled);
    label('avatar-face-sdf-enabled').hidden=$('avatar-face-sdf-enabled').disabled;
    matcap.classList.toggle('lighting-unavailable',$('avatar-matcap-enabled').disabled);
    emission.classList.toggle('lighting-unavailable',$('material-preview').disabled);
  }
  dialog.addEventListener('change',sync);return {sync,activate,lightSettings};
}
