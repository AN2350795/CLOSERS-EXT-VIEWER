'use strict';
globalThis.AnimationPNG=(()=>{
  const encoder=new TextEncoder(),table=new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
  function chunk(type,data){
    const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);out.set(encoder.encode(type),4);out.set(data,8);
    let crc=0xffffffff;for(let i=4;i<out.length-4;i++)crc=table[(crc^out[i])&255]^(crc>>>8);view.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out;
  }
  function uints(...numbers){const bytes=new Uint8Array(numbers.length*4),view=new DataView(bytes.buffer);numbers.forEach((n,i)=>view.setUint32(i*4,n));return bytes;}
  async function encode({width,height,count,fps,render,progress=()=>{}}){
    if(!Number.isInteger(count)||count<1||count>250||!Number.isInteger(fps)||fps<1||fps>60||width*height*count>268435456)throw Error('움직이는 PNG는 250프레임·합계 268,435,456픽셀까지입니다.');
    const parts=[new Uint8Array([137,80,78,71,13,10,26,10])];let sequence=0,total=0;
    for(let frame=0;frame<count;frame++){
      const canvas=render(frame/fps);let data;
      try{const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG 프레임 생성에 실패했습니다.');data=new Uint8Array(await blob.arrayBuffer());}finally{canvas.width=1;canvas.height=1;}
      const view=new DataView(data.buffer),idat=[];let header;
      for(let offset=8;offset+12<=data.length;){const size=view.getUint32(offset),type=String.fromCharCode(...data.slice(offset+4,offset+8));if(offset+size+12>data.length)throw Error('PNG 프레임이 잘렸습니다.');if(type==='IHDR')header=data.slice(offset+8,offset+8+size);if(type==='IDAT')idat.push(data.slice(offset+8,offset+8+size));offset+=size+12;}
      if(!header||!idat.length||new DataView(header.buffer).getUint32(0)!==width||new DataView(header.buffer).getUint32(4)!==height)throw Error('PNG 프레임 크기가 다릅니다.');
      if(frame===0){parts.push(chunk('IHDR',header),chunk('acTL',uints(count,0)));}
      const control=new Uint8Array(26),cv=new DataView(control.buffer);control.set(uints(sequence++,width,height,0,0));cv.setUint16(20,1);cv.setUint16(22,fps);parts.push(chunk('fcTL',control));
      for(const bytes of idat){if(frame===0)parts.push(chunk('IDAT',bytes));else{const payload=new Uint8Array(bytes.length+4);payload.set(uints(sequence++));payload.set(bytes,4);parts.push(chunk('fdAT',payload));}total+=bytes.length;}
      if(total>128*1024*1024)throw Error('움직이는 PNG가 128 MiB를 초과했습니다. 길이나 출력 크기를 줄여 주세요.');
      progress(frame+1,count);await new Promise(resolve=>setTimeout(resolve,0));
    }
    parts.push(chunk('IEND',new Uint8Array()));return new Blob(parts,{type:'image/apng'});
  }
  return Object.freeze({encode});
})();
