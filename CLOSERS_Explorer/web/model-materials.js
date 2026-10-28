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

// Opt-in vertex-normal MatCap approximation. The runtime normal-map alpha,
// tangent basis and specular branch are not inferred from diffuse filenames.
export function installMatcapPreview(material){
  const input=material.userData.input.matcap_preview;
  if(input?.kind!=='matcap'||input.status!=='approximate')return;
  const uniforms={avatarMatcapMap:{value:null},avatarMatcapEnabled:{value:0},avatarMatcapStrength:{value:1}};
  material.userData.matcapPreview={uniforms,enabled:false};
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.customProgramCacheKey=()=>key+'|closers-vertex-matcap-v1';
  material.onBeforeCompile=shader=>{
    previous.call(material,shader);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec3 avatarMatcapNormal;\n'+shader.vertexShader
      .replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )','#if 1')
      .replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\navatarMatcapNormal = transformedNormal;');
    shader.fragmentShader='varying vec3 avatarMatcapNormal;\nuniform sampler2D avatarMatcapMap;\nuniform float avatarMatcapEnabled;\nuniform float avatarMatcapStrength;\n'+shader.fragmentShader
      .replace('#include <opaque_fragment>',`
if (avatarMatcapEnabled > 0.5) {
  vec2 matcapUv = normalize(avatarMatcapNormal).xy * vec2(0.5, -0.5) + 0.5;
  outgoingLight = clamp(outgoingLight + texture2D(avatarMatcapMap, matcapUv).rgb * avatarMatcapStrength, 0.0, 1.0);
}
#include <opaque_fragment>`);
  };
}

export function setMatcapPreview(material,enabled,strength=1){
  const preview=material.userData.matcapPreview;if(!preview)return;
  preview.enabled=enabled;
  preview.uniforms.avatarMatcapStrength.value=Number.isFinite(strength)?Math.max(0,Math.min(1,strength)):1;
  preview.uniforms.avatarMatcapEnabled.value=enabled&&preview.uniforms.avatarMatcapMap.value?1:0;
}

export function setMatcapPreviewMap(material,map){
  const preview=material.userData.matcapPreview;if(!preview)return;
  preview.uniforms.avatarMatcapMap.value=map;
  setMatcapPreview(material,preview.enabled,preview.uniforms.avatarMatcapStrength.value);
}
