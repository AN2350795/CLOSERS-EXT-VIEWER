// Independent CPU image calculations. No production shaders or render helpers.
// The browser harness prepends this reference to the integration check module.
const postReference=(()=>{
 const byte=v=>Math.round(Math.max(0,Math.min(1,v))*255);
 function sample(p,w,h,u,v){
  const x=Math.max(0,Math.min(w-1,u*w-.5)),y=Math.max(0,Math.min(h-1,v*h-.5)),a=Math.floor(x),b=Math.floor(y),s=x-a,t=y-b;
  const at=(xx,yy,c)=>p[(Math.min(h-1,yy)*w+Math.min(w-1,xx))*4+c]/255;
  return [0,1,2,3].map(c=>(at(a,b,c)*(1-s)+at(a+1,b,c)*s)*(1-t)+(at(a,b+1,c)*(1-s)+at(a+1,b+1,c)*s)*t);
 }
 function sharpen(image,w,h,radius){
  const out=new Uint8Array(image);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=(y*w+x)*4,sum=[0,0,0];
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy){const tap=sample(image,w,h,(x+.5+dx*radius)/w,(y+.5+dy*radius)/h);for(let c=0;c<3;c++)sum[c]+=tap[c];}
   for(let c=0;c<3;c++)out[i+c]=byte(2*image[i+c]/255-sum[c]/8);
  }return out;
 }
 function grade(image,settings,encode=v=>v){
  const out=new Uint8Array(image),[brightness,contrast,saturation]=settings.bcs;
  for(let i=0;i<image.length;i+=4){
   const rgb=[0,1,2].map(c=>((image[i+c]/255+brightness-.5)*Math.max(1+contrast,0)+.5)*settings.rgb[c]),luma=rgb[0]*.2125+rgb[1]*.7154+rgb[2]*.0721;
   for(let c=0;c<3;c++)out[i+c]=byte(encode(Math.max(0,Math.min(1,luma+saturation*(rgb[c]-luma)))));
  }return out;
 }
 function dof(image,depth,w,h,strength){
  let input=image,iw=w,ih=h;
  for(let level=1;level<=2;level++){
   const ow=Math.floor(w/2**level),oh=Math.floor(h/2**level);
   for(let axis=0;axis<2;axis++){
    const out=new Uint8Array(ow*oh*4);
    for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){
     const u=(x+.5)/ow,v=(y+.5)/oh,sum=[0,0,0,0];
     for(let k=-4;k<=4;k++){const tap=sample(input,iw,ih,u+(axis===0?k/ow:0),v+(axis===1?k/oh:0)),weight=Math.exp(-k*k/2)/Math.sqrt(6.2831854820251465);for(let c=0;c<4;c++)sum[c]+=tap[c]*weight;}
     if(level===1&&axis===0)sum[3]=sample(depth,w,h,u,v)[0];out.set(sum.map(byte),(y*ow+x)*4);
    }input=out;iw=ow;ih=oh;
   }
  }
  const out=new Uint8Array(image),disc=[[0,0],[.527837,-.085868],[-.040088,.536087],[-.670445,-.179949],[-.419418,-.616039],[.440453,-.639399],[-.757088,.349334],[.574619,.685879]];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=(y*w+x)*4;if(depth[i+3]<128)continue;
   const u=(x+.5)/w,v=(y+.5)/h,center=depth[i]/255,radius=Math.abs(center-.5),sum=[0,0,0];let total=0;
   for(const [dx,dy] of disc){
    const coarse=sample(input,iw,ih,u+dx*radius*2/w,v+dy*radius*2/h),fine=sample(image,w,h,u+dx*radius/w,v+dy*radius/h);fine[3]=sample(depth,w,h,u+dx*radius/w,v+dy*radius/h)[0];
    const factor=Math.abs(2*fine[3]-1),mixed=fine.map((n,c)=>n*(1-factor)+coarse[c]*factor),weight=mixed[3]>=center?1:Math.abs(2*mixed[3]-1);
    total+=weight;for(let c=0;c<3;c++)sum[c]+=mixed[c]*weight;
   }
   for(let c=0;c<3;c++)out[i+c]=byte(image[i+c]/255*(1-strength)+(total>1e-6?sum[c]/total:image[i+c]/255)*strength);
  }return out;
 }
 return {sharpen,dof,grade};
})();
