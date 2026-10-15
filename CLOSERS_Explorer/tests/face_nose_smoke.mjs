// Real face/texture fixtures from face_nose_fixtures.py; isolated static
// HTTP server and headless Chromium CDP. No live catalog or original writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const [base,cdp,output,fixtureURL='/diagnostics/caster-225-fix/fixtures.json']=process.argv.slice(2);
let pages;
for(let i=0;i<100;i++){try{pages=await(await fetch(cdp+'/json')).json();if(pages.some(p=>p.type==='page'))break;}catch{}await new Promise(r=>setTimeout(r,100));}
const page=pages?.find(p=>p.type==='page');assert.ok(page,'headless browser page missing');
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let sequence=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:base});
  for(let i=0;i<100;i++){if(await evaluate('document.readyState==="complete"&&location.href.startsWith('+JSON.stringify(base)+')'))break;await new Promise(r=>setTimeout(r,100));}
  const report=await evaluate(`(async()=>{
    const T=await import('/CLOSERS_Explorer/web/vendor/three/three.module.min.js');
    const {buildModel,applyPose,restorePose}=await import('/CLOSERS_Explorer/web/model-core.js');
    const {isFaceShadingMaterial}=await import('/CLOSERS_Explorer/web/face-preview.js');
    const fixture=await(await fetch(${JSON.stringify(fixtureURL)})).json();
    const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
    renderer.setSize(512,512);renderer.setClearColor(0x111823);renderer.outputColorSpace=T.SRGBColorSpace;
    const scene=new T.Scene(),loader=new T.TextureLoader(),reports=[],images=[];
    const check=(condition,message)=>{if(!condition)throw Error(message);};
    for(const entry of [...fixture.faces,{name:'FIGHTER CLOTH_228_A',data:fixture.assembled},...fixture.caster_bundles,...fixture.representatives]){
      const input=JSON.stringify(entry.data),model=buildModel(entry.data),textures=new Map();
      try{
        scene.add(model.root);
        for(const mat of model.materials){const url=mat.userData.input.test_image;if(!url)continue;let map=textures.get(url);if(!map){map=await loader.loadAsync(url);map.colorSpace=T.SRGBColorSpace;map.flipY=false;map.wrapS=map.wrapT=T.RepeatWrapping;textures.set(url,map);}mat.map=map;mat.color.set(0xffffff);mat.needsUpdate=true;}
        for(let i=0;i<model.meshes.length;i++){
          const mesh=model.meshes[i],source=entry.data.meshes[i];
          const actual=Array.from(mesh.geometry.getAttribute('uv')?.array||[]);
          check(JSON.stringify(actual)===JSON.stringify(source.uv),'original UV changed: '+source.name);
          check(JSON.stringify(Array.from(mesh.geometry.index.array))===JSON.stringify(source.indices),'topology changed: '+source.name);
          check(mesh.geometry.getAttribute('position').count===source.vertices.length/3,'vertex count changed');
          check(mesh.geometry.groups.reduce((n,g)=>n+g.count,0)===mesh.geometry.index.count,'material groups omit faces');
          if(source.skin.length)check(mesh.isSkinnedMesh&&mesh.geometry.getAttribute('skinWeight').count===source.vertices.length/3,'skin lost');
        }
        const character=entry.name.includes('_USER_')?entry.name.split('_USER_')[1].split('_BASIC')[0]:entry.name.replaceAll(' ','-');
        check(JSON.stringify(entry.data)===input,'source scene mutated');
        for(const mat of model.materials){check(mat.side===T.FrontSide,'backface culling disabled');check(mat.userData.faceShadingAlpha?mat.alphaTest===0&&!mat.transparent&&mat.opacity===1:mat.alphaTest===.1,'face/eye opacity changed');}
        const sides=model.materials.map(m=>m.side);
        const views=[];
        const caster=entry.name.startsWith('CASTER CLOTH_225_A');
        for(const area of caster?['head','all']:['all']){
          const index=entry.data.meshes.reduce((best,m,i)=>m.materials.some(v=>isFaceShadingMaterial(m,v))&&m.vertices.length>(entry.data.meshes[best]?.vertices.length||0)?i:best,-1);
          const bounds=new T.Box3();
          if(area==='head'&&index>=0)bounds.expandByObject(model.meshes[index],true);else model.meshes.filter(m=>m.visible).forEach(m=>bounds.expandByObject(m,true));
          const center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3()),extent=Math.max(size.x,size.y)*.6,distance=size.length()*3;
          const camera=new T.OrthographicCamera(-extent,extent,extent,-extent,.01,1000),gl=renderer.getContext();
          camera.far=distance*10;camera.updateProjectionMatrix();
          function capture(original){model.materials.forEach((m,i)=>{m.side=original?T.DoubleSide:sides[i];m.needsUpdate=true;});renderer.render(scene,camera);const pixels=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return {pixels,image:renderer.domElement.toDataURL()};}
          for(const degrees of [-120,-60,-30,0,30,60,120,180]){
            const a=degrees*Math.PI/180;camera.position.copy(center).add(new T.Vector3(Math.sin(a)*distance,0,Math.cos(a)*distance));camera.lookAt(center);camera.updateMatrixWorld(true);
            const before=capture(true),after=capture(false),background=before.pixels.slice(0,3);let changed=0,lost=0,restored=0;
            for(let i=0;i<before.pixels.length;i+=4){const b=before.pixels[i]!==background[0]||before.pixels[i+1]!==background[1]||before.pixels[i+2]!==background[2],a=after.pixels[i]!==background[0]||after.pixels[i+1]!==background[1]||after.pixels[i+2]!==background[2];lost+=b&&!a;restored+=!b&&a;if(before.pixels[i]!==after.pixels[i]||before.pixels[i+1]!==after.pixels[i+1]||before.pixels[i+2]!==after.pixels[i+2])changed++;}
            // Culling may remove exterior outline pixels; the primary face
            // must remain covered rather than developing holes.
            const backgroundPixel=i=>after.pixels[i*4]===background[0]&&after.pixels[i*4+1]===background[1]&&after.pixels[i*4+2]===background[2];
            const exterior=new Uint8Array(512*512),queue=[];
            function visit(i){if(!exterior[i]&&backgroundPixel(i)){exterior[i]=1;queue.push(i);}}
            for(let i=0;i<512;i++){visit(i);visit(511*512+i);visit(i*512);visit(i*512+511);}
            for(let j=0;j<queue.length;j++){const i=queue[j];if(i%512)visit(i-1);if(i%512<511)visit(i+1);if(i>=512)visit(i-512);if(i<511*512)visit(i+512);}
            let holes=0;for(let i=0;i<exterior.length;i++)if(backgroundPixel(i)&&!exterior[i]&&(before.pixels[i*4]!==background[0]||before.pixels[i*4+1]!==background[1]||before.pixels[i*4+2]!==background[2]))holes++;
            const coverage=after.pixels.reduce((n,v,i)=>n+(i%4===0&&(v!==background[0]||after.pixels[i+1]!==background[1]||after.pixels[i+2]!==background[2])),0);
            check(coverage>100,'model disappeared: '+character+' '+degrees);
            const front=Math.abs(degrees)<=60,originalCoverage=coverage+lost-restored;
            check(coverage>=originalCoverage*(front?.99:.90),'primary surfaces lost: '+character+' '+degrees);
            if(front)check(holes<=(caster?64:4),'new front-facing holes: '+character+' '+degrees);
            if(caster&&degrees===30)check(changed>(area==='head'?1000:100),'reported hair/cloth/nose artifact was not reproduced');
            views.push({area,degrees,changed,lost,restored,holes,coverage});
            if(degrees===30)images.push({name:character.toLowerCase()+'-'+area,before:before.image,after:after.image});
          }
        }
        let animation=null;
        if(caster){
          const clip=fixture.caster_clip,time=clip.keys.at(-1).time*.5;
          const boneBefore=model.bones.map(b=>b.matrixWorld.toArray());applyPose(model,clip,time);
          check(model.bones.some((b,i)=>b.matrixWorld.elements.some((v,j)=>Math.abs(v-boneBefore[i][j])>.0001)),'animation did not move bones');
          let vertices=0;for(const mesh of model.meshes)if(mesh.isSkinnedMesh){for(let i=0;i<mesh.geometry.attributes.position.count;i++){const v=mesh.getVertexPosition(i,new T.Vector3());check(Number.isFinite(v.x+v.y+v.z),'nonfinite animated vertex');vertices++;}}
          animation={clip:clip.clip.name,time,vertices};restorePose(model,entry.data);
        }
        reports.push({name:entry.name,views,animation});
      }finally{scene.remove(model.root);model.dispose();textures.forEach(t=>t.dispose());}
    }
    renderer.dispose();renderer.forceContextLoss();return {reports,images};
  })()`);
  fs.mkdirSync(output,{recursive:true});
  for(const img of report.images)for(const key of ['before','after'])fs.writeFileSync(path.join(output,img.name+'-'+key+'.png'),Buffer.from(img[key].split(',')[1],'base64'));
  delete report.images;assert.equal(errors.length,0);fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(report,null,2));
  console.log('PASS: backface culling, original UVs/topology, 23 faces, both CASTER CLOTH_225_A hairstyles with ALPHA parts, animation, NPC and monster at eight angles');
}finally{ws.close();}
