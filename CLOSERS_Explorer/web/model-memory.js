const KEY='closers.model-picker.v1';

export function pickerMemory(){
  let data={};
  try{data=JSON.parse(localStorage.getItem(KEY))||{};}catch{}
  if(typeof data!=='object'||Array.isArray(data))data={};
  for(const key of ['favorites','recent'])data[key]=(Array.isArray(data[key])?data[key]:[]).filter(r=>r&&typeof r.identity==='string'&&typeof r.label==='string'&&typeof r.q==='string'&&['sets','files','accessories','eyes'].includes(r.mode)&&typeof r.character==='string').slice(0,30);
  if(!data.settings||typeof data.settings!=='object')data.settings={};
  return {data,save(){try{localStorage.setItem(KEY,JSON.stringify(data));return true;}catch{return false;}}};
}
