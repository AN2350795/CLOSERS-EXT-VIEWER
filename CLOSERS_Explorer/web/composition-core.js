'use strict';
globalThis.CompositionCore=(()=>{
  const MAX_PIXELS=16777216,MAX_TOTAL_PIXELS=33554432,MAX_LAYERS=20;
  const fail=message=>{throw Error(message);};
  const number=(v,label,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fail(label+' 범위가 올바르지 않습니다.');
  const integer=(v,label,min,max)=>Number.isInteger(v)?number(v,label,min,max):fail(label+'는 정수여야 합니다.');
  const text=(v,label,max)=>typeof v==='string'&&v.length<=max?v:fail(label+' 형식이 올바르지 않습니다.');
  const bool=(v,fallback)=>v===undefined?fallback:typeof v==='boolean'?v:fail('선택 설정 형식이 올바르지 않습니다.');
  function validate(value){
    if(!value||value.schema!=='closers-composition'||value.version!==1||!['composition','frame-template'].includes(value.kind))fail('지원하는 조합 설정 파일이 아닙니다.');
    const c=value.canvas||{},canvas={width:integer(c.width,'출력 너비',1,8192),height:integer(c.height,'출력 높이',1,8192),transparent:bool(c.transparent,true),color:text(c.color,'배경색',7)};
    if(canvas.width*canvas.height>MAX_PIXELS)fail('출력은 16,777,216픽셀까지 지원합니다.');
    if(!/^#[0-9a-f]{6}$/i.test(canvas.color))fail('배경색이 올바르지 않습니다.');
    if(!Array.isArray(value.sources)||value.sources.length>MAX_LAYERS||!Array.isArray(value.layers)||value.layers.length>MAX_LAYERS)fail('이미지와 레이어는 최대 20개입니다.');
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
    if(sources.reduce((n,s)=>n+s.width*s.height,0)>MAX_TOTAL_PIXELS)fail('불러올 원본 이미지의 합계는 33,554,432픽셀까지 지원합니다.');
    const sourceMap=new Map(sources.map(s=>[s.key,s])),ids=new Set();
    const layers=value.layers.map(l=>{
      if(!l||!/^l[0-9]{1,10}$/.test(l.id)||ids.has(l.id)||!sourceMap.has(l.source))fail('레이어의 이미지 연결이 올바르지 않습니다.');ids.add(l.id);
      if(!['illustration','frame','fragment'].includes(l.role))fail('레이어 용도가 올바르지 않습니다.');
      const s=sourceMap.get(l.source),crop=l.crop||{},x=number(crop.x,'자르기 X',0,s.width),y=number(crop.y,'자르기 Y',0,s.height);
      const result={id:l.id,source:l.source,name:text(l.name,'레이어 이름',200),role:l.role,
        x:number(l.x,'배치 X',-100000,100000),y:number(l.y,'배치 Y',-100000,100000),
        width:number(l.width,'배치 너비',.01,65536),height:number(l.height,'배치 높이',.01,65536),
        crop:{x,y,width:number(crop.width,'자르기 너비',.01,s.width-x),height:number(crop.height,'자르기 높이',.01,s.height-y)},
        opacity:number(l.opacity,'불투명도',0,1),visible:bool(l.visible,true),locked:bool(l.locked,false),keepRatio:bool(l.keepRatio,true)};
      if(value.kind==='frame-template'&&result.role==='illustration')fail('프레임 템플릿에는 프레임·조각만 넣어 주세요.');
      return result;
    });
    return {schema:'closers-composition',version:1,kind:value.kind,canvas,sources,layers};
  }
  function draw(context,project,images,width=project.canvas.width,height=project.canvas.height){
    context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,width,height);
    context.save();context.scale(width/project.canvas.width,height/project.canvas.height);
    if(!project.canvas.transparent){context.fillStyle=project.canvas.color;context.fillRect(0,0,project.canvas.width,project.canvas.height);}
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    for(const l of project.layers){if(!l.visible)continue;const image=images.get(l.source);if(!image)continue;const c=l.crop;context.globalAlpha=l.opacity;context.drawImage(image,c.x,c.y,c.width,c.height,l.x,l.y,l.width,l.height);}
    context.restore();
  }
  return Object.freeze({validate,draw,MAX_PIXELS,MAX_TOTAL_PIXELS,MAX_LAYERS});
})();
