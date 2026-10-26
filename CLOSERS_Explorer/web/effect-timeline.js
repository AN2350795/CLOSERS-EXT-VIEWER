export function random(seed){let n=seed>>>0;return ()=>{n=(n+0x6d2b79f5)|0;let x=Math.imul(n^(n>>>15),1|n);x^=x+Math.imul(x^(x>>>7),61|x);return ((x^(x>>>14))>>>0)/4294967296;};}
export const sample=(value,rng)=>Array.isArray(value)?value[0]+(value[1]-value[0])*rng():Number(value||0);
export const vector=(value,rng,fallback=[0,0,0])=>(value||fallback).map(v=>sample(v,rng));
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const defaults={color:[1,1,1,1],dualColor:[1,1,1,1],size:[1,1,1],scale:[1],rotation:[0,0,0],rotationSpeed:[0,0,0],velocity:[0,0,0],position:[0,0,0],uv:[0,0],directionSpeed:[0],drag:[0,0,0],blinkColor:[0,0,0,0],blinkPeriod:[0],crash:[0,0,0],crashPeriod:[0],dissolveColor:[1,1,1,1],dissolveWidth:[.05],dissolveThreshold:[1,1]};
export function createTracks(definitions=[],seed=1,life=1){
  const rng=random(seed),tracks={};
  for(const [name,value] of Object.entries(defaults))tracks[name]={initial:[...value],events:[]};
  for(const event of definitions){
    const track=tracks[event.property];if(!track)continue;
    const value=vector(event.value,rng),start=Math.max(0,sample(event.start,rng));
    if(event.property==='dissolveThreshold'&&value.length===1)value.push(value[0]);
    if(event.mode==='initial')track.initial=value;
    else track.events.push({value,start,end:event.mode==='final'?life:Math.max(start,sample(event.end,rng)),clock:event.clock||'global',mode:event.mode});
  }
  function read(track,time,anim,limit=track.events.length){
    let value=track.initial;
    for(let i=0;i<limit;i++){
      const e=track.events[i],t=e.clock==='anim'?anim:time;if(t<e.start)continue;
      value=e.mode==='at'?e.value:mix(e.from||value,e.value,e.end===e.start?1:Math.min(1,(t-e.start)/(e.end-e.start)));
    }
    return value;
  }
  for(const track of Object.values(tracks)){
    track.events.sort((a,b)=>a.start-b.start);
    track.events.forEach((e,i)=>e.from=read(track,e.start,e.start,i));
  }
  return {
    value(name,time,anim=time){return read(tracks[name],time,anim);},
    integral(name,time){
      const track=tracks[name],knots=[0,time,...track.events.flatMap(e=>[e.start,e.end]).filter(t=>t>0&&t<time)].sort((a,b)=>a-b),out=track.initial.map(()=>0);
      for(let i=1;i<knots.length;i++){
        const a=knots[i-1],b=knots[i],left=read(track,a,a),right=read(track,b-1e-9,b-1e-9);
        for(let j=0;j<out.length;j++)out[j]+=(left[j]+right[j])*(b-a)/2;
      }return out;
    }
  };
}

