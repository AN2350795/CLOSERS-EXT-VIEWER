'use strict';
globalThis.CompositionCore=(()=>{
  const MAX_PIXELS=16777216,MAX_TOTAL_PIXELS=134217728,MAX_LAYERS=20,MAX_SOURCES=256;
  const tinted=new WeakMap();
  const fail=message=>{throw Error(message);};
  const number=(v,label,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fail(label+' 범위가 올바르지 않습니다.');
  const integer=(v,label,min,max)=>Number.isInteger(v)?number(v,label,min,max):fail(label+'는 정수여야 합니다.');
  const text=(v,label,max)=>typeof v==='string'&&v.length<=max?v:fail(label+' 형식이 올바르지 않습니다.');
  const bool=(v,fallback)=>v===undefined?fallback:typeof v==='boolean'?v:fail('선택 설정 형식이 올바르지 않습니다.');
  function gameCrop(crop,source){
    const x=number(crop.x,'자르기 X',0,65536),y=number(crop.y,'자르기 Y',0,65536),
      right=Math.min(source.width,x+number(crop.width,'자르기 너비',.01,65536)),
      bottom=Math.min(source.height,y+number(crop.height,'자르기 높이',.01,65536));
    if(right<=x||bottom<=y)fail('게임 자르기 영역이 원본 이미지와 겹치지 않습니다.');
    return {x,y,width:right-x,height:bottom-y};
  }
  function validate(value){
    if(!value||value.schema!=='closers-composition'||![1,2,3].includes(value.version)||!['composition','frame-template'].includes(value.kind))fail('지원하는 조합 설정 파일이 아닙니다.');
    const c=value.canvas||{},canvas={width:integer(c.width,'출력 너비',1,8192),height:integer(c.height,'출력 높이',1,8192),transparent:bool(c.transparent,true),color:text(c.color,'배경색',7)};
    if(canvas.width*canvas.height>MAX_PIXELS)fail('출력은 16,777,216픽셀까지 지원합니다.');
    if(!/^#[0-9a-f]{6}$/i.test(canvas.color))fail('배경색이 올바르지 않습니다.');
    if(!Array.isArray(value.sources)||value.sources.length>MAX_SOURCES||!Array.isArray(value.layers)||value.layers.length>MAX_LAYERS)fail('레이어는 20개, 애니메이션 포함 원본은 256개까지입니다.');
    const keys=new Set(),sources=value.sources.map(s=>{
      if(!s||!/^s[0-9]{1,10}$/.test(s.key)||keys.has(s.key))fail('이미지 식별자가 올바르지 않습니다.');keys.add(s.key);
      for(const key of ['source_sha256','image_sha256'])if(!/^[0-9a-f]{64}$/.test(s[key]))fail('원본 해시 정보가 올바르지 않습니다.');
      const source={key:s.key,archive:text(s.archive,'원본 경로',32768),ordinal:integer(s.ordinal,'항목 번호',0,100000000),name:text(s.name,'원래 이름',4096),
        format:text(s.format,'파일 형식',8),source_sha256:s.source_sha256,image_sha256:s.image_sha256,
        width:integer(s.width,'원본 너비',1,16384),height:integer(s.height,'원본 높이',1,16384)};
      if(source.width*source.height>MAX_PIXELS)fail('원본 이미지의 픽셀 수가 너무 큽니다.');
      if(!['png','jpg','jpeg','gif','bmp','webp','dds','tga'].includes(source.format))fail('지원하지 않는 이미지 형식입니다.');
      return source;
    });
    if(sources.reduce((n,s)=>n+s.width*s.height,0)>MAX_TOTAL_PIXELS)fail('불러올 원본 이미지의 합계는 134,217,728픽셀까지 지원합니다.');
    const sourceMap=new Map(sources.map(s=>[s.key,s])),ids=new Set();
    const layers=value.layers.map(l=>{
      if(!l||!/^l[0-9]{1,10}$/.test(l.id)||ids.has(l.id)||!sourceMap.has(l.source))fail('레이어의 이미지 연결이 올바르지 않습니다.');ids.add(l.id);
      if(!['illustration','frame','fragment'].includes(l.role))fail('레이어 용도가 올바르지 않습니다.');
      const s=sourceMap.get(l.source),game=bool(l.gameIllustration,false)||bool(l.gameFrame,false)||bool(l.gameMark,false),
        crop=game&&!l.animation?gameCrop(l.crop||{},s):l.crop||{},x=number(crop.x,'자르기 X',0,s.width),y=number(crop.y,'자르기 Y',0,s.height);
      const result={id:l.id,source:l.source,name:text(l.name,'레이어 이름',200),role:l.role,
        x:number(l.x,'배치 X',-100000,100000),y:number(l.y,'배치 Y',-100000,100000),
        width:number(l.width,'배치 너비',.01,65536),height:number(l.height,'배치 높이',.01,65536),
        crop:{x,y,width:number(crop.width,'자르기 너비',.01,s.width-x),height:number(crop.height,'자르기 높이',.01,s.height-y)},
        opacity:number(l.opacity,'불투명도',0,1),visible:bool(l.visible,true),locked:bool(l.locked,false),keepRatio:bool(l.keepRatio,true)};
      if(l.gameFrame!==undefined)result.gameFrame=bool(l.gameFrame,false);
      if(l.gameMark!==undefined)result.gameMark=bool(l.gameMark,false);
      if(l.gameIllustration!==undefined)result.gameIllustration=bool(l.gameIllustration,false);
      if(l.markParent!==undefined){if(!/^l[0-9]{1,10}$/.test(l.markParent))fail('마크 효과 연결이 올바르지 않습니다.');result.markParent=l.markParent;}
      if(l.animation!==undefined){
        const a=l.animation;if(!a||!Array.isArray(a.frames)||!a.frames.length||a.frames.length>120)fail('애니메이션은 1~120프레임까지입니다.');
        if(!['source-over','lighter'].includes(a.blend)||!Array.isArray(a.color)||a.color.length!==4)fail('애니메이션 색상·합성 설정이 잘못되었습니다.');
        result.animation={delay:number(a.delay,'재생 지연',0,60),blend:a.blend,color:a.color.map(v=>number(v,'효과 색상',0,1)),frames:a.frames.map(f=>{
          if(!f||!sourceMap.has(f.source))fail('애니메이션 원본이 없습니다.');
          return {source:f.source,duration:number(f.duration,'프레임 시간',.001,60)};
        })};
        if(a.particle!==undefined)result.animation.particle=ParticleEffects.validate(a.particle,sourceMap);
      }
      if(value.kind==='frame-template'&&result.role==='illustration')fail('프레임 템플릿에는 프레임·조각만 넣어 주세요.');
      return result;
    });
    for(const l of layers)if(l.markParent&&!layers.some(p=>p.id===l.markParent&&p.id!==l.id&&p.gameMark&&!p.markParent&&!p.animation))fail('효과를 연결할 마크가 없습니다.');
    return {schema:'closers-composition',version:layers.some(l=>l.animation?.particle)?3:layers.some(l=>l.animation)?2:value.version,kind:value.kind,canvas,sources,layers};
  }
  function frameAt(animation,time){
    if(time<animation.delay)return null;
    const total=animation.frames.reduce((n,f)=>n+f.duration,0);let phase=(Math.max(0,time-animation.delay)%total);
    for(const f of animation.frames){if(phase<f.duration-1e-9)return f;phase-=f.duration;}
    return animation.frames[0];
  }
  function colorImage(image,color){
    if(color.slice(0,3).every(v=>v===1))return image;
    const key=color.slice(0,3).join(',');let cache=tinted.get(image);if(!cache){cache=new Map();tinted.set(image,cache);}if(cache.has(key))return cache.get(key);
    const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<pixels.data.length;i+=4)for(let j=0;j<3;j++)pixels.data[i+j]=Math.round(pixels.data[i+j]*color[j]);ctx.putImageData(pixels,0,0);cache.set(key,canvas);return canvas;
  }
  function draw(context,project,images,width=project.canvas.width,height=project.canvas.height,time=0){
    globalThis.ParticleEffects?.prune(images);
    context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,width,height);
    context.save();context.scale(width/project.canvas.width,height/project.canvas.height);
    if(!project.canvas.transparent){context.fillStyle=project.canvas.color;context.fillRect(0,0,project.canvas.width,project.canvas.height);}
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    for(const l of project.layers){
      if(l.visible&&l.animation?.particle){
        const placed=placement(l,project.layers);if(placed)ParticleEffects.draw(context,placed,l.animation,images,project,time);continue;
      }
      if(!l.visible)continue;const a=l.animation,f=a?frameAt(a,time):null;if(a&&!f)continue;
      let image=images.get(f?.source||l.source);if(!image)continue;const c=a?{x:0,y:0,width:image.width,height:image.height}:l.crop;
      context.globalAlpha=l.opacity*(a?a.color[3]:1);context.globalCompositeOperation=a?a.blend:'source-over';if(a)image=colorImage(image,a.color);
      context.drawImage(image,c.x,c.y,c.width,c.height,l.x,l.y,l.width,l.height);
    }
    context.restore();
  }
  function placement(l,layers){
    if(!l.markParent)return l;
    const parent=layers.find(p=>p.id===l.markParent);if(!parent?.visible)return null;
    const sx=parent.width/parent.crop.width,sy=parent.height/parent.crop.height;
    return {...l,x:parent.x+parent.width/2+l.x*sx,y:parent.y+parent.height/2+l.y*sy,width:l.width*sx,height:l.height*sy,opacity:l.opacity*parent.opacity};
  }
  function usedSources(layers){return new Set(layers.flatMap(l=>[l.source,...(l.animation?.frames.map(f=>f.source)||[]),...(l.animation?.particle?.mask?[l.animation.particle.mask]:[])]));}
  return Object.freeze({validate,draw,frameAt,usedSources,placement,MAX_PIXELS,MAX_TOTAL_PIXELS,MAX_LAYERS,MAX_SOURCES});
})();
