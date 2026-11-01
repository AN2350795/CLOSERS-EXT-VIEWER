import * as THREE from './vendor/three/three.module.min.js';

// Investigated Glow mode 1: five progressive UNORM8 H/V pairs, nine taps,
// offsets in each destination's pixels. The avatar input remains a viewer
// emission/depth approximation, not the game's complete scene MRT1.
export function createSourceBloom(samples=0){
  const make=depth=>new THREE.WebGLRenderTarget(1,1,{type:THREE.UnsignedByteType,depthBuffer:depth,stencilBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  const base=make(true),mask=make(true);base.samples=mask.samples=samples;
  const pairs=Array.from({length:5},()=>[make(false),make(false)]);
  const weights=Array.from({length:9},(_,i)=>Math.exp(-((i-4)**2)/2)/Math.sqrt(6.2831854820251465));
  const blur=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending,
    uniforms:{image:{value:null},direction:{value:new THREE.Vector2()},weights:{value:weights}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:'varying vec2 vUv;uniform sampler2D image;uniform vec2 direction;uniform float weights[9];void main(){vec3 color=vec3(0.0);for(int i=0;i<9;i++){color+=texture2D(image,vUv+float(i-4)*direction).rgb*weights[i];}gl_FragColor=vec4(clamp(color,0.0,1.0),1.0);}'});
  return {base,mask,layers:pairs.map(pair=>pair[1].texture),
    resize(width,height){
      if(width<32||height<32)return false;
      if(base.width===width&&base.height===height)return true;
      base.setSize(width,height);mask.setSize(width,height);
      pairs.forEach((pair,i)=>pair.forEach(t=>t.setSize(Math.floor(width/2**(i+1)),Math.floor(height/2**(i+1)))));
      return true;
    },
    render(draw){
      let input=mask.texture;
      for(const [horizontal,vertical] of pairs){
        blur.uniforms.image.value=input;blur.uniforms.direction.value.set(1/horizontal.width,0);draw(blur,horizontal);
        blur.uniforms.image.value=horizontal.texture;blur.uniforms.direction.value.set(0,1/vertical.height);draw(blur,vertical);
        input=vertical.texture;
      }
    },
    dispose(){for(const t of [base,mask,...pairs.flat()])t.dispose();blur.dispose();}
  };
}
