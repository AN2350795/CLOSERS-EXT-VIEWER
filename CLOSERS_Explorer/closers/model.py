"""Bounded readers for observed binary DirectX X and CLOSERS_XMD_0001.

Binary token reference: Microsoft Direct3D9 X file format.
XMD research: https://github.com/nbreeze/closers-rev/wiki/.XMD
No extraction/catalog changes; viewer data is derived from original bytes.
"""
import math
import struct
import zlib

MAX_BYTES = 32 * 1024 * 1024
IDENTITY = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]


def numeric(values):
    if any(type(v) not in (int,float) or not math.isfinite(v) for v in values):
        raise ValueError('X 벡터·행렬에 숫자가 아닌 값이 있습니다.')
    return values


class Reader:
    def __init__(self,data):
        if len(data) > MAX_BYTES:
            raise ValueError('3D 입력은 파일당 32 MiB까지 지원합니다.')
        self.data,self.pos = data,0

    def take(self,n):
        if n < 0 or self.pos+n > len(self.data):
            raise ValueError(f'잘린 3D 데이터: 바이트 {self.pos}')
        value = self.data[self.pos:self.pos+n]
        self.pos += n
        return value

    def unpack(self,fmt):
        return struct.unpack('<'+fmt,self.take(struct.calcsize('<'+fmt)))

    def count(self,value,maximum=1_000_000):
        if type(value) is not int or not 0 <= value <= maximum:
            raise ValueError('3D 데이터의 개수·인덱스가 지원 범위를 벗어났습니다.')
        return value

    def floats(self,n):
        values = list(self.unpack('f'*n))
        if not all(math.isfinite(x) and abs(x) < 1e10 for x in values):
            raise ValueError('3D 데이터에 유효하지 않은 실수가 있습니다.')
        return values

    def varint(self):
        value = 0
        for shift in range(0,35,7):
            byte = self.take(1)[0]
            value |= (byte & 127) << shift
            if byte & 128:
                return value
        raise ValueError('XMD 가변 길이 정수가 올바르지 않습니다.')

    def wide(self):
        n = self.count(self.varint(),8192)
        if n % 2:
            raise ValueError('XMD 문자열 길이가 올바르지 않습니다.')
        return self.take(n).decode('utf-16-le').rstrip('\0')


def x_tokens(data):
    r = Reader(data)
    head = r.take(16)
    if head != b'xof 0303bin 0032':
        raise ValueError('현재 3D 뷰어는 xof 0303bin 0032 바이너리 X를 지원합니다. 원본 저장은 가능합니다.')
    while r.pos < len(data):
        code, = r.unpack('H')
        if code in (1,2):
            n, = r.unpack('I'); r.count(n,32768)
            raw = r.take(n)
            try:
                value = raw.decode('utf-8')
            except UnicodeDecodeError:
                value = raw.decode('cp949')
            yield ('name' if code == 1 else 'string',value.rstrip('\0'))
            if code == 2:
                r.take(2)
        elif code == 3:
            yield ('number',r.unpack('I')[0])
        elif code in (6,7):
            n, = r.unpack('I'); r.count(n,4_000_000)
            values = r.unpack(('I' if code==6 else 'f')*n)
            for v in values:
                if not math.isfinite(v) or abs(v)>1e10:
                    raise ValueError('X 숫자가 유효하지 않습니다.')
                yield ('number',v)
        elif code == 5:
            r.take(16); yield ('guid',None)
        elif code in range(10,21):
            yield ('symbol',{10:'{',11:'}',12:'(',13:')',14:'[',15:']',16:'<',17:'>',18:'.',19:',',20:';'}[code])
        elif code == 31 or 40 <= code <= 52:
            yield ('keyword',code)
        else:
            raise ValueError(f'지원하지 않는 X 토큰 {code}: 바이트 {r.pos-2}')


