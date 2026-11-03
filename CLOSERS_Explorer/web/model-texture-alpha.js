import * as THREE from './vendor/three/three.module.min.js';

// Inspect short strips once per cached texture. Share the result between
// cloth classification and conservative depth-only effect occlusion.
export function textureAlphaMode(map){
  if(!map)return 'unknown';
  if(map.userData.avatarAlphaMode)return map.userData.avatarAlphaMode;
  const image=map.image;let clear=false,partial=false,canvas;
  const scan=data=>{for(let i=3;i<data.length;i+=4){if(data[i]===0)clear=true;else if(data[i]<255){partial=true;break;}}};
  try{
    if(image?.data&&map.type===THREE.UnsignedByteType&&map.format===THREE.RGBAFormat)scan(image.data);
    else{
      const width=image?.naturalWidth||image?.width,height=image?.naturalHeight||image?.height;
      if(!width||!height)return 'unknown';
      canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.min(64,height);
      const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return 'unknown';
      for(let y=0;y<height&&!partial;y+=64){const rows=Math.min(64,height-y);context.clearRect(0,0,width,rows);context.drawImage(image,0,y,width,rows,0,0,width,rows);scan(context.getImageData(0,0,width,rows).data);}
    }
    return map.userData.avatarAlphaMode=partial?'blend':clear?'cutout':'opaque';
  }catch{return 'unknown';}
  finally{if(canvas)canvas.width=canvas.height=0;}
}
