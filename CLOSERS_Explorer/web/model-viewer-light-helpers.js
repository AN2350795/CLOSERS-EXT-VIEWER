import * as THREE from './vendor/three/three.module.min.js';

// An independent overlay scene keeps guides out of model bounds, emission,
// depth-of-field and source-color passes. Only edits rebuild the line geometry.
export function createViewerLightHelpers(){
  const scene=new THREE.Scene(),icons=new THREE.Scene();let signature='',disposed=false;
  function iconTexture(target){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=96;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#111823dd';ctx.beginPath();ctx.arc(48,48,40,0,Math.PI*2);ctx.fill();ctx.lineWidth=5;ctx.strokeStyle=target?'#77e6ff':'#ffe18b';ctx.lineCap='round';
    ctx.beginPath();ctx.arc(48,48,target?23:15,0,Math.PI*2);ctx.stroke();
    if(target){ctx.beginPath();ctx.arc(48,48,7,0,Math.PI*2);ctx.stroke();for(const [x,y] of [[1,0],[-1,0],[0,1],[0,-1]]){ctx.beginPath();ctx.moveTo(48+x*16,48+y*16);ctx.lineTo(48+x*33,48+y*33);ctx.stroke();}}
    else for(let i=0;i<8;i++){const a=i*Math.PI/4;ctx.beginPath();ctx.moveTo(48+Math.cos(a)*25,48+Math.sin(a)*25);ctx.lineTo(48+Math.cos(a)*34,48+Math.sin(a)*34);ctx.stroke();}
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
  }
  const sun=iconTexture(false),targetIcon=iconTexture(true);
  function clear(){
    for(const child of [...scene.children]){child.geometry.dispose();child.material.dispose();scene.remove(child);}
    for(const sprite of [...icons.children]){sprite.material.dispose();icons.remove(sprite);}
  }
  function update(settings,hasModel){
    if(disposed)return;
    scene.visible=settings.showHelpers&&hasModel;
    icons.visible=settings.showIcons===true&&hasModel;
    const next=JSON.stringify([settings.enabled,settings.selected,settings.gizmoTarget,settings.lights]);
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
      function icon(point,isTarget){
        const selected=index===settings.selected&&isTarget===(settings.gizmoTarget==='target');
        const material=new THREE.SpriteMaterial({map:isTarget?targetIcon:sun,transparent:true,opacity:selected?1:Math.max(.5,opacity),depthTest:false,depthWrite:false,toneMapped:false});
        const sprite=new THREE.Sprite(material);sprite.position.copy(point);sprite.renderOrder=selected?2:1;sprite.userData={viewerLightIndex:index,kind:isTarget?'target-icon':'light-icon',selected};icons.add(sprite);
        sprite.onBeforeRender=(renderer,world,camera)=>{
          const height=renderer.domElement.getBoundingClientRect().height;if(!height)return;
          const depth=-sprite.position.clone().applyMatrix4(camera.matrixWorldInverse).z;
          if(depth<=camera.near){sprite.material.opacity=0;return;}sprite.material.opacity=selected?1:Math.max(.5,opacity);
          const worldHeight=camera.isPerspectiveCamera?2*depth*Math.tan(camera.fov*Math.PI/360)/camera.zoom:(camera.top-camera.bottom)/camera.zoom;
          sprite.scale.setScalar(worldHeight*(selected?34:28)/height);
          sprite.updateMatrixWorld();
        };
      }
      icon(position,false);if(light.type!=='point')icon(target,true);
      function lines(vertices,color,selected){
        if(!vertices.length)return;
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
        const material=new THREE.LineBasicMaterial({color,transparent:true,opacity,depthTest:false,depthWrite:false,toneMapped:false});
        const object=new THREE.LineSegments(geometry,material);object.userData={viewerLightIndex:index,selected,kind:selected?'selection':light.type};scene.add(object);
      }
      lines(points,light.color,false);lines(markers,'#ffffff',true);
    }
  }
  function draw(renderer,camera,world){
    if(disposed||!world.visible||!world.children.length)return;
    const autoClear=renderer.autoClear;
    try{renderer.autoClear=false;renderer.render(world,camera);}finally{renderer.autoClear=autoClear;}
  }
  return {scene,icons,update,render:(renderer,camera)=>draw(renderer,camera,scene),renderIcons:(renderer,camera)=>draw(renderer,camera,icons),dispose(){if(disposed)return;disposed=true;clear();sun.dispose();targetIcon.dispose();}};
}
