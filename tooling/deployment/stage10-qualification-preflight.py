"""Fixed CT200 metadata probe sent over pinned SSH; no application/DB access.

Does not start browser/Node/PostgreSQL, create scratch, change limits, access
credentials, read application configuration or assert native ABI compatibility.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import subprocess


def file_metadata(file):
    if not file.is_file():
        return {'present': False}
    with file.open('rb') as stream:
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    info = file.stat()
    return {'present': True, 'sha256': digest.hexdigest(), 'bytes': info.st_size,
            'executable': os.access(file, os.X_OK), 'uid': info.st_uid,
            'mode': oct(info.st_mode & 0o7777)}


def inspect():
    tools = {}
    for name in ('initdb', 'pg_ctl', 'postgres', 'psql', 'pg_dump', 'pg_restore'):
        file = Path('/usr/lib/postgresql/18/bin') / name
        record = file_metadata(file)
        if record['present'] and record['executable']:
            result = subprocess.run([str(file), '--version'], capture_output=True,
                                    timeout=5, env={'PATH': '/usr/bin:/bin', 'LANG': 'C'})
            record['versionExit'] = result.returncode
            text = result.stdout.decode('ascii', errors='replace').strip()
            record['version'] = text if len(text) < 150 else 'UNEXPECTED_OUTPUT'
        tools[name] = record
    cgroups = []
    for line in Path('/proc/self/cgroup').read_text().splitlines():
        if not line.startswith('0::'):
            continue
        suffix = line[3:]
        if '..' in Path(suffix).parts:
            continue
        root = Path('/sys/fs/cgroup') / suffix.lstrip('/')
        controls = {}
        for name in ('memory.max', 'pids.max', 'cpu.max', 'cgroup.subtree_control', 'cgroup.procs'):
            target = root / name
            controls[name] = {'present': target.is_file(), 'writable': os.access(target, os.W_OK)}
        cgroups.append({'directoryWritable': os.access(root, os.W_OK), 'controls': controls})
    browsers = []
    for base in (Path('/home/hermes/.cache/ms-playwright'), Path('/opt/ms-playwright')):
        if base.is_dir():
            for pattern in ('chromium-*/chrome-linux/chrome', 'chromium-*/chrome-linux64/chrome',
                            'chromium_headless_shell-*/chrome-linux/headless_shell',
                            'chromium_headless_shell-*/chrome-linux64/headless_shell'):
                for entry in sorted(base.glob(pattern))[:8]:
                    browsers.append({'cache': base.name, 'relative': entry.relative_to(base).as_posix(),
                                     'binary': file_metadata(entry)})
    libraries = {}
    ldconfig = Path('/sbin/ldconfig')
    if ldconfig.is_file():
        result = subprocess.run([str(ldconfig), '-p'], capture_output=True, timeout=5,
                                env={'PATH': '/usr/bin:/bin', 'LANG': 'C'})
        output = result.stdout.decode('ascii', errors='replace')
        for name in ('libnss3.so', 'libnspr4.so', 'libatk-1.0.so.0', 'libatk-bridge-2.0.so.0',
                     'libcups.so.2', 'libdrm.so.2', 'libX11.so.6', 'libxcb.so.1', 'libXcomposite.so.1',
                     'libXdamage.so.1', 'libXext.so.6', 'libXfixes.so.3', 'libXrandr.so.2',
                     'libgbm.so.1', 'libxkbcommon.so.0', 'libasound.so.2', 'libpango-1.0.so.0',
                     'libcairo.so.2'):
            libraries[name] = any(line.strip().startswith(name + ' ') for line in output.splitlines())
    free = os.statvfs('/home/hermes')
    return {'schemaVersion': 1, 'scope': 'READ_ONLY_METADATA_NOT_QUALIFICATION',
            'uid': os.getuid(), 'architecture': platform.machine(), 'libc': platform.libc_ver(),
            'postgresTools': tools, 'cgroupV2': cgroups, 'browserCaches': browsers,
            'browserLibraryCache': libraries,
            'homeFreeBytes': free.f_bavail * free.f_frsize,
            'rlimits': {name: list(resource.getrlimit(getattr(resource, name))) for name in
                        ('RLIMIT_AS', 'RLIMIT_CPU', 'RLIMIT_NPROC', 'RLIMIT_NOFILE', 'RLIMIT_FSIZE')},
            'runtimeExecuted': False, 'scratchCreated': False, 'qualification': 'NOT_RUN'}


if __name__ == '__main__':
    print(json.dumps(inspect(), sort_keys=True))
