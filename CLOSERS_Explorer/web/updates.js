'use strict';
let manifestBusy=false;
function showUpdateComparison(result){
  if(!result?.counts)return;
  $('update-result').hidden=false;
  const c=result.counts;
  $('update-counts').textContent=`추가 ${fmt(c.added)} · 변경 ${fmt(c.changed)} · 원본에서 사라짐 ${fmt(c.missing)} · 동일 ${fmt(c.unchanged)}`;
  $('update-examples').textContent=Object.entries({added:'추가',changed:'변경',missing:'사라짐'}).map(([key,label])=>label+'\n'+(result.examples[key].join('\n')||'없음')).join('\n\n');
}
async function showResourceHistory(item,seq){
  if(!item.history_count)return;
  const panel=node('details'),summary=node('summary','',`이 CMF의 이전 버전 저장 이력 (${fmt(item.history_count)}회)`);
  const content=node('div');panel.append(summary,content);$('preview-info').after(panel);panel.id='resource-history';
  let page=1;
  const load=async()=>{
    try{
      const result=await api('/api/history?'+new URLSearchParams({archive_id:item.archive_id,page}));
      if(seq!==previewGeneration)return;
      content.querySelector('button')?.remove();
      for(const entry of result.items){
        const row=node('p','muted',`버전 기록 ${entry.revision_id} · ${entry.name} · ${entry.output||'저장 기록 없음'} `);
        if(entry.saved_exists&&entry.flag!==2){
          const link=node('a','button secondary','이전 파일 내려받기');link.href='/api/history-download/'+entry.history_id+'?token='+encodeURIComponent(token);row.append(link);
        }
        content.append(row);
      }
      if(page*result.limit<result.total){const next=node('button','secondary','다음 이력 100개');next.onclick=()=>{page++;load();};content.append(next);}
    }catch(e){if(seq===previewGeneration)content.append(node('p','muted',e.message));}
  };
  panel.addEventListener('toggle',()=>{if(panel.open&&!content.childNodes.length)load();});
}
function initStage2Ui(){
  $('compare').onclick=async()=>{try{await api('/api/compare',{paths:[$('source').value]});setBusy(true);}catch(e){toast(e.message);}};
  $('manifest').onclick=async event=>{
    event.preventDefault();
    if(running){toast('현재 작업이 끝난 뒤 CSV를 내려받으세요.');return;}
    if(manifestBusy)return;
    manifestBusy=true;$('manifest').textContent='CSV 준비 중…';
    try{
      const response=await fetch('/api/manifest',{headers:{'X-Explorer-Token':token}});
      if(!response.ok)throw Error((await response.json()).error);
      const blob=await response.blob(),url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download='catalog.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(e){toast(e.message);}finally{manifestBusy=false;$('manifest').textContent='↓ 목록 CSV';}
  };
  api('/api/update-comparison').then(showUpdateComparison).catch(e=>toast(e.message));
}
