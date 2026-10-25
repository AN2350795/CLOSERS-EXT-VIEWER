// Advance verified state chains without fetching data during playback.
export class MotionSequencePlayer{
  constructor(definition,clips){
    if(!clips.length||clips.length>16||clips.length!==definition.steps.length||
      !Number.isInteger(definition.loop_index)||definition.loop_index<0||definition.end_index!==definition.loop_index+1||definition.end_index>=clips.length||
      clips.some((clip,i)=>{const step=definition.steps[i];return !Number.isFinite(step.speed)||step.speed<=0||!Number.isFinite(step.start_time)||step.start_time<0||!Number.isFinite(step.cancel_time)||step.cancel_time<0||!Number.isFinite(clip.clip.duration)||clip.clip.duration<=step.start_time;}))throw Error('묶음 동작 구성이 올바르지 않습니다.');
    this.definition=definition;this.clips=clips;this.index=0;this.time=definition.steps[0].start_time;
    this.elapsed=0;this.finishRequested=false;this.completed=false;
  }
  get clip(){return this.clips[this.index];}
  get phase(){return this.completed?'종료':this.index<this.definition.loop_index?'시작':this.index===this.definition.loop_index?'반복':'마무리';}
  requestFinish(){this.finishRequested=true;}
  restart(){this.index=0;this.time=this.definition.steps[0].start_time;this.elapsed=0;this.finishRequested=false;this.completed=false;}
  seek(time){
    if(!Number.isFinite(time))throw Error('동작 재생 위치가 올바르지 않습니다.');
    const start=this.definition.steps[this.index].start_time,duration=this.clip.clip.duration;
    this.time=Math.max(start,Math.min(duration,time));this.elapsed=this.time-start;
    this.completed=this.index===this.clips.length-1&&this.time===duration;
  }
  advance(seconds,multiplier=1){
    if(this.completed)return;
    let remaining=seconds;
    for(let transitions=0;transitions<32;transitions++){
      const step=this.definition.steps[this.index],duration=this.clip.clip.duration,rate=step.speed*multiplier;
      const looping=this.index===this.definition.loop_index;
      if(looping&&!this.finishRequested){
        this.elapsed+=remaining*rate;
        this.time=step.start_time+(this.time-step.start_time+remaining*rate)%(duration-step.start_time);return;
      }
      const needed=Math.max(0,looping?step.cancel_time-this.elapsed:duration-this.time)/rate;
      if(remaining<needed){
        this.elapsed+=remaining*rate;this.time+=remaining*rate;
        if(looping)this.time=step.start_time+(this.time-step.start_time)%(duration-step.start_time);
        return;
      }
      remaining-=needed;
      if(looping)this.index=this.definition.end_index;
      else if(this.index+1<this.clips.length)this.index++;
      else{this.time=duration;this.completed=true;return;}
      this.time=this.definition.steps[this.index].start_time;this.elapsed=0;
    }
    throw Error('묶음 동작의 상태 전환이 너무 많습니다.');
  }
}
