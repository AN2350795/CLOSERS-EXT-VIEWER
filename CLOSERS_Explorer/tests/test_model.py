import hashlib
import struct
import tempfile
import threading
from pathlib import Path
import unittest
import urllib.request
import zlib

from closers.catalog import Catalog
from closers.model import IDENTITY,parse_x,parse_xmd,bind_mapping
from closers.model_library import Models
from test_explorer import fixture


def name(value):
    b=value.encode();return struct.pack('<HI',1,len(b))+b


def numbers(values,floating=False):
    return struct.pack('<HI',7 if floating else 6,len(values))+struct.pack('<'+('f' if floating else 'I')*len(values),*values)


def string(value):
    b=value.encode();return struct.pack('<HI',2,len(b))+b+struct.pack('<H',20)


def obj(kind,body,label=''):
    return name(kind)+(name(label) if label else b'')+struct.pack('<H',10)+body+struct.pack('<H',11)


def binary_model(texture='texture.png'):
    transform=IDENTITY.copy();transform[12]=5
    mesh=obj('Mesh',numbers([3])+numbers([0,0,0,1,0,0,0,1,0],True)+numbers([1,3,0,1,2])
        +obj('MeshTextureCoords',numbers([3])+numbers([0,0,1,0,0,1],True))
        +obj('MeshMaterialList',numbers([1,1,0])+obj('Material',numbers([1,1,1,1,0,0,0,0,0,0,0],True)+obj('TextureFilename',string(texture))))
        +obj('SkinWeights',string('CHILD')+numbers([3,0,1,2])+numbers([1,1,1],True)+numbers(IDENTITY,True)), 'BODY')
    return b'xof 0303bin 0032'+obj('Frame',obj('FrameTransformMatrix',numbers(IDENTITY,True))+
           obj('Frame',obj('FrameTransformMatrix',numbers(transform,True)), 'CHILD')+mesh,'ROOT')


def varint(n):
    result=bytearray()
    while n>=128:result.append(n&127);n>>=7
    result.append(n|128);return bytes(result)


def wide(text):
    b=text.encode('utf-16-le');return varint(len(b))+b


def animation(bad=False):
    def clip(label,positions):
        body=wide(label)*2+struct.pack('<f',1)+b'\x01\x80'+varint(len(positions))
        for time,x in positions:
            transforms=[0,0,0,1,x,0,0, 0,0,0,1,0,0,0] # Alphabetical: CHILD, ROOT.
            body+=struct.pack('<f',time)+varint(0)+varint(2)+struct.pack('<14f',*transforms)
        return body
    return b'\x91CLOSERS_XMD_0001\0'+struct.pack('<II',2,1)+varint(2)+clip('MOVE',[(0,5),(.5,6)])+clip('_DEFAULT',[(0,8 if bad else 5),(.5,8 if bad else 5)])


