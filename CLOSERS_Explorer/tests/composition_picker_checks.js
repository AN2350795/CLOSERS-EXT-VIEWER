const errors=[];
try{
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const until=async condition=>{for(let i=0;i<200;i++){if(condition())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
  const sheet=document.createElement('canvas');sheet.width=8;sheet.height=4;const ctx=sheet.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,4,4);ctx.fillStyle='blue';ctx.fillRect(4,0,4,4);
  const blob=await new Promise(r=>sheet.toBlob(r));const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const presets=Array.from({length:15},(_,i)=>({id:i+1,name:'frame '+(i+1),image:'FRAME_'+(i+1)+'.PNG',effects:'',mark:'marks.png',mark_key:i<2?'COMMON':'MARK_'+(i+1),mark_effects:''}));
  const requests=[],nativeFetch=window.fetch;let staleResolve,includeParticles=false;
  const particle={seed:123,life:2,maxParticles:1,rate:0,instant:1,emitterLife:10,deaths:0,radius:[0,0,0],radiusMin:0,gravity:[0,0,0],scale:[1,1],basis:[4,4],drawCount:1,dual:false,dualDrawCount:1,clamp:true,blend:['SRCALPHA','INVSRCALPHA'],mask_entry_id:1,tracks:[{property:'size',mode:'initial',value:[4,4,1],start:0,end:null},{property:'color',mode:'initial',value:[1,1,1,1],start:0,end:null},{property:'color',mode:'final',value:[1,1,1,0],start:0,end:null}]};
  window.fetch=async(path,options)=>{
    const url=new URL(path,location.origin);requests.push(url.pathname+url.search);
    if(url.pathname==='/api/loading-layout')return Response.json({width:450,height:640});
    if(url.pathname==='/api/loading-illustration/9')return Response.json({width:450,height:640,layers:[{entry_id:9,name:'테스트 로딩',role:'illustration',gameIllustration:true,x:0,y:0,width:450,height:640,crop:{x:0,y:0,width:4,height:4}}]});
    if(url.pathname==='/api/loading-presets')return Response.json({items:presets});
    if(url.pathname==='/api/composition-resolve')return Response.json({ids:JSON.parse(options.body).sources.map(s=>s.ordinal)});
    if(url.pathname==='/api/loading-illustrations'){
      if(url.searchParams.get('q')==='slow')await new Promise(r=>staleResolve=r);
      return Response.json({items:[{id:9,name:'DLG_PVP_LOADING_TEST.PNG',display_name:'테스트 로딩',character:'이세하'}],total:1});
    }
    if(url.pathname.startsWith('/api/loading-plan/')){
      const id=Number(url.pathname.split('/').at(-1));return Response.json({preset:presets[id-1],width:450,height:640,effects:includeParticles?[{name:'effect',role:'fragment',x:-2,y:-2,width:4,height:4,frames:[{entry_id:3,duration:1}],delay:0,color:[1,1,1,1],blend:'source-over',particle}]:[],warnings:[],
        layers:[{entry_id:1,name:'TOP',role:'frame',crop:{x:0,y:0,width:4,height:2},x:0,y:0,width:450,height:170},{entry_id:1,name:'BOT',role:'frame',crop:{x:0,y:2,width:4,height:2},x:0,y:556,width:450,height:84}],
        mark:{entry_id:2,key:presets[id-1].mark_key,crop:{x:4,y:0,width:4,height:4}}});
    }
    if(url.pathname.startsWith('/api/composition-source/'))return Response.json({entry_id:Number(url.pathname.split('/').at(-1)),archive:'fixture',ordinal:Number(url.pathname.split('/').at(-1)),name:'sheet.png',format:'png',source_sha256:digest,image_sha256:digest,width:8,height:4});
    if(url.pathname.startsWith('/api/composition-image/'))return new Response(blob);
    return nativeFetch(path,options);
  };
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/compose.js';s.onload=resolve;s.onerror=reject;document.head.append(s);});
  await until(()=>document.querySelector('#image-results[aria-busy=false]'));
  await until(()=>!busy);
  check(composition.canvas.width===450&&composition.canvas.height===640&&document.querySelector('#canvas-width').disabled&&document.querySelector('#canvas-height').disabled,'game output dimensions are not fixed');
  check(document.querySelector('.asset-name').textContent==='테스트 로딩'&&document.querySelector('.asset-card img').src.includes('/api/loading-thumbnail/illustration/9'),'registered loading label and cropped preview');
  document.querySelector('.asset-card').click();await until(()=>!busy&&composition.layers.length===1);
  const exported=makeExportCanvas();check(exported.getContext('2d').getImageData(225,320,1,1).data[0]===255,'illustration atlas crop was not applied');
  check(!document.querySelector('#game-frame')&&!document.querySelector('#find-all'),'old dropdown/search controls remain');
  document.querySelector('#pick-frame').click();await until(()=>document.querySelectorAll('.asset-card').length===12);
  check(document.querySelector('.asset-card img').src.includes('/api/loading-thumbnail/frame/1'),'assembled frame thumbnail URL');
  document.querySelector('.asset-card[data-id="2"]').click();await until(()=>!busy&&composition.layers.length===3);
  check(selectedFrameId===2&&document.querySelector('.asset-card[data-id="2"]').getAttribute('aria-pressed')==='true','selected frame state');
  document.querySelector('#image-next').click();await until(()=>document.querySelector('.asset-card[data-id="13"]'));check(document.querySelectorAll('.asset-card').length===3,'frame pagination');
  document.querySelector('#image-query').value='FRAME_14';await searchImages();check(document.querySelectorAll('.asset-card').length===1&&document.querySelector('.asset-card').dataset.id==='14','frame name filter and page clamp');
  document.querySelector('#pick-mark').click();await until(()=>document.querySelector('.asset-card[data-kind="mark"]'));
  check(document.querySelector('#picker-summary').textContent.includes('14'),'duplicate mark regions were not merged');
  check(document.querySelector('.asset-card img').src.includes('/api/loading-thumbnail/mark/'),'individual mark thumbnail URL');
  document.querySelector('.asset-card[data-id="3"]').click();await until(()=>!busy&&composition.layers.length===4);
  check(selectedFrameId===2&&selectedMarkId===3&&composition.layers.at(-1).crop.x===4,'independent mark selection');
  check(requests.some(p=>p==='/api/loading-plan/3?mark=1'),'mark request unnecessarily loads frame effects');
  document.querySelector('.asset-card[data-id="4"]').click();await until(()=>!busy&&selectedMarkId===4);
  check(composition.layers.length===4&&composition.layers.filter(l=>l.gameMark).length===1&&selectedFrameId===2,'switching marks did not replace only the previous mark');
  document.querySelector('#pick-mark').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await until(()=>document.querySelector('.asset-card[data-kind="frame"]'));
  check(document.activeElement.id==='pick-frame','keyboard tab navigation');
  document.querySelector('#pick-illustration').click();await until(()=>document.querySelector('#image-results[aria-busy=false]'));
  document.querySelector('#image-query').value='slow';const pending=searchImages();await until(()=>staleResolve);document.querySelector('#pick-frame').click();await until(()=>document.querySelector('.asset-card[data-kind="frame"]'));staleResolve();await pending;
  check(document.querySelectorAll('.asset-card').length===12,'stale illustration response replaced frame menu');
  check(!requests.some(p=>p.startsWith('/api/entries')),'generic CMF search still used');
  const legacy=projectForSave();legacy.canvas.width*=2;legacy.canvas.height*=2;for(const l of legacy.layers){l.x*=2;l.y*=2;l.width*=2;l.height*=2;}
  await importProject(legacy);check(composition.canvas.width===450&&composition.canvas.height===640&&composition.layers.find(l=>l.gameIllustration).width===450,'old settings were not adapted to the fixed game layout');
  document.querySelector('#new-project').click();check(composition.canvas.width===450&&composition.canvas.height===640,'new project lost game dimensions');
  includeParticles=true;await applyGameFrame(true,5);playing=false;
  check(composition.version===3&&composition.layers.length===2,'mark particle plan not loaded');
  const mark=composition.layers.find(l=>!l.markParent),effect=composition.layers.find(l=>l.markParent);
  check(effect.markParent===mark.id&&effect.animation.particle.mask,'mark attachment or mask missing');
  mark.x=20;mark.y=30;mark.width=8;mark.height=8;
  const before=makeExportCanvas(.5).toDataURL(),saved=projectForSave();
  await importProject(saved);playing=false;
  check(makeExportCanvas(.5).toDataURL()===before,'mark particles or mask changed after restore');
  check(composition.layers[1].markParent===composition.layers[0].id,'restored mark parent id was not remapped');
  const scaled=projectForSave();scaled.canvas.width*=2;scaled.canvas.height*=2;const parent=scaled.layers.find(l=>!l.markParent);parent.x*=2;parent.y*=2;parent.width*=2;parent.height*=2;
  await importProject(scaled);playing=false;check(makeExportCanvas(.5).toDataURL()===before,'canvas normalization scaled attached effects twice');
  const actualDownload=downloadBlob,downloads=[];downloadBlob=(blob,name)=>downloads.push({blob,name});
  check(document.querySelector('#animation-format').value==='webp','lossless WebP should be the default');
  document.querySelector('#animation-format').value='apng';
  document.querySelector('#animation-duration').value='3';document.querySelector('#animation-fps').value='25';
  await exportAnimation();downloadBlob=actualDownload;
  const decoded=new ImageDecoder({data:await downloads[0].blob.arrayBuffer(),type:'image/png'});await decoded.tracks.ready;
  check(downloads[0].name==='closers-composition.apng'&&decoded.tracks.selectedTrack.frameCount===75,'default export should contain 75 frames');decoded.close();
  check(document.querySelector('#animation-preview').open&&document.querySelector('#animation-preview-info').textContent.includes('75프레임 · 25 FPS · 3초'),'export playback preview or frame count missing');
  const preview=await (await nativeFetch(document.querySelector('#animation-preview-image').src)).blob();
  const hash=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');
  check(await hash(preview)===await hash(downloads[0].blob),'preview does not use the downloaded APNG');
  document.querySelector('#close-animation-preview').click();await until(()=>!document.querySelector('#animation-preview-image').hasAttribute('src'));
  downloadBlob=(blob,name)=>downloads.push({blob,name});document.querySelector('#animation-format').value='webp';
  await exportAnimation();downloadBlob=actualDownload;
  const webpDecoded=new ImageDecoder({data:await downloads[1].blob.arrayBuffer(),type:'image/webp'});await webpDecoded.tracks.ready;
  check(downloads[1].name==='closers-composition.webp'&&webpDecoded.tracks.selectedTrack.frameCount===75,'WebP export dropped frames');
  const last=await webpDecoded.decode({frameIndex:74});check(last.image.duration===40000,'WebP frame duration');last.image.close();webpDecoded.close();
  const originalDecoder=new ImageDecoder({data:await downloads[0].blob.arrayBuffer(),type:'image/png'}),convertedDecoder=new ImageDecoder({data:await downloads[1].blob.arrayBuffer(),type:'image/webp'});
  for(const index of [0,12,49,74]){
    const pixels=async decoder=>{const {image}=await decoder.decode({frameIndex:index});const c=new OffscreenCanvas(450,640),ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();return ctx.getImageData(0,0,40,50).data;};
    const original=await pixels(originalDecoder),converted=await pixels(convertedDecoder);
    check(original.every((v,i)=>v===converted[i]),'WebP changed browser-decoded colors or alpha at frame '+index);
  }
  originalDecoder.close();convertedDecoder.close();
  check(document.querySelector('#animation-preview-info').textContent.startsWith('WebP · 75프레임'),'WebP preview format missing');
  document.querySelector('#close-animation-preview').click();await until(()=>!document.querySelector('#animation-preview-image').hasAttribute('src'));
  selectedLayer=composition.layers.find(l=>!l.markParent).id;document.querySelector('#duplicate-layer').click();
  check(composition.layers.length===4&&composition.layers[3].markParent===composition.layers[2].id,'duplicating a mark lost its effects');
  document.querySelector('#remove-layer').click();check(composition.layers.length===2,'deleting a duplicated mark removed the original effects');
  selectedLayer=composition.layers.find(l=>!l.markParent).id;document.querySelector('#remove-layer').click();check(composition.layers.length===0,'deleting a mark left orphaned effects');
  document.body.dataset.checks='passed';
}catch(error){errors.push(error.stack||String(error));document.body.dataset.checks='failed';}
const pre=document.createElement('pre');pre.textContent=errors.join('\n');document.body.append(pre);
