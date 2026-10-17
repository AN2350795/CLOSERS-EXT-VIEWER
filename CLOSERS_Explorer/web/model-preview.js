import * as THREE from './vendor/three/three.module.min.js';
import {buildModel} from './model-core.js';

// One offscreen renderer, one job at a time, and a bounded page-lifetime cache.
// A preview never changes the main viewer or makes an ambiguous source choice.
export function setupPreviews({api}){
  let renderer,running=false,stopped=false;
  const queue=[],cache=new Map();
  const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);queue.push(entry.target);pump();}},{root:document.getElementById('model-results'),rootMargin:'80px'});
  async function render(item,mode,saved){
    if(item.item_icon?.sha256){
      const token=document.querySelector('meta[name="explorer-token"]').content;
      const src='/api/model-icon/'+encodeURIComponent(item.item_icon.sha256)+'?'+new URLSearchParams({token});
      try{const image=new Image();image.src=src;await image.decode();return src;}catch{/* Keep the 3D preview when the icon is unavailable. */}
    }
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
        material.map=maps.get(info.selected);material.color.set(0xffffff);material.needsUpdate=true;
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
  async function pump(){
    if(running||stopped)return;running=true;
    try{while(queue.length&&!stopped){
      const target=queue.shift();if(!target.isConnected)continue;
      const {item,mode,saved}=target.preview;
      const key=JSON.stringify([mode,item.key||item.id,saved,item.item_icon?.sha256]);
      try{
        let src=cache.get(key);if(!src){src=await render(item,mode,saved);cache.set(key,src);if(cache.size>80)cache.delete(cache.keys().next().value);}
        if(target.isConnected){const icon=src.startsWith('/api/model-icon/'),img=document.createElement('img');img.src=src;img.alt=(item.label||item.display_name||item.name)+(icon?' 인게임 아이템 아이콘':' 3D 미리보기');target.classList.toggle('is-item-icon',icon);if(icon)target.title=mode==='sets'?'의상 대표 · 인게임 '+(item.item_icon.part_label||'부위')+' 아이콘':'인게임 아이템 아이콘';target.replaceChildren(img);if(icon){const badge=document.createElement('span');badge.className='thumbnail-caption';badge.textContent=mode==='sets'?(item.item_icon.part_label||'대표')+' 아이콘':'아이템 아이콘';target.append(badge);}}
      }catch(e){if(target.isConnected){target.textContent=e.message;target.title='부위 구성을 열어 출처를 확인하세요.';}}
    }}finally{running=false;}
  }
  function attach(row,item,mode,saved){const target=document.createElement('div');target.className='model-thumbnail';target.textContent='미리보기 대기';target.title=mode==='sets'?'사용 가능한 기본 부위로 만든 참고 미리보기':'원본 모델의 기본 자세 미리보기';target.preview={item,mode,saved};row.prepend(target);observer.observe(target);}
  function reset(){observer.disconnect();queue.length=0;}
  window.addEventListener('pagehide',()=>{stopped=true;reset();cache.clear();renderer?.dispose();});
  return {attach,reset};
}
