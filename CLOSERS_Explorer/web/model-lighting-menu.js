// Presentation only: move the existing controls so their bindings and saved
// values stay intact. Diagnostics and manual experiments are kept out of basics.
export function setupLightingMenu({dialog,state,element,toonField,colorField,conditionBox,nearLabel,nearStatus,distanceField,rotationField,regionField,extSurfaceField,secondDetails}){
  const controls=new Map([...dialog.querySelectorAll('[id]')].map(e=>[e.id,e]));
  const $=id=>controls.get(id)||dialog.querySelector('#'+id),label=id=>$(id).closest('label');
  const details=(title,...nodes)=>{const e=element('details');e.append(element('summary',title),...nodes);return e;};
  const rename=(id,text)=>{const e=label(id);for(const node of [...e.childNodes])if(node.nodeType===Node.TEXT_NODE)node.remove();e.append(document.createTextNode(' '+text));};
  const heading=dialog.querySelector('.view-settings-heading'),title=element('div');title.className='lighting-menu-title';
  title.append($('avatar-lighting-title'),$('avatar-lighting-summary'));heading.prepend(title);heading.classList.add('lighting-menu-heading');
  $('avatar-lighting-title').textContent='조명 · 재질';
  const notice=element('div');notice.id='avatar-lighting-experiments-notice';notice.hidden=true;const noticeText=element('span'),review=element('button','설정 보기');review.type='button';review.className='secondary';review.id='avatar-lighting-review-advanced';notice.append(noticeText,review);heading.append(notice);
  const nav=element('div');nav.className='lighting-menu-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','조명·재질 설정 분류');
  const scroll=element('div');scroll.id='avatar-lighting-scroll';const panels=new Map(),tabs=new Map();let current='light';
  for(const [key,text] of [['light','조명'],['material','광택·발광'],['color','색감·선명도'],['advanced','고급·진단']]){
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
  const advanced=panels.get('advanced'),material=panels.get('material');
  const off=element('button','수동 실험 한 번에 끄기');off.id='avatar-lighting-experiments-off';off.type='button';off.className='secondary';
  const experiments=['avatar-second-enabled','avatar-camera-mix-enabled','avatar-toon-rotation-enabled','avatar-ext-surface-enabled'];
  off.onclick=()=>{for(const id of experiments){const input=$(id);if(input.checked){input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));}}sync();};
  const experimentNote=element('p','하이퍼 색상·거리 연동·광원 회전·B 채널 가산을 끕니다. 입력한 수치는 유지합니다.');experimentNote.className='muted';advanced.append(off,experimentNote);
  panels.get('light').append(toonField);toonField.querySelector('legend').textContent='조명과 음영';
  rename('avatar-toon-enabled','조명 음영 켜기');rename('avatar-face-sdf-enabled','얼굴 음영 포함');rename('avatar-lighting-auto','착용 조건으로 조명 선택');
  const autoLabel=label('avatar-lighting-auto'),autoStatus=$('avatar-lighting-auto-status');$('avatar-toon-profile').after(autoLabel,autoStatus);
  advanced.append(details('조명 선택 상세 · 스킨 상태·착용 조건',conditionBox),details('지역 조명 합성',regionField),details('거리·방향 조절',nearLabel,nearStatus,distanceField,rotationField));
  const matcap=label('avatar-matcap-enabled').closest('fieldset'),emission=$('avatar-emission-master').closest('fieldset');material.append(matcap,emission);
  const emissionUnavailable=element('p','이 모델에 연결된 발광 재질이 없습니다.');emissionUnavailable.id='avatar-emission-unavailable';emission.append(emissionUnavailable);
  matcap.querySelector('legend').textContent='광택';rename('avatar-matcap-enabled','광택 켜기');
  const glossDetails=details('광택 세부 설정',label('avatar-matcap-normal'),label('avatar-matcap-specular'),label('avatar-specular-light'),$('avatar-specular-status'));matcap.append(glossDetails,details('부위별 광택', $('avatar-matcap-items')));
  material.append(details('추가 표면 효과',label('avatar-glow-enabled'),$('avatar-glow-status'),label('avatar-ext-enabled'),$('avatar-ext-status'),label('avatar-rim-enabled'),$('avatar-rim-status')));
  emission.append(details('부위별 발광',$('avatar-emission-items')));
  advanced.append(details('광택 범위 확인',label('avatar-matcap-mask-only'),$('avatar-matcap-mask-status')),details('발광 부위 확인',label('avatar-emission-solo'),label('avatar-emission-exposure')));
  panels.get('color').append(colorField);colorField.querySelector('legend').textContent='색감과 선명도';
  secondDetails.querySelector('summary').textContent='하이퍼 모드 색상 실험';secondDetails.open=false;advanced.append(extSurfaceField,secondDetails,details('연결 정보·원본 출처',$('avatar-toon-items').closest('details'),$('avatar-lighting-profile-source')));
  // Detailed support notes stay available without dominating every card.
  for(const card of [toonField,matcap,emission,colorField]){
    const notes=[...card.children].filter(e=>e.tagName==='P'&&!e.id);
    if(notes.length)card.append(details('설명·지원 범위',...notes));
  }
  const unmoved=[...dialog.children].filter(e=>e!==heading&&e!==nav&&e!==scroll);
  // All functional controls should now live in a section; retain any future
  // additions visibly in advanced instead of dropping them during a UI update.
  advanced.append(...unmoved);
  dialog.append(heading,nav,scroll);activate(current);
  function sync(){
    const enabled=experiments.filter(id=>$(id).checked).length;notice.hidden=enabled===0;noticeText.textContent=`수동 실험 ${enabled}개 켜짐`;tabs.get('advanced').textContent=enabled?`고급·진단 · ${enabled}`:'고급·진단';off.disabled=enabled===0;
    $('avatar-lighting-summary').textContent=!state.model?'모델을 선택하면 사용할 수 있는 효과를 확인할 수 있습니다.':`켜둔 설정: 조명 ${$('avatar-toon-enabled').checked?'켬':'끔'} · 광택 ${$('avatar-matcap-enabled').checked?'켬':'끔'} · 발광 ${$('material-preview').checked?'켬':'끔'}`;
    glossDetails.querySelector('summary').textContent=$('avatar-matcap-normal').checked?'광택 세부 설정':'광택 세부 설정 · 범위 제한 해제됨';
    label('avatar-face-sdf-enabled').hidden=$('avatar-face-sdf-enabled').disabled;
    matcap.classList.toggle('lighting-unavailable',$('avatar-matcap-enabled').disabled);
    const noEmission=$('material-preview').disabled;emission.classList.toggle('lighting-unavailable',noEmission);emissionUnavailable.hidden=!noEmission;
  }
  dialog.addEventListener('change',sync);return {sync,activate};
}
