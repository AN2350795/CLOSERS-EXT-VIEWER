import * as THREE from './vendor/three/three.module.min.js';

const storageKey='closers-model-stage-v1';
const presets={studio:['#505660','#272c34'],gray:['#777777','#777777'],light:['#f0eee9','#c7cbd0'],dark:['#303640','#141820'],original:['#111823','#111823']};
const defaults={preset:'studio',color:'#687382',shadow:true,grid:true,image:null};

export function setupModelStage({scene,root=document}){
  const $=id=>root.querySelector('#'+id);
  let settings={...defaults},disposed=false,imageVersion=0;
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey));
    if(saved&&Object.hasOwn({...presets,custom:1,image:1},saved.preset)){
      settings={...defaults,preset:saved.preset,shadow:saved.shadow!==false,grid:saved.grid!==false};
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
  // One small line mesh, anchored to the model's floor. Fade the boundary so
  // the floor reads as space rather than a rectangular platform.
  const positions=[],weights=[];
  for(let i=-20;i<=20;i++){
    positions.push(-20,0,i,20,0,i,i,0,-20,i,0,20);
    const opacity=i===0?.38:i%5===0?.27:.14;weights.push(opacity,opacity,opacity,opacity);
  }
  const gridGeometry=new THREE.BufferGeometry();gridGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));gridGeometry.setAttribute('lineOpacity',new THREE.Float32BufferAttribute(weights,1));
  const gridMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,uniforms:{lineColor:{value:new THREE.Color('#c1c4c9')}},
    vertexShader:'attribute float lineOpacity;varying float vOpacity;varying vec2 vFloor;void main(){vOpacity=lineOpacity;vFloor=position.xz/20.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform vec3 lineColor;varying float vOpacity;varying vec2 vFloor;void main(){float fade=1.0-smoothstep(0.35,1.0,length(vFloor));gl_FragColor=vec4(lineColor,vOpacity*fade);\n#include <colorspace_fragment>\n}'});
  const grid=new THREE.LineSegments(gridGeometry,gridMaterial);grid.name='viewer-floor-grid';grid.visible=false;scene.add(grid);shadow.renderOrder=1;
  let hasModel=false;
  function message(text){$('stage-message').textContent=text;}
  function save(){try{localStorage.setItem(storageKey,JSON.stringify(settings));message('');}catch{message('현재 화면에 적용했습니다. 브라우저 저장 공간이 부족하여 설정을 저장하지 못했습니다.');}}
  function draw(){
    const colors=settings.preset==='custom'?[settings.color,settings.color]:presets[settings.preset]||presets.studio;
    const tone=new THREE.Color(colors[0]);gridMaterial.uniforms.lineColor.value.set(tone.r*.2126+tone.g*.7152+tone.b*.0722>.35?'#43464b':'#c1c4c9');
    const {width,height}=canvas;
    const gradient=context.createRadialGradient(width*.5,height*.4,0,width*.5,height*.4,Math.max(width,height)*.75);
    gradient.addColorStop(0,colors[0]);gradient.addColorStop(1,colors[1]);
    context.fillStyle=gradient;context.fillRect(0,0,width,height);background.needsUpdate=true;
  }
  async function apply(){
    const version=++imageVersion;
    $('stage-background').value=settings.preset;$('stage-color').value=settings.color;$('stage-shadow').checked=settings.shadow;$('stage-grid').checked=settings.grid;
    $('stage-color-options').hidden=settings.preset!=='custom';$('stage-image-options').hidden=settings.preset!=='image';
    shadow.visible=hasModel&&settings.shadow;grid.visible=hasModel&&settings.grid;draw();scene.background=background;
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
  $('stage-grid').onchange=()=>{settings.grid=$('stage-grid').checked;save();void apply();};
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
    shadow,grid,
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
        if(hasModel){
          const size=bounds.getSize(new THREE.Vector3()),wanted=Math.max(size.x,size.y,size.z,.01)/10,base=10**Math.floor(Math.log10(wanted));
          const step=[1,2,5,10].find(n=>n*base>=wanted)*base;
          grid.position.set(shadow.position.x,shadow.position.y-Math.max(size.y*.001,.001),shadow.position.z);grid.scale.setScalar(step);
        }
      }
      shadow.visible=hasModel&&settings.shadow;
      grid.visible=hasModel&&settings.grid;
    },
    dispose(){disposed=true;imageVersion++;uploadVersion++;if(scene.background===background)scene.background=null;scene.remove(shadow,grid);shadow.geometry.dispose();shadow.material.dispose();shadowMap.dispose();gridGeometry.dispose();gridMaterial.dispose();background.dispose();}
  };
}
