"""Source-verified shininess -> toon enum -> runtime sampler binding."""
import math

# CW.EXE 0x14185dcff registers enum names; 0x1415fce54 dispatches all
# three five-entry banks to the same five resources loaded at 0x141606e8f.
NAMES=('CTT_BASIC0','CTT_BASIC_SKIN1','CTT_BASIC_BLUE2','CTT_BASIC_MAGENTA3','CTT_BASIC_YELLOW4',
       'CTT_BASIC5','CTT_BASIC_SKIN6','CTT_BASIC_BLUE7','CTT_BASIC_MAGENTA8','CTT_BASIC_YELLOW9',
       'CTT_BASIC10','CTT_BASIC_SKIN11','CTT_BASIC_BLUE12','CTT_BASIC_MAGENTA13','CTT_BASIC_YELLOW14','CTT_DAMAGE')
TEXTURES=('CTT_BASIC0.BMP','CTT_BASIC_SKIN1.BMP','CTT_BASIC_WHITE_BLUE2.BMP','CTT_BASIC_MAGENTA3.BMP','CTT_BASIC_YELLOW4.BMP')


def change_rows(block):
    if not isinstance(block,dict):return None
    if set(block)&{'texture_rows','item_rows'}:
        if set(block)-{'texture_rows','item_rows'}:return None
        result=[]
        for value in block.values():
            rows=change_rows(value)
            if rows is None:return None
            result.extend(rows)
        return result
    rows=list(block.values())
    if any(not isinstance(row,dict) or set(row)-{'m_OrgToonTex','m_ChangeToonTex'} for row in rows):return None
    return rows


def toon_preview(material,item=None):
    # Render code reads Assimp $mat.shininess and cvttss2si, not a filename.
    power=material.get('power')
    if type(power) not in (int,float) or not math.isfinite(power):return None
    index=math.trunc(power)
    if not 0<=index<len(NAMES):return None
    item=item or {}
    preview=dict(kind='toon',status='approximate',source_power=power,source_index=index,source_name=NAMES[index],
                 index=index,name=NAMES[index],basis='CW.EXE:0x1417498ef/0x1415fcd10',
                 limitations=['runtime_cartoon_power_not_bound','face_sdf_not_supported','game_postprocess_not_bound'])
    def unsupported(reason):
        return dict(preview,status='unsupported',reason=reason)
    if 'toon_changes' in item.get('material_conflicts',[]):return unsupported('툰 변경 정의 충돌')
    rows=change_rows(item.get('toon_changes',{}))
    if rows is None:return unsupported('툰 변경표 형식 미지원')
    targets=set()
    for row in rows:
        original=row.get('m_OrgToonTex')
        if original not in NAMES:return unsupported('툰 원본 이름 미지원: '+str(original))
        if NAMES.index(original)!=index:continue
        target=row.get('m_ChangeToonTex')
        if target not in NAMES:return unsupported('툰 변경 대상 미지원: '+str(target))
        targets.add(NAMES.index(target))
    if len(targets)>1:return unsupported('동일 표면의 툰 변경 대상 충돌')
    selected=next(iter(targets),index)
    preview.update(index=selected,name=NAMES[selected],texture='CTT_DAMAGE.BMP' if selected==15 else TEXTURES[selected%5])
    return preview
