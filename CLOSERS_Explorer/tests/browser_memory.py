"""Windows working sets for explicitly supplied isolated Chrome PIDs only."""
import ctypes
from ctypes import wintypes
import json
import sys


class Counters(ctypes.Structure):
    _fields_=[('cb',wintypes.DWORD),('PageFaultCount',wintypes.DWORD),
              *[(key,ctypes.c_size_t) for key in ('PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage',
                'QuotaPagedPoolUsage','QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage',
                'PeakPagefileUsage','PrivateUsage')]]


kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
kernel.CloseHandle.argtypes=[wintypes.HANDLE]
psapi=ctypes.WinDLL('psapi',use_last_error=True)
psapi.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(Counters),wintypes.DWORD]
rows=[]
for value in sys.argv[1:]:
    pid=int(value);handle=kernel.OpenProcess(0x410,False,pid)
    if not handle:
        rows.append(dict(pid=pid,error=ctypes.get_last_error()));continue
    try:
        counters=Counters();counters.cb=ctypes.sizeof(counters)
        if not psapi.GetProcessMemoryInfo(handle,ctypes.byref(counters),counters.cb):
            rows.append(dict(pid=pid,error=ctypes.get_last_error()))
        else:
            rows.append(dict(pid=pid,working_set=counters.WorkingSetSize,peak_working_set=counters.PeakWorkingSetSize,
                             private_bytes=counters.PrivateUsage))
    finally:kernel.CloseHandle(handle)
print(json.dumps(dict(processes=rows,working_set_sum=sum(row.get('working_set',0) for row in rows),
                      note='Sum of isolated Chrome working sets; shared pages may be counted more than once.')))
