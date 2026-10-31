"""Inspect original EXT channels without inventing a runtime B-channel factor."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from closers.catalog import Catalog
from closers.composition import CompositionImages,check_dimensions
from closers.model_library import Models

DEFAULTS=tuple(code+'_GUST_USER_'+character+'_BASIC_EP_AVATAR_DEFENCE_HAIR.X'
               for code,character in (('300000102','STRIKER'),('300100102','CASTER'),('300200102','RANGER'),('300400102','LANCER')))+(
    '499930013_GUST_USER_CASTER_A_EP_AVATAR_ACC_BODY_CHEST.X',
    '499932811_GUST_USER_STRIKER_A_EP_AVATAR_ACC_HEAD_MOUTH.X')


def channels(path):
    from PIL import Image
    with Image.open(path) as image:
        check_dimensions(image.size)
        rgba=image.convert('RGBA')
        try:
            histogram=rgba.histogram();result={}
            for i,name in enumerate('rgba'):
                values=histogram[i*256:(i+1)*256]
                present=[v for v,count in enumerate(values) if count]
                result[name]=dict(min=min(present),max=max(present),nonzero_pixels=sum(values[1:]))
            return dict(width=image.width,height=image.height,pixels=image.width*image.height,channels=result)
        finally:rgba.close()


def inspect_ext(preview,images):
    report=dict(source_texture=preview['source_texture'],texture=preview['texture'],
                image=preview['image'],rendering_enabled=False,
                r_binding='regional-global-specular',b_binding='unresolved-runtime-factor',
                b_verified_scope='world-object-template',b_avatar_binding='unresolved',
                b_formula='surface * EXT.b * CBPerMaterial[18].x')
    selected=preview['image'].get('selected')
    if selected is None:
        return dict(report,status='unresolved',reason='Exact original EXT image is missing or ambiguous')
    try:
        path,metadata=images.prepare(selected)
        stats=channels(path)
        return dict(report,status='source-only',source=metadata,**stats,
                    r_signal='nonzero' if stats['channels']['r']['nonzero_pixels'] else 'zero',
                    b_signal='nonzero' if stats['channels']['b']['nonzero_pixels'] else 'zero')
    except (ValueError,OSError) as exc:
        return dict(report,status='unresolved',reason=str(exc))


def audit(workspace,entries=DEFAULTS):
    catalog=Catalog(workspace);models=Models(catalog);images=CompositionImages(catalog);result=[]
    for entry in entries:
        try:
            if isinstance(entry,str):
                matches=models.matches(entry)
                if len(matches)!=1:raise ValueError('Exact model is missing or ambiguous: '+entry)
                model_id=matches[0]['id']
            else:model_id=entry
            scene=models.scene([model_id]);materials=[]
            for mesh_index,mesh in enumerate(scene['meshes']):
                for index,material in enumerate(mesh['materials']):
                    preview=material.get('ext_preview')
                    if preview:
                        materials.append(dict(mesh=mesh_index,material=index,**inspect_ext(preview,images)))
            result.append(dict(source=entry,entry=model_id,status='inspected',materials=materials))
        except (ValueError,OSError) as exc:
            result.append(dict(entry=entry,status='unresolved',reason=str(exc)))
    return dict(models=result,rendering_enabled=False,
                note='Nonzero channel values alone do not prove an in-game effect or runtime activation.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--entry',action='append',type=int,help='Exact model entry ID; repeat for multiple models')
    parser.add_argument('--source',action='append',help='Exact model filename; ambiguous names remain unresolved')
    args=parser.parse_args();report=audit(args.workspace,(args.entry or [])+(args.source or []) or DEFAULTS)
    Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(models=len(report['models']),materials=sum(len(m.get('materials',[])) for m in report['models']),rendering_enabled=False)))
