import * as T from '/vendor/three/three.module.min.js';
import {setupMotionExtras} from '/model-motion-extras.js';
const check=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id),calls=[];
const wait=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out '+fn);};
let extras,framed=0;
try{
 localStorage.setItem('closers-motion-extras',JSON.stringify({effects:true,models:true,danceLight:'spotlight'}));
 const scene=new T.Scene(),root=new T.Group();scene.add(root);
 const weapon=new T.Mesh(new T.PlaneGeometry(),new T.MeshBasicMaterial());weapon.userData.part='WEAPON';root.add(weapon);
 const common={state:'USN_EMOTION_DANCE',condition_schema:2,source:'fixture.LUA',status:'ready',conditions:{},bone:'',offset:[0,0,0],rotation:[0,0,0],scale:1,at:0,anim_time:true,follow:false,state_end:false,animation:null,speed:1,loop:false,life:10,color:[1,1,1,1],fades:[],depth_test:true,depth_write:true};
 const custom=id=>({m_vecShowEffectCustomID:{1:id}});
 const light={...common,key:'light',kind:'effect',label:'DE_HYPER_MODE_2026_BOSS_HOD_BUFF_SPOT_LIGHT',conditions:custom(13),resources:[{selected:13}]};
 const child={...common,key:'child',parent_key:'light',kind:'particle',label:'notes',conditions:{parent:custom(13)},resources:[],images:[],particle:{seed:1,type:'PCT_3D_PLANE',max_particles:1,rate:0,instant:1,life:1,emitter_life:1,deaths:1,depth_test:true,depth_write:false,blend:['SRCALPHA','ONE'],frames:[],tracks:[]}};
 const mirror={...light,key:'mirror',label:'mirror ball',conditions:custom(1),resources:[{selected:1}]};
 const floor={...light,key:'floor',label:'other stage effects',conditions:custom(13),resources:[{selected:77}]};
 const alias={...light,key:'snowman',label:'snowman',conditions:{},state:'USN_EMOTION_SNOWMAN_END',resources:[{selected:99}]};
 const hide={...common,key:'hide',kind:'equipment',part:'WEAPON',until:10,label:'hide weapon'};
 const packet={clip:{name:'EMOTION_DANCE',duration:10},extras:[alias,mirror,light,child,hide,floor],extras_index_available:true};
 const state={model:{root,bones:[],meshes:[weapon],materials:[weapon.material]},clip:packet,time:.2,playing:false};
 const api=async url=>{calls.push(url);const id=Number(new URL(url,location.href).searchParams.get('entries'));check(id===13,'unselected optional/alias resource loaded '+url);return {frames:[],meshes:[{name:'light',frame:-1,vertices:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],uv:[],skin:[],groups:[[0,3,0]],materials:[{color:[1,1,1,1]}]}],animation:{selected:null}};};
 extras=setupMotionExtras({state,api,getScene:()=>scene,onVisible:()=>framed++,element:(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}});
 await extras.select([packet]);extras.update();
 check(!extras.assets.size&&!calls.length,'plain dance loaded optional lighting by default');
 check($('motion-extra-state').hidden,'dance must not default to a snowman alias state');
 check(!$('motion-dance-controls').hidden&&$('motion-dance-light').value==='none','dance control not reset to none');
 check(!$('motion-extra-items').textContent.includes('snowman')&&!$('motion-extra-items').textContent.includes('mirror ball'),'optional/alias rows cluttered the default dance menu');
 check(!weapon.visible,'base dance equipment event was lost');
 $('show-conditional-extras').checked=true;$('show-conditional-extras').dispatchEvent(new Event('change'));await wait(()=>!extras.loading);
 check(!extras.assets.size&&!calls.length,'generic conditional preview enabled custom decorations');
 const lightSelect=$('motion-dance-light');lightSelect.value='spotlight';lightSelect.dispatchEvent(new Event('change'));await wait(()=>!extras.loading&&extras.assets.size===2);extras.update();
 check([...extras.assets.values()].flat().every(a=>a.anchor.visible),'selected spotlight parent/notes did not render');
 check(framed===0&&extras.meshes.length>0&&extras.framingMeshes.length===0,'optional spotlight changed avatar camera framing');
 check(calls.length===1&&!calls.some(url=>url.includes('99')),'other dance decorations were mixed in');
 lightSelect.value='none';lightSelect.dispatchEvent(new Event('change'));await wait(()=>!extras.loading);check(!extras.assets.size,'switching off left optional assets');
 // A sequence transition must hide even effects that do not die on state end.
 const idle={clip:{name:'ASTAND',duration:1},extras:[]};state.clip=packet;await extras.select([packet,idle]);
 lightSelect.value='spotlight';lightSelect.dispatchEvent(new Event('change'));await wait(()=>!extras.loading&&extras.assets.size===2);extras.update();state.clip=idle;extras.update();
 check($('motion-dance-controls').hidden&&lightSelect.value==='none','dance lighting remained selectable outside dance');
 check([...extras.assets.values()].flat().every(a=>!a.anchor.visible),'dance light survived into idle');
 state.clip=packet;extras.update();check([...extras.assets.values()].flat().every(a=>!a.anchor.visible),'returning to dance reactivated old lighting');
 // Explicit sequence states still win over the default clip presentation.
 await extras.select([packet],[{state:'USN_EMOTION_SNOWMAN_END'}]);check($('motion-dance-controls').hidden,'snowman sequence received dance lighting menu');
 const dance2={clip:{name:'EMOTION_DANCE_2',duration:10},extras:[{...light,state:'USN_EMOTION_DANCE2'}]};state.clip=dance2;await extras.select([dance2]);check(!$('motion-dance-controls').hidden&&lightSelect.value==='none','dance 2 default incorrect');
 // Legacy indexes omitted custom conditions. Until rebuilt, dance extras
 // must stay off even if general preview preferences are already enabled.
 const legacy={clip:packet.clip,extras:[{...light,condition_schema:undefined,conditions:{}}]};state.clip=legacy;await extras.select([legacy]);
 check(!extras.assets.size&&$('motion-dance-controls').hidden&&$('motion-extras-status').textContent.includes('후처리'),'legacy dance index activated unchecked effects');
 extras.dispose();weapon.geometry.dispose();weapon.material.dispose();document.body.dataset.checks='passed';
}catch(e){document.body.dataset.checks='failed';document.body.append(Object.assign(document.createElement('pre'),{textContent:e.stack}));}
finally{extras?.dispose();}
