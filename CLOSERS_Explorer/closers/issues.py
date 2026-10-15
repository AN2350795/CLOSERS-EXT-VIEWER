"""Explain processing failures without treating unknown formats as corruption."""
import errno
import zlib


def issue(error, stage=None):
    message = str(error or '')
    if not message:
        return None
    lower = message.lower()
    kind, reason, action = 'unknown', message, '상세 오류를 확인하고 해당 항목을 다시 시도하세요.'
    if isinstance(error, zlib.error) or 'decompress' in lower or 'zlib' in lower:
        stage = stage or 'decode'
        kind, reason = 'decode', '현재 복원 방식으로 내부 본문을 압축 해제하지 못했습니다. 미지원 형식일 수 있습니다.'
        action = '저장 바이트를 별도로 보존할 수 있습니다. 복원 지원이 추가된 뒤 다시 추출하세요.'
    elif isinstance(error, FileNotFoundError) or 'winerror 2' in lower or 'no such file' in lower:
        stage = stage or 'source'
        kind, reason, action = 'missing', '필요한 파일 또는 폴더를 찾지 못했습니다.', '원본·저장 경로를 확인한 뒤 다시 시도하세요.'
    elif isinstance(error, PermissionError) or 'permission denied' in lower or 'access is denied' in lower:
        kind, reason, action = 'permission', '파일 접근 권한이 없거나 다른 프로그램이 파일을 사용 중입니다.', '접근 권한과 파일 사용 상태를 확인한 뒤 다시 시도하세요.'
    elif (isinstance(error, OSError) and error.errno == errno.ENOSPC) or 'no space left' in lower:
        kind, reason, action = 'space', '저장 공간이 부족합니다.', '저장 드라이브의 여유 공간을 확보한 뒤 같은 작업을 재개하세요.'
    elif '변경' in message or '분석 기록과 다' in message:
        stage = stage or 'source'
        kind, reason, action = 'changed', '원본이 분석 기록과 다릅니다.', '해당 원본 CMF를 다시 분석한 뒤 추출하세요.'
    elif '안전하지' in message or '경로 이탈' in message:
        stage = stage or 'path'
        kind, reason, action = 'path', '안전하게 저장할 수 없는 내부 파일 경로입니다.', '원래 파일명과 경로를 확인하세요.'
    stage = stage or 'unknown'
    labels = {'source': '원본 확인', 'archive': '아카이브 읽기', 'decode': '본문 복원',
              'write': '파일 저장', 'path': '저장 경로', 'verify': '저장 파일 검증',
              'preview': '미리보기', 'unknown': '이전 오류 기록'}
    return dict(stage=stage, label=labels.get(stage, stage), kind=kind,
                reason=reason, action=action, raw=message)