def x_objects(data):
    stream = iter(x_tokens(data))
    current = next(stream,None)
    def advance():
        nonlocal current
        previous = current
        current = next(stream,None)
        return previous
    def object_(depth=0):
        if depth > 128:
            raise ValueError('X 프레임 계층이 너무 깊습니다.')
        kind = advance()[1]
        name = advance()[1] if current and current[0]=='name' else ''
        if advance() != ('symbol','{'):
            raise ValueError('X 객체 시작 괄호가 없습니다.')
        values,children = [],[]
        while current != ('symbol','}'):
            if current is None:
                raise ValueError('X 객체 종료 괄호가 없습니다.')
            if current[0]=='name':
                children.append(object_(depth+1))
            elif current == ('symbol','{'):
                advance(); ref = advance()
                if not ref or ref[0]!='name' or advance()!=('symbol','}'):
                    raise ValueError('X 참조가 올바르지 않습니다.')
                children.append(dict(kind='reference',name=ref[1],values=[],children=[]))
            else:
                token = advance()
                if token[0] in ('number','string'):
                    values.append(token[1])
        advance()
        return dict(kind=kind,name=name,values=values,children=children)
    objects = []
    while current:
        if current == ('keyword',31):
            # Template declarations describe fields, not scene objects.
            while current and current != ('symbol','{'):
                advance()
            level = 0
            while current:
                t = advance()
                level += int(t==('symbol','{'))-int(t==('symbol','}'))
                if level==0:
                    break
            if level or current is None:
                raise ValueError('X 템플릿이 잘렸거나 장면이 없습니다.')
        elif current[0]=='name':
            objects.append(object_())
        else:
            raise ValueError('지원하지 않는 X 최상위 데이터입니다.')
    return objects


