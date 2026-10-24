// Entries own GPU textures; each displayed model holds one reference per key.
// Pending uploads reserve pixels too, so concurrency cannot bypass the budget.
export class TextureCache {
  constructor({maxPixels=32*1024*1024,maxEntries=64}={}){
    this.maxPixels=maxPixels;this.maxEntries=maxEntries;this.pixels=0;this.entries=new Map();
  }
  evict(pixels=0){
    for(const [key,entry] of this.entries){
      if(this.pixels+pixels<=this.maxPixels&&this.entries.size<this.maxEntries)break;
      if(entry.refs||!entry.texture)continue;
      this.entries.delete(key);this.pixels-=entry.pixels;entry.texture.dispose();
    }
  }
  async acquire(key,pixels,load){
    let entry=this.entries.get(key);
    if(entry){entry.refs++;this.entries.delete(key);this.entries.set(key,entry);return entry.promise;}
    if(!Number.isSafeInteger(pixels)||pixels<=0)throw Error('텍스처 크기가 잘못되었습니다.');
    this.evict(pixels);
    if(this.pixels+pixels>this.maxPixels||this.entries.size>=this.maxEntries)throw Error('텍스처 합계는 33,554,432픽셀·64개까지 지원합니다.');
    entry={pixels,refs:1,texture:null,promise:null};this.pixels+=pixels;this.entries.set(key,entry);
    entry.promise=Promise.resolve().then(load).then(texture=>{entry.texture=texture;return texture;},error=>{
      if(this.entries.get(key)===entry){this.entries.delete(key);this.pixels-=pixels;}throw error;
    });
    return entry.promise;
  }
  release(key){const entry=this.entries.get(key);if(entry){if(entry.refs<=0)throw Error('텍스처 참조가 이미 해제되었습니다.');entry.refs--;}}
  clear(){
    for(const entry of this.entries.values()){
      if(entry.texture)entry.texture.dispose();else entry.promise.then(texture=>texture.dispose(),()=>{});
    }
    this.entries.clear();this.pixels=0;
  }
}

export async function limitedMap(values,limit,run){
  let next=0;
  await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{
    while(next<values.length){const index=next++;await run(values[index],index);}
  }));
}
