// Layout controls stay independent of WebGL and preserve the current scene.
const $=id=>document.getElementById(id);
const layout=document.querySelector('.model-layout');
const compact=matchMedia('(max-width:1500px)');
function setEquipmentVisible(visible){
  layout.classList.toggle('info-collapsed',!visible);
  $('toggle-model-info').setAttribute('aria-expanded',String(visible));
  $('toggle-model-info').textContent=visible?'장착 접기':'장착 보기';
}
setEquipmentVisible(!compact.matches);
compact.addEventListener('change',()=>setEquipmentVisible(!compact.matches));
$('toggle-model-info').onclick=()=>setEquipmentVisible(layout.classList.contains('info-collapsed'));

// Keep the small-screen picker short enough to show results below the search.
const narrow=matchMedia('(max-width:900px)');
const filters=document.createElement('div');
filters.className='mobile-picker-filters';
$('model-advanced').before(filters);
const relocated=[$('part-tabs'),$('model-sort'),document.querySelector('.filter-summary')].map(node=>{
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
}
$('show-wardrobe').onclick=()=>selectPanel(false);
$('show-equipment').onclick=()=>selectPanel(true);
$('open-view-settings').onclick=()=>$('view-settings').showModal();
$('close-view-settings').onclick=()=>$('view-settings').close();

const panel=document.querySelector('.viewport-panel'),dialog=$('viewer-dialog');
const anchor=document.createComment('viewer position');
panel.before(anchor);
$('expand-viewer').onclick=()=>{
  if(dialog.open){dialog.close();return;}
  dialog.append(panel);
  $('expand-viewer').textContent='원래 크기';
  dialog.showModal();
  $('expand-viewer').focus();
};
dialog.addEventListener('close',()=>{
  anchor.after(panel);
  $('expand-viewer').textContent='크게 보기';
  $('expand-viewer').focus();
});
