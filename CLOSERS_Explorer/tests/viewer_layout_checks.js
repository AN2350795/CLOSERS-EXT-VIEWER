import {setupViewerLayout} from '/model-picker.js';
setupViewerLayout();
const $=id=>document.getElementById(id);
const check=(value,message)=>{if(!value)throw Error(message+' at '+innerWidth+'×'+innerHeight);};
const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const rect=selector=>document.querySelector(selector).getBoundingClientRect();
window.checkViewerLayout=async()=>{
  await frame();
  const viewport=rect('#viewport'),panel=rect('.viewport-panel');
  check(viewport.width>200&&viewport.height>80,'scene has usable space');
  check(panel.top>=0&&panel.bottom<=innerHeight,'viewer fits screen');
  check(document.documentElement.scrollWidth<=innerWidth+1,'no horizontal overflow');
  check(document.documentElement.scrollHeight<=innerHeight+1,'page stays within screen');
  const original={x:viewport.x,y:viewport.y,width:viewport.width,height:viewport.height};
  $('open-view-settings').click();
  check($('view-settings').open,'settings opens');
  $('show-bones').checked=true;
  check(rect('#viewport').height===original.height,'settings preserves scene size');
  $('close-view-settings').click();
  check(!$('view-settings').open&&$('show-bones').checked,'settings retained');
  if(innerWidth>900){
    const before=rect('#viewport').width;
    const collapsed=document.querySelector('.model-layout').classList.contains('info-collapsed');
    $('toggle-model-info').click();await frame();
    check($('equipment-panel').checkVisibility()===collapsed,'equipment toggle');
    check(collapsed?rect('#viewport').width<before:rect('#viewport').width>before,'scene responds to equipment toggle');
    $('toggle-model-info').click();await frame();
    if(innerWidth>=1440)check(rect('#viewport').width/innerWidth>.55,'scene receives most of desktop width');
  }else{
    const landscape=innerWidth>600&&innerHeight<=550;
    check(landscape?rect('.workspace-switch').right<=panel.left:rect('.workspace-switch').top>=panel.bottom,'panel switch outside viewer');
    $('show-equipment').click();await frame();
    check($('equipment-panel').checkVisibility()&&!$('wardrobe-panel').checkVisibility(),'mobile equipment panel');
    $('equipment-panel').append(Object.assign(document.createElement('p'),{textContent:'장착 정보 '.repeat(300)}));
    $('equipment-panel').scrollTop=200;await frame();
    check(rect('#viewport').y===original.y&&rect('#viewport').height===original.height,'equipment scroll preserves viewer');
    $('equipment-panel').lastElementChild.remove();
    $('show-wardrobe').click();await frame();
    check($('wardrobe-panel').checkVisibility()&&!$('equipment-panel').checkVisibility(),'mobile wardrobe panel');
    $('wardrobe-panel').scrollTop=200;await frame();
    check(rect('#viewport').y===original.y,'wardrobe scroll preserves viewer');
    $('wardrobe-panel').scrollTop=0;
  }
  const canvas=$('model-canvas');
  $('expand-viewer').click();await frame();
  check($('viewer-dialog').open&&$('viewer-dialog').contains(canvas),'expand keeps canvas');
  check(rect('#viewport').width>=original.width&&rect('#viewport').height>original.height,'expanded scene grows');
  $('open-view-settings').click();check($('view-settings').open,'settings works in expanded viewer');
  $('close-view-settings').click();
  $('viewer-dialog').close();await frame();
  check(document.querySelector('.model-layout').contains(canvas),'close restores canvas');
  check(document.activeElement===$('expand-viewer'),'close restores focus');
  for(const button of document.querySelectorAll('.viewport-actions button,.animation-controls button')){
    if(!button.checkVisibility())continue;
    const bounds=button.getBoundingClientRect();
    check(bounds.left>=panel.left&&bounds.right<=panel.right&&bounds.bottom<=panel.bottom,'viewer controls fit');
  }
  return {width:innerWidth,height:innerHeight,viewport:original};
};
try{await window.checkViewerLayout();document.body.dataset.checks='passed';}
catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
