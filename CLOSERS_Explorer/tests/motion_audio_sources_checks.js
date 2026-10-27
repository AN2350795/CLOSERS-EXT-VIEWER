import {MotionAudio} from '/model-motion-audio.js';
const check=(value,message)=>{if(!value)throw Error(message);};
try{
  const decoder=new OfflineAudioContext(2,24000,24000),audio=new MotionAudio({createContext:()=>({decodeAudioData:body=>decoder.decodeAudioData(body)}),fetchAudio:async url=>{
    const id=Number(new URL(url,location.href).pathname.split('/').at(-1)),file=sourceAudioFiles.find(f=>f.id===id);check(file,'source audio matches requested ID');
    return new Response(Uint8Array.from(atob(file.body),c=>c.charCodeAt(0)));
  }}),signal=new AbortController().signal;
  for(const file of sourceAudioFiles){const entry={sounds:[{name:file.name,selected:file.id}],loadWarnings:[]};
    check(await audio.prepare(entry,'fixture',signal)===1,'installed sound decodes: '+file.name+' '+entry.loadWarnings.join(' '));
    const buffer=await audio.buffers.get(file.id);check(buffer.duration>0&&buffer.numberOfChannels>0,'installed sound has playable samples: '+file.name);
  }
  audio.reset();check(!audio.buffers.size&&!audio.bytes,'installed audio buffers are released');document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
