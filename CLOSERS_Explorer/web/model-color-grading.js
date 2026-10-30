// CW_ColorGrading: exposure is fixed to zero by the source CPU update path.
export const colorGradingFragment=`
uniform bool avatarGradeEnabled;
uniform vec3 avatarGradeRgb;
uniform vec3 avatarGradeBcs;
vec4 avatarGrade(vec4 color){
  if(!avatarGradeEnabled)return color;
  vec3 tinted=((color.rgb+avatarGradeBcs.x-.5)*max(1.+avatarGradeBcs.y,0.)+.5)*avatarGradeRgb;
  float luma=dot(tinted,vec3(.2125,.7154,.0721));
  return vec4(clamp(vec3(luma)+avatarGradeBcs.z*(tinted-vec3(luma)),0.,1.),clamp(color.a,0.,1.));
}`;

export function normalizeColorGrading(value){
  const vector=(v,fallback,min,max)=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)?v.map((n,i)=>Math.max(min[i],Math.min(max[i],n))):fallback;
  return {enabled:value?.enabled===true,rgb:vector(value?.rgb,[1,1,1],[0,0,0],[2,2,2]),bcs:vector(value?.bcs,[0,0,1],[-1,-1,0],[1,2,2])};
}
