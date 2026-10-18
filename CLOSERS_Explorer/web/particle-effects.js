'use strict';
globalThis.ParticleEffects=(()=>{
  const properties={color:4,dualColor:4,blinkColor:4,blinkPeriod:1,size:3,scale:1,position:3,velocity:3,rotation:3,rotationSpeed:3,uv:2};
  const defaults={color:[1,1,1,1],dualColor:[1,1,1,1],blinkColor:[1,1,1,1],blinkPeriod:[0],size:[1,1,1],scale:[1],position:[0,0,0],velocity:[0,0,0],rotation:[0,0,0],rotationSpeed:[0,0,0],uv:[0,0]};
  const blends=['ZERO','ONE','SRCALPHA','INVSRCALPHA','DESTALPHA','INVSRCCOLOR'],timelines=new WeakMap();
  function validate(p,sources){
    const fail=()=>{throw Error('파티클 설정이 올바르지 않습니다.');};
    const num=(v,min=-1e7,max=1e7)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fail();
    const range=(v,min=-1e7,max=1e7)=>Array.isArray(v)?(v.length===2&&v[0]<=v[1]?v.map(n=>num(n,min,max)):fail()):num(v,min,max);
    const vector=(v,n,fn=range)=>Array.isArray(v)&&v.length===n?v.map(x=>fn(x)):fail();
    const bool=v=>typeof v==='boolean'?v:fail();
    if(!p||!Array.isArray(p.tracks)||p.tracks.length>64||!blends.includes(p.blend?.[0])||!blends.includes(p.blend?.[1]))fail();
    const result={seed:num(p.seed,0,4294967295),life:range(p.life,.001),maxParticles:num(p.maxParticles,1,256),
      rate:range(p.rate,0,1000),instant:range(p.instant,0,256),emitterLife:range(p.emitterLife,0),deaths:range(p.deaths,0),
      radius:vector(p.radius,3),radiusMin:range(p.radiusMin,0),gravity:vector(p.gravity,3),
      scale:vector(p.scale,2,v=>num(v,-1000,1000)),basis:vector(p.basis,2,v=>num(v,.01,65536)),
      drawCount:num(p.drawCount,0,16),dual:bool(p.dual),dualDrawCount:num(p.dualDrawCount,0,16),clamp:bool(p.clamp),blend:[...p.blend],
      tracks:p.tracks.map(t=>{
        if(!Object.hasOwn(properties,t?.property)||!['initial','fade','final'].includes(t.mode))fail();
        return {property:t.property,mode:t.mode,value:vector(t.value,properties[t.property]),start:range(t.start,0),end:t.end===null?null:range(t.end,0)};
      })};
    if(![result.seed,result.maxParticles,result.drawCount,result.dualDrawCount].every(Number.isInteger))fail();
    if(p.mask!==undefined){if(!sources.has(p.mask))fail();result.mask=p.mask;}
    return result;
  }
  function random(seed){let state=seed>>>0;return ()=>{state=(state+0x6d2b79f5)|0;let x=Math.imul(state^(state>>>15),1|state);x^=x+Math.imul(x^(x>>>7),61|x);return ((x^(x>>>14))>>>0)/4294967296;};}
  const sample=(v,rng)=>Array.isArray(v)?v[0]+(v[1]-v[0])*rng():v;
  const sampleVector=(v,rng)=>v.map(x=>sample(x,rng));
  const mix=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
  function makeParticle(p,rng,birth){
    const life=sample(p.life,rng),tracks={};
    for(const [name,value] of Object.entries(defaults))tracks[name]={initial:[...value],events:[]};
    for(const t of p.tracks){
      const track=tracks[t.property],value=sampleVector(t.value,rng);
      if(t.mode==='initial')track.initial=value;
      else{
        const previous=track.events.at(-1),start=t.mode==='final'&&t.start===0?(previous?.end||0):sample(t.start,rng);
        const end=t.mode==='final'?life:(t.end===null?life:sample(t.end,rng));
        track.events.push({start,end:Math.max(start,end),value});
      }
    }
    for(const track of Object.values(tracks)){
      track.events.sort((a,b)=>a.start-b.start);
      for(let i=0;i<track.events.length;i++)track.events[i].from=valueAt(track,track.events[i].start,i);
    }
    const radius=sampleVector(p.radius,rng),minimum=sample(p.radiusMin,rng),length=Math.hypot(...radius);
    if(length>0)for(let i=0;i<3;i++)radius[i]+=radius[i]*minimum/length;
    return {birth,life,tracks,radius,gravity:sampleVector(p.gravity,rng)};
  }
  function valueAt(track,time,limit=track.events.length){
    let value=track.initial;
    for(let i=0;i<limit;i++){
      const e=track.events[i];if(time<e.start)break;
      value=mix(e.from||value,e.value,e.end===e.start?1:Math.min(1,(time-e.start)/(e.end-e.start)));
    }
    return value;
  }
  function integral(track,time){
    const knots=[0,time,...track.events.flatMap(e=>[e.start,e.end]).filter(t=>t>0&&t<time)].sort((a,b)=>a-b),result=track.initial.map(()=>0);
    for(let i=1;i<knots.length;i++){
      const a=knots[i-1],b=knots[i],left=valueAt(track,a),right=valueAt(track,b-1e-10);
      for(let j=0;j<result.length;j++)result[j]+=(left[j]+right[j])*(b-a)/2;
    }
    return result;
  }
  function timeline(p,time){
    let cache=timelines.get(p);
    if(cache&&time<cache.time-1e-9){timelines.delete(p);cache=null;}
    if(!cache){
      const rng=random(p.seed),instant=Math.floor(sample(p.instant,rng)),rate=sample(p.rate,rng);
      cache={rng,active:[],next:rate>0?1/rate:Infinity,emitterLife:sample(p.emitterLife,rng),deathLimit:sample(p.deaths,rng),dead:0,attempts:0,time};
      for(let i=0;i<Math.min(p.maxParticles,instant||(!rate?1:0));i++){
        cache.active.push(makeParticle(p,rng,0));
      }
      timelines.set(p,cache);
    }
    while(cache.next<=time&&cache.next<=cache.emitterLife){
      const birth=cache.next,active=cache.active.filter(v=>v.birth+v.life>birth+1e-9);
      cache.dead+=cache.active.length-active.length;cache.active=active;
      if(cache.deathLimit>0&&cache.dead>=cache.deathLimit){cache.next=Infinity;break;}
      if(active.length<p.maxParticles)active.push(makeParticle(p,cache.rng,birth));
      const rate=sample(p.rate,cache.rng);cache.next=rate>0?birth+1/rate:Infinity;
      if(++cache.attempts>60001)throw Error('파티클 생성 수가 한도를 초과했습니다.');
    }
    cache.time=time;return cache.active;
  }
  function states(p,time){
    time=Math.max(0,Math.min(60,time));
    return timeline(p,time).filter(v=>v.birth<=time+1e-9&&time<v.birth+v.life).map(v=>{
      const age=time-v.birth,get=name=>valueAt(v.tracks[name],age),position=get('position'),movement=integral(v.tracks.velocity,age),rotation=get('rotation'),spin=integral(v.tracks.rotationSpeed,age);
      const color=[...get('color')],period=get('blinkPeriod')[0];
      if(period>0){const blink=get('blinkColor'),phase=(1-Math.cos(age/period*Math.PI*2))/2;for(let i=0;i<4;i++)color[i]*=1+(blink[i]-1)*phase;}
      return {age,life:v.life,color,dualColor:get('dualColor'),size:get('size'),scale:get('scale')[0],uv:get('uv'),
        position:position.map((x,i)=>x+v.radius[i]+movement[i]+v.gravity[i]*age*age/2),rotation:rotation.map((x,i)=>x+spin[i])};
    });
  }

  // Render into one shared WebGL surface, starting with the existing canvas.
  // This preserves destination-alpha/inverse-source-color blending across layers.
  let renderer;
  function createRenderer(){
    const canvas=new OffscreenCanvas(1,1),gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true,antialias:false,depth:false,stencil:false});
    if(!gl)throw Error('게임 파티클 효과를 표시하려면 WebGL을 사용할 수 있어야 합니다.');
    const shader=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const program=gl.createProgram(),vertex=shader(gl.VERTEX_SHADER,`
      attribute vec2 point; uniform mat3 transform; uniform vec2 viewport; varying vec2 uv;
      void main(){vec3 pos=transform*vec3(point,1.0);gl_Position=vec4(pos.x/viewport.x*2.0-1.0,1.0-pos.y/viewport.y*2.0,0.0,1.0);uv=point+0.5;}`),fragment=shader(gl.FRAGMENT_SHADER,`
      precision highp float; uniform sampler2D image; uniform sampler2D mask;
      uniform vec4 color; uniform vec2 offset; uniform bool masked; uniform bool clamped; uniform bool additive; varying vec2 uv;
      void main(){vec2 tex=uv+offset;tex=clamped?clamp(tex,0.0,1.0):fract(tex);vec4 value=texture2D(image,tex)*color;
        if(masked)value*=texture2D(mask,uv);
        if(additive){float coverage=max(value.r,max(value.g,value.b));value.rgb=coverage>0.0?value.rgb/coverage:vec3(0.0);value.a*=coverage;}
        gl_FragColor=value;}`);
    gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    const uniforms=Object.fromEntries(['transform','viewport','image','mask','color','offset','masked','clamped','additive'].map(k=>[k,gl.getUniformLocation(program,k)]));
    gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-.5,-.5,.5,-.5,-.5,.5,.5,.5]),gl.STATIC_DRAW);
    const point=gl.getAttribLocation(program,'point');gl.enableVertexAttribArray(point);gl.vertexAttribPointer(point,2,gl.FLOAT,false,0,0);
    const textures=new Map();let texturePixels=0;
    const remove=image=>{const entry=textures.get(image);gl.deleteTexture(entry.texture);textures.delete(image);texturePixels-=entry.pixels;};
    const newTexture=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);return t;};
    const background=newTexture();
    const upload=(texture,image,premultiply=false)=>{gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiply);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);};
    const texture=image=>{
      const entry=textures.get(image);
      if(entry){textures.delete(image);textures.set(image,entry);return entry.texture;}
      while(textures.size&&texturePixels+image.width*image.height>16777216)remove(textures.keys().next().value);
      const t=newTexture();upload(t,image);const pixels=image.width*image.height;textures.set(image,{texture:t,pixels});texturePixels+=pixels;return t;
    };
    const quad=(matrix,color,offset,clamped,masked,additive=false)=>{gl.uniformMatrix3fv(uniforms.transform,false,matrix);gl.uniform4fv(uniforms.color,color);gl.uniform2fv(uniforms.offset,offset);gl.uniform1i(uniforms.clamped,clamped);gl.uniform1i(uniforms.masked,masked);gl.uniform1i(uniforms.additive,additive);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);};
    return {canvas,gl,uniforms,textures,background,upload,texture,quad,remove};
  }
  function prune(images){if(!renderer)return;const live=new Set(images.values());for(const image of renderer.textures.keys())if(!live.has(image))renderer.remove(image);}
  function draw(context,layer,animation,images,project,time){
    const p=animation.particle,elapsed=time-animation.delay;if(elapsed<0)return;
    const particles=states(p,elapsed);if(!particles.length)return;
    if(!renderer||renderer.gl.isContextLost())renderer=createRenderer();
    const r=renderer,{gl,uniforms}=r;
    if(r.canvas.width!==context.canvas.width)r.canvas.width=context.canvas.width;
    if(r.canvas.height!==context.canvas.height)r.canvas.height=context.canvas.height;
    gl.viewport(0,0,r.canvas.width,r.canvas.height);
    gl.uniform2f(uniforms.viewport,project.canvas.width,project.canvas.height);gl.uniform1i(uniforms.image,0);gl.uniform1i(uniforms.mask,1);
    gl.activeTexture(gl.TEXTURE0);r.upload(r.background,context.canvas,true);gl.disable(gl.BLEND);
    r.quad([project.canvas.width,0,0,0,project.canvas.height,0,project.canvas.width/2,project.canvas.height/2,1],[1,1,1,1],[0,0],true,false);
    gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);
    if(p.mask){gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,r.texture(images.get(p.mask)));}
    const total=animation.frames.reduce((n,f)=>n+f.duration,0),sx=layer.width/p.basis[0]*p.scale[0],sy=layer.height/p.basis[1]*p.scale[1],draws=[];
    for(const state of particles){
      let phase=state.age%total,frame=animation.frames.at(-1);
      for(const f of animation.frames){if(phase<f.duration-1e-9){frame=f;break;}phase-=f.duration;}
      const image=images.get(frame.source);if(!image)continue;
      const [rx,ry,rz]=state.rotation.map(v=>v*Math.PI/180),cz=Math.cos(rz),sz=Math.sin(rz),cx=Math.cos(rx),cy=Math.cos(ry),sinx=Math.sin(rx),siny=Math.sin(ry);
      const w=state.size[0]*state.scale*sx,h=state.size[1]*state.scale*sy;
      const matrix=[cy*cz*w,cy*sz*w,0,(sinx*siny*cz-cx*sz)*h,(sinx*siny*sz+cx*cz)*h,0,layer.x+layer.width/2+state.position[0]*sx,layer.y+layer.height/2+state.position[1]*sy,1];
      draws.push({state,image,matrix});
    }
    const factors={ZERO:'ZERO',ONE:'ONE',SRCALPHA:'SRC_ALPHA',INVSRCALPHA:'ONE_MINUS_SRC_ALPHA',DESTALPHA:'DST_ALPHA',INVSRCCOLOR:'ONE_MINUS_SRC_COLOR'};
    const pass=(dual,count,src,dst)=>{
      if(!count)return;
      gl.blendFuncSeparate(gl[src],gl[dst],src==='ZERO'?gl.ZERO:gl.ONE,src==='ZERO'?gl.ONE:gl.ONE_MINUS_SRC_ALPHA);
      for(const {state,image,matrix} of draws){
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,r.texture(image));
        const color=dual?state.dualColor:state.color;
        const rgb=color.slice(0,3).map(v=>src==='ZERO'?v*layer.opacity:v);
        for(let i=0;i<count;i++)r.quad(matrix,[...rgb,Math.max(0,Math.min(1,color[3]*layer.opacity))],state.uv,p.clamp,Boolean(p.mask),src==='SRC_ALPHA'&&['ONE','DST_ALPHA'].includes(dst));
      }
    };
    // The client completes the base pass for the whole effect before its dual pass.
    // Reuse the sampled particles so both passes keep identical ages/frames/transforms.
    pass(false,p.drawCount,factors[p.blend[0]],factors[p.blend[1]]);
    if(p.dual)pass(true,p.dualDrawCount,'SRC_ALPHA','DST_ALPHA');
    context.save();context.setTransform(1,0,0,1,0,0);context.globalAlpha=1;context.globalCompositeOperation='copy';context.drawImage(r.canvas,0,0);context.restore();
  }
  return Object.freeze({validate,states,valueAt,integral,draw,prune});
})();
