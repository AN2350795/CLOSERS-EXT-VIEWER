import * as THREE from './vendor/three/three.module.min.js';
import {buildModel,setAvatarBaseMap} from './model-core.js';

// Four visible image jobs at a time. HTTP revalidation owns source freshness;
// decoded images belong to the current DOM, with no retained page-lifetime copies.
// A preview never changes the main viewer or makes an ambiguous source choice.
export function setupPreviews({api}){
  let renderer,running=0,stopped=false,generation=0;
  const queue=[],active=new Set();
  const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);queue.push(entry.target);pump();}},{root:document.getElementById('model-results'),rootMargin:'80px'});
  function placeholder(target,mode,missing=false){
    const shape=mode==='eyes'?'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>':mode==='accessories'?'<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"/>':'<path d="m12 3 9 5v8l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v8"/>';
    target.classList.add('is-placeholder');target.setAttribute('role','img');target.setAttribute('aria-label',missing?'아이콘 없음':'아이콘 불러오는 중');
    target.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">'+shape+'</svg>';
    if(missing){const caption=document.createElement('span');caption.className='preview-caption';caption.textContent='아이콘 없음';target.append(caption);}
  }
  async function image(src,signal){
    const img=new Image();
    let abort,timer;
    const cancelled=new Promise((_,reject)=>{
      abort=()=>{img.removeAttribute('src');reject(new DOMException('미리보기 요청 취소','AbortError'));};
      signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(abort,15000);
    });
    try{img.src=src;await Promise.race([img.decode(),cancelled]);return img;}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
  }
  async function render(item,mode,saved,signal){
    if(item.preview_entry){
      const token=document.querySelector('meta[name="explorer-token"]').content;
      const src='/api/media/'+item.preview_entry+'?'+new URLSearchParams({token});
      try{return await image(src,signal);}catch(e){if(signal.aborted)throw e;return null;}
    }
    if(item.item_icon?.sha256){
      const token=document.querySelector('meta[name="explorer-token"]').content;
      const src='/api/model-icon/'+encodeURIComponent(item.item_icon.sha256)+'?'+new URLSearchParams({token});
      try{return await image(src,signal);}catch(e){if(signal.aborted)throw e;/* 아이콘을 불러오지 못하면 빈 상태를 표시합니다. */}
    }
    // 목록 로딩 비용을 줄이기 위해 아이콘이 없을 때의 3D 미리보기 생성을 사용하지 않습니다.
    // 나중에 다시 사용할 수 있도록 구현을 보존합니다. 재활성화 시 아래 호출을 복원하세요.
    // return renderModelPreview(item,mode,saved);
    return null;
  }
  async function renderModelPreview(item,mode,saved){
    let ids,skeleton;
    if(mode==='sets'){
      const bundle=await api('/api/model-bundle?'+new URLSearchParams({key:item.key,saved}));
      const slots=bundle.slots.filter(s=>s.checked);
      if(slots.some(s=>!s.selected)||bundle.motion.candidates.length>1||bundle.face.candidates?.length>1)throw Error('출처 선택 필요');
      ids=slots.map(s=>s.selected);
      if(bundle.face.selected&&!ids.includes(bundle.face.selected))ids.push(bundle.face.selected);
      skeleton=bundle.motion.selected;
    }else ids=[item.id];
    if(!ids.length||ids.length>16)throw Error('부위 확인 필요');
    const data=await api('/api/model-scene?'+new URLSearchParams({entries:ids.join(','),...(skeleton?{skeleton}:{} )}));
    if(stopped)throw Error('미리보기 종료');
    const model=buildModel(data),textures=[];
    try{
      if(!renderer){renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(160,180);renderer.setPixelRatio(1);renderer.setClearColor(0x111823);renderer.outputColorSpace=THREE.SRGBColorSpace;}
      const loader=new THREE.TextureLoader(),maps=new Map();let pixels=0;
      for(const material of model.materials){
        const info=material.userData.input.image;
        if(!info)continue;
        if(!info.selected)throw Error(info.candidates.length?'텍스처 출처 선택 필요':'텍스처 없음');
        if(!maps.has(info.selected)){
          const image=await api('/api/composition-source/'+info.selected);
          pixels+=image.width*image.height;if(pixels>32*1024*1024)throw Error('텍스처 용량 초과');
          const token=document.querySelector('meta[name="explorer-token"]').content;
          const map=await loader.loadAsync('/api/composition-image/'+info.selected+'?'+new URLSearchParams({token,sha256:image.image_sha256}));
          map.colorSpace=THREE.SRGBColorSpace;map.flipY=false;map.wrapS=map.wrapT=THREE.RepeatWrapping;textures.push(map);maps.set(info.selected,map);
        }
        setAvatarBaseMap(material,maps.get(info.selected));
      }
      if(stopped)throw Error('미리보기 종료');
      const scene=new THREE.Scene();scene.add(model.root);
      const bounds=new THREE.Box3();for(const mesh of model.meshes)if(mesh.visible)bounds.expandByObject(mesh,true);
      if(bounds.isEmpty())throw Error('표시할 메시 없음');
      const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),extent=Math.max(size.y,size.x*180/160,.01)*.6,distance=Math.max(size.length()*2,1);
      const camera=new THREE.OrthographicCamera(-extent*160/180,extent*160/180,extent,-extent,.01,distance*10);
      camera.position.copy(center).add(new THREE.Vector3(0,0,distance));camera.lookAt(center);renderer.render(scene,camera);
      return renderer.domElement.toDataURL('image/png');
    }finally{model.dispose();textures.forEach(t=>t.dispose());renderer?.renderLists.dispose();}
  }
  function pump(){
    while(queue.length&&running<4&&!stopped){
      const target=queue.shift();if(!target.isConnected||target.preview.generation!==generation)continue;
      running++;const controller=new AbortController();active.add(controller);
      const current=()=>!controller.signal.aborted&&target.isConnected&&target.preview.generation===generation;
      const {item,mode,saved}=target.preview;
      void (async()=>{
      try{
        const img=await render(item,mode,saved,controller.signal);
        if(!current())return;
        if(!img){placeholder(target,mode,true);target.title='표시할 아이템 아이콘이 없습니다.';return;}
        const icon=img.src.includes('/api/model-icon/')||item.preview_kind==='icon';img.alt=(item.label||item.display_name||item.name)+(mode==='eyes'?(item.preview_kind==='icon'?' 인게임 아이템 아이콘':' 눈동자 텍스처'):icon?' 인게임 아이템 아이콘':' 3D 미리보기');target.classList.remove('is-placeholder');target.removeAttribute('role');target.removeAttribute('aria-label');target.classList.toggle('is-item-icon',icon||mode==='eyes');if(mode==='eyes')target.title=img.alt;else if(icon)target.title=mode==='sets'?'의상 대표 · 인게임 '+(item.item_icon?.part_label||'부위')+' 아이콘':'인게임 아이템 아이콘';target.replaceChildren(img);
      }catch(e){if(current()){target.textContent=e.message;target.title='부위 구성을 열어 출처를 확인하세요.';}}
      finally{active.delete(controller);running--;pump();}
      })();
    }
  }
  function attach(row,item,mode,saved){const target=document.createElement('div');target.className='model-thumbnail';placeholder(target,mode);target.title='인게임 아이템 아이콘';target.preview={item,mode,saved,generation};row.prepend(target);observer.observe(target);}
  function reset(){generation++;observer.disconnect();queue.length=0;for(const controller of active)controller.abort();}
  window.addEventListener('pagehide',()=>{stopped=true;reset();renderer?.dispose();});
  return {attach,reset};
}
