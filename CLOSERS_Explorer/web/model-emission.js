import * as THREE from './vendor/three/three.module.min.js';
import {colorGradingFragment,normalizeColorGrading} from './model-color-grading.js';
import {sharpenFragment,normalizeSharpen} from './model-sharpen.js';
import {createSourceBloom} from './model-bloom.js';
import {createDofPipeline,normalizeDof,dofFocal,supportsDofModel} from './model-dof.js';

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
  const combined=new THREE.WebGLRenderTarget(1,1,{type:THREE.UnsignedByteType,depthBuffer:false,stencilBuffer:false});
  const sharpened=combined.clone();
  let sourceBloom=null,dofPipeline=null;
  base.samples=mask.samples=renderer.getContext().getContextAttributes()?.antialias?Math.min(4,renderer.capabilities.maxSamples):0;
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1),scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry);scene.add(quad);quad.frustumCulled=false;
  const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
  const sharp=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{image:{value:null},imageSize:{value:new THREE.Vector2(1,1)},radius:{value:0}},vertexShader,fragmentShader:sharpenFragment});
  const blur=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{image:{value:null},direction:{value:new THREE.Vector2()}},vertexShader,fragmentShader:`varying vec2 vUv;uniform sampler2D image;uniform vec2 direction;
void main(){vec3 color=texture2D(image,vUv).rgb*.227027;
color+=(texture2D(image,vUv+direction*1.384615).rgb+texture2D(image,vUv-direction*1.384615).rgb)*.316216;
color+=(texture2D(image,vUv+direction*3.230769).rgb+texture2D(image,vUv-direction*3.230769).rgb)*.070270;
gl_FragColor=vec4(color,1.0);}`});
  const composite=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{baseImage:{value:null},glowImage:{value:null},sourceMode:{value:false},sourceLayers:{value:[null,null,null,null,null]},strength:{value:0},exposure:{value:1},avatarGradeEnabled:{value:false},avatarGradeRgb:{value:new THREE.Vector3(1,1,1)},avatarGradeBcs:{value:new THREE.Vector3(0,0,1)}},vertexShader,fragmentShader:`varying vec2 vUv;uniform sampler2D baseImage;uniform sampler2D glowImage;uniform bool sourceMode;uniform sampler2D sourceLayers[5];uniform float strength;uniform float exposure;
${colorGradingFragment}
void main(){vec4 original=texture2D(baseImage,vUv);vec3 glow=texture2D(glowImage,vUv).rgb;
if(sourceMode){glow=texture2D(sourceLayers[0],vUv).rgb+texture2D(sourceLayers[1],vUv).rgb+texture2D(sourceLayers[2],vUv).rgb+texture2D(sourceLayers[3],vUv).rgb+texture2D(sourceLayers[4],vUv).rgb;}
vec3 result=original.rgb+glow*strength;if(sourceMode)result=clamp(result,0.0,1.0);gl_FragColor=vec4(result*exposure,original.a);
gl_FragColor=avatarGrade(gl_FragColor);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
  quad.material.dispose();quad.material=blur;
  function render(world,view,model,{bloom=true,bloomMode='viewer',solo=false,strength=.8,exposure=1,colorGrading=null,sharpen=null,dof=null}={}){
    const materials=model?.materials||[],ready=materials.some(m=>m.userData.materialPreview?.uniforms.avatarEmissiveMap.value);
    const active=materials.some(m=>m.userData.materialPreview?.uniforms.avatarMaterialEnabled.value>0);
    const grade=normalizeColorGrading(colorGrading),grading=!!model&&!solo&&grade.enabled;
    const sharpenSettings=normalizeSharpen(sharpen),sharpening=!!model&&!solo&&sharpenSettings.enabled&&sharpenSettings.radius>0;
    const focusSettings=normalizeDof(dof),focusRequested=!solo&&focusSettings.enabled&&focusSettings.strength>0&&!!dofFocal(focusSettings)&&supportsDofModel(model);
    if(!model||(!grading&&!sharpening&&!focusRequested&&!solo&&(!ready||!bloom||!active))){renderer.render(world,view);return;}
    renderer.getDrawingBufferSize(size);if(size.x<1||size.y<1)return;if(base.width!==size.x||base.height!==size.y){base.setSize(size.x,size.y);mask.setSize(size.x,size.y);horizontal.setSize(Math.max(1,Math.ceil(size.x/2)),Math.max(1,Math.ceil(size.y/2)));vertical.setSize(horizontal.width,horizontal.height);}
    const source=bloomMode==='source'&&bloom&&!solo&&ready&&active&&size.x>=32&&size.y>=32?(sourceBloom??=createSourceBloom(base.samples)):null;
    if(source)source.resize(size.x,size.y);
    const focusing=focusRequested&&size.x>=4&&size.y>=4;
    const frameBase=source?.base||base,frameMask=source?.mask||mask,suppressed=[];
    const output=renderer.getRenderTarget(),background=world.background,clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),autoClear=renderer.autoClear,hidden=[];
    function finish(){
      if(sharpening||focusing||(source&&grading)){
        if(combined.width!==size.x||combined.height!==size.y){combined.setSize(size.x,size.y);sharpened.setSize(size.x,size.y);}
        // Source Glow -> Edge -> DOF -> ColorGrading, with UNORM8 intermediates.
        composite.uniforms.avatarGradeEnabled.value=false;renderer.setRenderTarget(combined);renderer.render(scene,camera);
        if(sharpening){
          quad.material=sharp;sharp.uniforms.image.value=combined.texture;sharp.uniforms.imageSize.value.copy(size);sharp.uniforms.radius.value=sharpenSettings.radius;
          renderer.setRenderTarget(sharpened);renderer.render(scene,camera);
        }
        let finished=sharpening?sharpened.texture:combined.texture;
        if(focusing){dofPipeline??=createDofPipeline(renderer);finished=dofPipeline.render(world,view,model,finished,focusSettings,size.x,size.y,(material,target)=>{quad.material=material;renderer.setRenderTarget(target);renderer.render(scene,camera);});}
        quad.material=composite;composite.uniforms.sourceMode.value=false;composite.uniforms.baseImage.value=finished;composite.uniforms.glowImage.value=finished;composite.uniforms.strength.value=0;composite.uniforms.exposure.value=1;composite.uniforms.avatarGradeEnabled.value=grading;
      }
      renderer.setRenderTarget(output);renderer.render(scene,camera);
    }
    try{
      renderer.autoClear=true;
      composite.uniforms.sourceMode.value=!!source;if(source)composite.uniforms.sourceLayers.value=source.layers;
      composite.uniforms.avatarGradeEnabled.value=grading;composite.uniforms.avatarGradeRgb.value.fromArray(grade.rgb);composite.uniforms.avatarGradeBcs.value.fromArray(grade.bcs);
      if(!solo){
        // Source surface output excludes emission; restore every uniform before
        // the mask pass and also on exceptions, without saving user settings.
        if(source)for(const m of materials){const u=m.userData.materialPreview?.uniforms.avatarMaterialEnabled;if(u){suppressed.push([u,u.value]);u.value=0;}}
        renderer.setRenderTarget(frameBase);renderer.render(world,view);
        for(const [u,value] of suppressed)u.value=value;
      }
      if(!solo&&(!ready||!bloom||!active)){
        quad.material=composite;composite.uniforms.baseImage.value=base.texture;composite.uniforms.glowImage.value=base.texture;composite.uniforms.strength.value=0;composite.uniforms.exposure.value=1;finish();return;
      }
      for(const child of world.children)if(child!==model.root&&child.visible){hidden.push(child);child.visible=false;}
      world.background=null;renderer.setClearColor(0x000000,1);
      for(const m of materials)if(m.userData.avatarLighting)m.userData.avatarLighting.avatarEmissionPass.value=1;
      renderer.setRenderTarget(frameMask);renderer.render(world,view);
      for(const m of materials)if(m.userData.avatarLighting)m.userData.avatarLighting.avatarEmissionPass.value=0;
      world.background=background;for(const child of hidden)child.visible=true;
      if(source)source.render((material,target)=>{quad.material=material;renderer.setRenderTarget(target);renderer.render(scene,camera);});
      else if(bloom){quad.material=blur;blur.uniforms.image.value=mask.texture;blur.uniforms.direction.value.set(2/mask.width,0);renderer.setRenderTarget(horizontal);renderer.render(scene,camera);blur.uniforms.image.value=horizontal.texture;blur.uniforms.direction.value.set(0,1/horizontal.height);renderer.setRenderTarget(vertical);renderer.render(scene,camera);}
      quad.material=composite;composite.uniforms.baseImage.value=solo?frameMask.texture:frameBase.texture;composite.uniforms.glowImage.value=source?source.layers[0]:vertical.texture;composite.uniforms.strength.value=bloom?strength:0;composite.uniforms.exposure.value=solo?exposure:1;finish();
    }finally{for(const [u,value] of suppressed)u.value=value;for(const m of materials)if(m.userData.avatarLighting)m.userData.avatarLighting.avatarEmissionPass.value=0;world.background=background;for(const child of hidden)child.visible=true;renderer.setClearColor(clear,alpha);renderer.setRenderTarget(output);renderer.autoClear=autoClear;}
  }
  return {render,dispose(){dofPipeline?.dispose();sourceBloom?.dispose();for(const t of [base,mask,horizontal,vertical,combined,sharpened])t.dispose();geometry.dispose();blur.dispose();composite.dispose();sharp.dispose();}};
}
