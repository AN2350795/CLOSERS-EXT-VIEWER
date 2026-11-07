"""Request-local, measured listing progress; disconnects cancel at checkpoints."""
from contextlib import contextmanager
import threading
import time

local=threading.local()


class Progress:
    def __init__(self,send):
        self.send=send;self.started=time.monotonic();self.changed=self.started;self.sent=0
        self.state=dict(stage='starting',label='목록 요청을 준비하는 중',done=None,total=None,batch=None)

    def report(self,stage,label,done=None,total=None,heartbeat=False):
        now=time.monotonic();previous=self.state
        state=dict(stage=stage,label=label,done=done,total=total,batch=getattr(local,'batch',None))
        changed=any(state[key]!=previous[key] for key in ('stage','label','total','batch'))
        if not heartbeat:self.state=state;self.changed=now
        if changed or now-self.sent>=(1 if heartbeat else .2) or done is not None and done==total:
            self.send(dict(self.state,elapsed=now-self.started,last_progress_age=now-self.changed))
            self.sent=now


@contextmanager
def reporting(send):
    previous=getattr(local,'progress',None);previous_batch=getattr(local,'batch',None)
    local.progress=Progress(send);local.batch=None
    try:
        report('starting','목록 요청을 준비하는 중')
        yield
    finally:local.progress=previous;local.batch=previous_batch


def report(stage,label,done=None,total=None):
    progress=getattr(local,'progress',None)
    if progress:progress.report(stage,label,done,total)


@contextmanager
def batch(index,total):
    previous=getattr(local,'batch',None);local.batch=dict(index=index,total=total)
    try:yield
    finally:local.batch=previous


def rows(values,stage,label,total=None):
    if not getattr(local,'progress',None):
        yield from values;return
    if total is None:
        try:total=len(values)
        except TypeError:pass
    report(stage,label,0,total);done=0
    for done,value in enumerate(values,1):
        if done%250==0:report(stage,label,done,total)
        yield value
    report(stage,label,done,total)


@contextmanager
def locked(lock):
    progress=getattr(local,'progress',None)
    if progress is None:
        with lock:yield
        return
    acquired=lock.acquire(blocking=False)
    if not acquired:
        progress.report('waiting','다른 목록 준비 작업이 끝나기를 기다리는 중')
        while not acquired:
            acquired=lock.acquire(timeout=.1)
            if not acquired:progress.report('waiting','다른 목록 준비 작업이 끝나기를 기다리는 중',heartbeat=True)
    try:yield
    finally:lock.release()
