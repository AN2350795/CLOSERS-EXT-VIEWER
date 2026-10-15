"""Run without third-party dependencies: python explorer.py"""
import argparse
import json
from pathlib import Path
import sys
import time

from closers.catalog import Catalog
from closers.cmf import Cancelled


def main():
    parser = argparse.ArgumentParser(description='CLOSERS CMF 탐색·분류·스트리밍 추출')
    parser.add_argument('--workspace', default=str(Path(__file__).resolve().parent.parent / 'results'), help='목록 DB와 보고서를 보관할 폴더')
    commands = parser.add_subparsers(dest='command')
    ui = commands.add_parser('serve', help='로컬 탐색 화면 실행 (기본)')
    ui.add_argument('--port', type=int, default=8765)
    ui.add_argument('--no-browser', action='store_true')
    scan = commands.add_parser('scan', help='폴더/CMF 목록 분석')
    scan.add_argument('paths', nargs='+')
    scan.add_argument('--retry-errors', action='store_true', help='동일 원본의 캐시된 오류도 다시 시도')
    extract = commands.add_parser('extract', help='분석한 파일 추출. 완료 파일은 SHA-256 검증 후 건너뜀')
    extract.add_argument('--output', help='기본: 작업 폴더/assets')
    extract.add_argument('--category', choices=['images', 'audio', 'models', 'scripts', 'other', 'encrypted'])
    extract.add_argument('--query', default='')
    extract.add_argument('--raw', action='store_true', help='암호화 플래그 항목을 .encrypted.bin으로 보존 (복호화 아님)')
    extract.add_argument('--retry-errors', action='store_true', help='캐시된 내부 복원 실패도 다시 시도')
    extract.add_argument('--verify', choices=['sha256', 'fast'], default='sha256', help='fast: 크기·수정 시각이 같으면 스킵. 구 DB는 SHA-256 확인')
    process = commands.add_parser('process', help='CMF별로 분석하고 바로 추출')
    process.add_argument('paths', nargs='+')
    process.add_argument('--output')
    process.add_argument('--category', choices=['images', 'audio', 'models', 'scripts', 'other', 'encrypted'])
    process.add_argument('--query', default='')
    process.add_argument('--raw', action='store_true')
    process.add_argument('--retry-errors', action='store_true')
    process.add_argument('--verify', choices=['sha256', 'fast'], default='sha256')
    process.add_argument('--workers', type=int, choices=[1,2,4], default=1, help='동시에 처리할 CMF 수 (기본 1)')
    commands.add_parser('report', help='통계와 CSV 보고서 갱신')
    compare = commands.add_parser('compare', help='원본의 추가·변경·사라짐 비교 (목록·저장 파일 유지)')
    compare.add_argument('paths', nargs='+')
    diagnose = commands.add_parser('diagnose', help='읽기 전용 DB 스냅샷과 실패 헤더 진단')
    diagnose.add_argument('--destination', required=True, help='운영 폴더 밖의 새 진단 폴더')
    bench = commands.add_parser('benchmark', help='별도 새 폴더에서 대표 CMF 분석·추출·재개 측정')
    bench.add_argument('paths', nargs='+')
    bench.add_argument('--destination', required=True)
    preserve = commands.add_parser('preserve', help='CMF 내부의 저장 바이트를 별도로 보존 (원문 복원 아님)')
    preserve.add_argument('paths', nargs='+', help='CMF 파일 경로')
    preserve.add_argument('--destination', required=True, help='별도 원시 보존 폴더; 같은 폴더로 재개 가능')
    index = commands.add_parser('index', help='HEADER.CMF의 인덱스 메타데이터 내보내기')
    index.add_argument('path')
    index.add_argument('--destination', required=True, help='아직 없는 별도 폴더')
    args = parser.parse_args()
    if args.command in ('preserve', 'index'):
        last_print = 0
        def preservation_progress(**values):
            nonlocal last_print
            if time.monotonic()-last_print >= 1:
                print(json.dumps(values,ensure_ascii=True),flush=True)
                last_print=time.monotonic()
        try:
            if args.command == 'preserve':
                from closers.preservation import preserve_archives
                result = preserve_archives(args.paths,args.destination,progress=preservation_progress)
            else:
                from closers.header_index import export_index
                result = export_index(args.path,args.destination,progress=preservation_progress)
        except (KeyboardInterrupt, Cancelled):
            print('작업을 중단했습니다. 별도 보존 폴더의 완료 파일은 유지됩니다.',file=sys.stderr)
            return 130
        print(json.dumps(result,ensure_ascii=True,indent=2))
        return 1 if result.get('failed') else 0
    if args.command == 'diagnose':
        from closers.diagnostics import diagnose
        result = diagnose(args.workspace, args.destination)
        print(json.dumps({k: result[k] for k in ('archives', 'entries', 'failed_headers_read', 'unreadable', 'source_changed', 'elapsed_seconds')}, ensure_ascii=True, indent=2))
        return 0
    if args.command == 'benchmark':
        from closers.benchmark import benchmark
        result = benchmark(args.paths, args.destination)
        print(json.dumps({k: {'seconds': v['seconds'], 'result': v['result']} for k, v in result['runs'].items()}, indent=2))
        return 1 if any(v['result'].get('failed') for v in result['runs'].values()) else 0
    catalog = Catalog(args.workspace)
    if args.command in (None, 'serve'):
        from closers.server import serve
        serve(catalog, getattr(args, 'port', 8765), not getattr(args, 'no_browser', False))
        return 0
    last = 0
    state = {}
    def progress(**values):
        nonlocal last
        state.update(values)
        if time.monotonic() - last >= 0.5:
            print(json.dumps(state, ensure_ascii=True), flush=True)
            last = time.monotonic()
    result = {}
    try:
        if args.command == 'scan':
            result = catalog.scan(args.paths, progress=progress, retry_errors=args.retry_errors)
        elif args.command == 'extract':
            result = catalog.extract(args.output or catalog.workspace / 'assets', {'category': args.category, 'q': args.query}, args.raw, progress=progress, verify=args.verify,retry_errors=args.retry_errors)
        elif args.command == 'process':
            result = catalog.process(args.paths, args.output or catalog.workspace / 'assets',
                                     {'category': args.category, 'q': args.query}, args.raw, progress=progress,
                                     verify=args.verify, retry_errors=args.retry_errors,workers=args.workers)
        elif args.command == 'compare':
            from closers.updates import compare
            from closers.catalog import operation_lock
            with operation_lock(catalog.workspace):
                result = compare(catalog,args.paths,progress=progress)
        else:
            from closers.reports import ensure_report
            ensure_report(catalog,'csv',force=True)
            ensure_report(catalog,'summary',force=True)
            result = catalog.stats()
    except (KeyboardInterrupt, Cancelled):
        print('작업을 중단했습니다. 완료된 파일은 보존됩니다.', file=sys.stderr)
        return 130
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 1 if result.get('failed') or result.get('entry_errors') else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print(f'오류: {exc}', file=sys.stderr)
        sys.exit(1)
