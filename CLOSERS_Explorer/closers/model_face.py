"""Face-only SDF bindings; alpha is shading data, never an opacity mask."""
import re


def face_sdf_preview(mesh,material,frames):
    texture=material.get('texture') or ''
    if not (re.search(r'(?:^|_)SDF(?:_|$)',mesh['name'],re.I)
            and re.search(r'(?:^|_)FACE(?:_|\.)',texture,re.I)
            and not re.search(r'(?:^|_)EYE(?:_|\.)',texture,re.I)):return None
    preview=dict(kind='face-sdf',status='approximate',texture=texture,head_bone='BIP01_HEAD',
                 basis='CW_CARTOONLIGHT.PS.CSO:cb3[12:15]/t0.a',
                 head_binding=dict(status='source-verified',slot=7,matrix='frame-world',side_column=1,forward_column=2),
                 limitations=['runtime_cartoon_power_not_bound','game_postprocess_not_bound'])
    if sum(f['name']=='BIP01_HEAD' for f in frames)!=1:
        return dict(preview,status='unsupported',reason='얼굴 음영에 사용할 머리 뼈를 하나로 확정할 수 없습니다.')
    if not mesh.get('uv'):
        return dict(preview,status='unsupported',reason='얼굴 음영의 원본 UV가 없습니다.')
    return preview