class ModelTests(unittest.TestCase):
    def test_only_unused_empty_identity_duplicate_leaf_can_be_named_uniquely(self):
        dummy=obj('Frame',obj('FrameTransformMatrix',numbers(IDENTITY,True)),'DUMMY')
        body=binary_model()+obj('Frame',dummy,'DUMMY')
        scene=parse_x(body)
        self.assertEqual(len(set(f['name'] for f in scene['frames'])),len(scene['frames']))
        self.assertEqual(scene['frames'][-1]['parent'],len(scene['frames'])-2)
        self.assertTrue(scene['warnings'])
        # A repeated skin bone, or a leaf with a meaningful transform, is ambiguous.
        with self.assertRaisesRegex(ValueError,'중복'):parse_x(binary_model()+obj('Frame',b'','CHILD'))
        shifted=IDENTITY.copy();shifted[12]=1
        with self.assertRaisesRegex(ValueError,'중복'):parse_x(binary_model()+obj('Frame',obj('Frame',obj('FrameTransformMatrix',numbers(shifted,True)),'DUMMY'),'DUMMY'))

    def test_binary_mesh_and_verified_multi_key_default(self):
        scene=parse_x(binary_model());a=parse_xmd(animation());mapping=bind_mapping(scene,a)
        self.assertEqual(mapping['verified_bones'],2);self.assertEqual(mapping['verified_keys'],2)
        self.assertLess(mapping['maximum_error'],1e-6)
        self.assertEqual(scene['meshes'][0]['indices'],[0,1,2])
        self.assertEqual(scene['meshes'][0]['skin'][0]['indices'],[0,1,2])
        self.assertEqual(parse_xmd(animation(),0)['retained'][0]['keys'][1]['transforms'][0][7],6)

    def test_wrong_bone_binding_and_invalid_files_rejected(self):
        scene=parse_x(binary_model())
        with self.assertRaisesRegex(ValueError,'기본 자세'):bind_mapping(scene,parse_xmd(animation(True)))
        for body in [binary_model()[:-1],b'xof 0303txt 0032',b'xof 0303bin 0032'+b'\xff\xff']:
            with self.assertRaises(ValueError):parse_x(body)
        for body in [animation()[:-1],animation()+b'\0',b'bad xmd']:
            with self.assertRaises(ValueError):parse_xmd(body)

    def test_mszip_dictionary_and_truncated_chunk(self):
        raw=binary_model()[16:];pieces=[raw[:170],raw[170:]];encoded=b'xof 0303bzip0032'+struct.pack('<I',len(raw)+16);previous=b''
        for piece in pieces:
            compressor=zlib.compressobj(wbits=-15,zdict=previous);b=compressor.compress(piece)+compressor.flush()
            encoded+=struct.pack('<HH',len(piece),len(b)+2)+b'CK'+b;previous=(previous+piece)[-32768:]
        self.assertEqual(parse_x(encoded),parse_x(binary_model()))
        with self.assertRaises(ValueError):parse_x(encoded[:-2])

    def test_offline_saved_sources_ambiguous_texture_and_changed_animation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=fixture(root/'one.cmf',[('MODEL.X',binary_model(),1),('MODEL.XMD',animation(),1)])
            textures=fixture(root/'two.cmf',[('texture.png',b'png-a',0),('TEXTURE.PNG',b'png-b',0)])
            catalog=Catalog(root/'work');catalog.process([source,textures],root/'assets');source.unlink();textures.unlink()
            rows=catalog.entries({})['items'];model=next(r['id'] for r in rows if r['name']=='MODEL.X');anim=next(r['id'] for r in rows if r['name']=='MODEL.XMD');models=Models(catalog)
            scene=models.scene([model]);info=scene['meshes'][0]['materials'][0]['image']
            self.assertIsNone(info['selected']);self.assertEqual(len(info['candidates']),2)
            a=models.animations(model,anim);clip=models.clip(model,anim,0,a['animation_source']['sha256'])
            self.assertEqual(clip['clip']['name'],'MOVE')
            out=Path(catalog.get(anim)['output']);out.write_bytes(animation(True))
            with self.assertRaisesRegex(ValueError,'변경'):models.clip(model,anim,0,a['animation_source']['sha256'])
            self.assertEqual(scene['sources'][0]['sha256'],hashlib.sha256(binary_model()).hexdigest())
            with self.assertRaises(ValueError):models.scene([model]*17)


    def test_viewer_face_preview_dependency_is_served(self):
        from closers.server import create_server
        with tempfile.TemporaryDirectory() as temp:
            server=create_server(Catalog(Path(temp)/'work'),0)
            thread=threading.Thread(target=server.serve_forever,daemon=True)
            thread.start()
            try:
                for name in ('model-core.js','face-preview.js'):
                    with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/{name}') as response:
                        self.assertEqual(response.status,200)
                        self.assertIn(response.headers.get_content_type(),('text/javascript','application/javascript'))
                        expected=Path(__file__).resolve().parents[1]/'web'/name
                        self.assertEqual(response.read(),expected.read_bytes())
            finally:
                server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main()
