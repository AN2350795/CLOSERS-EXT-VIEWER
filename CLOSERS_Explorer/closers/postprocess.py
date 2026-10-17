"""Ordered, independently retryable derived-data steps after extraction.

Register new steps in STEPS. Each step owns its atomic output publication;
failures must leave extracted assets and the last valid output intact.
"""
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .cmf import Cancelled


def check_cancel(cancel):
    if cancel.is_set():
        raise Cancelled()


def executable_path(catalog, options, paths):
    explicit = options.get('executable', '').strip()
    if explicit:
        path = Path(explicit).resolve()
        if not path.is_file():
            raise ValueError('CW.EXE 경로를 확인해 주세요: '+str(path))
        return path
    # Only inspect immediate source directories and their parent, never launch EXEs.
    with catalog.connect() as db:
        sources = [row[0] for row in db.execute('SELECT path FROM archives')]
    candidates = set()
    for value in list(paths)+sources:
        path = Path(value).resolve()
        directory = path if path.is_dir() else path.parent
        for folder in (directory, directory.parent):
            candidate = folder/'CW.EXE'
            if candidate.is_file():
                candidates.add(candidate)
    if len(candidates) != 1:
        raise ValueError('CW.EXE를 하나로 찾을 수 없습니다. 게임 실행 파일 경로를 직접 입력해 주세요.')
    return candidates.pop()


def build_game_data(catalog, options, paths, cancel, progress):
    from .game_names import build_index
    executable = executable_path(catalog, options, paths)
    result = build_index(catalog.workspace, executable, progress, cancel=cancel)
    catalog.game_names.refresh()
    return result


@dataclass(frozen=True)
class Step:
    id: str
    label: str
    run: Callable


STEPS = (Step('game-data', '게임 이름·장비 메시 표시 규칙', build_game_data),)


def validate_options(options):
    if not isinstance(options, dict):
        raise ValueError('후처리 설정 형식이 잘못되었습니다.')
    if not isinstance(options.get('enabled', True), bool) or not isinstance(options.get('executable', ''), str):
        raise ValueError('후처리 사용 여부와 실행 파일 경로를 확인해 주세요.')
    return options


def run(catalog, options, cancel, progress, paths=()):
    validate_options(options)
    results = []
    for step in STEPS:
        check_cancel(cancel)
        def report(**values):
            check_cancel(cancel)
            progress(phase='postprocess', postprocess_step=step.id,
                     current=step.label+' · '+str(values.get('current', '준비 중')))
        report()
        try:
            result = step.run(catalog, options, paths, cancel, report)
            results.append(dict(id=step.id, label=step.label, status='completed', result=result))
        except Cancelled:
            raise
        except Exception as exc:
            results.append(dict(id=step.id, label=step.label, status='error', error=str(exc)))
        progress(postprocess=list(results))
    return dict(steps=results, failed=sum(s['status']=='error' for s in results))
