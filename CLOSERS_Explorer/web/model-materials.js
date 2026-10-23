// CW_CARTOONLIGHT.PS.CSO writes map * color * strength to MRT1.
// Local additive preview, without game bloom, exposure or the runtime strength
// multiplier. The former diffuse * sphereMap * .35 skin effect had no basis.
export function installMaterialPreview(material){
  const input=material.userData.input.material_preview;
  if(input?.kind!=='emissive'||input.status!=='approximate')return;
  const uniforms={avatarEmissiveMap:{value:null},avatarMaterialEnabled:{value:0},
    avatarEmissiveColor:{value:input.color.slice(0,3)},avatarEmissiveStrength:{value:input.strength}};
  material.userData.materialPreview={uniforms,enabled:true};
  material.customProgramCacheKey=()=> 'closers-emissive-preview-v1';
  material.onBeforeCompile=shader=>{
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
