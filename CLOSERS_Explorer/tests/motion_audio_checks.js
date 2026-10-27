import * as THREE from '/vendor/three/three.module.min.js';
import {setupMotionExtras} from '/model-motion-extras.js';
const check=(value,message)=>{if(!value)throw Error(message);};
const $=id=>document.getElementById(id),element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
try{
  // Use the browser's real audio decoder and deterministic source nodes so
  // assertions do not require sound hardware or autoplay policy exceptions.
  const decoder=new OfflineAudioContext(1,24000,24000),starts=[],stops=[],fetches=[];
  let releases=[],delay=false;
  const wav=new ArrayBuffer(44+24000*2),view=new DataView(wav),str=(at,s)=>[...s].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
  str(0,'RIFF');view.setUint32(4,wav.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,24000,true);view.setUint32(28,48000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,48000,true);
  window.fetch=async(url,options)=>{fetches.push(String(url));if(delay)await new Promise(resolve=>releases.push(resolve));if(options?.signal?.aborted)throw new DOMException('aborted','AbortError');return new Response(String(url).includes('/999?')?new Uint8Array([1,2,3]):wav.slice(0),{headers:{'Content-Length':String(wav.byteLength)}});};
  window.AudioContext=class {
    state='running';currentTime=0;destination={};decodeAudioData=body=>decoder.decodeAudioData(body);
    resume=async()=>{};close=async()=>{};
    createGain(){return {gain:{value:1,setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
    createBufferSource(){const source={playbackRate:{value:1},connect(){},disconnect(){},start(time,offset){starts.push({source,offset,rate:source.playbackRate.value});},stop(time){stops.push({source,time});}};return source;}
  };
  localStorage.removeItem('closers-motion-extras');
  const scene=new THREE.Scene(),root=new THREE.Group(),material=new THREE.MeshBasicMaterial({color:0xffffff}),state={model:{root,bones:[],materials:[material]},time:0,playing:false};scene.add(root);
  const sound=(key,id,overrides={})=>({key,kind:'sound',status:'ready',state:'S',source:'SOUND.LUA',label:key,conditions:{},at:.2,anim_time:true,state_end:true,speed:1,voice:false,probability:1,volume:.3,sound_names:['SE.OGG'],sounds:[{name:'SE.OGG',selected:id,candidates:[]}],resources:[],loop:false,stop_on_end:true,...overrides});
  const effect={key:'parent',kind:'effect',state:'S',status:'unavailable',source:'DE.LUA',label:'missing geometry',error:'no mesh',at:.1,anim_time:true,speed:1,conditions:{}};
  const effectSound=sound('child',1,{parent_key:'parent',at:.2});
  const voice=sound('voice',2,{voice:true,at:.7,sounds:[{name:'VOICE_A.OGG',selected:2,candidates:[]},{name:'VOICE_B.OGG',selected:3,candidates:[]}]});
  const color={key:'color',kind:'color',status:'ready',state:'S',source:'S.LUA',label:'color',conditions:{},at:0,anim_time:true,life:1,transition:0,emissive:0,color:[1,0,0,.5],models:[],resources:[]};
  const info={key:'info',kind:'event_info',status:'unavailable',state:'S',source:'FUTURE.LUA',label:'게임 전용 이벤트',error:'원본 연결 정보',events:{m_EventFuture:{source:'FUTURE.LUA',count:1,resources:['UNSUPPORTED.OGG']}}};
  const packet={clip:{duration:2},extras:[effect,effectSound,voice,color,info]};state.clip=packet;
  const extras=setupMotionExtras({state,api:async()=>{throw Error('geometry should not load');},getScene:()=>scene,element});await extras.select([packet],[{state:'S'}]);
  check(['show-motion-props','show-motion-effects','show-motion-sounds','show-motion-voices','show-motion-colors'].every(id=>$(id).checked),'all accompanying elements default on');
  check(fetches.length===3&&fetches.every(u=>u.startsWith('/api/media/')&&u.includes('token=')),'all alternative audio files are decoded before readiness with authenticated same-origin URLs');
  check($('motion-extra-items').textContent.includes('UNSUPPORTED.OGG'),'unhandled source events remain inspectable without arbitrary playback');
  extras.update();check(!starts.length&&material.color.g===0&&material.opacity===.5,'paused preview applies color without playing audio');
  state.playing=true;state.time=.25;extras.update(.25);await flush();extras.update();check(!starts.length,'child sound waits for its parent-relative event');
  state.time=.4;extras.update(.15);await flush();extras.update();check(starts.length===1&&Math.abs(starts[0].offset-.1)<1e-6,'sound-only child starts at the correct offset even when parent geometry is missing');
  check(starts[0].source.motionGain.gain.value===.3,'source event volume is preserved');
  state.time=.8;extras.update(.4);await flush();extras.update();check(starts.length===2,'a voice candidate plays once without stacking alternatives');
  state.playing=false;extras.update();check(stops.length===2,'pause stops all live sound sources');
  state.playing=true;extras.update();check(starts.length===4,'resume rebuilds sources at the held timeline position');
  $('animation-speed').value='2';extras.update();check(starts.at(-1).source.playbackRate.value===2,'playback speed is synchronized');$('animation-speed').value='1';
  state.time=.1;extras.seek();extras.update();await flush();extras.update();check(starts.length===4,'rewinding before the event clears sounds without replaying future events');
  state.time=.4;extras.update(.3);await flush();extras.update();check(starts.length===5,'sound replays once on a new motion occurrence');
  const next={clip:{duration:1},extras:[]};state.clip=next;state.time=0;extras.update();check(stops.length>=5&&material.color.g===1&&material.opacity===1,'leaving a state stops its sounds and restores character color');
  $('show-motion-sounds').checked=false;$('show-motion-sounds').dispatchEvent(new Event('change'));await flush();
  state.clip=packet;state.time=.4;extras.seek();extras.update();await flush();extras.update();check(starts.length===5,'disabled effects cannot play sound-only events');
  // A looping track survives clip wrap, then stops at the sequence boundary.
  const music=sound('music',4,{at:0,anim_time:false,loop:true}),loopPacket={clip:{duration:1},extras:[music]};
  $('show-motion-sounds').checked=true;await extras.select([loopPacket],[{state:'S'}]);state.clip=loopPacket;state.time=.9;state.playing=true;extras.update(.9);await flush();extras.update();const before=starts.length;
  state.time=.1;extras.update(.2);check(starts.length===before,'global looping music does not double on animation wrap');
  state.clip=next;extras.update();check(stops.at(-1).source===starts.at(-1).source,'leaving a state stops looping music');
  const carry=sound('carry',6,{at:0,anim_time:false,loop:true,stop_on_end:false,keep_on_end:true}),carryPacket={clip:{duration:1},extras:[carry]};
  await extras.select([carryPacket],[{state:'S'}]);state.clip=carryPacket;state.time=0;extras.update();await flush();extras.update();const carrySource=starts.at(-1).source;
  state.clip=next;extras.update();check(!stops.some(s=>s.source===carrySource),'explicit no-stop looping sound continues across sequence stages');
  extras.reset();check(stops.some(s=>s.source===carrySource),'motion reset still stops an explicitly persistent loop');
  const grouped=sound('grouped',5,{at:0,loop:true,sound_group:5,anim_time:false,stop_on_end:false,fade_out:.1});
  const stopGroup=sound('stop',0,{at:.1,sounds:[],stop_groups:[5],fade_out:.1});
  const groupPacket={clip:{duration:2},extras:[grouped,stopGroup]};await extras.select([groupPacket],[{state:'S'}]);
  $('motion-sound-group').value='5';$('motion-sound-group').dispatchEvent(new Event('change'));for(let i=0;i<100&&extras.loading;i++)await new Promise(r=>setTimeout(r,5));
  state.clip=groupPacket;state.time=0;extras.update();await flush();extras.update();const groupedSource=starts.at(-1).source;
  state.time=.2;extras.update(.2);check(stops.some(s=>s.source===groupedSource&&s.time===.1),'sound-group control fades the matching source without requiring an audio file');
  const failed={clip:{duration:2},extras:[sound('bad',999)]};await extras.select([failed],[{state:'S'}]);check(!extras.loading&&$('motion-extra-items').textContent.includes('재생할 음원이 준비되지 않았습니다'),'unsupported audio is explained and cannot leave playback loading forever');
  delay=true;const pending=extras.select([packet],[{state:'S'}]);await flush();check(extras.loading,'audio decoding belongs to motion readiness');extras.reset();for(const release of releases)release();await pending;check(!extras.loading,'cancellation cannot revive pending audio');
  extras.dispose();material.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
