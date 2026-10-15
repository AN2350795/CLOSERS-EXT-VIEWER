"""Bounded per-archive workers, one connection per worker, short SQLite writes."""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import threading

from .cmf import check_cancel


COUNTERS = ('archives','scanned','scan_skipped','archive_failed','entry_errors','indexes','entry_failed',
            'done','failed','skipped','encrypted','recovered','bytes','outside_scope','cached_failures')


def process_parallel(catalog, paths, output, filters, raw, cancel, progress, verify, retry_errors, workers):
    stopped = threading.Event()
    class Cancellation:
        def is_set(self):
            return stopped.is_set() or bool(cancel and cancel.is_set())
    cancellation = Cancellation()
    guard = threading.Lock()
    active = {}
    totals = dict.fromkeys(COUNTERS,0)
    def report_locked(current='아카이브 처리 중'):
        state = {key: totals[key] + sum(values.get(key,0) for values in active.values()) for key in COUNTERS}
        progress(phase='process',discovering=True,total=None,current=current,workers=workers,written=state['bytes'],**state)
    def run(path):
        def update(**state):
            with guard:
                active[str(path)].update(state)
                if 'written' in state:
                    active[str(path)]['bytes'] = state['written']
                report_locked(state.get('current',str(path)))
        with catalog.session():
            return catalog._process_serial([path],output,filters,raw,cancellation,update,verify,retry_errors)
    candidates = iter(catalog.candidates(paths,cancellation))
    futures = {}
    exhausted = False
    try:
        with ThreadPoolExecutor(max_workers=workers,thread_name_prefix='cmf-archive') as pool:
            try:
                while futures or not exhausted:
                    check_cancel(cancellation)
                    while not exhausted and len(futures) < workers:
                        path = next(candidates,None)
                        if path is None:
                            exhausted = True
                            break
                        with guard:
                            active[str(path)] = {}
                        futures[pool.submit(run,path)] = path
                    if not futures:
                        break
                    completed,_ = wait(futures,timeout=0.1,return_when=FIRST_COMPLETED)
                    for future in completed:
                        path = futures.pop(future)
                        result = future.result()
                        with guard:
                            active.pop(str(path))
                            for key in COUNTERS:
                                totals[key] += result[key]
                            report_locked(str(path))
            except BaseException:
                stopped.set()
                raise
    finally:
        candidates.close()
    progress(phase='process',discovering=False,total=totals['done'],current='통합 처리 종료',workers=workers,written=totals['bytes'],**totals)
    return totals
