const errors=[];
try{
  for(const path of ['/particle-effects.js','/composition-core.js','/animation-png.js','/animation-loop.js'])await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=path;s.onload=resolve;s.onerror=reject;document.head.append(s);});
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const red=document.createElement('canvas'),blue=document.createElement('canvas');for(const [c,color] of [[red,'red'],[blue,'blue']]){c.width=4;c.height=4;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,4,4);}
  const source=key=>({key,archive:'a',ordinal:0,name:key+'.png',format:'png',source_sha256:'a'.repeat(64),image_sha256:'b'.repeat(64),width:4,height:4});
  const raw={schema:'closers-composition',version:1,kind:'composition',canvas:{width:4,height:4,transparent:true,color:'#000000'},sources:[source('s1'),source('s2')],layers:[{id:'l1',source:'s1',name:'effect',role:'fragment',gameFrame:true,x:0,y:0,width:4,height:4,crop:{x:0,y:0,width:4,height:4},opacity:1,visible:true,locked:false,keepRatio:true,animation:{delay:.1,blend:'source-over',color:[1,1,1,1],frames:[{source:'s1',duration:.1},{source:'s2',duration:.2}]}}]};
  const project=CompositionCore.validate(raw),images=new Map([['s1',red],['s2',blue]]);
  check(CompositionCore.usedSources(project.layers).size===2,'animation references were pruned');
  check(Math.abs(AnimationLoop.timings(project)[0].texture-.3)<1e-9,'game texture durations were not summed');
  const cycles={layers:[{visible:true,name:'top',animation:{delay:.49,frames:[{duration:.96} ,{duration:0}]}},{visible:true,name:'logo',animation:{delay:0,frames:[{duration:2.54},{duration:0}]}}]};
  check(AnimationLoop.textureCycle(cycles,25)===null,'different texture periods must not invent a short game cycle');
  cycles.layers[0].animation.frames=[{duration:.75},{duration:.75}];cycles.layers[1].animation.frames=[{duration:1.5},{duration:1.5}];
  check(AnimationLoop.textureCycle(cycles,25)===3,'common texture cycle');
  const ramp=time=>{const c=document.createElement('canvas');c.width=2;c.height=1;const ctx=c.getContext('2d');ctx.fillStyle='rgb(40,60,100)';ctx.fillRect(0,0,1,1);ctx.fillStyle=`rgb(${Math.round(50+time*10)},0,0)`;ctx.fillRect(1,0,1,1);return c;};
  const loopPlan=AnimationLoop.plan(project,3,25,true),loopRender=AnimationLoop.renderer(ramp,loopPlan),rawRender=AnimationLoop.renderer(ramp,AnimationLoop.plan(project,3,25,false));
  const loopPixel=(render,t)=>[...render(t).getContext('2d').getImageData(1,0,1,1).data];
  check(Math.abs(loopPixel(loopRender,0)[0]-loopPixel(loopRender,2.96)[0])<=1,'loop seam still jumps');
  check(Math.abs(loopPixel(rawRender,0)[0]-loopPixel(rawRender,2.96)[0])>20,'raw mode unexpectedly changed game timing');
  check(JSON.stringify(loopPixel(loopRender,0))===JSON.stringify(loopPixel(loopRender,3)),'loop endpoints differ');
  check(JSON.stringify([...loopRender(2.75).getContext('2d').getImageData(0,0,1,1).data])==='[40,60,100,255]','loop blend dimmed the static illustration');
  const alphaRender=time=>{const c=document.createElement('canvas');c.width=1;c.height=1;const ctx=c.getContext('2d');if(time>1){ctx.fillStyle='red';ctx.fillRect(0,0,1,1);}return c;};
  const blended=AnimationLoop.renderer(alphaRender,{warmup:1,period:2,blend:.5})(1.75).getContext('2d').getImageData(0,0,1,1).data;
  check(blended[0]===255&&blended[3]===128,'loop alpha interpolation was not premultiplied');
  const render=time=>{const c=document.createElement('canvas');c.width=4;c.height=4;CompositionCore.draw(c.getContext('2d'),project,images,4,4,time);return c;};
  const pixel=time=>[...render(time).getContext('2d').getImageData(0,0,1,1).data];
  check(pixel(0)[3]===0,'latency');check(pixel(.1)[0]===255,'first frame');check(pixel(.2)[2]===255,'boundary timing');check(pixel(.4)[0]===255,'sequence loop');
  const copy=CompositionCore.validate(JSON.parse(JSON.stringify(project)));check(copy.layers[0].gameFrame&&copy.layers[0].animation.frames.length===2,'animation settings round trip');
  const bad=JSON.parse(JSON.stringify(project));bad.layers[0].animation.frames[1].source='s9';let rejected=false;try{CompositionCore.validate(bad);}catch{rejected=true;}check(rejected,'missing animation source');
  const high=structuredClone(raw);high.canvas.width=450;high.canvas.height=640;
  high.sources[0].width=720;high.sources[0].height=1024;
  Object.assign(high.layers[0],{role:'illustration',gameIllustration:true,width:450,height:640,crop:{x:0,y:0,width:720,height:1024}});delete high.layers[0].animation;
  const native=CompositionCore.validate(high),nativeSize=CompositionCore.exportSize(native);
  check(nativeSize.width===720&&nativeSize.height===1024,'original illustration resolution was not preserved');
  const fineStripes=new OffscreenCanvas(720,1024),fineContext=fineStripes.getContext('2d');
  for(let x=0;x<720;x++){fineContext.fillStyle=x%2?'white':'black';fineContext.fillRect(x,0,1,1024);}
  const large=new OffscreenCanvas(720,1024);CompositionCore.draw(large.getContext('2d'),native,new Map([['s1',fineStripes]]),720,1024);
  const detail=large.getContext('2d').getImageData(0,500,720,1).data;
  check([...Array(720)].every((_,x)=>detail[x*4]===(x%2?255:0)),'export enlarged a low resolution intermediate image');
  native.layers.push({...raw.layers[0],animation:undefined,id:'l2',source:'s2',x:0,y:0,width:450,height:40});
  CompositionCore.draw(large.getContext('2d'),native,new Map([['s1',fineStripes],['s2',blue]]),720,1024);
  check(large.getContext('2d').getImageData(719,63,1,1).data[2]===255&&large.getContext('2d').getImageData(718,65,1,1).data[2]===0,'frame placement did not scale with the illustration');
  for(const [mode,w,h] of [['base',450,640],['double',900,1280],['custom',1080,1536]]){
    native.output={mode,width:1080};const size=CompositionCore.exportSize(native);check(size.width===w&&size.height===h,'output size '+mode);
    check(CompositionCore.validate(native).output.mode===mode,'output settings round trip '+mode);
  }
  native.output={mode:'custom',width:8192};let tooLarge=false;try{CompositionCore.exportSize(native);}catch{tooLarge=true;}check(tooLarge,'oversized output accepted');
  for(const output of [{mode:'invalid',width:720},{mode:'custom',width:NaN},{mode:'custom',width:0}]){
    high.output=output;let invalid=false;try{CompositionCore.validate(high);}catch{invalid=true;}check(invalid,'invalid output settings accepted');
  }
  const bgRaw=structuredClone(raw);bgRaw.layers=[];bgRaw.canvas.transparent=false;
  bgRaw.canvas.background={source:'s2',name:'game',crop:{x:0,y:0,width:4,height:4},x:0,y:0,width:4,height:4};
  const bgProject=CompositionCore.validate(bgRaw),bgCanvas=new OffscreenCanvas(8,8);
  CompositionCore.draw(bgCanvas.getContext('2d'),bgProject,images,8,8);
  check(bgProject.version===5&&bgCanvas.getContext('2d').getImageData(7,7,1,1).data[2]===255,'game background missing from scaled export');
  check(CompositionCore.usedSources([],bgProject.canvas).has('s2'),'background source omitted from persistence');
  const legacyBg=structuredClone(bgRaw);legacyBg.sources[1].name='UI_UNIT_CREATE_BG2_TEAM1.DDS';legacyBg.canvas.background.crop={x:1,y:0,width:2,height:4};
  check(CompositionCore.validate(legacyBg).canvas.background.fit==='cover','legacy background must preserve aspect');
  const square=new OffscreenCanvas(4,4),squareCtx=square.getContext('2d');squareCtx.fillStyle='black';squareCtx.fillRect(0,0,4,4);squareCtx.fillStyle='red';squareCtx.fillRect(1,1,2,2);
  const aspect=structuredClone(bgRaw);aspect.canvas.height=8;aspect.canvas.background.height=8;
  const tall=new OffscreenCanvas(4,8);CompositionCore.draw(tall.getContext('2d'),CompositionCore.validate(aspect),new Map([['s2',square]]),4,8);
  check(tall.getContext('2d').getImageData(0,3,1,1).data[0]>150&&tall.getContext('2d').getImageData(3,3,1,1).data[0]>150,'square emblem was horizontally compressed into a narrow card');
  for(const mutate of [p=>p.canvas.background.source='s99',p=>p.canvas.background.width=NaN,p=>p.canvas.transparent=true]){
    const invalid=structuredClone(bgRaw);mutate(invalid);let rejected=false;try{CompositionCore.validate(invalid);}catch{rejected=true;}check(rejected,'invalid background accepted');
  }
  const blob=await AnimationPNG.encode({width:4,height:4,count:4,fps:10,render,requireMotion:true});
  const decoder=new ImageDecoder({data:await blob.arrayBuffer(),type:'image/png'});await decoder.tracks.ready;check(decoder.tracks.selectedTrack.frameCount===4,'APNG frame count');
  for(let i=0;i<4;i++){const {image}=await decoder.decode({frameIndex:i});const c=new OffscreenCanvas(4,4),ctx=c.getContext('2d');ctx.drawImage(image,0,0);const actual=[...ctx.getImageData(0,0,1,1).data];check(JSON.stringify(actual)===JSON.stringify(pixel(i/10)),'APNG decoded pixels '+i);check(Math.abs(image.duration-100000)<1,'APNG timing');image.close();}decoder.close();
  let staticRejected=false;
  try{await AnimationPNG.encode({width:4,height:4,count:3,fps:10,render:()=>render(.1),requireMotion:true});}catch(e){staticRejected=e.message.includes('저장 구간에 화면 변화가 없어');}
  check(staticRejected,'identical rendered frames should not export as moving PNG');
  let delayedRejected=false;
  try{await AnimationPNG.encode({width:4,height:4,count:2,fps:60,render,requireMotion:true});}catch(e){delayedRejected=e.message.includes('저장 구간에 화면 변화가 없어');}
  check(delayedRejected,'export ending before the effect starts should report no motion');
  const initial=(property,value)=>({property,mode:'initial',value,start:0,end:null});
  const fade=(property,value,start,end)=>({property,mode:'fade',value,start,end});
  const particle={seed:123,life:2,maxParticles:2,rate:2,instant:1,emitterLife:10,deaths:0,radius:[0,0,0],radiusMin:0,gravity:[0,2,0],scale:[1,1],basis:[4,4],drawCount:1,dual:false,dualDrawCount:1,clamp:true,blend:['SRCALPHA','INVSRCALPHA'],tracks:[initial('size',[4,4,1]),initial('color',[1,1,1,1]),initial('velocity',[2,0,0]),fade('velocity',[6,0,0],0,2),initial('rotationSpeed',[0,0,10]),fade('size',[8,8,1],0,2)]};
  const warmProject={layers:[{visible:true,animation:{delay:.49,particle,frames:[{duration:1}]}}]};
  check(AnimationLoop.plan(warmProject,3,25,true).warmup>2.99,'continuous particle warm-up omitted the initial build-up');
  warmProject.layers[0].animation.particle={...particle,life:999999};check(AnimationLoop.plan(warmProject,3,25,true).warmup<1,'persistent plane life was treated as a warm-up duration');
  warmProject.layers[0].animation.particle={...particle,rate:0};check(AnimationLoop.plan(warmProject,3,25,true).warmup<1,'one-shot effect was skipped by warming past its life');
  const sampled=ParticleEffects.states(particle,1);
  check(sampled.length===2,'emitter particle cap');
  check(Math.abs(sampled[0].position[0]-3)<1e-6&&sampled[0].position[1]===1,'integrated velocity and gravity');
  check(sampled[0].size[0]===6&&sampled[0].rotation[2]===10,'size and rotation tracks');
  const radial=ParticleEffects.states({...particle,radius:[3,4,0],radiusMin:10},0)[0];
  check(radial.position[0]===9&&radial.position[1]===12,'minimum emission radius must extend the radial direction');
  check(ParticleEffects.states(particle,.25).length===1,'backwards timeline seek');
  const randomParticle={...particle,radius:[[-3,3],[-3,3],0],life:[.4,.8],instant:2};
  const randomState=ParticleEffects.states(randomParticle,2);
  check(JSON.stringify(randomState)===JSON.stringify(ParticleEffects.states(JSON.parse(JSON.stringify(randomParticle)),2)),'seeded particles must replay identically');
  const motionRaw=JSON.parse(JSON.stringify(raw));motionRaw.layers[0].animation={delay:0,blend:'source-over',color:[1,1,1,1],frames:[{source:'s1',duration:.1},{source:'s2',duration:.1}],particle:{...particle,maxParticles:1,instant:1,rate:0,gravity:[0,0,0],tracks:[initial('size',[4,4,1]),initial('color',[1,1,1,1])]}};
  let motion=CompositionCore.validate(motionRaw);
  check(motion.version===3,'particle schema version');
  const drawMotion=time=>{const c=document.createElement('canvas');c.width=4;c.height=4;CompositionCore.draw(c.getContext('2d'),motion,images,4,4,time);return c;};
  const motionPixel=t=>[...drawMotion(t).getContext('2d').getImageData(1,1,1,1).data];
  check(motionPixel(0)[0]>250&&motionPixel(.1)[2]>250,'WebGL texture animation rendering');
  const motionBlob=await AnimationPNG.encode({width:4,height:4,count:3,fps:10,render:drawMotion,requireMotion:true});
  const particleDecoder=new ImageDecoder({data:await motionBlob.arrayBuffer(),type:'image/png'});await particleDecoder.tracks.ready;
  for(let i=0;i<3;i++){const {image}=await particleDecoder.decode({frameIndex:i});const c=new OffscreenCanvas(4,4),ctx=c.getContext('2d');ctx.drawImage(image,0,0);check(JSON.stringify([...ctx.getImageData(1,1,1,1).data])===JSON.stringify(motionPixel(i/10)),'particle APNG matches preview '+i);image.close();}particleDecoder.close();
  motionRaw.layers[0].animation.frames=[{source:'s1',duration:1}];
  motionRaw.layers[0].animation.particle.mask='s2';
  motion=CompositionCore.validate(motionRaw);
  check(motionPixel(0)[0]<3,'RGB mask must affect the texture');
  check(CompositionCore.usedSources(motion.layers).has('s2'),'mask source was pruned');
  const missingMask=JSON.parse(JSON.stringify(motionRaw));missingMask.layers[0].animation.particle.mask='s9';
  let maskRejected=false;try{CompositionCore.validate(missingMask);}catch{maskRejected=true;}check(maskRejected,'missing mask must be rejected');
  motionRaw.layers[0].animation.particle.mask=undefined;motionRaw.canvas.transparent=false;motionRaw.canvas.color='#ff0000';motionRaw.layers[0].animation.frames=[{source:'s2',duration:1}];motionRaw.layers[0].animation.particle.blend=['ZERO','INVSRCCOLOR'];
  motion=CompositionCore.validate(motionRaw);check(motionPixel(0)[0]>250&&motionPixel(0)[2]<3,'inverse-source-color blend');
  motionRaw.layers[0].animation.particle.dual=true;motionRaw.layers[0].animation.particle.tracks.push(initial('dualColor',[1,1,1,.5]));
  motion=CompositionCore.validate(motionRaw);check(motionPixel(0)[0]>250&&Math.abs(motionPixel(0)[2]-128)<=2,'dual additive blending pass');
  motionRaw.layers[0].animation.particle.dual=false;motionRaw.layers[0].opacity=0;
  motion=CompositionCore.validate(motionRaw);check(motionPixel(0)[0]>250&&motionPixel(0)[2]<3,'zero-opacity inverse blend changed the canvas');
  // Opaque RGB reference: finish every inverse-color pass before any glow pass.
  // Per-particle base/glow interleaving incorrectly erases the earlier glow.
  const gray=value=>{const c=document.createElement('canvas');c.width=4;c.height=4;const ctx=c.getContext('2d');ctx.fillStyle=`rgb(${value},${value},${value})`;ctx.fillRect(0,0,4,4);return c;};
  const passImages=new Map([['s1',gray(128)],['s2',gray(64)]]),passRaw=JSON.parse(JSON.stringify(motionRaw));
  passRaw.canvas.color='#ffffff';passRaw.layers[0].opacity=1;
  passRaw.layers[0].animation.frames=[{source:'s1',duration:.2},{source:'s2',duration:.8}];
  passRaw.layers[0].animation.particle={...particle,life:10,maxParticles:2,instant:2,rate:0,gravity:[0,0,0],
    blend:['ZERO','INVSRCCOLOR'],dual:true,dualDrawCount:2,tracks:[initial('size',[4,4,1]),initial('color',[1,1,1,1]),initial('dualColor',[.2,.4,.6,.5])]};
  const clampByte=v=>Math.min(255,Math.max(0,Math.round(v)));
  const referencePasses=(textures,dual=true)=>{
    let rgb=[255,255,255];
    for(const value of textures)rgb=rgb.map(v=>clampByte(v*(1-value/255)));
    if(dual)for(const value of textures)for(let n=0;n<2;n++)rgb=rgb.map((v,i)=>clampByte(v+value*[.2,.4,.6][i]*.5));
    return [...rgb,255];
  };
  const passPixel=(project,time)=>{const c=document.createElement('canvas');c.width=4;c.height=4;CompositionCore.draw(c.getContext('2d'),project,passImages,4,4,time);return [...c.getContext('2d').getImageData(1,1,1,1).data];};
  const nearPixel=(actual,expected)=>actual.every((v,i)=>Math.abs(v-expected[i])<=2);
  const sameTexturePasses=CompositionCore.validate(passRaw);
  check(nearPixel(passPixel(sameTexturePasses,0),referencePasses([128,128])),'overlapping particles must finish all base passes before dual glow');
  passRaw.layers[0].animation.particle.instant=1;passRaw.layers[0].animation.particle.rate=2;
  const timedPasses=CompositionCore.validate(passRaw),timedStates=ParticleEffects.states(timedPasses.layers[0].animation.particle,.6);
  check(timedStates.length===2&&Math.abs(timedStates[0].age-.6)<1e-9&&Math.abs(timedStates[1].age-.1)<1e-9,'pass ordering changed particle ages');
  check(nearPixel(passPixel(timedPasses,.6),referencePasses([64,128])),'both passes must reuse each particle\'s own animation frame');
  passRaw.layers[0].animation.particle.dual=false;
  check(nearPixel(passPixel(CompositionCore.validate(passRaw),.6),referencePasses([64,128],false)),'non-dual particles changed');
  passRaw.layers[0].animation.particle.dual=true;passRaw.layers[0].opacity=0;
  check(nearPixel(passPixel(CompositionCore.validate(passRaw),.6),[255,255,255,255]),'hidden dual particles changed the canvas');
  const translucent=document.createElement('canvas');translucent.width=4;translucent.height=4;const translucentContext=translucent.getContext('2d');translucentContext.fillStyle='rgba(255,0,0,.5)';translucentContext.fillRect(0,0,4,4);
  const translucentBitmap=await createImageBitmap(await new Promise(resolve=>translucent.toBlob(resolve)),{premultiplyAlpha:'none',colorSpaceConversion:'none'});images.set('s1',translucentBitmap);
  motionRaw.canvas.transparent=true;motionRaw.layers[0].opacity=1;motionRaw.layers[0].animation.frames=[{source:'s1',duration:1}];motionRaw.layers[0].animation.particle.blend=['SRCALPHA','INVSRCALPHA'];
  motion=CompositionCore.validate(motionRaw);const translucentPixel=motionPixel(0);check(translucentPixel[0]>250&&Math.abs(translucentPixel[3]-128)<=1,'ImageBitmap alpha was multiplied twice');
  translucentBitmap.close();images.set('s1',red);
  const stripes=document.createElement('canvas');stripes.width=4;stripes.height=4;const stripeContext=stripes.getContext('2d');stripeContext.fillStyle='red';stripeContext.fillRect(0,0,2,4);stripeContext.fillStyle='blue';stripeContext.fillRect(2,0,2,4);images.set('s1',stripes);
  motionRaw.layers[0].animation.particle.life=4;motionRaw.layers[0].animation.particle.clamp=false;
  motionRaw.layers[0].animation.particle.tracks=[initial('size',[4,4,1]),initial('color',[1,1,1,1]),initial('uv',[0,0]),fade('uv',[1,0],0,2)];
  motion=CompositionCore.validate(motionRaw);check(motionPixel(0)[0]>250&&motionPixel(1)[2]>250&&motionPixel(2.1)[0]>250,'UV scroll and texture wrap');
  motionRaw.layers[0].animation.particle.clamp=true;motion=CompositionCore.validate(motionRaw);check(motionPixel(2.1)[2]>250,'UV clamp sampled the repeated texture');
  const finalUV={...particle,life:999999,tracks:[{property:'uv',mode:'final',value:[230000,0],start:0,end:null}]};
  check(Math.abs(ParticleEffects.states(finalUV,2)[0].uv[0]-460000/999999)<1e-9,'final UV endpoint must be interpolated over the particle life');
  images.set('s1',red);
  project.layers[0].animation.color=[0,0,0,.5];check(pixel(.1)[0]===0&&Math.abs(pixel(.1)[3]-128)<=1,'color and alpha');
  let limited=false;try{await AnimationPNG.encode({width:8192,height:8192,count:5,fps:25,render});}catch{limited=true;}check(limited,'export memory limit');
  const atlas=JSON.parse(JSON.stringify(raw));delete atlas.layers[0].animation;atlas.layers[0].gameIllustration=true;atlas.layers[0].crop.y=1;
  check(CompositionCore.validate(atlas).layers[0].crop.height===3,'game atlas was not intersected with the source');
  atlas.layers[0].crop={x:1,y:2,width:6,height:8};
  const clipped=CompositionCore.validate(atlas);
  check(clipped.layers[0].crop.width===3&&clipped.layers[0].crop.height===2,'multi-pixel game atlas overflow');
  const canvas=new OffscreenCanvas(4,4);CompositionCore.draw(canvas.getContext('2d'),clipped,images);
  check(canvas.getContext('2d').getImageData(3,3,1,1).data[3]===255,'clipped atlas left a transparent output edge');
  check(CompositionCore.validate(clipped).layers[0].crop.height===2,'normalized project could not be restored');
  const negative=structuredClone(atlas);negative.layers[0].crop={x:-2,y:-1,width:6,height:5};
  check(JSON.stringify(CompositionCore.validate(negative).layers[0].crop)===JSON.stringify({x:0,y:0,width:4,height:4}),'negative atlas edge was not clipped');
  for(const flag of ['gameIllustration','gameFrame','gameMark']){
    const variant=structuredClone(atlas);delete variant.layers[0].gameIllustration;delete variant.layers[0].gameFrame;variant.layers[0][flag]=true;
    check(CompositionCore.validate(variant).layers[0].crop.height===2,'game crop not shared by '+flag);
  }
  const outside=structuredClone(atlas);outside.layers[0].crop.x=4;
  let outsideRejected=false;try{CompositionCore.validate(outside);}catch{outsideRejected=true;}check(outsideRejected,'empty game crop accepted');
  atlas.layers[0].gameIllustration=false;atlas.layers[0].gameFrame=false;let cropped=false;try{CompositionCore.validate(atlas);}catch{cropped=true;}check(cropped,'manual crop escaped source bounds');
  document.body.dataset.checks='passed';
}catch(e){errors.push(e.stack||String(e));document.body.dataset.checks='failed';}
const pre=document.createElement('pre');pre.textContent=errors.join('\n');document.body.append(pre);