def parse_x(data):
    if data[:16]==b'xof 0303bzip0032':
        r = Reader(data); r.take(16); advertised, = r.unpack('I')
        expanded,previous = bytearray(),b''
        while r.pos<len(data):
            expected,n = r.unpack('HH')
            if not 1<=expected<=32768 or not 2<=n<=32786 or r.take(2)!=b'CK':
                raise ValueError('X MSZIP 블록이 올바르지 않습니다.')
            inflater = zlib.decompressobj(-15,zdict=previous)
            block = inflater.decompress(r.take(n-2),32769)
            if len(block)!=expected or not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
                raise ValueError('X MSZIP 블록 복원 길이가 올바르지 않습니다.')
            expanded.extend(block)
            if len(expanded)>MAX_BYTES:
                raise ValueError('복원된 X는 32 MiB까지 지원합니다.')
            previous = bytes(expanded[-32768:])
        data = b'xof 0303bin 0032'+expanded
        if len(data)!=advertised:
            raise ValueError('X MSZIP 전체 복원 길이가 헤더와 일치하지 않습니다.')
    objects = x_objects(data)
    frames,meshes,warnings = [],[],[]
    material_defs = {}
    def gather(nodes):
        for node in nodes:
            if node['kind']=='Material' and node['name']:
                material_defs[node['name']]=node
            gather(node['children'])
    gather(objects)
    def child(node,kind):
        return next((v for v in node['children'] if v['kind']==kind),None)
    def material(node):
        if node['kind']=='reference':
            node = material_defs.get(node['name'])
            if node is None:
                raise ValueError('이름으로 참조한 X 재질을 찾을 수 없습니다.')
        value = node['values']
        if len(value)!=11:
            raise ValueError('X 재질 데이터 길이가 올바르지 않습니다.')
        numeric(value)
        texture = child(node,'TextureFilename')
        return dict(color=value[:4],texture=texture['values'][0] if texture else None)
    def mesh(node,parent):
        r = iter(node['values'])
        def count(maximum=250_000):
            return Reader(b'').count(next(r),maximum)
        n = count()
        vertices = numeric([next(r) for _ in range(n*3)])
        nf = count(500_000)
        faces = []
        for _ in range(nf):
            face = [count(n-1) for _ in range(count(64))]
            if len(face)<3:
                raise ValueError('X 면에 정점이 부족합니다.')
            faces.append(face)
        if next(r,None) is not None:
            raise ValueError('지원하지 않는 X 메시 데이터입니다.')
        uv = child(node,'MeshTextureCoords')
        if uv and (uv['values'][0]!=n or len(uv['values'])!=n*2+1):
            raise ValueError('X 텍스처 좌표 개수가 정점과 일치하지 않습니다.')
        if uv:
            numeric(uv['values'])
        materials,face_material = [dict(color=[1,1,1,1],texture=None)],[0]*nf
        ml = child(node,'MeshMaterialList')
        if ml:
            nm,ni = ml['values'][:2]
            materials = [material(c) for c in ml['children'] if c['kind'] in ('Material','reference')]
            face_material = ml['values'][2:]
            if len(materials)!=nm or ni not in (1,nf) or len(face_material)!=ni:
                raise ValueError('X 면 재질 목록이 올바르지 않습니다.')
            if ni==1:
                face_material *= nf
            if any(type(i)is not int or not 0<=i<nm for i in face_material):
                raise ValueError('X 재질 인덱스가 올바르지 않습니다.')
        skin = []
        for s in node['children']:
            if s['kind'] != 'SkinWeights':
                continue
            bone,nw = s['values'][:2]
            Reader(b'').count(nw,n)
            indices = s['values'][2:2+nw]
            weights = s['values'][2+nw:2+2*nw]
            offset = s['values'][2+2*nw:]
            numeric(weights); numeric(offset)
            if len(offset)!=16 or any(type(i)is not int or not 0<=i<n for i in indices) or any(w<0 or w>1.001 for w in weights):
                raise ValueError('X 스킨 가중치·행렬이 올바르지 않습니다.')
            skin.append(dict(bone=bone,indices=indices,weights=weights,offset=offset))
        indices,groups = [],[]
        for mi in range(len(materials)):
            start = len(indices)
            for face,fm in zip(faces,face_material):
                if mi==fm:
                    for i in range(1,len(face)-1):
                        indices.extend((face[0],face[i],face[i+1]))
            groups.append([start,len(indices)-start,mi])
        meshes.append(dict(name=node['name'],frame=parent,vertices=vertices,indices=indices,
                           uv=uv['values'][1:] if uv else [],materials=materials,groups=groups,skin=skin))
    def visit(nodes,parent=-1):
        for node in nodes:
            if node['kind']=='Frame':
                f = child(node,'FrameTransformMatrix')
                matrix = f['values'] if f else IDENTITY.copy()
                if len(matrix)!=16 or not node['name']:
                    raise ValueError('X 프레임 이름·행렬이 올바르지 않습니다.')
                numeric(matrix)
                index = len(frames)
                if index>=1024:
                    raise ValueError('X 프레임은 1,024개까지 지원합니다.')
                frames.append(dict(name=node['name'],parent=parent,matrix=matrix))
                visit(node['children'],index)
            elif node['kind']=='Mesh':
                mesh(node,parent)
            elif node['kind']=='AnimationSet':
                warnings.append('X 내부 AnimationSet은 현재 재생하지 않습니다. XMD를 선택해 주세요.')
    try:
        visit(objects)
    except (StopIteration,IndexError,TypeError) as exc:
        raise ValueError('X 메시 데이터가 잘렸거나 지원하지 않는 구조입니다.') from exc
    names = [f['name'] for f in frames]
    if len(set(names))!=len(names):
        referenced={s['bone'] for m in meshes for s in m['skin']}
        occupied=set(names)
        for label in dict.fromkeys(names):
            indices=[i for i,n in enumerate(names) if n==label]
            if len(indices)<2:continue
            # Observed DEVILISH face repeats an unused, empty identity leaf.
            # Preserve its hierarchy with a unique label; ambiguous skin bones
            # and meaningful duplicate transforms remain unsupported.
            if label in referenced or any(
                any(f['parent']==i for f in frames) or any(m['frame']==i for m in meshes)
                or max(abs(a-b) for a,b in zip(frames[i]['matrix'],IDENTITY))>1e-4
                for i in indices[1:]):
                raise ValueError('이름이 중복된 X 뼈는 현재 지원하지 않습니다.')
            for i in indices[1:]:
                unique=label+'__UNUSED_FRAME_'+str(i)
                while unique in occupied:unique+='_' 
                frames[i]['name']=unique;occupied.add(unique)
            warnings.append('스킨 미사용·빈 말단 프레임의 중복 이름을 표시용으로 구분했습니다: '+label)
        names=[f['name'] for f in frames]
    if sum(len(m['vertices'])//3 for m in meshes)>250_000:
        raise ValueError('3D 장면은 정점 250,000개까지 지원합니다.')
    for m in meshes:
        if any(s['bone'] not in names for s in m['skin']):
            raise ValueError('X 스킨에서 참조하는 뼈가 프레임 계층에 없습니다.')
    return dict(frames=frames,meshes=meshes,warnings=warnings)


def parse_xmd(data,selected=None):
    """Scan all clips; retain transforms only for the requested/default pose clip."""
    r = Reader(data)
    if r.take(18)!=b'\x91CLOSERS_XMD_0001\0':
        raise ValueError('지원하지 않는 XMD 헤더입니다.')
    bones,version = r.unpack('II')
    r.count(bones,1024)
    if version not in (1,2):
        raise ValueError(f'지원하지 않는 XMD 내부 버전 {version}')
    nclips = r.count(r.varint(),2048)
    clips,retained = [],[]
    total = 0
    for index in range(nclips):
        name,secondary = r.wide(),r.wide()
        duration = r.floats(1)[0]
        flags = r.take(2).hex()
        nk = r.count(r.varint(),10000)
        keep = index==selected or (selected is None and name.startswith('_DEFAULT'))
        keys,last = [],-1
        for _ in range(nk):
            time = r.floats(1)[0]
            if time<last or time<0 or time>duration+0.01:
                raise ValueError('XMD 키프레임 시간이 올바르지 않습니다.')
            last = time
            ns = r.count(r.varint(),bones)
            scales = r.floats(ns*10) if keep else r.take(ns*40)
            nt = r.count(r.varint(),bones)
            if ns+nt!=bones:
                raise ValueError('XMD 변환 개수가 뼈 수와 일치하지 않습니다.')
            transforms = r.floats(nt*7) if keep else r.take(nt*28)
            total += ns+nt
            if total>2_000_000:
                raise ValueError('XMD 전체 키 변환은 2,000,000개까지 지원합니다.')
            if keep:
                if (len(keys)+1)*bones>150_000:
                    raise ValueError('한 동작의 뼈 키 변환은 150,000개까지 지원합니다.')
                values = [scales[i:i+10] for i in range(0,len(scales),10)]
                values += [transforms[i:i+4]+[1,1,1]+transforms[i+4:i+7] for i in range(0,len(transforms),7)]
                keys.append(dict(time=time,transforms=values,scale_count=ns))
        if duration<0 or duration>3600 or not nk:
            raise ValueError('XMD 동작 길이·키 수가 올바르지 않습니다.')
        clips.append(dict(index=index,name=name,secondary=secondary,duration=duration,keys=nk,flags=flags))
        if keep:
            retained.append(dict(index=index,keys=keys))
    if r.pos!=len(data):
        raise ValueError(f'지원하지 않는 XMD 후행 데이터: {len(data)-r.pos}바이트')
    return dict(bones=bones,version=version,clips=clips,retained=retained)


def xmd_matrix(transform):
    # Current samples use direct quaternion/position. Never infer from extension.
    x,y,z,w,sx,sy,sz,tx,ty,tz = transform
    length = math.sqrt(x*x+y*y+z*z+w*w)
    if not 0.99<length<1.01:
        raise ValueError('XMD 회전 쿼터니언이 정규화되어 있지 않습니다.')
    x,y,z,w = x/length,y/length,z/length,w/length
    return [(1-2*(y*y+z*z))*sx,2*(x*y+z*w)*sx,2*(x*z-y*w)*sx,0,
            2*(x*y-z*w)*sy,(1-2*(x*x+z*z))*sy,2*(y*z+x*w)*sy,0,
            2*(x*z+y*w)*sz,2*(y*z-x*w)*sz,(1-2*(x*x+y*y))*sz,0,tx,ty,tz,1]


def bind_mapping(scene,animation):
    """Require every DEFAULT local matrix to match before enabling game playback."""
    defaults = animation['retained']
    ordered = sorted(range(len(scene['frames'])),key=lambda i:scene['frames'][i]['name'])
    if len(ordered)!=animation['bones'] or len(defaults)!=1 or not defaults[0]['keys']:
        raise ValueError('XMD 뼈 연결을 검증할 수 없습니다: 뼈 수 또는 _DEFAULT 자세가 일치하지 않습니다.')
    scales = [[math.sqrt(sum(f['matrix'][j+k]**2 for k in range(3))) for j in (0,4,8)] for f in scene['frames']]
    maximum = 0
    for key in defaults[0]['keys']:
        for ti,(i,tr) in enumerate(zip(ordered,key['transforms'])):
            tr = tr.copy()
            if ti>=key['scale_count']:
                tr[4:7] = scales[i]
            expected = scene['frames'][i]['matrix']
            actual = xmd_matrix(tr)
            error = max(abs(a-b)/max(1,abs(b)) for a,b in zip(actual,expected))
            maximum = max(maximum,error)
    if maximum>0.005:
        raise ValueError(f'XMD 기본 자세가 X 뼈 행렬과 일치하지 않습니다 (최대 상대 오차 {maximum:.6f}). 동작 재생을 보류합니다.')
    return dict(frames=ordered,scales=scales,maximum_error=maximum,method='alphabetical/default-local-matrix/direct-coordinates',verified_bones=len(ordered),verified_keys=len(defaults[0]['keys']))
