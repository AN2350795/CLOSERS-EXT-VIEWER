import * as T from '/vendor/three/three.module.min.js';
const check=(v,m)=>{if(!v)throw Error(m);};
const renderer=new T.WebGLRenderer({alpha:true,premultipliedAlpha:false,antialias:false});renderer.setSize(32,24);renderer.outputColorSpace=T.LinearSRGBColorSpace;
const world=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.z=12;camera.updateMatrixWorld(true);
const geometry=new T.PlaneGeometry(1.5,1.5);geometry.setAttribute('particleAlpha',new T.InstancedBufferAttribute(new Float32Array([1]),1));
const white=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1),cutout=new T.DataTexture(new Uint8Array([255,255,255,0,255,255,255,255]),2,1);white.needsUpdate=cutout.needsUpdate=true;
// Reconstruct only the audited QUAD surface cutoff, view-depth encoding and
// two explicit alpha modes. Original game shaders are never executed.
const material=new T.ShaderMaterial({toneMapped:false,transparent:true,blending:T.CustomBlending,uniforms:{image:{value:white},depthOutput:{value:false},alphaMode:{value:0}},
  vertexShader:`attribute float particleAlpha;varying vec4 rgba;varying vec2 texcoord;varying float distanceZ;
void main(){vec4 p=modelViewMatrix*instanceMatrix*vec4(position,1.0);distanceZ=-p.z;rgba=vec4(instanceColor,particleAlpha);texcoord=uv;gl_Position=projectionMatrix*p;}`,
  fragmentShader:`uniform sampler2D image;uniform bool depthOutput;uniform float alphaMode;varying vec4 rgba;varying vec2 texcoord;varying float distanceZ;
void main(){vec4 surface=texture2D(image,texcoord)*rgba;if(surface.a<=1.0/255.0)surface=vec4(0.0);
if(depthOutput){float signal=distanceZ<4.0?(distanceZ-4.0)/4.0:min(max((distanceZ-4.0)/4.0,0.0),0.5);gl_FragColor=vec4(vec3(signal*0.5+0.5),alphaMode==1.0?surface.a*surface.r:surface.a);}else gl_FragColor=surface;}`});
material.blendEquation=material.blendEquationAlpha=T.AddEquation;material.blendSrcAlpha=material.blendDstAlpha=T.OneFactor;
const mesh=new T.InstancedMesh(geometry,material,1);mesh.frustumCulled=false;mesh.setColorAt(0,new T.Color(1,1,1));world.add(mesh);
const targets=[0,2].map(()=>new T.WebGLRenderTarget(32,24,{type:T.UnsignedByteType,depthBuffer:true,stencilBuffer:false}));
const factors={1:T.ZeroFactor,2:T.OneFactor,4:T.OneMinusSrcColorFactor,5:T.SrcAlphaFactor,6:T.OneMinusSrcAlphaFactor,7:T.DstAlphaFactor},matrix=new T.Matrix4(),errors=[];renderer.debug.onShaderError=()=>errors.push('shader');
let comparisons=0;
try{
  check(window.particleMrtCases.length===131,'diagnostic case count changed');
  for(const fixture of window.particleMrtCases)for(let output=0;output<2;output++){
    const depthOutput=output===1,target=targets[output],background=depthOutput?[.5,.5,.5,.15]:[.08,.12,.16,.2];
    renderer.setRenderTarget(target);renderer.setClearColor(new T.Color(...background.slice(0,3)),background[3]);renderer.clear();renderer.autoClear=false;
    let mode=fixture.mode;
    for(const layer of fixture.layers){
      if(layer.restore_before)mode=0;
      const [src,dst]=layer.blend,rewrite=(src===5&&(dst===7||dst===2))||(src===1&&dst===4)||(src===2&&dst===2);if(rewrite)mode=1;
      material.uniforms.depthOutput.value=depthOutput;material.uniforms.alphaMode.value=mode;material.uniforms.image.value=layer.cutout?cutout:white;
      material.depthTest=layer.depth_test;material.depthWrite=layer.depth_write;
      material.blendSrc=factors[depthOutput&&rewrite?5:src];material.blendDst=factors[depthOutput&&rewrite?6:dst];
      mesh.setMatrixAt(0,matrix.makeTranslation(0,0,12-layer.z));mesh.instanceMatrix.needsUpdate=true;mesh.setColorAt(0,new T.Color(...layer.rgba.slice(0,3)));mesh.instanceColor.needsUpdate=true;
      geometry.getAttribute('particleAlpha').setX(0,layer.rgba[3]);geometry.getAttribute('particleAlpha').needsUpdate=true;renderer.render(world,camera);
    }
    const pixels=new Uint8Array(32*24*4);renderer.readRenderTargetPixels(target,0,0,32,24,pixels);
    for(let sample=0;sample<3;sample++){
      const x=[12,20,1][sample],actual=pixels.slice((12*32+x)*4,(12*32+x)*4+4),expected=fixture.expected[output][sample];
      check(actual.every((v,i)=>Math.abs(v-expected[i])<=2),'MRT mismatch '+JSON.stringify({case:fixture.name,target:depthOutput?2:0,sample,actual:[...actual],expected}));comparisons++;
    }
  }
  check(comparisons===786&&errors.length===0&&renderer.getContext().getError()===renderer.getContext().NO_ERROR,'incomplete/error MRT checks');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{renderer.setRenderTarget(null);renderer.autoClear=true;for(const target of targets)target.dispose();mesh.dispose();geometry.dispose();material.dispose();white.dispose();cutout.dispose();renderer.dispose();}
