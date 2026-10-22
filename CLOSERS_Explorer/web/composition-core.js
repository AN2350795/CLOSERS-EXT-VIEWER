'use strict';
globalThis.CompositionCore=(()=>{
  const MAX_PIXELS=16777216,MAX_TOTAL_PIXELS=134217728,MAX_LAYERS=20,MAX_SOURCES=256;
  const tinted=new WeakMap();
  const INFO_KEYS=['level','character','name','progress'];
  const FONT_FAMILIES={'NanumGothicExtraBold.ttf':'ClosersGameExtraBold','NanumGothicBold.ttf':'ClosersGameBold'};
  const fail=message=>{throw Error(message);};
  const number=(v,label,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fail(label+' 범위가 올바르지 않습니다.');
  const integer=(v,label,min,max)=>Number.isInteger(v)?number(v,label,min,max):fail(label+'는 정수여야 합니다.');
  const text=(v,label,max)=>typeof v==='string'&&v.length<=max?v:fail(label+' 형식이 올바르지 않습니다.');
  const bool=(v,fallback)=>v===undefined?fallback:typeof v==='boolean'?v:fail('선택 설정 형식이 올바르지 않습니다.');
  function gameCrop(crop,source){
    const rawX=number(crop.x,'자르기 X',-65536,65536),rawY=number(crop.y,'자르기 Y',-65536,65536),
      x=Math.max(0,rawX),y=Math.max(0,rawY),
      right=Math.min(source.width,rawX+number(crop.width,'자르기 너비',.01,65536)),
      bottom=Math.min(source.height,rawY+number(crop.height,'자르기 높이',.01,65536));
    if(right<=x||bottom<=y)fail('게임 자르기 영역이 원본 이미지와 겹치지 않습니다.');
    return {x,y,width:right-x,height:bottom-y};
  }
  function validate(value){
    if(!value||value.schema!=='closers-composition'||![1,2,3,4,5,6,7].includes(value.version)||!['composition','frame-template'].includes(value.kind))fail('지원하는 조합 설정 파일이 아닙니다.');
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
    if(c.info!==undefined){
      const i=c.info;
      if(!i||!Array.isArray(i.fields)||i.fields.length!==4||!Array.isArray(i.pictures)||i.pictures.length>8||!Array.isArray(i.fonts)||i.fonts.length!==2)fail('캐릭터 정보 설정이 올바르지 않습니다.');
      if(new Set(i.fonts.map(f=>f?.name)).size!==2)fail('게임 글꼴이 중복되었습니다.');
      const rgba=color=>{if(!Array.isArray(color)||color.length!==4)fail('정보 색상이 올바르지 않습니다.');return color.map(v=>number(v,'정보 색상',0,1));};
      const rect=p=>({x:number(p.x,'정보 X',-65536,65536),y:number(p.y,'정보 Y',-65536,65536),width:number(p.width,'정보 너비',.01,65536),height:number(p.height,'정보 높이',.01,65536)});
      const frames=items=>{if(!Array.isArray(items)||!items.length||items.length>120)fail('엠블럼 프레임이 올바르지 않습니다.');return items.map(f=>{if(!sourceMap.has(f.source))fail('엠블럼 원본이 없습니다.');return {source:f.source,duration:number(f.duration,'엠블럼 재생 시간',.001,60)};});};
      canvas.info={enabled:bool(i.enabled,false),height:integer(i.height,'정보 영역 높이',1,1024),
        fonts:i.fonts.map(f=>{if(!FONT_FAMILIES[f.name]||!/^[0-9a-f]{64}$/.test(f.sha256))fail('게임 글꼴 정보가 올바르지 않습니다.');return {name:f.name,sha256:f.sha256};}),
        fields:i.fields.map((f,n)=>{
          if(f.key!==INFO_KEYS[n]||!FONT_FAMILIES[f.font]||!['left','center','right'].includes(f.align)||!['top','middle','bottom'].includes(f.baseline))fail('정보 글자 설정이 올바르지 않습니다.');
          return {key:f.key,text:text(f.text,'정보 내용',80),font:f.font,size:number(f.size,'글자 크기',1,128),
            x:number(f.x,'글자 X',-65536,65536),y:number(f.y,'글자 Y',-65536,65536),align:f.align,baseline:f.baseline,
            outline:number(f.outline,'글자 외곽선',0,8),outlineFactor:number(f.outlineFactor,'외곽선 색상',0,1),boldRate:number(f.boldRate,'글자 굵기',0,16),color:rgba(f.color)};
        }),pictures:i.pictures.map(p=>{const s=sourceMap.get(p.source);if(!s)fail('정보 배경 원본이 없습니다.');return {...rect(p),source:p.source,crop:gameCrop(p.crop||{},s),gauge:bool(p.gauge,false)};})};
      if(i.emblem!==undefined){const e=i.emblem;if(!e||!['source-over','lighter'].includes(e.blend))fail('엠블럼 설정이 올바르지 않습니다.');canvas.info.emblem={...rect(e),id:integer(e.id,'요원 등급',1,8),name:text(e.name,'엠블럼 이름',80),frames:frames(e.frames),color:rgba(e.color),delay:number(e.delay,'엠블럼 지연',0,60),blend:e.blend};}
      if(value.kind==='frame-template')fail('프레임 템플릿에는 캐릭터 정보를 넣을 수 없습니다.');
      if(canvas.width*(canvas.height+canvas.info.height)>MAX_PIXELS)fail('정보 영역을 포함한 이미지가 너무 큽니다.');
    }
    if(c.background!==undefined){
      const b=c.background,s=sourceMap.get(b?.source);
      if(!s||canvas.transparent)fail('게임 배경의 이미지 연결이 올바르지 않습니다.');
      const crop=gameCrop(b.crop||{},s);
      const fit=b.fit??'cover';
      if(!['cover','stretch'].includes(fit))fail('배경 배치 방식이 올바르지 않습니다.');
      const color=b.color??[1,1,1,1];
      if(!Array.isArray(color)||color.length!==4)fail('배경 색상 형식이 올바르지 않습니다.');
      canvas.background={source:s.key,team:integer(b.team??Number(s.name.match(/_TEAM([1-4])\./i)?.[1]||1),'배경 팀',1,4),name:text(b.name,'배경 이름',200),crop,
        fit,color:color.map(v=>number(v,'배경 색상',0,1)),opacity:number(b.opacity??1,'배경 불투명도',0,1),
        x:number(b.x,'배경 X',-100000,100000),y:number(b.y,'배경 Y',-100000,100000),
        width:number(b.width,'배경 너비',.01,65536),height:number(b.height,'배경 높이',.01,65536)};
    }
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
    const output=value.output===undefined?{mode:'native',width:720}:value.output;
    if(!output||!['native','base','double','custom'].includes(output.mode))fail('저장 해상도 설정이 올바르지 않습니다.');
    return {schema:'closers-composition',version:canvas.info?7:canvas.background?6:layers.some(l=>l.animation?.particle)?3:layers.some(l=>l.animation)?2:value.version,kind:value.kind,canvas,sources,layers,
      output:{mode:output.mode,width:integer(output.width??720,'저장 너비',1,8192)}};
  }
  function exportSize(project){
    const {canvas,layers}=project,output=project.output||{mode:'native'};
    let scale=1;
    if(output.mode==='native'){
      for(const l of layers)if(l.visible&&l.role==='illustration'&&!l.animation)scale=Math.max(scale,l.crop.width/l.width,l.crop.height/l.height);
    }
    // Keep one uniform scale for illustration, frame and particle placement.
    if(output.mode==='double')scale=2;
    if(output.mode==='custom')scale=output.width/canvas.width;
    const width=Math.max(1,Math.round(canvas.width*scale)),height=Math.max(1,Math.round(canvasSize(project).height*scale));
    if(width>8192||height>8192||width*height>MAX_PIXELS)fail('저장 이미지는 한 변 8,192픽셀·합계 16,777,216픽셀까지입니다. 저장 크기를 줄여 주세요.');
    return {width,height};
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
  function canvasSize(project){return {width:project.canvas.width,height:project.canvas.height+(project.canvas.info?.enabled?project.canvas.info.height:0)};}
  function drawInfo(ctx,info,images,time,width){
    const progress=info.fields[3].text.trim(),amount=/^\d+(?:\.\d+)?\s*%?$/.test(progress)?Math.min(100,Number(progress.replace('%','').trim()))/100:0;
    for(const p of info.pictures){const image=images.get(p.source),c=p.crop,w=p.width*(p.gauge?amount:1);if(image&&w>0)ctx.drawImage(image,c.x,c.y,c.width,c.height,p.x,p.y,w,p.height);}
    const e=info.emblem,f=e?frameAt(e,time):null;
    if(f){const image=images.get(f.source);if(image){ctx.save();ctx.globalAlpha=e.color[3];ctx.globalCompositeOperation=e.blend;ctx.drawImage(colorImage(image,e.color),e.x,e.y,e.width,e.height);ctx.restore();}}
    for(const f of info.fields){
      if(!f.text)continue;
      ctx.save();const left=f.align==='right'?Math.max(0,f.x-80):f.x;
      const right=f.key==='level'?info.fields[1].x-6:f.key==='progress'?f.x:info.fields[3].x-80;
      ctx.beginPath();ctx.rect(left,f.y-f.size-4,Math.max(0,Math.min(width,right)-left),f.size*2+8);ctx.clip();
      ctx.font=`${f.size}px "${FONT_FAMILIES[f.font]}"`;ctx.textAlign=f.align;ctx.textBaseline=f.baseline;ctx.lineJoin='round';
      ctx.fillStyle=`rgba(${f.color.slice(0,3).map(v=>Math.round(v*255)).join(',')},${f.color[3]})`;
      ctx.strokeStyle=`rgba(${f.color.slice(0,3).map(v=>Math.round(v*255*f.outlineFactor)).join(',')},${f.color[3]})`;
      if(f.outline){ctx.lineWidth=f.outline*2;ctx.strokeText(f.text,f.x,f.y);}ctx.fillText(f.text,f.x,f.y);ctx.restore();
    }
  }
  function draw(context,project,images,width=canvasSize(project).width,height=canvasSize(project).height,time=0){
    globalThis.ParticleEffects?.prune(images);
    context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,width,height);
    const size=canvasSize(project);
    context.save();context.scale(width/size.width,height/size.height);
    if(!project.canvas.transparent){context.fillStyle=project.canvas.color;context.fillRect(0,0,size.width,size.height);}
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    const background=project.canvas.background;
    if(background){
      let image=images.get(background.source);const c=background.crop;
      if(image){
        context.save();context.globalAlpha=background.color[3]*background.opacity;image=colorImage(image,background.color);
        if(background.fit==='cover'){
          const scale=Math.max(background.width/c.width,background.height/c.height),sw=background.width/scale,sh=background.height/scale;
          context.drawImage(image,c.x+(c.width-sw)/2,c.y+(c.height-sh)/2,sw,sh,background.x,background.y,background.width,background.height);
        }else context.drawImage(image,c.x,c.y,c.width,c.height,background.x,background.y,background.width,background.height);
        context.restore();
      }
    }
    context.save();context.beginPath();context.rect(0,0,project.canvas.width,project.canvas.height);context.clip();
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
    context.globalAlpha=1;context.globalCompositeOperation='source-over';
    if(project.canvas.info?.enabled)drawInfo(context,project.canvas.info,images,time,size.width);
    context.restore();
  }
  function placement(l,layers){
    if(!l.markParent)return l;
    const parent=layers.find(p=>p.id===l.markParent);if(!parent?.visible)return null;
    const sx=parent.width/parent.crop.width,sy=parent.height/parent.crop.height;
    return {...l,x:parent.x+parent.width/2+l.x*sx,y:parent.y+parent.height/2+l.y*sy,width:l.width*sx,height:l.height*sy,opacity:l.opacity*parent.opacity};
  }
  function usedSources(layers,canvas){return new Set([...(canvas?.background?[canvas.background.source]:[]),...(canvas?.info?.pictures.map(p=>p.source)||[]),...(canvas?.info?.emblem?.frames.map(f=>f.source)||[]),...layers.flatMap(l=>[l.source,...(l.animation?.frames.map(f=>f.source)||[]),...(l.animation?.particle?.mask?[l.animation.particle.mask]:[])])]);}
  return Object.freeze({validate,exportSize,canvasSize,draw,frameAt,usedSources,placement,FONT_FAMILIES,MAX_PIXELS,MAX_TOTAL_PIXELS,MAX_LAYERS,MAX_SOURCES});
})();
