"""Loading-card footer definitions, using the installed game's fonts and assets."""
import hashlib
from pathlib import Path


FONT_FILES = ('NanumGothicExtraBold.ttf', 'NanumGothicBold.ttf')


def font_data(data, name):
    if name not in FONT_FILES:
        raise ValueError('지원하지 않는 게임 글꼴입니다.')
    # Loading a verified definition also locates the matching game installation.
    data.body('FONT_MANAGER.LUA')
    path = data.key_source.parent / name.upper()
    data.derived.watch(path)
    return path.read_bytes()


def info_plan(data):
    from .loading import region
    dialog = data.table('DLG_LOADING_DUNGEON_START_V2.LUA')['DIALOG']
    controls = {v['m_Name']: v for v in dialog['CONTROL'].values()}
    info, image, grade = (controls['SLOT_1_'+s] for s in ('INFO', 'IMG', 'AGENT_GRADE'))
    area = data.layout()['area']

    def position(control, item):
        cp, ip = control.get('m_Pos', {}), item.get('m_Pos', {})
        return dict(x=cp.get(1, 0)+ip.get(1, 0)-area['x'],
                    y=cp.get(2, 0)+ip.get(2, 0)-area['y'])

    pictures = []
    for control, keys in ((image, (None,)), (info, ('CHAR_GAUGE', 'CHAR_LINE'))):
        for pic in control['m_vecPicData'].values():
            if pic.get('UVKey') not in keys or not pic.get('TexName'):
                continue
            crop = None
            if pic.get('UVKey'):
                uv = data.table(str(Path(pic['TexName']).with_suffix('.TET')))['TEXTURE_UV']
                crop = region(next(v for v in uv.values() if v.get('m_Key')==pic['UVKey']))
            pictures.append(dict(entry_id=data.image_id(pic['TexName']), crop=crop, gauge=pic.get('UVKey')=='CHAR_GAUGE',
                width=pic['m_fWidth'], height=pic['m_fHeight'], **position(control, pic)))

    fonts = {v['m_FontID']: v for v in data.table('FONT_MANAGER.LUA')['FREE_TYPE_FONT'].values()}
    fields = []
    for key, raw in zip(('level', 'character', 'name', 'progress'), info['m_vecTextData'].values()):
        font = fonts[raw.get('m_FTFontID', 'FFI_DEFAULT')]
        p = position(info, raw)
        align = raw.get('m_AlignX', 'AT_LEFT')
        valign = raw.get('m_AlignY', 'AT_TOP')
        p['x'] += info['m_fWidth'] * {'AT_LEFT':0, 'AT_CENTER':.5, 'AT_RIGHT':1}[align]
        p['y'] += info['m_fHeight'] * {'AT_TOP':0, 'AT_CENTER':.5, 'AT_BOTTOM':1}[valign]
        fields.append(dict(key=key, **p, align={'AT_LEFT':'left','AT_CENTER':'center','AT_RIGHT':'right'}[align],
            baseline={'AT_TOP':'top','AT_CENTER':'middle','AT_BOTTOM':'bottom'}[valign],
            font=font['m_FontName'], size=font['m_FontSize'], outline=font['m_OutLineSize'],
            outlineFactor=font['m_fFontOutLineColorFactor'], boldRate=font['m_fBoldRate'],
            color=[raw.get('m_Color', {}).get(i, 1) for i in range(1, 5)]))

    emblems = []
    center = position(grade, {})
    scale = grade['m_vecPicData'][1]['m_ParticleScale']
    for i in range(1, 9):
        sequence = f'PARTICLE_AGENT_GRADE_{i:02d}'
        effects, warnings = data.effects(dict(effects='"'+sequence+'"',
            positions='{{%s,%s}}'%(center['x'],center['y']), scales='{{%s,%s}}'%(scale[1],scale[2])))
        if warnings or len(effects)!=1:
            raise ValueError('요원 등급 에셋을 해석하지 못했습니다: '+sequence+' · '+' / '.join(warnings))
        effect = effects[0]
        emblems.append(dict(id=i, name=('D','C','B','A','S','SS','SSS','X')[i-1],
            x=effect['x'], y=effect['y'], width=effect['width'], height=effect['height'],
            frames=effect['frames'], color=effect['color'], delay=effect['delay'], blend=effect['blend']))
    inset = area['y']-info.get('m_Pos', {}).get(2, 0)
    return dict(height=info['m_fHeight']-2*inset-area['height'], fields=fields, pictures=pictures,
        emblems=emblems, fonts=[dict(name=name, sha256=hashlib.sha256(font_data(data,name)).hexdigest()) for name in FONT_FILES],
        source='DLG_LOADING_DUNGEON_START_V2.LUA / FONT_MANAGER.LUA / PARTICLE_SYSTEM_UI.LUA')
