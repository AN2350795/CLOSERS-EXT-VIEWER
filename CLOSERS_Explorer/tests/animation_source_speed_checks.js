import * as T from '/vendor/three/three.module.min.js';
import {MotionSequencePlayer} from '/motion-sequence-player.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id),originalFetch=fetch,originalLoop=Object.getOwnPropertyDescriptor(T.WebGLRenderer.prototype,'setAnimationLoop');
let frame;
// The renderer installs this method on each instance. Capture the viewer's
// callback at construction so elapsed time is deterministic in this test.
Object.defineProperty(T.WebGLRenderer.prototype,'setAnimationLoop',{configurable:true,set(){Object.defineProperty(this,'setAnimationLoop',{configurable:true,value:fn=>{frame=fn;}});}});
const clip={index:0,name:'EMOTION_DANCE',duration:20};
window.fetch=async(url,options)=>{
 const path=String(url);let data;
 if(path.startsWith('/api/model-browser'))data={total:0,items:[],facets:{character:[],kind:[],family:[],part:[],variant:[]}};
 else if(path.startsWith('/api/model-scene'))data={frames:[],meshes:[{name:'triangle',frame:-1,vertices:[-1,0,0,1,0,0,0,2,0],indices:[0,2,1],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,0,0,1]}]}],sources:[{name:'test.X',entry_id:1}],skeleton_source:{name:'test.X',entry_id:1,sha256:'rig'},motion:{candidates:[]},animation:{name:'test.XMD',selected:9,candidates:[]},warnings:[]};
 else if(path.startsWith('/api/model-animations'))data={skeleton_source:{sha256:'rig'},animation_source:{name:'test.XMD',sha256:'motion'},clips:[clip],mapping:{verified_bones:0,verified_keys:0,maximum_error:0}};
 else if(path.startsWith('/api/model-clip'))data={skeleton_source:{sha256:'rig'},clip,playback:{state:'USN_EMOTION_DANCE',speed:.5},keys:[],mapping:{frames:[]},extras:[]};
 else return originalFetch(url,options);
 return new Response(JSON.stringify(data));
};
try{
 await import('/model.js');await modelViewer.loadModel([1]);
 for(let i=0;i<500&&!modelViewer.state.animation;i++)await new Promise(r=>setTimeout(r,5));
 await modelViewer.chooseClip(0);check(frame,'viewer frame loop missing');
 let now=performance.now();frame(now);const state=modelViewer.state;
 const advance=(userSpeed,seconds)=>{state.time=0;state.playing=true;$('animation-speed').value=String(userSpeed);for(let i=0;i<seconds*20;i++){now+=50;frame(now);}state.playing=false;return state.time;};
 check(Math.abs(advance(1,1)-.5)<1e-8,'1x ignored source half-speed');
 check(Math.abs(advance(2,1)-1)<1e-8,'user speed did not multiply the source speed once');
 check(Math.abs(advance(.5,1)-.25)<1e-8,'slow user playback ignored source speed');
 // Sequence steps already carry native speed and must not be slowed twice.
 const definition={label:'fixture',steps:[{name:clip.name,state:'USN_EMOTION_DANCE',speed:.5,start_time:0,cancel_time:0},{name:'END',state:'END',speed:1,start_time:0,cancel_time:0}],loop_index:0,end_index:1};
 state.sequence=new MotionSequencePlayer(definition,[state.clip,{...state.clip,clip:{name:'END',duration:1}}]);state.time=0;state.playing=true;$('animation-speed').value='1';
 for(let i=0;i<20;i++){now+=50;frame(now);}check(Math.abs(state.time-.5)<1e-8,'sequence source speed was applied twice');
 state.playing=false;state.sequence=null;delete state.clip.playback;
 check(Math.abs(advance(1,1)-1)<1e-8,'ordinary/legacy playback changed');
 document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{window.fetch=originalFetch;if(originalLoop)Object.defineProperty(T.WebGLRenderer.prototype,'setAnimationLoop',originalLoop);else delete T.WebGLRenderer.prototype.setAnimationLoop;}
