'use strict';
let resetPlan = null, resetPreviewGeneration = 0;
const management = $('data-management');

function resetControls(){
  $('confirm-reset').disabled=resetPending||running||!resetPlan||$('reset-confirmation').value!=='전체 초기화';
  for(const id of ['close-management','cancel-management','reset-preserved','reset-confirmation'])$(id).disabled=resetPending;
}

async function previewReset(){
  const generation=++resetPreviewGeneration;
  resetPlan=null;$('reset-confirmation').value='';$('reset-error').textContent='';
  $('reset-summary').textContent='삭제 범위를 확인하고 있습니다…';$('reset-folders').replaceChildren();resetControls();
  try{
    const plan=await api('/api/reset-preview?preserved='+($('reset-preserved').checked?'1':'0'));
    if(generation!==resetPreviewGeneration||!management.open)return;
    resetPlan=plan;
    $('reset-summary').textContent=`분석 CMF ${fmt(plan.archives)}개 · 목록 ${fmt(plan.entries)}개 · 삭제 파일 ${fmt(plan.count)}개 (${bytes(plan.bytes)}) · 보존 데이터 ${plan.delete_preserved?'삭제':'유지'}`;
    $('reset-folders').replaceChildren(...plan.folders.map(path=>node('li','path',path)));
  }catch(e){if(generation===resetPreviewGeneration){$('reset-summary').textContent='삭제 범위를 확인하지 못했습니다.';$('reset-error').textContent=e.message;}}
  resetControls();
}

$('manage-data').onclick=()=>{
  if(running||resetPending)return;
  $('reset-preserved').checked=false;management.showModal();previewReset();
};
$('reset-preserved').onchange=previewReset;
$('reset-confirmation').oninput=resetControls;
for(const id of ['close-management','cancel-management'])$(id).onclick=()=>management.close();
management.addEventListener('cancel',e=>{if(resetPending)e.preventDefault();});
management.addEventListener('close',()=>{if(management.open)return;resetPreviewGeneration++;resetPlan=null;});
$('confirm-reset').onclick=async()=>{
  if(!resetPlan||resetPending||running||$('reset-confirmation').value!=='전체 초기화')return;
  resetPending=true;resetControls();setBusy(true);
  $('reset-error').textContent='';$('reset-summary').textContent='전체 초기화 중입니다. 파일이 많으면 시간이 걸릴 수 있습니다…';
  try{
    await api('/api/reset',{plan_id:resetPlan.id,confirmation:$('reset-confirmation').value});
    location.reload();
  }catch(e){
    resetPending=false;setBusy(false);resetPlan=null;resetControls();
    $('reset-summary').textContent='초기화를 완료하지 못했습니다. 삭제 범위를 다시 확인해 주세요.';
    $('reset-error').textContent=e.message;
    // Reopening the dialog creates a fresh preview, including any files left after an I/O error.
  }
};
