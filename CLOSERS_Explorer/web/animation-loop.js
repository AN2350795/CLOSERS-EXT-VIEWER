'use strict';
globalThis.AnimationLoop=(()=>{
  const maximum=v=>Array.isArray(v)?Math.max(...v):v;
  const minimum=v=>Array.isArray(v)?Math.min(...v):v;
  function timings(project){
    return project.layers.filter(l=>l.visible&&l.animation&&(!l.markParent||project.layers.find(p=>p.id===l.markParent)?.visible)).map(l=>{
      const a=l.animation,p=a.particle;
      return {name:l.name,texture:a.frames.length>1?a.frames.reduce((n,f)=>n+f.duration,0):null,frames:a.frames.length,
        shortest:Math.min(...a.frames.map(f=>f.duration)),longest:Math.max(...a.frames.map(f=>f.duration)),delay:a.delay,life:p?p.life:null};
    });
  }
  function textureCycle(project,fps){
    const periods=timings(project).filter(t=>t.texture!==null).map(t=>BigInt(Math.round(t.texture*1e6)));
    if(!periods.length||!Number.isInteger(fps)||fps<1||fps>60)return null;
    const limit=BigInt(Math.floor(Math.min(10,250/fps)*1e6)),gcd=(a,b)=>{while(b){const r=a%b;a=b;b=r;}return a;};
    let cycle=1n;
    for(const period of periods){if(period<=0n)return null;cycle=cycle/gcd(cycle,period)*period;if(cycle>limit)return null;}
    const seconds=Number(cycle)/1e6;
    return seconds<.1?seconds*Math.ceil(.1/seconds):seconds;
  }
  function plan(project,duration,fps,smooth){
    if(!Number.isFinite(duration)||duration<.1||duration>10||!Number.isInteger(fps)||fps<1||fps>60)throw Error('저장 길이 또는 FPS가 올바르지 않습니다.');
    const count=Math.ceil(duration*fps-1e-9),period=count/fps;
    if(count>250)throw Error('최대 250프레임입니다. 저장 길이나 FPS를 줄여 주세요.');
    let warmup=0;
    if(smooth)for(const l of project.layers){
      if(!l.visible||!l.animation||(l.markParent&&!project.layers.find(parent=>parent.id===l.markParent)?.visible))continue;
      const a=l.animation,p=a.particle;
      let settling=0;
      if(p){
        const life=maximum(p.life),rate=minimum(p.rate);
        // A very long life is a persistent plane, not a million-second intro.
        if(life<=15&&rate>0&&maximum(p.emitterLife)>life)settling=life+Math.min(2.5,1/rate);
      }
      warmup=Math.max(warmup,a.delay+settling);
    }
    const blend=smooth?Math.min(.5,period/4):0;
    return {count,period,warmup:smooth?Math.max(blend,Math.min(15,warmup))+1/fps:0,blend};
  }
  function renderer(render,settings){
    return time=>{
      const t=time>=0&&time<settings.period?time:((time%settings.period)+settings.period)%settings.period;
      const first=render(settings.warmup+t);
      if(!settings.blend||t<=settings.period-settings.blend)return first;
      let second;
      try{
        second=render(settings.warmup+t-settings.period);
        const phase=(t-settings.period+settings.blend)/settings.blend,weight=phase*phase*(3-2*phase);
        const ctx=first.getContext('2d'),a=ctx.getImageData(0,0,first.width,first.height),b=second.getContext('2d').getImageData(0,0,first.width,first.height);
        // Interpolate premultiplied RGBA. Alpha-over crossfades would dim the
        // static illustration and leave trails in partially transparent areas.
        for(let i=0;i<a.data.length;i+=4){
          if(a.data[i]===b.data[i]&&a.data[i+1]===b.data[i+1]&&a.data[i+2]===b.data[i+2]&&a.data[i+3]===b.data[i+3])continue;
          const left=a.data[i+3]*(1-weight),right=b.data[i+3]*weight,alpha=left+right;
          for(let channel=0;channel<3;channel++)a.data[i+channel]=alpha?(a.data[i+channel]*left+b.data[i+channel]*right)/alpha:0;
          a.data[i+3]=alpha;
        }
        ctx.putImageData(a,0,0);return first;
      }catch(error){first.width=1;first.height=1;throw error;}
      finally{if(second){second.width=1;second.height=1;}}
    };
  }
  return Object.freeze({timings,textureCycle,plan,renderer});
})();
