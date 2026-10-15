"""Bounded, strict text decoding; no script execution or decryption."""
import codecs


ENCODINGS = ('auto', 'utf-8-sig', 'utf-16', 'utf-16-le', 'utf-16-be', 'cp949')


def decode_preview(data, final=False, encoding='auto'):
    if encoding not in ENCODINGS:
        raise ValueError('지원하지 않는 텍스트 인코딩입니다.')
    if encoding != 'auto':
        candidates = (encoding,)
    elif data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        candidates = ('utf-16',)
    elif data.startswith(codecs.BOM_UTF8):
        candidates = ('utf-8-sig',)
    else:
        candidates = ('utf-8-sig', 'cp949')
    for name in candidates:
        try:
            decoder = codecs.getincrementaldecoder(name)(errors='strict')
            text = decoder.decode(data, final=final)
            if any(ord(c) < 32 and c not in '\n\r\t' or ord(c) == 127 for c in text):
                continue
            return dict(text=text, encoding=name, consumed=len(data)-len(decoder.getstate()[0]), error=None)
        except UnicodeError:
            continue
    return dict(text='', encoding=None, consumed=0,
                error='텍스트로 판독할 수 없습니다. 다른 인코딩 또는 바이너리·미지원 저장 형식일 수 있습니다. 복호화는 수행하지 않습니다.')
