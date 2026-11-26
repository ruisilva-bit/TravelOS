"""Fail-closed resource preflight for Stage 10 synthetic CT200 qualification.

Run as the first program inside an attempt-owned, transient user-systemd unit.
This only attests effective limits; it does not launch PostgreSQL or certify
an application artifact, cleanup, browser ABI, receipt custody or privacy.
"""
import json
import os
from pathlib import Path
import re
import resource
import sys

ATTEMPT_PARENT = Path('/home/hermes/.local/share/travelos-stage10-qualification')
MEMORY_MAX = 3221225472
PIDS_MAX = 128
CPU_MAX = '300000 100000'


def require(condition):
    if not condition:
        raise ValueError('STAGE10_RESOURCE_BOUNDARY_REJECTED')


def check_resource_boundary(cgroup, *, uid, core_limits):
    """Read effective child cgroup controls, not the SSH parent metadata."""
    cgroup = Path(cgroup)
    require(uid == 1000 and core_limits == (0, 0))
    require('user-1000.slice' in cgroup.parts and 'user@1000.service' in cgroup.parts)
    require('app.slice' in cgroup.parts and cgroup.name.startswith('travelos-s10-'))
    observed = {}
    for name in ('memory.max', 'memory.swap.max', 'memory.swap.current', 'pids.max', 'cpu.max'):
        file = cgroup / name
        require(file.is_file() and not file.is_symlink())
        observed[name] = file.read_text(encoding='ascii').strip()
    require(observed['memory.max'] == str(MEMORY_MAX))
    require(observed['memory.swap.max'] == '0' and observed['memory.swap.current'] == '0')
    require(observed['pids.max'] == str(PIDS_MAX) and observed['cpu.max'] == CPU_MAX)
    return {'scope': 'SYNTHETIC_RESOURCE_PREFLIGHT_ONLY', 'uid': uid,
            'memoryMaxBytes': MEMORY_MAX, 'memorySwapMaxBytes': 0,
            'pidsMax': PIDS_MAX, 'cpuMax': CPU_MAX, 'coreLimits': [0, 0]}


def unit_command(unit, attempt):
    """Construct fixed non-shell systemd probe, never a caller-command executor."""
    attempt = Path(attempt)
    require(attempt.is_absolute() and attempt.parent == ATTEMPT_PARENT)
    require(re.fullmatch(r'attempt-[a-z0-9]{3,32}', attempt.name) is not None)
    require(unit == 'travelos-s10-' + attempt.name)
    return ['/usr/bin/systemd-run', '--user', '--collect', '--wait', '--pipe',
            '--unit=' + unit, '-p', 'MemoryMax=' + str(MEMORY_MAX),
            '-p', 'MemorySwapMax=0', '-p', 'TasksMax=' + str(PIDS_MAX),
            '-p', 'CPUQuota=300%', '-p', 'RuntimeMaxSec=1800',
            '-p', 'LimitCORE=0', '/usr/bin/python3', '-B', '-I',
            str(attempt / 'harness/resource.py')]


def inspect_child():
    lines = Path('/proc/self/cgroup').read_text(encoding='ascii').splitlines()
    require(len(lines) == 1 and lines[0].startswith('0::/'))
    suffix = lines[0][3:]
    require('..' not in Path(suffix).parts)
    return check_resource_boundary(Path('/sys/fs/cgroup') / suffix.lstrip('/'),
                                   uid=os.getuid(), core_limits=resource.getrlimit(resource.RLIMIT_CORE))


if __name__ == '__main__':
    try:
        require(not sys.argv[1:])
        print(json.dumps(inspect_child(), sort_keys=True))
    except (ValueError, OSError, UnicodeError):
        print(json.dumps({'result': 'FAIL', 'code': 'STAGE10_RESOURCE_BOUNDARY_REJECTED'}))
        sys.exit(1)
