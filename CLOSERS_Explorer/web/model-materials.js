// CW_CARTOONLIGHT.PS.CSO writes map * color * strength to MRT1.
// Local additive preview, without game bloom, exposure or the runtime strength
// multiplier. The former diffuse * sphereMap * .35 skin effect had no basis.
export function installMaterialPreview(material){
  const input=material.userData.input.material_preview;
  if(input?.kind!=='emissive'||input.status!=='approximate')return;
  const uniforms={avatarEmissiveMap:{value:null},avatarMaterialEnabled:{value:0},
    avatarEmissiveColor:{value:input.color.slice(0,3)},avatarEmissiveStrength:{value:input.strength}};
  material.userData.materialPreview={uniforms,enabled:true};
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.customProgramCacheKey=()=>key+'|closers-emissive-preview-v1';
  material.onBeforeCompile=shader=>{
    previous.call(material,shader);
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec2 avatarMaterialUv;\n'+shader.vertexShader
      .replace('#include <uv_vertex>','#include <uv_vertex>\navatarMaterialUv = uv;');
    shader.fragmentShader='varying vec2 avatarMaterialUv;\nuniform sampler2D avatarEmissiveMap;\nuniform float avatarMaterialEnabled;\nuniform vec3 avatarEmissiveColor;\nuniform float avatarEmissiveStrength;\n'+shader.fragmentShader
      .replace('#include <opaque_fragment>',`
if (avatarMaterialEnabled > 0.5) {
  outgoingLight += texture2D(avatarEmissiveMap, avatarMaterialUv).rgb * avatarEmissiveColor * avatarEmissiveStrength;
}
#include <opaque_fragment>`);
  };
}

export function setMaterialPreview(material,enabled){
  const preview=material.userData.materialPreview;if(!preview)return;
  preview.enabled=enabled;preview.uniforms.avatarMaterialEnabled.value=enabled&&preview.uniforms.avatarEmissiveMap.value?1:0;
}

export function setMaterialPreviewMap(material,map){
  const preview=material.userData.materialPreview;if(!preview)return;
  preview.uniforms.avatarEmissiveMap.value=map;setMaterialPreview(material,preview.enabled);
}

