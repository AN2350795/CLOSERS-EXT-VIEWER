import * as THREE from './vendor/three/three.module.min.js';
import {TransformControls} from './vendor/three/addons/TransformControls.js';

// Upstream controls own picking, drag planes, axis constraints and snapping.
// This adapter bridges viewer state, orbit arbitration and edit transactions.
export function createLightGizmo({camera,canvas,onChange,onRotate,onCommit}){
  const scene=new THREE.Scene(),anchor=new THREE.Object3D();scene.add(anchor);
  const controls=new TransformControls(camera),helper=controls.getHelper();scene.add(helper);
  // Use capture-phase events instead of the default bubble listeners: orbit
  // shares this canvas. Assign domElement for the upstream dispose lifecycle.
  controls.domElement=canvas;controls.setMode('translate');controls.setSpace('world');
  for(const axis of ['X','Y','Z']){controls['min'+axis]=-100000;controls['max'+axis]=100000;}
  controls.attach(anchor);
  const touchAction=canvas.style.touchAction;canvas.style.touchAction='none';
  let active=false,disposed=false,drag=null,owner=null,key='',handleSize=1;
  function changed(){if(controls.mode==='rotate')onRotate?.(anchor.quaternion.toArray());else onChange(anchor.position.toArray());}
  controls.addEventListener('objectChange',changed);
  function pointer(event,button=event.button){
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return null;
    return {x:(event.clientX-rect.left)/rect.width*2-1,y:-(event.clientY-rect.top)/rect.height*2+1,button};
  }
  function layout(){
    if(!active||disposed)return false;
    camera.updateMatrixWorld(true);
    const height=canvas.getBoundingClientRect().height,view=anchor.position.clone().applyMatrix4(camera.matrixWorldInverse);
    helper.visible=height>0&&-view.z>camera.near&&-view.z<camera.far;
    if(!helper.visible)return false;
    const worldHeight=camera.isPerspectiveCamera?2*(-view.z)*Math.tan(camera.fov*Math.PI/360)/camera.zoom:(camera.top-camera.bottom)/camera.zoom;
    handleSize=drag?drag.size:worldHeight*85/height;
    const factor=camera.isOrthographicCamera?worldHeight:anchor.position.distanceTo(camera.getWorldPosition(new THREE.Vector3()))*Math.min(1.9*Math.tan(camera.fov*Math.PI/360)/camera.zoom,7);
    // Upstream arrow tips sit at +/-0.5, keeping their length near 85 CSS px.
    controls.setSize(8*handleSize/Math.max(factor,1e-10));scene.updateMatrixWorld(true);return true;
  }
  function consume(event){event.preventDefault();event.stopImmediatePropagation();}
  function finish(cancel=false){
    if(!drag)return;const previous=drag;drag=null;
    controls.pointerUp({button:0});
    if(cancel){anchor.position.copy(previous.origin);anchor.quaternion.copy(previous.quaternion);changed();}else onCommit();
    if(canvas.hasPointerCapture?.(previous.id))canvas.releasePointerCapture(previous.id);
    canvas.style.cursor='';
  }
  function down(event){
    if(drag){consume(event);return;}
    if(event.button!==0||!layout())return;const p=pointer(event);if(!p)return;
    controls.pointerHover(p);if(!controls.axis)return;
    scene.updateMatrixWorld(true);const origin=anchor.position.clone(),quaternion=anchor.quaternion.clone();controls.pointerDown(p);
    if(!controls.dragging)return;
    consume(event);drag={id:event.pointerId,origin,quaternion,size:handleSize};canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';
  }
  function move(event){
    if(drag){
      consume(event);if(event.pointerId!==drag.id)return;const p=pointer(event,-1);if(p)controls.pointerMove(p);
    }else if(active&&layout()){
      const p=pointer(event);if(p)controls.pointerHover(p);canvas.style.cursor=controls.axis?'grab':'';
    }
  }
  function up(event){if(drag?.id===event.pointerId){move(event);finish(false);}}
  function cancel(event){if(drag?.id===event.pointerId){consume(event);finish(true);}}
  function lost(event){if(drag?.id===event.pointerId)finish(true);}
  function wheel(event){if(drag)consume(event);}
  function keyboard(event){if(drag&&event.key==='Escape'){consume(event);finish(true);}}
  function blur(){finish(true);}
  function visibility(){if(canvas.ownerDocument.hidden)finish(true);}
  function documentMove(event){if(drag)move(event);}
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['lostpointercapture',lost],['wheel',wheel]];
  for(const [name,fn] of listeners)canvas.addEventListener(name,fn,{capture:true,passive:false});
  const doc=canvas.ownerDocument;
  doc.addEventListener('keydown',keyboard,true);doc.addEventListener('pointermove',documentMove,{capture:true,passive:false});doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',cancel,true);doc.addEventListener('visibilitychange',visibility);doc.defaultView.addEventListener('blur',blur);
  return {
    scene,controls,get handleSize(){return handleSize;},
    update({enabled,position,model,selection,snap=0,mode='translate',quaternion=[0,0,0,1],rotationSnap=0}){
      if(disposed)return;
      if(drag&&(!enabled||owner!==model||key!==selection||controls.mode!==mode||controls.translationSnap!==(snap||null)||controls.rotationSnap!==(rotationSnap||null)))finish(true);
      owner=model;key=selection;active=enabled;helper.visible=enabled;controls.enabled=enabled;controls.setTranslationSnap(snap>0?snap:null);
      controls.setMode(mode);controls.setRotationSnap(rotationSnap>0?rotationSnap:null);
      if(!drag){anchor.position.fromArray(position);anchor.quaternion.fromArray(quaternion);}
      if(!active){controls.axis=null;canvas.style.cursor='';}
    },
    render(renderer){
      if(!layout())return;const autoClear=renderer.autoClear;
      try{renderer.autoClear=false;renderer.render(scene,camera);}finally{renderer.autoClear=autoClear;}
    },
    cancel:()=>finish(true),
    dispose(){
      if(disposed)return;finish(true);disposed=true;
      for(const [name,fn] of listeners)canvas.removeEventListener(name,fn,true);
      doc.removeEventListener('keydown',keyboard,true);doc.removeEventListener('pointermove',documentMove,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',cancel,true);doc.removeEventListener('visibilitychange',visibility);doc.defaultView.removeEventListener('blur',blur);
      controls.detach();controls.dispose();scene.clear();canvas.style.touchAction=touchAction;canvas.style.cursor='';
    },
  };
}
