const errors=[];
try{
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const until=async condition=>{for(let i=0;i<200;i++){if(condition())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
  const sheet=document.createElement('canvas');sheet.width=8;sheet.height=4;const ctx=sheet.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,4,4);ctx.fillStyle='blue';ctx.fillRect(4,0,4,4);
  const blob=await new Promise(r=>sheet.toBlob(r));const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const presets=Array.from({length:15},(_,i)=>({id:i+1,name:'frame '+(i+1),image:'FRAME_'+(i+1)+'.PNG',effects:'',mark:'marks.png',mark_key:i<2?'COMMON':'MARK_'+(i+1),mark_effects:''}));
  const requests=[],nativeFetch=window.fetch;let staleResolve;
  window.fetch=async(path,options)=>{
    const url=new URL(path,location.origin);requests.push(url.pathname+url.search);
    if(url.pathname==='/api/loading-presets')return Response.json({items:presets});
    if(url.pathname==='/api/loading-illustrations'){
      if(url.searchParams.get('q')==='slow')await new Promise(r=>staleResolve=r);
      return Response.json({items:[],total:0});
    }
    if(url.pathname.startsWith('/api/loading-plan/')){
      const id=Number(url.pathname.split('/').at(-1));return Response.json({preset:presets[id-1],width:450,height:640,effects:[],warnings:[],
        layers:[{entry_id:1,name:'TOP',role:'frame',crop:{x:0,y:0,width:4,height:2},x:0,y:0,width:450,height:170},{entry_id:1,name:'BOT',role:'frame',crop:{x:0,y:2,width:4,height:2},x:0,y:556,width:450,height:84}],
        mark:{entry_id:2,key:presets[id-1].mark_key,crop:{x:4,y:0,width:4,height:4}}});
    }
    if(url.pathname.startsWith('/api/composition-source/'))return Response.json({entry_id:Number(url.pathname.split('/').at(-1)),archive:'fixture',ordinal:Number(url.pathname.split('/').at(-1)),name:'sheet.png',format:'png',source_sha256:digest,image_sha256:digest,width:8,height:4});
    if(url.pathname.startsWith('/api/composition-image/'))return new Response(blob);
    return nativeFetch(path,options);
  };
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/compose.js';s.onload=resolve;s.onerror=reject;document.head.append(s);});
  await until(()=>document.querySelector('#image-results[aria-busy=false]'));
  check(!document.querySelector('#game-frame')&&!document.querySelector('#find-all'),'old dropdown/search controls remain');
  document.querySelector('#pick-frame').click();await until(()=>document.querySelectorAll('.asset-card').length===12);
  check(document.querySelector('.asset-card img').src.includes('/api/loading-thumbnail/frame/1'),'assembled frame thumbnail URL');
  document.querySelector('.asset-card[data-id="2"]').click();await until(()=>!busy&&composition.layers.length===2);
  check(selectedFrameId===2&&document.querySelector('.asset-card[data-id="2"]').getAttribute('aria-pressed')==='true','selected frame state');
  document.querySelector('#image-next').click();await until(()=>document.querySelector('.asset-card[data-id="13"]'));check(document.querySelectorAll('.asset-card').length===3,'frame pagination');
  document.querySelector('#image-query').value='FRAME_14';await searchImages();check(document.querySelectorAll('.asset-card').length===1&&document.querySelector('.asset-card').dataset.id==='14','frame name filter and page clamp');
  document.querySelector('#pick-mark').click();await until(()=>document.querySelector('.asset-card[data-kind="mark"]'));
  check(document.querySelector('#picker-summary').textContent.includes('14'),'duplicate mark regions were not merged');
  check(document.querySelector('.asset-card img').src.includes('/api/loading-thumbnail/mark/'),'individual mark thumbnail URL');
  document.querySelector('.asset-card[data-id="3"]').click();await until(()=>!busy&&composition.layers.length===3);
  check(selectedFrameId===2&&selectedMarkId===3&&composition.layers.at(-1).crop.x===4,'independent mark selection');
  check(requests.some(p=>p==='/api/loading-plan/3?mark=1'),'mark request unnecessarily loads frame effects');
  document.querySelector('.asset-card[data-id="4"]').click();await until(()=>!busy&&selectedMarkId===4);
  check(composition.layers.length===3&&composition.layers.filter(l=>l.gameMark).length===1&&selectedFrameId===2,'switching marks did not replace only the previous mark');
  document.querySelector('#pick-mark').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await until(()=>document.querySelector('.asset-card[data-kind="frame"]'));
  check(document.activeElement.id==='pick-frame','keyboard tab navigation');
  document.querySelector('#pick-illustration').click();await until(()=>document.querySelector('#image-results[aria-busy=false]'));
  document.querySelector('#image-query').value='slow';const pending=searchImages();await until(()=>staleResolve);document.querySelector('#pick-frame').click();await until(()=>document.querySelector('.asset-card[data-kind="frame"]'));staleResolve();await pending;
  check(document.querySelectorAll('.asset-card').length===12,'stale illustration response replaced frame menu');
  check(!requests.some(p=>p.startsWith('/api/entries')),'generic CMF search still used');
  document.body.dataset.checks='passed';
}catch(error){errors.push(error.stack||String(error));document.body.dataset.checks='failed';}
const pre=document.createElement('pre');pre.textContent=errors.join('\n');document.body.append(pre);
