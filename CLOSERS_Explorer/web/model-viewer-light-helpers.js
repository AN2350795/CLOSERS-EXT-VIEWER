import * as THREE from './vendor/three/three.module.min.js';

// An independent overlay scene keeps guides out of model bounds, emission,
// depth-of-field and source-color passes. Only edits rebuild the line geometry.
export function createViewerLightHelpers(){
  const scene=new THREE.Scene();let signature='',disposed=false;
  function clear(){
    for(const child of [...scene.children]){child.geometry.dispose();child.material.dispose();scene.remove(child);}
  }
  function update(settings,hasModel){
    if(disposed)return;
    scene.visible=settings.showHelpers&&hasModel;
    const next=JSON.stringify([settings.enabled,settings.selected,settings.lights]);
    if(signature===next)return;signature=next;clear();
    for(const [index,light] of settings.lights.entries()){
      if(light.type==='ambient')continue;
      const points=[],markers=[],position=new THREE.Vector3(...light.position),target=new THREE.Vector3(...light.target),aim=target.clone().sub(position),length=aim.length();
      const direction=length>1e-8?aim.clone().divideScalar(length):new THREE.Vector3(0,-1,0);
      const side=new THREE.Vector3().crossVectors(direction,Math.abs(direction.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0)).normalize(),up=new THREE.Vector3().crossVectors(side,direction).normalize();
      const size=THREE.MathUtils.clamp((light.type==='directional'?length:light.distance)*.025,1,8);
      const segment=(a,b,list=points)=>list.push(a.x,a.y,a.z,b.x,b.y,b.z);
      const cross=(center,r,list)=>{for(const axis of [new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)])segment(center.clone().addScaledVector(axis,-r),center.clone().addScaledVector(axis,r),list);};
      function circle(center,x,y,r){
        for(let i=0;i<48;i++){const a=i*Math.PI/24,b=(i+1)*Math.PI/24;segment(center.clone().addScaledVector(x,Math.cos(a)*r).addScaledVector(y,Math.sin(a)*r),center.clone().addScaledVector(x,Math.cos(b)*r).addScaledVector(y,Math.sin(b)*r));}
      }
      cross(position,size,points);
      if(index===settings.selected)cross(position,size*1.6,markers);
      if(light.type==='point'){
        const x=new THREE.Vector3(1,0,0),y=new THREE.Vector3(0,1,0),z=new THREE.Vector3(0,0,1);
        circle(position,x,y,light.distance);circle(position,y,z,light.distance);circle(position,z,x,light.distance);
      }else{
        cross(target,size*.6,points);segment(position,target);
        if(length>1e-8){
          const arrowLength=Math.min(size*3,length*.25),base=target.clone().addScaledVector(direction,-arrowLength);
          for(const sign of [-1,1])segment(target,base.clone().addScaledVector(side,sign*arrowLength*.4));
          if(light.type==='spot'){
            // The shader's cutoff is a sphere, so cone edges have length
            // distance, not axial height distance (which would overstate range).
            const angle=light.angle*Math.PI/180,center=position.clone().addScaledVector(direction,light.distance*Math.cos(angle)),radius=light.distance*Math.sin(angle);
            circle(center,side,up,radius);
            for(let i=0;i<8;i++){const a=i*Math.PI/4;segment(position,center.clone().addScaledVector(side,Math.cos(a)*radius).addScaledVector(up,Math.sin(a)*radius));}
            segment(position,position.clone().addScaledVector(direction,light.distance));
          }
        }
      }
      const opacity=settings.enabled&&light.enabled?1:.3;
      function lines(vertices,color,selected){
        if(!vertices.length)return;
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
        const material=new THREE.LineBasicMaterial({color,transparent:true,opacity,depthTest:false,depthWrite:false,toneMapped:false});
        const object=new THREE.LineSegments(geometry,material);object.userData={viewerLightIndex:index,selected,kind:selected?'selection':light.type};scene.add(object);
      }
      lines(points,light.color,false);lines(markers,'#ffffff',true);
    }
  }
  function render(renderer,camera){
    if(disposed||!scene.visible||!scene.children.length)return;
    const autoClear=renderer.autoClear;
    try{renderer.autoClear=false;renderer.render(scene,camera);}finally{renderer.autoClear=autoClear;}
  }
  return {scene,update,render,dispose(){if(disposed)return;disposed=true;clear();}};
}
