import {setupPreviews} from '/model-preview.js';
const check=(v,message)=>{if(!v)throw Error(message);};
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn);};
const OriginalImage=window.Image,OriginalObserver=window.IntersectionObserver;
const jobs=[];let active=0,peak=0,modelCalls=0;
window.IntersectionObserver=class{
  constructor(callback){this.callback=callback;}
  observe(target){queueMicrotask(()=>this.callback([{target,isIntersecting:true}]));}
  unobserve(){}disconnect(){}
};
window.Image=class{
  constructor(){
    const img=document.createElement('img');let src,job;
    Object.defineProperty(img,'src',{get:()=>src,set:value=>src=String(value)});
    img.decode=()=>new Promise((resolve,reject)=>{
      active++;peak=Math.max(peak,active);
      job={src,done:false,finish(fail=false){if(this.done)return;this.done=true;active--;fail?reject(Error('fixture decode failure')):resolve();}};jobs.push(job);
    });
    const remove=img.removeAttribute.bind(img);img.removeAttribute=name=>{if(name==='src')job?.finish(true);remove(name);};
    return img;
  }
};
try{
  const previews=setupPreviews({api:async()=>{modelCalls++;throw Error('Unexpected 3D preview');}}),root=document.getElementById('model-results');
  const rows=[];
  function attach(id=71){const row=document.createElement('div');root.append(row);previews.attach(row,{id:1,name:'shared mesh',preview_entry:id,preview_kind:'icon'},'parts','');rows.push(row);return row;}
  for(let i=0;i<8;i++)attach(71+i);
  await until(()=>jobs.length===4);check(active===4&&peak===4,'thumbnail concurrency is not bounded at four');
  jobs[0].finish();jobs[1].finish();await until(()=>jobs.length===6);
  check(active===4&&rows[0].querySelector('img')&&rows[1].querySelector('img'),'ready images did not display independently');
  previews.reset();root.replaceChildren();const fresh=attach(99);
  await until(()=>jobs.some(j=>j.src.includes('/99?')));
  check(jobs.length===7,'reset started queued stale thumbnails');
  jobs.at(-1).finish();await until(()=>fresh.querySelector('img'));
  check(rows.slice(2,8).every(row=>!row.querySelector('img')),'stale image mutated an old row');
  const a=attach(71),b=attach(72);await until(()=>jobs.length===9);
  check(jobs[7].src!==jobs[8].src,'A/B item icons share a model identity');
  jobs[7].finish(true);jobs[8].finish();await until(()=>a.textContent.includes('아이콘 없음')&&b.querySelector('img'));
  const retry=attach(71);await until(()=>jobs.length===10);jobs[9].finish();await until(()=>retry.querySelector('img'));
  check(retry.querySelector('img')===retry.querySelector('.model-thumbnail').firstChild,'decoded image was copied into a second request');
  const closing=attach(73);await until(()=>jobs.length===11);window.dispatchEvent(new Event('pagehide'));
  await until(()=>active===0);check(!closing.querySelector('img')&&modelCalls===0,'teardown or disabled 3D preview regressed');
  check(peak===4,'concurrency exceeded budget after reset');
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';const pre=document.createElement('pre');pre.textContent=e.stack;document.body.append(pre);}
finally{window.Image=OriginalImage;window.IntersectionObserver=OriginalObserver;}
