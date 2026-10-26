"""The same scene and named channels must survive binary/text encoding."""
import struct
import unittest
import zlib
from closers.model import parse_x,x_tokens
from closers.model_x_animation import embedded_clip
from test_model_x_animation import animated_model


def text_model():
    # Convert neutral tokens rather than keeping an extracted asset fixture.
    out=[]
    for kind,value in x_tokens(animated_model()):
        if kind=='string':out.append('"'+value.replace('\\','\\\\').replace('"','\\"')+'"')
        elif kind=='number':out.append(str(value)+';')
        else:out.append(str(value))
    return b'xof 0303txt 0032\n// test\n'+(' '.join(out)).encode()


class TextModelTests(unittest.TestCase):
    def test_scene_and_embedded_channels_match_binary_and_compressed_text(self):
        body=text_model();scene=parse_x(body)
        self.assertEqual(scene,parse_x(animated_model()))
        self.assertEqual(embedded_clip(body,scene['frames'],'BOX_LOOP'),embedded_clip(animated_model(),scene['frames'],'BOX_LOOP'))
        raw=body[16:];compressor=zlib.compressobj(wbits=-15);data=compressor.compress(raw)+compressor.flush()
        compressed=b'xof 0303tzip0032'+struct.pack('<IHH',len(body),len(raw),len(data)+2)+b'CK'+data
        self.assertEqual(parse_x(compressed),scene)

    def test_templates_comments_numbers_and_invalid_input(self):
        template=b'\ntemplate Frame { <3d82ab46-62da-11cf-ab39-0020af71e433> [...] }\n'
        body=text_model();self.assertEqual(parse_x(body[:16]+template+body[16:]),parse_x(body))
        self.assertEqual(parse_x(body.replace(b'5.0;',b'+5.e0;')),parse_x(body))
        for body in [b'xof 0303txt 0032',text_model()+b' @',text_model()[:-1],text_model().replace(b'5.0;',b'1e999;')]:
            with self.assertRaises(ValueError):parse_x(body)
