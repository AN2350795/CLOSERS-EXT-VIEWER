export function isFaceShadingMaterial(mesh,material){
  return /(?:^|_)SDF(?:_|$)/i.test(mesh.name)
    && /(?:^|_)FACE(?:_|\.)/i.test(material.texture||'')
    && !/(?:^|_)EYE(?:_|\.)/i.test(material.texture||'');
}
