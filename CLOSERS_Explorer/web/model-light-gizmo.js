import * as THREE from './vendor/three/three.module.min.js';

// World-space translation with screen-sized handles. This scene is rendered
// after postprocessing and never enters model bounds or auxiliary depth passes.
export function createLightGizmo({camera,canvas,onChange,onCommit}){
  const scene=new THREE.Scene(),root=new THREE.Group();scene.add(root);
  const raycaster=new THREE.Raycaster(),plane=new THREE.Plane(),hit=new THREE.Vector3(),axes=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)];
  const pickers=[],handles=[],resources=new Set();let active=false,disposed=false,drag=null,owner=null,key='',hover=null;
  function mesh(geometry,color,parent){
    const material=new THREE.MeshBasicMaterial({color,depthTest:false,depthWrite:false,toneMapped:false,transparent:true});
    const object=new THREE.Mesh(geometry,material);parent.add(object);resources.add(geometry);resources.add(material);return object;
  }
  for(const [index,color] of [0xef5350,0x66bb6a,0x42a5f5].entries()){
    const group=new THREE.Group();root.add(group);handles.push(group);
    const shaft=mesh(new THREE.CylinderGeometry(.018,.018,.72,8),color,group);shaft.position.y=.46;
    const arrow=mesh(new THREE.ConeGeometry(.075,.2,12),color,group);arrow.position.y=.92;
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),axes[index]);
    const picker=mesh(new THREE.CylinderGeometry(.09,.09,1,8),color,group);picker.position.y=.52;picker.material.visible=false;picker.userData.axis=index;pickers.push(picker);
  }
  const center=mesh(new THREE.BoxGeometry(.13,.13,.13),0xffffff,root);center.userData.axis=3;pickers.push(center);
  function ray(event){const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return false;camera.updateMatrixWorld(true);raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);return true;}
  function layout(){
    if(!active||disposed)return;
    camera.updateMatrixWorld(true);
    const height=canvas.getBoundingClientRect().height;if(height<=0)return;
    const view=root.position.clone().applyMatrix4(camera.matrixWorldInverse),inFront=-view.z>camera.near&&-view.z<camera.far;
    root.visible=inFront;if(!inFront)return;
    const worldHeight=camera.isPerspectiveCamera?2*(-view.z)*Math.tan(camera.fov*Math.PI/360)/camera.zoom:(camera.top-camera.bottom)/camera.zoom;
    root.scale.setScalar(worldHeight*85/height);
    const eye=camera.isPerspectiveCamera?camera.getWorldPosition(new THREE.Vector3()).sub(root.position).normalize():camera.getWorldDirection(new THREE.Vector3()).negate();
    handles.forEach((group,i)=>{group.visible=Math.abs(eye.dot(axes[i]))<.98;group.children.forEach(o=>{o.material.opacity=hover===i?1:.85;});});
    root.updateMatrixWorld(true);
  }
  function pick(event){
    layout();if(!active||!root.visible||!ray(event))return null;
    if(raycaster.intersectObject(center,false).length)return 3;
    const visible=pickers.filter((picker,i)=>i===3||handles[i].visible);
    return raycaster.intersectObjects(visible,false)[0]?.object.userData.axis??null;
  }
  function consume(event){event.preventDefault();event.stopImmediatePropagation();}
  function finish(cancel=false){
    if(!drag)return;const previous=drag;drag=null;
    if(cancel){root.position.copy(previous.origin);onChange(previous.origin.toArray());}else onCommit();
    if(canvas.hasPointerCapture?.(previous.id))canvas.releasePointerCapture(previous.id);
    canvas.style.cursor='';hover=null;
  }
  function down(event){
    if(drag){consume(event);return;}
    if(event.button!==0||!active)return;const axis=pick(event);if(axis===null)return;
    const normal=camera.getWorldDirection(new THREE.Vector3());
    if(axis<3)normal.addScaledVector(axes[axis],-normal.dot(axes[axis]));
    if(normal.lengthSq()<1e-8)return;normal.normalize();plane.setFromNormalAndCoplanarPoint(normal,root.position);
    if(!raycaster.ray.intersectPlane(plane,hit))return;
    consume(event);drag={id:event.pointerId,axis,origin:root.position.clone(),start:hit.clone()};hover=axis;canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';
  }
  function move(event){
    if(drag){
      if(event.pointerId!==drag.id){consume(event);return;}consume(event);
      if(!ray(event)||!raycaster.ray.intersectPlane(plane,hit))return;
      const delta=hit.clone().sub(drag.start);
      if(drag.axis<3){const distance=delta.dot(axes[drag.axis]);delta.copy(axes[drag.axis]).multiplyScalar(distance);}
      const value=drag.origin.clone().add(delta);value.clampScalar(-100000,100000);root.position.copy(value);onChange(value.toArray());
    }else{
      const axis=pick(event);if(axis!==null||hover!==null){hover=axis;canvas.style.cursor=axis===null?'':'grab';}
    }
  }
  function up(event){if(drag?.id===event.pointerId){consume(event);finish(false);}}
  function cancel(event){if(drag?.id===event.pointerId){consume(event);finish(true);}}
  function lost(event){if(drag?.id===event.pointerId)finish(true);}
  function wheel(event){if(drag)consume(event);}
  function keyboard(event){if(drag&&event.key==='Escape'){consume(event);finish(true);}}
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['lostpointercapture',lost],['wheel',wheel]];
  for(const [name,fn] of listeners)canvas.addEventListener(name,fn,{capture:true,passive:false});
  canvas.ownerDocument.addEventListener('keydown',keyboard,true);
  return {
    scene,
    update({enabled,position,model,selection}){
      if(disposed)return;
      if(drag&&(!enabled||owner!==model||key!==selection))finish(true);
      owner=model;key=selection;active=enabled;root.visible=enabled;
      if(!drag)root.position.fromArray(position);if(!active){hover=null;canvas.style.cursor='';}
    },
    render(renderer){
      if(!active||disposed)return;layout();if(!root.visible)return;
      const autoClear=renderer.autoClear;try{renderer.autoClear=false;renderer.render(scene,camera);}finally{renderer.autoClear=autoClear;}
    },
    cancel:()=>finish(true),
    dispose(){if(disposed)return;finish(true);disposed=true;for(const [name,fn] of listeners)canvas.removeEventListener(name,fn,true);canvas.ownerDocument.removeEventListener('keydown',keyboard,true);for(const resource of resources)resource.dispose();scene.clear();canvas.style.cursor='';},
  };
}
