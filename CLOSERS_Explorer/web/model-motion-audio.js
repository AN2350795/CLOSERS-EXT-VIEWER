// Decode before playback; buffers are shared by events, sources belong to one
// event occurrence. Pausing destroys sources, never the motion's event clock.
export class MotionAudio {
  constructor({fetchAudio=(url,options)=>fetch(url,options),createContext=()=>new AudioContext(),random=Math.random}={}){
    this.fetchAudio=fetchAudio;this.createContext=createContext;this.random=random;this.buffers=new Map();this.events=new Map();this.nodes=new Set();this.bytes=0;this.generation=0;
  }
  async prepare(entry,token,signal){
    this.context??=this.createContext();const generation=this.generation;let ready=0;
    for(const sound of entry.sounds||[]){
      if(!sound.selected)continue;
      const id=sound.selected;
      if(!this.buffers.has(id))this.buffers.set(id,(async()=>{
        const response=await this.fetchAudio('/api/media/'+id+'?token='+encodeURIComponent(token),{signal});
        if(!response.ok)throw Error('음원을 불러오지 못했습니다: '+sound.name);
        const length=Number(response.headers.get('Content-Length'));
        if(length>64*1024*1024)throw Error('음원 크기가 64 MiB를 초과했습니다.');
        const body=await response.arrayBuffer();if(body.byteLength>64*1024*1024)throw Error('음원 크기가 64 MiB를 초과했습니다.');
        const buffer=await this.context.decodeAudioData(body);
        if(generation!==this.generation||signal.aborted)throw new DOMException('취소된 음원 준비','AbortError');
        const bytes=buffer.length*buffer.numberOfChannels*4;
        if(this.bytes+bytes>128*1024*1024)throw Error('선택한 음원의 메모리가 128 MiB를 초과했습니다.');
        this.bytes+=bytes;return buffer;
      })());
      try{await this.buffers.get(id);ready++;}catch(e){if(signal.aborted)throw e;entry.loadWarnings.push(e.message);}
    }
    return ready;
  }
  unlock(){try{this.context??=this.createContext();if(this.context.state==='suspended')return this.context.resume().catch(()=>{});}catch{}}
  stop(record,fade=0){if(record.source){const source=record.source,gain=record.gain;record.source=null;if(fade&&this.context.state==='running'){gain.gain.setValueAtTime(gain.gain.value,this.context.currentTime);gain.gain.linearRampToValueAtTime(0,this.context.currentTime+fade);source.stop(this.context.currentTime+fade);}else{source.stop();source.disconnect();gain.disconnect();this.nodes.delete(source);}}}
  pause(){for(const record of this.events.values())this.stop(record);for(const source of this.nodes){source.stop();source.disconnect();source.motionGain.disconnect();}this.nodes.clear();}
  reset(){this.generation++;this.pause();this.events.clear();this.buffers.clear();this.bytes=0;}
  seek(){this.pause();this.events.clear();}
  async dispose(){this.reset();await this.context?.close();}
  sync(entry,{active,since,rate,total,restart,playing,speed,enabled}){
    let record=this.events.get(entry.id);
    if(restart&&record){this.stop(record);this.events.delete(entry.id);record=null;}
    if(!enabled){if(record)this.stop(record);this.events.delete(entry.id);return;}
    if(!record&&active&&since>=0){
      for(const other of this.events.values())if(entry.stop_groups?.includes(other.entry.sound_group)){this.stop(other,entry.fade_out);other.stopped=true;}
      const choices=(entry.sounds||[]).filter(s=>s.selected),choice=Number.isInteger(entry.soundChoice)?entry.sounds[entry.soundChoice]:choices[Math.floor(this.random()*choices.length)];
      record={entry,born:total-since/rate,stopped:this.random()>=entry.probability,buffer:null,source:null};this.events.set(entry.id,record);
      if(choice)this.buffers.get(choice.selected)?.then(buffer=>record.buffer=buffer,()=>{});
    }
    if(!record)return;
    if(!active&&(entry.stop_on_end||(entry.loop&&!entry.keep_on_end))){this.stop(record,entry.fade_out);record.stopped=true;return;}
    const age=Math.max(0,total-record.born),buffer=record.buffer;
    if(!playing||record.stopped||!buffer||this.context.state!=='running'){this.stop(record);return;}
    if(!entry.loop&&age>=buffer.duration){this.stop(record);return;}
    if(record.source){record.source.playbackRate.value=speed;return;}
    const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;source.loop=entry.loop;source.playbackRate.value=speed;gain.gain.value=entry.volume;
    source.connect(gain);gain.connect(this.context.destination);record.source=source;record.gain=gain;source.motionGain=gain;this.nodes.add(source);
    source.onended=()=>{source.disconnect();gain.disconnect();this.nodes.delete(source);if(record.source===source)record.source=null;};
    source.start(0,entry.loop?age%buffer.duration:age);
  }
}
