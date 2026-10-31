// CW_Edge.PS.cso: the coefficient is a sample radius in render-target pixels.
export function normalizeSharpen(value){
  return {enabled:value?.enabled===true,radius:Number.isFinite(value?.radius)&&value.radius>=0&&value.radius<=5?value.radius:0};
}

export const sharpenFragment=`
varying vec2 vUv;
uniform sampler2D image;
uniform vec2 imageSize;
uniform float radius;
void main(){
  vec4 original=texture2D(image,vUv);
  vec2 offset=vec2(radius)/imageSize;
  vec3 neighbors=vec3(0.0);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    if(x!=0||y!=0)neighbors+=texture2D(image,vUv+vec2(float(x),float(y))*offset).rgb;
  }
  // The game writes RGBA to UNORM8. Keep the viewer's cutout/export alpha.
  gl_FragColor=vec4(clamp(2.0*original.rgb-neighbors*.125,0.0,1.0),original.a);
}`;
