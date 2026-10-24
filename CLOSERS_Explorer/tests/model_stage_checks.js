import * as THREE from '/vendor/three/three.module.min.js';
import {setupModelStage} from '/model-stage.js';
import {setupViewerLayout} from '/model-picker.js';

const $=id=>document.getElementById(id),key='closers-model-stage-v1';
const check=(value,message)=>{if(!value)throw Error(message);};
const change=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event('change'));};
const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out');};
try{
  // Match production image policy: saved data must be decoded via a blob URL.
  const policy=document.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content="img-src 'self' blob:";document.head.append(policy);
  localStorage.removeItem(key);setupViewerLayout();
  const scene=new THREE.Scene(),stage=setupModelStage({scene});stage.resize(800,400);
  check($('stage-background').value==='studio','default studio');
  const renderer=new THREE.WebGLRenderer({canvas:$('model-canvas'),preserveDrawingBuffer:true});renderer.setSize(80,40,false);
  const camera=new THREE.PerspectiveCamera(40,2,.1,100);camera.position.set(0,2,5);camera.lookAt(0,1,0);
  const pixel=()=>{renderer.render(scene,camera);const data=new Uint8Array(4);renderer.getContext().readPixels(40,20,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,data);return [...data];};
  const studio=pixel();change('stage-background','light');const light=pixel();change('stage-background','dark');const dark=pixel();
  check(light[0]>studio[0]&&studio[0]>dark[0],'preset changes reach actual WebGL output');
  change('stage-background','gray');const gray=pixel();check(Math.max(...gray.slice(0,3))-Math.min(...gray.slice(0,3))<=1,'neutral background');
  change('stage-background','original');const original=pixel();check(Math.abs(original[0]-17)<=1&&Math.abs(original[1]-24)<=1,'original background preserved');
  change('stage-background','custom');$('stage-color').value='#ff0000';$('stage-color').dispatchEvent(new Event('input'));check(pixel()[0]>250&&pixel()[1]<2,'custom color');
  stage.resize(400,800);change('stage-background','light');
  check(pixel()[0]>200,'background updates after uploaded texture changes dimensions');
  check(renderer.getContext().getError()===renderer.getContext().NO_ERROR,'resizing background has no GPU errors');
  for(const [width,height] of [[1280,720],[320,800],[844,390],[400,800]]){
    const previous=scene.background;let released=false;previous.addEventListener('dispose',()=>released=true);
    stage.resize(width,height);check(released&&scene.background!==previous,'resize replaces and releases GPU texture');
    for(const preset of ['studio','gray','light','dark','original','custom']){
      change('stage-background',preset);const actual=pixel();
      check(actual[3]===255&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'all presets render after resize: '+preset);
    }
  }
  change('stage-background','custom');
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,4,2),new THREE.MeshBasicMaterial());mesh.position.set(3,2,1);mesh.updateMatrixWorld();
  stage.fit({meshes:[mesh]});check(stage.shadow.visible&&stage.shadow.position.y<0&&stage.shadow.position.x===3,'shadow placed under model bounds');
  $('stage-shadow').checked=false;$('stage-shadow').dispatchEvent(new Event('change'));check(!stage.shadow.visible,'shadow toggle');
  stage.dispose();const restored=setupModelStage({scene});check($('stage-background').value==='custom'&&$('stage-color').value==='#ff0000'&&!$('stage-shadow').checked,'settings restored');
  const image=document.createElement('canvas');image.width=40;image.height=80;const ctx=image.getContext('2d');ctx.fillStyle='#00ff00';ctx.fillRect(0,0,40,80);
  const blob=await new Promise(r=>image.toBlob(r,'image/png')),transfer=new DataTransfer();transfer.items.add(new File([blob],'background.png',{type:'image/png'}));
  change('stage-background','image');$('stage-image').files=transfer.files;$('stage-image').dispatchEvent(new Event('change'));
  await until(()=>JSON.parse(localStorage.getItem(key)).image);await until(()=>{const c=scene.background.image;return c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data[1]>240;});
  check(pixel()[1]>240&&pixel()[0]<10,'uploaded image reaches WebGL output');
  restored.resize(800,400);await until(()=>scene.background.image.getContext('2d').getImageData(400,200,1,1).data[1]>240);
  check(pixel()[1]>240&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'image renders after GPU texture resize');
  check(scene.background.image.getContext('2d').getImageData(5,200,1,1).data[1]<200,'portrait image fits without stretching or cropping');
  restored.dispose();const imageRestored=setupModelStage({scene});await until(()=>scene.background.image.getContext('2d').getImageData(512,512,1,1).data[1]>240);
  check(pixel()[1]>240,'restored image reaches WebGL output');
  check($('stage-background').value==='image','image restored under production image CSP');
  imageRestored.fit({meshes:[mesh]});imageRestored.fit(null);check(!imageRestored.shadow.visible,'clear hides ground');
  $('stage-reset').click();check($('stage-background').value==='studio'&&$('stage-shadow').checked&&!JSON.parse(localStorage.getItem(key)).image,'reset clears image and restores defaults');
  imageRestored.dispose();check(scene.background===null&&!scene.children.length,'stage resources removed');
  localStorage.setItem(key,'{"preset":"custom","color":"invalid"}');const sanitized=setupModelStage({scene});check($('stage-color').value==='#687382','invalid saved color recovered');sanitized.dispose();
  localStorage.removeItem(key);renderer.dispose();mesh.geometry.dispose();mesh.material.dispose();
  document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
