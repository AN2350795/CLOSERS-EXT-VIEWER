import * as THREE from './vendor/three/three.module.min.js';
import {createDofDepthPass} from './model-dof-depth.js';

export function normalizeDof(value){
  const distance=n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=1e8?n:null;
  return {enabled:value?.enabled===true,focus:distance(value?.focus),range:distance(value?.range),strength:typeof value?.strength==='number'&&Number.isFinite(value.strength)&&value.strength>=0&&value.strength<=1?value.strength:1};
}
export function dofFocal(value){
  const p=normalizeDof(value);return p.focus!==null&&p.range!==null?[Math.max(0,p.focus-p.range),p.focus,p.focus+p.range,.5]:null;
}
export function supportsDofModel(model){return !!model?.materials?.length&&model.materials.every(m=>m.isMeshBasicMaterial&&[THREE.NormalBlending,THREE.NoBlending].includes(m.blending)&&m.depthTest&&m.depthWrite);}

// Measure drawable avatar triangles on demand, without including hidden meshes,
// unused vertices/bones or cached bind-pose boxes. This is a geometry bound;
// texture cutouts, camera occlusion and screen clipping are not sampled here.
export function measureDofFocus(model,camera){
  if(!model?.root||!camera)return null;
  model.root.updateWorldMatrix(true,false);model.root.updateMatrixWorld(true);camera.updateWorldMatrix(true,false);
  const bounds=new THREE.Box3(),point=new THREE.Vector3();
  for(const mesh of model.meshes||[]){
    let visible=true,attached=false;for(let parent=mesh;parent;parent=parent.parent){if(parent===model.root)attached=true;if(!parent.visible){visible=false;break;}}
    if(!attached||!visible||!camera.layers.test(mesh.layers))continue;
    const geometry=mesh.geometry,position=geometry?.getAttribute('position');if(!position)continue;
    const index=geometry.index,count=index?.count??position.count,draw=geometry.drawRange,visited=new Set();
    const groups=Array.isArray(mesh.material)?geometry.groups:[{start:0,count,materialIndex:0}];
    for(const group of groups){
      const material=Array.isArray(mesh.material)?mesh.material[group.materialIndex]:mesh.material;if(!material||!material.visible)continue;
      const start=Math.max(0,draw.start,group.start),end=Math.min(count,draw.start+draw.count,group.start+group.count);
      for(let offset=start;offset+2<end;offset+=3)for(let j=0;j<3;j++){
        const vertex=index?index.getX(offset+j):offset+j;if(visited.has(vertex))continue;visited.add(vertex);
        mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld);
        if(Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.z))bounds.expandByPoint(point);
      }
    }
  }
  if(bounds.isEmpty())return null;
  const center=bounds.getCenter(point),position=camera.getWorldPosition(new THREE.Vector3()),forward=camera.getWorldDirection(new THREE.Vector3()),focus=center.sub(position).dot(forward);
  const result=normalizeDof({focus,range:Math.max(bounds.getSize(new THREE.Vector3()).length()*.25,focus*.01,.01)});
  return dofFocal(result)?{focus:result.focus,range:result.range}:null;
}

const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
const disc=[[0,0],[.527837,-.085868],[-.040088,.536087],[-.670445,-.179949],[-.419418,-.616039],[.440453,-.639399],[-.757088,.349334],[.574619,.685879]];

