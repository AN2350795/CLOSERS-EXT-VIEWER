// Progress arrives on the listing response itself; elapsed time is not progress.
export async function readListingResponse(response,onProgress){
  if(!response.headers.get('Content-Type')?.includes('application/x-ndjson')){
    const data=await response.json();if(!response.ok)throw Error(data.error||'불러오기 실패');return data;
  }
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result,complete=false;
  const line=text=>{
    if(!text.trim())return;
    const packet=JSON.parse(text);
    if(packet.error)throw Error(packet.error);
    if(packet.progress)onProgress?.(packet.progress);
    if(Object.hasOwn(packet,'result')){result=packet.result;complete=true;}
  };
  try{
    while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let end;
      while((end=buffer.indexOf('\n'))>=0){line(buffer.slice(0,end));buffer=buffer.slice(end+1);}
      if(done){line(buffer);break;}
    }
    if(!complete)throw Error('목록 응답이 완료되기 전에 연결이 끊겼습니다. 다시 시도해 주세요.');
    return result;
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
}

export function createListingStatus({anchor,element,onCancel,onRetry,now=()=>performance.now()}){
  const panel=element('div');panel.id='model-list-progress';panel.className='model-list-progress';panel.hidden=true;
  const label=element('p'),detail=element('p'),bar=element('progress'),warning=element('p'),actions=element('div');
  label.id='model-list-stage';label.setAttribute('role','status');label.setAttribute('aria-live','polite');
  detail.id='model-list-detail';warning.id='model-list-warning';warning.setAttribute('role','status');
  bar.setAttribute('aria-label','현재 단계 진행 상황');
  const cancel=element('button','취소'),retry=element('button','다시 시도');
  cancel.id='model-list-cancel';retry.id='model-list-retry';cancel.type=retry.type='button';
  cancel.onclick=onCancel;retry.onclick=onRetry;actions.append(cancel,retry);panel.append(label,bar,detail,warning,actions);anchor.before(panel);
  const icons=element('p');icons.id='model-icon-progress';icons.className='model-icon-progress';icons.hidden=true;anchor.before(icons);
  let timer,active=false,started=0,last=0,packet=null;
  function render(){
    if(!active)return;
    const elapsed=Math.max(0,Math.floor((now()-started)/1000)),age=Math.max(0,Math.floor((now()-last)/1000));
    const title=packet?.label||'서버의 목록 준비 응답을 기다리는 중';
    if(label.textContent!==title)label.textContent=title;
    const known=Number.isFinite(packet?.total)&&packet.total>0&&Number.isFinite(packet?.done);
    if(known){bar.max=packet.total;bar.value=Math.min(packet.done,packet.total);}else bar.removeAttribute('value');
    detail.textContent=(packet?.batch?`묶음 ${packet.batch.index} / ${packet.batch.total} · `:'')+(known?`${packet.done.toLocaleString()} / ${packet.total.toLocaleString()} 항목 · `:'')+`경과 ${elapsed}초 · 마지막 진행 확인 ${age}초 전`;
    const stale=age>=10;panel.classList.toggle('is-delayed',stale);warning.hidden=!stale;
    warning.textContent=stale?'진행 정보가 한동안 갱신되지 않았습니다. 응답을 기다리는 중입니다.':'';
    retry.hidden=!stale;
  }
  function stop(){active=false;clearInterval(timer);timer=null;}
  function start(){stop();active=true;started=last=now();packet=null;panel.hidden=false;cancel.hidden=false;bar.hidden=false;warning.hidden=true;retry.hidden=true;icons.hidden=true;render();timer=setInterval(render,500);}
  function update(value){if(!active)return;packet=value;last=now()-Math.max(0,value.last_progress_age||0)*1000;render();}
  function finish(){stop();panel.hidden=true;}
  function failed(message){stop();panel.hidden=false;panel.classList.remove('is-delayed');bar.hidden=true;cancel.hidden=true;retry.hidden=false;warning.hidden=true;label.textContent=message;detail.textContent='기존 목록은 유지됩니다.';}
  document.addEventListener('model-preview-progress',event=>{
    const {requested,done,unavailable}=event.detail;icons.hidden=active||!requested;
    icons.textContent=`아이콘 ${done.toLocaleString()} / ${requested.toLocaleString()}개 처리`+(unavailable?` · 표시할 수 없음 ${unavailable}개`:'')+(done<requested?' · 목록 탐색 가능':'');
  });
  window.addEventListener('pagehide',stop);
  return {start,update,finish,failed,render,stop};
}
