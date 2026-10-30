import * as THREE from './vendor/three/three.module.min.js';

// Keep input sampling and output transfer paired for the explicit raw-UNORM
// comparison. Reused GPU-cache entries must follow the active frame's domain.
export function applyAvatarColorSpace(renderer,textures,sourceColor=false){
  renderer.outputColorSpace=sourceColor?THREE.LinearSRGBColorSpace:THREE.SRGBColorSpace;
  for(const [key,map] of textures){
    const role=key.split(':')[0],color=!sourceColor&&(role==='base'||role==='second');
    const space=color?THREE.SRGBColorSpace:THREE.NoColorSpace;
    if(map.colorSpace!==space){map.colorSpace=space;map.needsUpdate=true;}
  }
}

// Selective avatar emission, including the avatar's own depth occlusion. White
// clothing, backgrounds and motion particles are never a bloom brightness mask.
export function createEmissionRenderer(renderer){
  const type=renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType;
  const target=depth=>new THREE.WebGLRenderTarget(1,1,{type,depthBuffer:depth,stencilBuffer:false});
  const base=target(true),mask=target(true),horizontal=target(false),vertical=target(false),size=new THREE.Vector2();
  base.samples=mask.samples=renderer.getContext().getContextAttributes()?.antialias?Math.min(4,renderer.capabilities.maxSamples):0;
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1),scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry);scene.add(quad);quad.frustumCulled=false;
  const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
  const blur=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{image:{value:null},direction:{value:new THREE.Vector2()}},vertexShader,fragmentShader:`varying vec2 vUv;uniform sampler2D image;uniform vec2 direction;
void main(){vec3 color=texture2D(image,vUv).rgb*.227027;
color+=(texture2D(image,vUv+direction*1.384615).rgb+texture2D(image,vUv-direction*1.384615).rgb)*.316216;
color+=(texture2D(image,vUv+direction*3.230769).rgb+texture2D(image,vUv-direction*3.230769).rgb)*.070270;
gl_FragColor=vec4(color,1.0);}`});
  const composite=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{baseImage:{value:null},glowImage:{value:null},strength:{value:0},exposure:{value:1}},vertexShader,fragmentShader:`varying vec2 vUv;uniform sampler2D baseImage;uniform sampler2D glowImage;uniform float strength;uniform float exposure;
void main(){vec4 original=texture2D(baseImage,vUv);gl_FragColor=vec4((original.rgb+texture2D(glowImage,vUv).rgb*strength)*exposure,original.a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
  quad.material.dispose();quad.material=blur;
  function render(world,view,model,{bloom=true,solo=false,strength=.8,exposure=1}={}){
    const materials=model?.materials||[],ready=materials.some(m=>m.userData.materialPreview?.uniforms.avatarEmissiveMap.value);
    const active=materials.some(m=>m.userData.materialPreview?.uniforms.avatarMaterialEnabled.value>0);
    if(!model||(!solo&&(!ready||!bloom||!active))){renderer.render(world,view);return;}
    renderer.getDrawingBufferSize(size);if(size.x<1||size.y<1)return;if(base.width!==size.x||base.height!==size.y){base.setSize(size.x,size.y);mask.setSize(size.x,size.y);horizontal.setSize(Math.max(1,Math.ceil(size.x/2)),Math.max(1,Math.ceil(size.y/2)));vertical.setSize(horizontal.width,horizontal.height);}
    const output=renderer.getRenderTarget(),background=world.background,clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),autoClear=renderer.autoClear,hidden=[];
    try{
      renderer.autoClear=true;
      if(!solo){renderer.setRenderTarget(base);renderer.render(world,view);}
      for(const child of world.children)if(child!==model.root&&child.visible){hidden.push(child);child.visible=false;}
      world.background=null;renderer.setClearColor(0x000000,1);
      for(const m of materials)if(m.userData.avatarLighting)m.userData.avatarLighting.avatarEmissionPass.value=1;
      renderer.setRenderTarget(mask);renderer.render(world,view);
      for(const m of materials)if(m.userData.avatarLighting)m.userData.avatarLighting.avatarEmissionPass.value=0;
      world.background=background;for(const child of hidden)child.visible=true;
      if(bloom){quad.material=blur;blur.uniforms.image.value=mask.texture;blur.uniforms.direction.value.set(2/mask.width,0);renderer.setRenderTarget(horizontal);renderer.render(scene,camera);blur.uniforms.image.value=horizontal.texture;blur.uniforms.direction.value.set(0,1/horizontal.height);renderer.setRenderTarget(vertical);renderer.render(scene,camera);}
      quad.material=composite;composite.uniforms.baseImage.value=solo?mask.texture:base.texture;composite.uniforms.glowImage.value=vertical.texture;composite.uniforms.strength.value=bloom?strength:0;composite.uniforms.exposure.value=solo?exposure:1;renderer.setRenderTarget(output);renderer.render(scene,camera);
    }finally{for(const m of materials)if(m.userData.avatarLighting)m.userData.avatarLighting.avatarEmissionPass.value=0;world.background=background;for(const child of hidden)child.visible=true;renderer.setClearColor(clear,alpha);renderer.setRenderTarget(output);renderer.autoClear=autoClear;}
  }
  return {render,dispose(){for(const t of [base,mask,horizontal,vertical])t.dispose();geometry.dispose();blur.dispose();composite.dispose();}};
}