// Manual viewer comparison: source H/V depth-in-alpha preparation and normal
// eight-tap gather, with base alpha retained and uncovered stage pixels sharp.
export function createDofPipeline(renderer){
  const depth=createDofDepthPass(renderer),make=()=>new THREE.WebGLRenderTarget(1,1,{type:THREE.UnsignedByteType,depthBuffer:false,stencilBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  const pairs=Array.from({length:2},()=>[make(),make()]),result=make();
  const weights=Array.from({length:9},(_,i)=>Math.exp(-((i-4)**2)/2)/Math.sqrt(6.2831854820251465));
  const blur=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending,vertexShader,
    uniforms:{image:{value:null},depthImage:{value:null},direction:{value:new THREE.Vector2()},seedDepth:{value:false},weights:{value:weights}},
    fragmentShader:'varying vec2 vUv;uniform sampler2D image;uniform sampler2D depthImage;uniform vec2 direction;uniform bool seedDepth;uniform float weights[9];void main(){vec4 color=vec4(0.0);for(int i=0;i<9;i++)color+=texture2D(image,vUv+float(i-4)*direction)*weights[i];color=clamp(color,0.0,1.0);if(seedDepth)color.a=texture2D(depthImage,vUv).r;gl_FragColor=color;}'});
  const gather=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending,vertexShader,
    uniforms:{image:{value:null},depthImage:{value:null},blurImage:{value:null},imageSize:{value:new THREE.Vector2()},disc:{value:disc.map(v=>new THREE.Vector2(...v))},strength:{value:1}},
    fragmentShader:`varying vec2 vUv;uniform sampler2D image;uniform sampler2D depthImage;uniform sampler2D blurImage;uniform vec2 imageSize;uniform vec2 disc[8];uniform float strength;
void main(){vec4 original=texture2D(image,vUv);vec4 center=texture2D(depthImage,vUv);if(center.a<0.5){gl_FragColor=original;return;}
float radius=abs(center.r-0.5);vec3 sum=vec3(0.0);float total=0.0;
for(int i=0;i<8;i++){
 vec4 coarse=texture2D(blurImage,vUv+disc[i]*radius*2.0/imageSize);
 vec2 uv=vUv+disc[i]*radius/imageSize;vec4 fine=vec4(texture2D(image,uv).rgb,texture2D(depthImage,uv).r);
 vec4 mixed=mix(fine,coarse,abs(2.0*fine.a-1.0));float weight=mixed.a>=center.r?1.0:abs(2.0*mixed.a-1.0);
 sum+=mixed.rgb*weight;total+=weight;
}
vec3 rgb=total>0.000001?sum/total:original.rgb;gl_FragColor=vec4(mix(original.rgb,rgb,strength),original.a);
}`});
  let disposed=false;
  function renderImages(image,depthImage,width,height,settings,draw){
    if(disposed)throw Error('종료된 DOF 비교입니다.');
    if(width<4||height<4)throw Error('DOF 비교 화면이 너무 작습니다.');
    if(result.width!==width||result.height!==height){result.setSize(width,height);pairs.forEach((pair,i)=>pair.forEach(t=>t.setSize(Math.floor(width/2**(i+1)),Math.floor(height/2**(i+1)))));}
    let input=image;blur.uniforms.depthImage.value=depthImage;
    for(let i=0;i<2;i++){
      const [h,v]=pairs[i];blur.uniforms.image.value=input;blur.uniforms.seedDepth.value=i===0;blur.uniforms.direction.value.set(1/h.width,0);draw(blur,h);
      blur.uniforms.image.value=h.texture;blur.uniforms.seedDepth.value=false;blur.uniforms.direction.value.set(0,1/v.height);draw(blur,v);input=v.texture;
    }
    gather.uniforms.image.value=image;gather.uniforms.depthImage.value=depthImage;gather.uniforms.blurImage.value=input;gather.uniforms.imageSize.value.set(width,height);gather.uniforms.strength.value=normalizeDof(settings).strength;draw(gather,result);return result.texture;
  }
  return {result,renderImages,
    render(world,camera,model,image,settings,width,height,draw,occluders=[]){const focal=dofFocal(settings);if(!focal)throw Error('DOF 초점 거리와 범위를 지정하세요.');return renderImages(image,depth.render(world,camera,model,focal,occluders).texture,width,height,settings,draw);},
    dispose(){if(disposed)return;disposed=true;depth.dispose();for(const target of [result,...pairs.flat()])target.dispose();blur.dispose();gather.dispose();}
  };
}