export class ParticleTimeline{
  constructor(rule){this.rule=rule;const rng=random(rule.seed);this.rate=Math.max(0,sample(rule.rate,rng));this.instant=Math.max(0,Math.floor(sample(rule.instant,rng)))||(!this.rate?1:0);this.emitterLife=Math.max(0,sample(rule.emitter_life,rng));this.deaths=Math.max(0,sample(rule.deaths,rng));this.cache=new Map();this.maxLife=Array.isArray(rule.life)?rule.life[1]:rule.life;this.resetEmitter();}
  resetEmitter(){this.live=[];this.births=0;this.dead=0;this.nextEmission=this.rate?1/this.rate:Infinity;this.lastTime=-1;this.initialized=false;this.stopped=false;}
  life(index){return Math.max(.001,sample(this.rule.life,random((this.rule.seed+Math.imul(index+1,2654435761))>>>0)));}
  birthsAt(time){
    const max=this.rule.max_particles;
    // No capacity pressure: skip history and inspect only the lifetime window.
    if(!this.deaths&&max>=this.instant+Math.ceil(this.rate*this.maxLife)){
      const births=Array.from({length:Math.min(max,this.instant)},(_,i)=>[i,0]);
      const end=Math.floor(Math.min(time,this.emitterLife)*this.rate),first=Math.max(1,Math.ceil((time-this.maxLife)*this.rate));
      for(let i=end;i>=first&&births.length<max;i--)births.push([this.instant+i-1,i/this.rate]);
      return births;
    }
    if(time<this.lastTime)this.resetEmitter();
    const admit=birth=>{const index=this.births++;this.live.push({index,birth,end:birth+this.life(index)});};
    if(!this.initialized){for(let i=0;i<Math.min(max,this.instant);i++)admit(0);this.initialized=true;}
    while(true){
      const death=this.live.reduce((n,p)=>Math.min(n,p.end),Infinity),emission=this.stopped||this.nextEmission>this.emitterLife?Infinity:this.nextEmission;
      if(Math.min(death,emission)>time)break;
      if(death<=emission){
        const alive=this.live.filter(p=>p.end>death+1e-9);this.dead+=this.live.length-alive.length;this.live=alive;
        if(this.deaths>0&&this.dead>=this.deaths)this.stopped=true;
      }else if(this.live.length<max){admit(emission);this.nextEmission+=1/this.rate;}
      else{
        // Full emitters keep their existing particles. They never replace a
        // living particle with a new birth and restart its texture animation.
        this.nextEmission=Math.max(this.nextEmission+1/this.rate,Math.ceil((death-1e-9)*this.rate)/this.rate);
      }
    }
    this.lastTime=time;return this.live.map(p=>[p.index,p.birth]);
  }
  particle(index){
    if(this.cache.has(index))return this.cache.get(index);
    const p=this.rule,rng=random((p.seed+Math.imul(index+1,2654435761))>>>0),life=Math.max(.001,sample(p.life,rng));
    const radius=vector(p.radius,rng),minimum=Array.isArray(p.radius_min)?vector(p.radius_min,rng):[p.radius_min||0,p.radius_min||0,p.radius_min||0];
    for(let i=0;i<3;i++)if(Math.abs(radius[i])<Math.abs(minimum[i]))radius[i]=Math.sign(radius[i]||1)*Math.abs(minimum[i]);
    const particle={life,radius,uv:vector(p.uv_offsets?.[0]?.offset||[0,0],rng),gravity:vector(p.gravity,rng),tracks:createTracks(p.tracks,(p.seed+index*31)>>>0,life)};
    this.cache.set(index,particle);while(this.cache.size>1024)this.cache.delete(this.cache.keys().next().value);return particle;
  }
  at(time){
    const p=this.rule,max=p.max_particles,births=this.birthsAt(time);
    const out=[];
    for(const [index,birth] of births){
      if(out.length>=max)break;
      const particle=this.particle(index),age=time-birth;
      if(age<0||age>=particle.life)continue;
      const t=particle.tracks,velocity=t.integral('velocity',age),drag=t.value('drag',age),spin=t.integral('rotationSpeed',age);
      const position=t.value('position',age).map((v,i)=>v+particle.radius[i]+velocity[i]*Math.exp(-Math.max(0,drag[i])*age*.5)+particle.gravity[i]*age*age*.5);
      const speed=t.value('directionSpeed',age)[0];position[2]+=speed*age;
      const crash=t.value('crash',age);if(crash.some(v=>v!==0)&&position[1]<0)position[1]=-position[1]*.5;
      const size=t.value('size',age),scale=t.value('scale',age)[0],rotation=t.value('rotation',age).map((v,i)=>v+spin[i]);
      let color=t.value('color',age),dual=t.value('dualColor',age);
      const period=t.value('blinkPeriod',age)[0];if(period>0){const blink=t.value('blinkColor',age),factor=(Math.sin(age/period*Math.PI*2)+1)/2;color=color.map((v,i)=>v+(blink[i]-v)*factor);}
      let frame=0,elapsed=age;const frames=p.frames||[],duration=frames.reduce((n,f)=>n+f.duration,0);
      if(duration>0){elapsed%=duration;for(let i=0;i<frames.length;i++){frame=i;if(elapsed<frames[i].duration)break;elapsed-=frames[i].duration;}}
      out.push({position,rotation,size:size.map(v=>v*scale),color,dualColor:dual,uv:t.value('uv',age).map((v,i)=>v+particle.uv[i]),frame,
        dissolveColor:t.value('dissolveColor',age),dissolveWidth:t.value('dissolveWidth',age)[0],dissolveThreshold:t.value('dissolveThreshold',age)});
    }return out;
  }
}