// Opt-in MatCap approximation. Explicitly resolved _BUMP RGB/alpha provide
// normals and the gloss mask; absent maps retain the vertex-normal preview.
export function installMatcapPreview(material){
  const input=material.userData.input.matcap_preview;
  if(input?.kind!=='matcap'||input.status!=='approximate')return;
  const specular=input.specular?.status==='approximate'?input.specular:null;
  const uniforms={avatarMatcapMap:{value:null},avatarMatcapEnabled:{value:0},avatarMatcapStrength:{value:1},avatarMatcapNormalMap:{value:null},avatarMatcapNormalEnabled:{value:0},avatarSpecularEnabled:{value:0},avatarSpecularColor:{value:specular?specular.color.slice(0,3):[0,0,0]},avatarSpecularPower:{value:specular?.power??1}};
  material.userData.matcapPreview={uniforms,enabled:false,useNormal:true,specularEnabled:false,specular};
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.customProgramCacheKey=()=>key+'|closers-matcap-specular-v3';
  material.onBeforeCompile=shader=>{
    previous.call(material,shader);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec3 avatarMatcapNormal;\nvarying vec2 avatarMatcapUv;\nvarying vec3 avatarMatcapPosition;\n'+shader.vertexShader
      .replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )','#if 1')
      .replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\navatarMatcapNormal = transformedNormal;')
      .replace('#include <uv_vertex>','#include <uv_vertex>\navatarMatcapUv = uv;')
      .replace('#include <project_vertex>','#include <project_vertex>\navatarMatcapPosition = mvPosition.xyz;');
    shader.fragmentShader='varying vec3 avatarMatcapNormal;\nvarying vec2 avatarMatcapUv;\nvarying vec3 avatarMatcapPosition;\nuniform sampler2D avatarMatcapMap;\nuniform float avatarMatcapEnabled;\nuniform float avatarMatcapStrength;\nuniform sampler2D avatarMatcapNormalMap;\nuniform float avatarMatcapNormalEnabled;\nuniform float avatarSpecularEnabled;\nuniform vec3 avatarSpecularColor;\nuniform float avatarSpecularPower;\n'+shader.fragmentShader
      .replace('#include <opaque_fragment>',`
if (avatarMatcapEnabled > 0.5) {
  vec3 capNormal = normalize(avatarMatcapNormal);
  float capMask = 1.0;
  if (avatarMatcapNormalEnabled > 0.5) {
    vec4 bump = texture2D(avatarMatcapNormalMap, avatarMatcapUv);
    capMask = any(greaterThan(bump.rgb, vec3(0.0))) ? bump.a : 0.0;
    vec3 mapNormal = bump.rgb * 2.0 - 1.0;
    vec3 dp1 = dFdx(avatarMatcapPosition), dp2 = dFdy(avatarMatcapPosition);
    vec2 duv1 = dFdx(avatarMatcapUv), duv2 = dFdy(avatarMatcapUv);
    float determinant = duv1.x * duv2.y - duv1.y * duv2.x;
    vec3 tangent = dp1 * duv2.y - dp2 * duv1.y;
    vec3 bitangent = -dp1 * duv2.x + dp2 * duv1.x;
    if (abs(determinant) > 1e-10 && dot(tangent,tangent) > 1e-10 && dot(bitangent,bitangent) > 1e-10 && dot(mapNormal,mapNormal) > 1e-10) {
      tangent = normalize(tangent) * sign(determinant);
      bitangent = normalize(bitangent) * sign(determinant);
      capNormal = normalize(mat3(tangent,bitangent,capNormal) * normalize(mapNormal));
    }
  }
  vec2 matcapUv = capNormal.xy * vec2(0.5, -0.5) + 0.5;
  outgoingLight = clamp(outgoingLight + texture2D(avatarMatcapMap, matcapUv).rgb * capMask * avatarMatcapStrength, 0.0, 1.0);
  if (avatarSpecularEnabled > 0.5 && dot(avatarMatcapPosition,avatarMatcapPosition) > 1e-10) {
    // Source: pow(saturate(dot(N,normalize(L+V))),power) * color * bump.a.
    // Inspection light is at the camera, so L=V and normalize(L+V)=V.
    // The game's runtime light position is not inferred from preset direction.
    vec3 halfDirection = normalize(-avatarMatcapPosition);
    float specularDot = clamp(dot(capNormal,halfDirection),0.0,1.0);
    float specular = avatarSpecularPower == 0.0 ? 1.0 : pow(specularDot,avatarSpecularPower);
    outgoingLight = clamp(outgoingLight + avatarSpecularColor * specular * capMask * avatarMatcapStrength,0.0,1.0);
  }
}
#include <opaque_fragment>`);
  };
}

export function setMatcapPreview(material,enabled,strength=1,useNormal=true){
  const preview=material.userData.matcapPreview;if(!preview)return;
  preview.enabled=enabled;preview.useNormal=useNormal;
  preview.uniforms.avatarMatcapStrength.value=Number.isFinite(strength)?Math.max(0,Math.min(1,strength)):1;
  preview.uniforms.avatarMatcapEnabled.value=enabled&&preview.uniforms.avatarMatcapMap.value?1:0;
  preview.uniforms.avatarMatcapNormalEnabled.value=useNormal&&preview.uniforms.avatarMatcapNormalMap.value?1:0;
  preview.uniforms.avatarSpecularEnabled.value=enabled&&preview.specularEnabled&&preview.specular&&useNormal&&preview.uniforms.avatarMatcapMap.value&&preview.uniforms.avatarMatcapNormalMap.value?1:0;
}

export function setMatcapPreviewMap(material,map){
  const preview=material.userData.matcapPreview;if(!preview)return;
  preview.uniforms.avatarMatcapMap.value=map;
  setMatcapPreview(material,preview.enabled,preview.uniforms.avatarMatcapStrength.value,preview.useNormal);
}

export function setMatcapNormalMap(material,map){
  const preview=material.userData.matcapPreview;if(!preview)return;
  preview.uniforms.avatarMatcapNormalMap.value=map;
  setMatcapPreview(material,preview.enabled,preview.uniforms.avatarMatcapStrength.value,preview.useNormal);
}

export function setSpecularPreview(material,enabled){
  const preview=material.userData.matcapPreview;if(!preview)return;
  preview.specularEnabled=enabled;
  setMatcapPreview(material,preview.enabled,preview.uniforms.avatarMatcapStrength.value,preview.useNormal);
}
