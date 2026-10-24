"""Bounded, content-addressed neutral parses; callers always receive a copy."""
from collections import OrderedDict
from copy import deepcopy
import sys


def retained_bytes(value):
    seen=set()
    def size(obj):
        identity=id(obj)
        if identity in seen:return 0
        seen.add(identity)
        total=sys.getsizeof(obj)
        if isinstance(obj,dict):total+=sum(size(k)+size(v) for k,v in obj.items())
        elif isinstance(obj,(list,tuple)):total+=sum(size(v) for v in obj)
        return total
    return size(value)


class ModelParseCache:
    # Models serializes operations with its existing memory gate.
    def __init__(self,max_bytes=32*1024*1024,max_entries=32):
        self.max_bytes=max_bytes;self.max_entries=max_entries
        self.entries=OrderedDict();self.bytes=0

    def get(self,key,build):
        found=self.entries.pop(key,None)
        if found is not None:
            self.entries[key]=found
            return deepcopy(found[0])
        value=build();size=retained_bytes(value)
        if size<=self.max_bytes:
            while self.entries and (self.bytes+size>self.max_bytes or len(self.entries)>=self.max_entries):
                _,(_,old_size)=self.entries.popitem(last=False);self.bytes-=old_size
            self.entries[key]=(value,size);self.bytes+=size
            return deepcopy(value)
        return value
