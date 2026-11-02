import * as T from '/vendor/three/three.module.min.js';
import {buildModel,setAvatarBaseMap} from '/model-core.js';
import {createEmissionRenderer} from '/model-emission.js';
import {setMatcapPreviewMap,setMatcapNormalMap,setMatcapPreview,setMaterialPreviewMap} from '/model-materials.js';
import {setAvatarLight} from '/model-lighting.js';
import {supportsDofModel} from '/model-dof.js';
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>a.every((v,i)=>v===b[i]),size=256;
const renderer=new T.WebGLRenderer({alpha:true,premultipliedAlpha:false,antialias:true,preserveDrawingBuffer:true});renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.setSize(size,size);renderer.setClearColor(0,0);
const fx=createEmissionRenderer(renderer),loader=new T.TextureLoader(),maps=new Map(),gl=renderer.getContext(),errors=[];renderer.debug.onShaderError=()=>errors.push('shader');
const white=new T.DataTexture(new Uint8Array([255,180,80,255]),1,1);white.needsUpdate=true;
const profile={color:[.9,.8,.7],direction:[.3,.4,-1],intensity:1},angles=[0,.65,Math.PI/2,Math.PI,-Math.PI/2];let model,beacon,cases=0,glossCases=0;window.testCaptures=[];window.alphaVariantResults=[];
try{
  for(const [id,body] of Object.entries(alphaVariants.images)){const map=await loader.loadAsync('data:image/png;base64,'+body);map.flipY=false;map.colorSpace=T.NoColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;maps.set(Number(id),map);}
  for(const fixture of alphaVariants.scenes){
    model=buildModel(fixture.data);const world=new T.Scene(),holder=new T.Group();world.add(holder);holder.add(model.root);
    for(const m of model.materials){const input=m.userData.input;if(input.image?.selected)setAvatarBaseMap(m,maps.get(input.image.selected));const cap=input.matcap_preview;if(cap){setMatcapPreviewMap(m,maps.get(cap.image?.selected)||null);setMatcapNormalMap(m,maps.get(cap.normal_image?.selected)||null);}}
    const expected=new Set(fixture.blended),overlays=model.materials.filter(m=>m.userData.avatarAlphaOverlay);
    check(overlays.length>0,'no shared-texture overlays '+fixture.label);
    for(const m of model.materials){const wanted=!!m.userData.avatarAlphaComponent&&expected.has(m.userData.input.image?.selected);check(m.userData.avatarAlphaOverlay===wanted,'wrong source/texture alpha classification '+fixture.label);if(!wanted)check(m.depthWrite,'opaque material lost depth writes '+fixture.label);}
    check(!supportsDofModel(model),'unsupported translucent DOF became active');
    const bounds=new T.Box3().setFromObject(model.root),center=bounds.getCenter(new T.Vector3()),extent=bounds.getSize(new T.Vector3()),half=Math.max(extent.y*.6,extent.x*.22),distance=extent.length()*2;
    // A controlled emitter exercises both real bloom pipelines. It is a test
    // fixture, not an emissive property invented for these source costumes.
    beacon=buildModel({frames:[],meshes:[{name:'test-emitter',frame:-1,vertices:[-.2,-.4,0,.2,-.4,0,.2,.4,0,-.2,.4,0],indices:[0,1,2,0,2,3],uv:[0,0,1,0,1,1,0,1],skin:[],groups:[[0,6,0]],materials:[{color:[.05,.05,.05,1],material_preview:{kind:'emissive',status:'approximate',color:[1,.5,.2,1],strength:.4}}]}]});beacon.root.scale.set(half,half,half);beacon.root.position.copy(center).add(new T.Vector3(-half*.65,0,-half*.3));holder.add(beacon.root);setMaterialPreviewMap(beacon.materials[0],white);
    const combined={root:holder,materials:[...model.materials,...beacon.materials],meshes:[...model.meshes,...beacon.meshes]};
    const camera=new T.OrthographicCamera(-half,half,half,-half,Math.max(.01,distance/1000),distance*4);
    const render=options=>{fx.render(world,camera,combined,{bloom:false,...options});const p=new Uint8Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
    let visibleViews=0;
    for(let view=0;view<angles.length;view++){
      const angle=angles[view];camera.position.copy(center).add(new T.Vector3(Math.sin(angle)*distance,0,Math.cos(angle)*distance));camera.lookAt(center);camera.updateMatrixWorld(true);
      for(const m of model.materials){setAvatarLight(m,null);setMatcapPreview(m,false);}
      const base=render({});check(base.some((v,i)=>i%4===3&&v>0),'empty source scene');
      if(view===0||view===3)window.testCaptures.push({name:fixture.label+'-'+(view===0?'front':'back'),body:renderer.domElement.toDataURL()});
      for(const m of overlays){m.transparent=false;m.depthWrite=true;m.needsUpdate=true;}const opaque=render({});for(const m of overlays){m.transparent=true;m.depthWrite=false;m.needsUpdate=true;}
      const changed=base.filter((v,i)=>i%4!==3&&Math.abs(v-opaque[i])>2).length;if(changed>100)visibleViews++;
      check(same(render({}),base),'opacity restoration changed pixels '+fixture.label+'/'+view);
      for(const mode of ['light','gloss','viewer','source','post']){
        for(const m of model.materials){setAvatarLight(m,profile,.5);setMatcapPreview(m,mode!=='light',.5,true);}
        if(mode==='gloss'&&model.materials.some(m=>m.userData.matcapPreview?.uniforms.avatarMatcapEnabled.value>0))glossCases++;
        const options={bloom:['viewer','source','post'].includes(mode),bloomMode:mode==='viewer'?'viewer':'source',...(mode==='post'?{colorGrading:{enabled:true,rgb:[.9,.95,1],bcs:[0,.1,.9]},sharpen:{enabled:true,radius:1}}:{})};
        const actual=render(options);for(let i=3;i<base.length;i+=4)check(Math.abs(actual[i]-base[i])<=1,'effect changed cloth coverage '+fixture.label+'/'+view+'/'+mode);
        check(model.materials.every(m=>!m.userData.avatarLighting.avatarEmissionPass.value),'emission pass leaked');
        if(mode==='post'&&view===0)window.testCaptures.push({name:fixture.label+'-combined',body:renderer.domElement.toDataURL()});cases++;
      }
      for(const m of model.materials){setAvatarLight(m,null);setMatcapPreview(m,false);}
      check(same(render({dof:{enabled:true,focus:distance*.5,range:half*.1,strength:1}}),base),'unsupported DOF changed translucent model');
      window.alphaVariantResults.push({fixture:fixture.label,view,changed});
    }
    check(visibleViews>=2,'transparent cloth was not visible from multiple views '+fixture.label);model.dispose();model=null;beacon.dispose();beacon=null;
  }
  check(cases===75&&glossCases>=5&&errors.length===0&&gl.getError()===gl.NO_ERROR,'incomplete source alpha/effect coverage');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{model?.dispose();beacon?.dispose();for(const map of maps.values())map.dispose();white.dispose();fx.dispose();renderer.dispose();}
