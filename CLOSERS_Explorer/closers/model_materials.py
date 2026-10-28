"""Item material plans; sampler roles are never inferred from filenames.

Source equations and unresolved bindings: docs/AVATAR_MATERIALS.md.
"""
import math
from pathlib import Path


def texture_key(name):
    return Path(str(name or '').replace(chr(92),'/')).name.upper()


def matching(values,name):
    key=texture_key(name)
    exact=[v for k,v in values if texture_key(k)==key]
    found=exact or [v for k,v in values if Path(texture_key(k)).stem==Path(key).stem]
    return found[0] if len(found)==1 else None


def vector(value):
    if not isinstance(value,dict) or {str(k) for k in value}!={'1','2','3','4'}:return None
    result=[value.get(i,value.get(str(i))) for i in range(1,5)]
    return result if all(type(v) in (int,float) and math.isfinite(v) for v in result) else None


def matcap_preview(inputs):
    """Explicit XET binding only; vertex-normal preview has no game mask."""
    texture=inputs.get('m_MultiTexName')
    if not isinstance(texture,str) or not texture.strip():return None
    return dict(kind='matcap',texture=texture_key(texture),status='approximate',
                basis='XET:m_MultiTexName',normal_source='vertex',
                limitations=['normal_map_alpha_not_bound','runtime_specular_not_bound'])


def plan(material,item):
    from .model_items import AvatarItems
    inputs=AvatarItems.material_inputs(material,item)
    report=dict(source_texture=material.get('texture'),reference=item.get('reference',''),inputs=inputs.copy(),
                unsupported=[],textures=[])
    report['source_values']={k:material[k] for k in ('power','specular','emissive') if k in material}
    report['unsupported'].extend('conflicting:'+field for field in item.get('material_conflicts',[]))
    for field in ('m_MultiTexName','m_MaskTexName','m_strDyeingMaskTexName'):
        if inputs.get(field):
            report['textures'].append(dict(field=field,texture=inputs[field],status='unsupported'))
            report['unsupported'].append(field)
    for field in ('SpecularColor','SpecularPower'):
        if field in inputs:report['unsupported'].append(field)
    if item.get('toon_changes'):
        report['toon_changes']=item['toon_changes']
        report['unsupported'].append('toon_changes')
    block=item.get('emissive_materials',{})
    if not isinstance(block,dict):
        report['unsupported'].append('emissive_materials:invalid')
        return report,None
    candidates=[(v.get('OrgTexName'),v) for v in block.values() if isinstance(v,dict)]
    emission=matching(candidates,material.get('texture'))
    preview=None
    if emission is not None:
        color=vector(emission.get('EmissiveColor'))
        strength=emission.get('fEmissiveStrength')
        texture=emission.get('EmissiveTexName')
        if color is not None and type(strength) in (float,int) and math.isfinite(strength) and strength>=0 and isinstance(texture,str) and texture:
            # The game writes map * color * strength to MRT1. Local addition
            # previews the source contribution without simulating game bloom.
            preview=dict(kind='emissive',texture=texture_key(texture),color=color,strength=strength,
                         status='approximate',basis='CW_CARTOONLIGHT.PS.CSO:t12/MRT1')
        else:report['unsupported'].append('emissive_materials:invalid')
    elif any(Path(texture_key(k)).stem==Path(texture_key(material.get('texture'))).stem for k,_ in candidates):
        report['unsupported'].append('emissive_materials:ambiguous')
    return report,preview
