// Approximate sphere-map preview for observed MAT_<id>_SKIN inputs.
// This is separate from the diffuse map: no substitution of avatar colors,
// alpha, toon ramps, dye masks or the game's unverified lighting equations.
export function installMaterialPreview(material){
  if(material.userData.input.material_preview?.kind!=='skin-sphere')return;
  const uniforms={avatarSkinMap:{value:null},avatarSkinEnabled:{value:0}};
  material.userData.materialPreview={uniforms,enabled:true};
  material.defines={...material.defines,AVATAR_SKIN_PREVIEW:1};
  material.customProgramCacheKey=()=> 'closers-skin-sphere-preview-v1';
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec3 avatarNormal;\nvarying vec3 avatarViewPosition;\n'+shader.vertexShader
      .replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )','#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING ) || defined ( AVATAR_SKIN_PREVIEW )')
      .replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\navatarNormal = transformedNormal;')
      .replace('#include <project_vertex>','#include <project_vertex>\navatarViewPosition = -mvPosition.xyz;');
    shader.fragmentShader='varying vec3 avatarNormal;\nvarying vec3 avatarViewPosition;\nuniform sampler2D avatarSkinMap;\nuniform float avatarSkinEnabled;\n'+shader.fragmentShader
      .replace('#include <opaque_fragment>',`
if (avatarSkinEnabled > 0.5) {
  vec3 viewDir = normalize(avatarViewPosition);
  vec3 axis = cross(vec3(0.0, 1.0, 0.0), viewDir);
  vec3 x = length(axis) > 0.0001 ? normalize(axis) : vec3(1.0, 0.0, 0.0);
  vec3 y = cross(viewDir, x);
  vec3 n = normalize(avatarNormal);
  vec2 sphereUv = vec2(dot(x, n), dot(y, n)) * 0.495 + 0.5;
  // Conservative additive highlight; retain the item's diffuse and alpha.
  outgoingLight += diffuseColor.rgb * texture2D(avatarSkinMap, sphereUv).rgb * 0.35;
}
#include <opaque_fragment>`);
  };
}

export function setMaterialPreview(material,enabled){
  const preview=material.userData.materialPreview;if(!preview)return;
  preview.enabled=enabled;preview.uniforms.avatarSkinEnabled.value=enabled&&preview.uniforms.avatarSkinMap.value?1:0;
}

export function setMaterialPreviewMap(material,map){
  const preview=material.userData.materialPreview;if(!preview)return;
  preview.uniforms.avatarSkinMap.value=map;setMaterialPreview(material,preview.enabled);
}
