import * as THREE from './vendor/three/three.module.min.js';

const storageKey='closers-model-stage-v1';
const presets={studio:['#505660','#272c34'],gray:['#777777','#777777'],light:['#f0eee9','#c7cbd0'],dark:['#303640','#141820'],original:['#111823','#111823']};
const defaults={preset:'studio',color:'#687382',shadow:true,image:null};

export function setupModelStage({scene,root=document}){
  const $=id=>root.querySelector('#'+id);
  let settings={...defaults},disposed=false,imageVersion=0;
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey));
    if(saved&&Object.hasOwn({...presets,custom:1,image:1},saved.preset)){
      settings={...defaults,preset:saved.preset,shadow:saved.shadow!==false};
      if(/^#[\da-f]{6}$/i.test(saved.color))settings.color=saved.color;
      if(typeof saved.image==='string'&&saved.image.startsWith('data:image/jpeg;base64,')&&saved.image.length<2000000)settings.image=saved.image;
      if(settings.preset==='image'&&!settings.image)settings.preset='studio';
    }
  }catch{}
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
  const context=canvas.getContext('2d');
  function createBackground(){
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;
    return texture;
  }
  let background=createBackground();
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;
  const shadowContext=shadowCanvas.getContext('2d'),gradient=shadowContext.createRadialGradient(64,64,0,64,64,64);
  gradient.addColorStop(0,'rgba(0,0,0,.32)');gradient.addColorStop(.35,'rgba(0,0,0,.22)');gradient.addColorStop(1,'rgba(0,0,0,0)');
  shadowContext.fillStyle=gradient;shadowContext.fillRect(0,0,128,128);
  const shadowMap=new THREE.CanvasTexture(shadowCanvas);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  shadow.name='viewer-ground-shadow';shadow.rotation.x=-Math.PI/2;shadow.visible=false;scene.add(shadow);
  let hasModel=false;
  function message(text){$('stage-message').textContent=text;}
  function save(){try{localStorage.setItem(storageKey,JSON.stringify(settings));message('');}catch{message('현재 화면에 적용했습니다. 브라우저 저장 공간이 부족하여 설정을 저장하지 못했습니다.');}}
  function draw(){
    const colors=settings.preset==='custom'?[settings.color,settings.color]:presets[settings.preset]||presets.studio;
    const {width,height}=canvas;
    const gradient=context.createRadialGradient(width*.5,height*.4,0,width*.5,height*.4,Math.max(width,height)*.75);
    gradient.addColorStop(0,colors[0]);gradient.addColorStop(1,colors[1]);
    context.fillStyle=gradient;context.fillRect(0,0,width,height);background.needsUpdate=true;
  }
  async function apply(){
    const version=++imageVersion;
    $('stage-background').value=settings.preset;$('stage-color').value=settings.color;$('stage-shadow').checked=settings.shadow;
    $('stage-remove-shadow').disabled=!settings.shadow;
    $('stage-color-options').hidden=settings.preset!=='custom';$('stage-image-options').hidden=settings.preset!=='image';
    shadow.visible=hasModel&&settings.shadow;draw();scene.background=background;
    if(settings.preset==='image'&&settings.image){
      const image=new Image();
      let url;
      try{
        const bytes=Uint8Array.from(atob(settings.image.split(',')[1]),c=>c.charCodeAt(0));
        url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));
        image.src=url;await image.decode();if(disposed||version!==imageVersion)return;
        // Fit the whole image; neutral margins preserve the original composition.
        const scale=Math.min(canvas.width/image.width,canvas.height/image.height),width=image.width*scale,height=image.height*scale;
        context.drawImage(image,(canvas.width-width)/2,(canvas.height-height)/2,width,height);background.needsUpdate=true;
      }catch{if(version===imageVersion)message('배경 이미지를 읽지 못했습니다. 다른 이미지를 선택해 주세요.');}
      finally{if(url)URL.revokeObjectURL(url);}
    }
  }
  $('stage-background').onchange=()=>{uploadVersion++;settings.preset=$('stage-background').value;save();void apply();};
  $('stage-color').oninput=()=>{settings.color=$('stage-color').value;save();void apply();};
  $('stage-shadow').onchange=()=>{settings.shadow=$('stage-shadow').checked;save();void apply();};
  $('stage-remove-shadow').onclick=()=>{settings.shadow=false;save();void apply();};
  let uploadVersion=0;
  $('stage-image').onchange=async()=>{
    const file=$('stage-image').files[0],version=++uploadVersion;if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024){message('20MB 이하의 PNG, JPEG, WebP 이미지를 선택해 주세요.');return;}
    const url=URL.createObjectURL(file),image=new Image();
    try{
      image.src=url;await image.decode();if(disposed||version!==uploadVersion)return;
      const resized=document.createElement('canvas'),scale=Math.min(1,1280/Math.max(image.width,image.height));
      resized.width=Math.max(1,Math.round(image.width*scale));resized.height=Math.max(1,Math.round(image.height*scale));
      const ctx=resized.getContext('2d');ctx.fillStyle='#303640';ctx.fillRect(0,0,resized.width,resized.height);ctx.drawImage(image,0,0,resized.width,resized.height);
      settings.image=resized.toDataURL('image/jpeg',.85);settings.preset='image';save();await apply();
    }catch{if(!disposed&&version===uploadVersion)message('배경 이미지를 읽지 못했습니다. 다른 이미지를 선택해 주세요.');}
    finally{URL.revokeObjectURL(url);$('stage-image').value='';}
  };
  $('stage-reset').onclick=()=>{uploadVersion++;settings={...defaults};save();void apply();};
  void apply();
  return {
    shadow,
    resize(width,height){
      if(width<=0||height<=0)return;
      const scale=Math.min(1,1280/Math.max(width,height));
      const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
      if(canvas.width===w&&canvas.height===h)return;
      // WebGL texture storage cannot be resized after its first upload.
      // Release the old allocation and create a texture for the new dimensions.
      background.dispose();canvas.width=w;canvas.height=h;
      background=createBackground();void apply();
    },
    fit(model){
      hasModel=!!model;
      if(model){
        const bounds=new THREE.Box3();for(const mesh of model.meshes)if(mesh.visible)bounds.expandByObject(mesh,true);
        hasModel=!bounds.isEmpty();
        if(hasModel){const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),diameter=Math.max(size.x,size.z,size.y*.4,.01)*1.6;
          shadow.position.set(center.x,bounds.min.y-Math.max(size.y*.001,.001),center.z);shadow.scale.set(diameter,diameter,1);}
      }
      shadow.visible=hasModel&&settings.shadow;
    },
    dispose(){disposed=true;imageVersion++;uploadVersion++;if(scene.background===background)scene.background=null;scene.remove(shadow);shadow.geometry.dispose();shadow.material.dispose();shadowMap.dispose();background.dispose();}
  };
}
