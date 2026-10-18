const errors=[];
try{
  for(const path of ['/composition-core.js','/animation-png.js'])await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=path;s.onload=resolve;s.onerror=reject;document.head.append(s);});
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const red=document.createElement('canvas'),blue=document.createElement('canvas');for(const [c,color] of [[red,'red'],[blue,'blue']]){c.width=4;c.height=4;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,4,4);}
  const source=key=>({key,archive:'a',ordinal:0,name:key+'.png',format:'png',source_sha256:'a'.repeat(64),image_sha256:'b'.repeat(64),width:4,height:4});
  const raw={schema:'closers-composition',version:1,kind:'composition',canvas:{width:4,height:4,transparent:true,color:'#000000'},sources:[source('s1'),source('s2')],layers:[{id:'l1',source:'s1',name:'effect',role:'fragment',gameFrame:true,x:0,y:0,width:4,height:4,crop:{x:0,y:0,width:4,height:4},opacity:1,visible:true,locked:false,keepRatio:true,animation:{delay:.1,blend:'source-over',color:[1,1,1,1],frames:[{source:'s1',duration:.1},{source:'s2',duration:.2}]}}]};
  const project=CompositionCore.validate(raw),images=new Map([['s1',red],['s2',blue]]);
  check(CompositionCore.usedSources(project.layers).size===2,'animation references were pruned');
  const render=time=>{const c=document.createElement('canvas');c.width=4;c.height=4;CompositionCore.draw(c.getContext('2d'),project,images,4,4,time);return c;};
  const pixel=time=>[...render(time).getContext('2d').getImageData(0,0,1,1).data];
  check(pixel(0)[3]===0,'latency');check(pixel(.1)[0]===255,'first frame');check(pixel(.2)[2]===255,'boundary timing');check(pixel(.4)[0]===255,'sequence loop');
  const copy=CompositionCore.validate(JSON.parse(JSON.stringify(project)));check(copy.layers[0].gameFrame&&copy.layers[0].animation.frames.length===2,'animation settings round trip');
  const bad=JSON.parse(JSON.stringify(project));bad.layers[0].animation.frames[1].source='s9';let rejected=false;try{CompositionCore.validate(bad);}catch{rejected=true;}check(rejected,'missing animation source');
  const blob=await AnimationPNG.encode({width:4,height:4,count:4,fps:10,render});
  const decoder=new ImageDecoder({data:await blob.arrayBuffer(),type:'image/png'});await decoder.tracks.ready;check(decoder.tracks.selectedTrack.frameCount===4,'APNG frame count');
  for(let i=0;i<4;i++){const {image}=await decoder.decode({frameIndex:i});const c=new OffscreenCanvas(4,4),ctx=c.getContext('2d');ctx.drawImage(image,0,0);const actual=[...ctx.getImageData(0,0,1,1).data];check(JSON.stringify(actual)===JSON.stringify(pixel(i/10)),'APNG decoded pixels '+i);check(Math.abs(image.duration-100000)<1,'APNG timing');image.close();}decoder.close();
  project.layers[0].animation.color=[0,0,0,.5];check(pixel(.1)[0]===0&&Math.abs(pixel(.1)[3]-128)<=1,'color and alpha');
  let limited=false;try{await AnimationPNG.encode({width:8192,height:8192,count:5,fps:25,render});}catch{limited=true;}check(limited,'export memory limit');
  const atlas=JSON.parse(JSON.stringify(raw));delete atlas.layers[0].animation;atlas.layers[0].gameIllustration=true;atlas.layers[0].crop.y=1;
  check(CompositionCore.validate(atlas).layers[0].crop.height===4,'game atlas one-pixel edge was discarded');
  atlas.layers[0].gameIllustration=false;let cropped=false;try{CompositionCore.validate(atlas);}catch{cropped=true;}check(cropped,'manual crop escaped source bounds');
  document.body.dataset.checks='passed';
}catch(e){errors.push(e.stack||String(e));document.body.dataset.checks='failed';}
const pre=document.createElement('pre');pre.textContent=errors.join('\n');document.body.append(pre);
