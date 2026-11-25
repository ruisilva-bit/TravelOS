#!/usr/bin/python3
"""Fixed Stage10 install-only bootstrap. Root supplies a verified JSON bundle on stdin.

No retry or cleanup after an uncertain/partial result. The CLI has no path overrides.
Trust boundary: root and all other privileged writers must remain exclusive.
"""
import base64
import binascii
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

NAMES = ('stage10-backup-identity-host.py', 'stage10-backup-identity.py',
         'stage10-native-backup.py', 'stage10-process-boundary.py',
         'stage10-backup-recipient.pem')
CERT_HASH = 'b7e09a9f4165c4798d33aa171e2a3d1b5fab0789d6c51f8bf88717db4240cd92'
LIMIT = 131072
DIRFLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC

class Refusal(Exception):
    pass

def _validate(bundle, cert_hash):
    if not isinstance(bundle, dict) or set(bundle) != set(NAMES):
        raise Refusal('bundle names')
    contents = {}
    for name in NAMES:
        item = bundle[name]
        if not isinstance(item, dict) or set(item) != {'sha256', 'data'}:
            raise Refusal('bundle fields')
        digest, encoded = item['sha256'], item['data']
        if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
            raise Refusal('digest format')
        if not isinstance(encoded, str) or len(encoded) > ((LIMIT + 2) // 3) * 4:
            raise Refusal('encoded size')
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise Refusal('base64') from None
        if not 0 < len(data) <= LIMIT or hashlib.sha256(data).hexdigest() != digest:
            raise Refusal('content hash or size')
        contents[name] = data
    if hashlib.sha256(contents[NAMES[-1]]).hexdigest() != cert_hash:
        raise Refusal('recipient certificate pin')
    return contents

def _check_dir(fd, owner, group):
    s = os.fstat(fd)
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != owner or s.st_gid != group or s.st_mode & 0o022:
        raise Refusal('insecure directory')

def _walk(rootfd, parts, owner, group, *, missing_ok=False):
    fd = os.dup(rootfd)
    try:
        _check_dir(fd, owner, group)
        for part in parts:
            try:
                new = os.open(part, DIRFLAGS, dir_fd=fd)
            except FileNotFoundError:
                if missing_ok:
                    return None
                raise
            os.close(fd)
            fd = new
            _check_dir(fd, owner, group)
        result, fd = fd, None
        return result
    finally:
        if fd is not None:
            os.close(fd)

def _absent(fd, name):
    try:
        os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise Refusal('target exists: ' + name)

def _preflight(rootfd, owner, group):
    for parent, leaf in ((('usr','local','lib','travelos'), 'stage10-identity'),
                         (('var','lib','travelos'), 'stage10-backup-identity'),
                         (('etc','travelos'), NAMES[-1])):
        fd = _walk(rootfd, parent, owner, group, missing_ok=parent[0] != 'etc')
        if fd is None:
            continue
        try:
            _absent(fd, leaf)
            if parent[0] == 'etc':
                _absent(fd, '.stage10-install-recipient.tmp')
                _absent(fd, '.stage10-identity-install-started')
        finally:
            os.close(fd)
    # Fixed leading parents must exist, never create generic system directories.
    for parts in (('usr','local','lib'), ('var','lib'), ('etc','travelos')):
        fd = _walk(rootfd, parts, owner, group)
        os.close(fd)

def _mkdir(parent, name, mode, progress):
    progress['started'] = True  # syscall result can be ambiguous
    os.mkdir(name, mode, dir_fd=parent)
    progress['created'].append(name)
    fd = os.open(name, DIRFLAGS, dir_fd=parent)
    try:
        os.fchmod(fd, mode)
        os.fsync(fd)
        os.fsync(parent)
    except BaseException:
        os.close(fd)
        raise
    return fd

def _parent(rootfd, parts, owner, group, progress):
    fd = _walk(rootfd, parts[:-1], owner, group)
    try:
        try:
            child = os.open(parts[-1], DIRFLAGS, dir_fd=fd)
        except FileNotFoundError:
            child = _mkdir(fd, parts[-1], 0o755, progress)
        _check_dir(child, owner, group)
        return child
    finally:
        os.close(fd)

def _publish(fd, name, tmp, data, owner, group, progress):
    progress['started'] = True
    f = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
    try:
        view = memoryview(data)
        while view:
            n = os.write(f, view)
            if n <= 0:
                raise OSError('short write')
            view = view[n:]
        os.fchmod(f, 0o644)
        os.fsync(f)
    finally:
        os.close(f)
    os.link(tmp, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
    os.fsync(fd)
    os.unlink(tmp, dir_fd=fd)
    os.fsync(fd)
    _readback(fd, name, data, owner, group)
    progress['created'].append(name)

def _readback(fd, name, data, owner, group):
    f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=fd)
    try:
        s = os.fstat(f)
        if (not stat.S_ISREG(s.st_mode) or s.st_uid != owner or s.st_gid != group
                or stat.S_IMODE(s.st_mode) != 0o644 or s.st_nlink != 1 or s.st_size != len(data)):
            raise Refusal('readback metadata')
        result = bytearray()
        while len(result) <= LIMIT:
            part = os.read(f, LIMIT + 1 - len(result))
            if not part:
                break
            result.extend(part)
        if bytes(result) != data or os.fstat(f) != s:
            raise Refusal('readback mismatch')
    finally:
        os.close(f)

def install(bundle, *, _root=Path('/'), _owner=0, _group=None, _cert_hash=CERT_HASH):
    """Underscored arguments are private fixture injection, unavailable via CLI."""
    if _group is None:
        _group = os.getegid() if _root != Path('/') else 0
    progress = {'started': False, 'created': []}
    fds = []
    try:
        contents = _validate(bundle, _cert_hash)
        rootfd = os.open(_root, DIRFLAGS)
        fds.append(rootfd)
        _preflight(rootfd, _owner, _group)
        certdir = _walk(rootfd, ('etc','travelos'), _owner, _group); fds.append(certdir)
        progress['started'] = True
        marker = os.open('.stage10-identity-install-started', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=certdir)
        try:
            os.fchmod(marker, 0o600)
            os.fsync(marker)
        finally:
            os.close(marker)
        os.fsync(certdir)
        progress['created'].append('.stage10-identity-install-started')
        lib = _parent(rootfd, ('usr','local','lib','travelos'), _owner, _group, progress); fds.append(lib)
        statebase = _parent(rootfd, ('var','lib','travelos'), _owner, _group, progress); fds.append(statebase)
        inst = _mkdir(lib, 'stage10-identity', 0o755, progress); fds.append(inst)
        state = _mkdir(statebase, 'stage10-backup-identity', 0o700, progress); fds.append(state)
        for name in NAMES[:-1]:
            _publish(inst, name, '.' + name + '.tmp', contents[name], _owner, _group, progress)
        _publish(certdir, NAMES[-1], '.stage10-install-recipient.tmp', contents[NAMES[-1]], _owner, _group, progress)
        for name in NAMES[:-1]:
            _readback(inst, name, contents[name], _owner, _group)
        _readback(certdir, NAMES[-1], contents[NAMES[-1]], _owner, _group)
        s = os.fstat(state)
        if s.st_uid != _owner or s.st_gid != _group or stat.S_IMODE(s.st_mode) != 0o700 or os.listdir(state):
            raise Refusal('state readback')
        return {'status': 'INSTALLED', 'sha256': {n: hashlib.sha256(contents[n]).hexdigest() for n in NAMES}}
    except (OSError, Refusal, ValueError, TypeError) as exc:
        return {'status': 'RECONCILIATION_REQUIRED' if progress['started'] else 'REFUSED',
                'reason': str(exc), 'created_observed': progress['created'],
                'warning': 'No automatic cleanup or retry; inspect all fixed paths and staging names.'}
    finally:
        for fd in reversed(fds):
            os.close(fd)

def parse_bundle(raw):
    def unique_pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate JSON key')
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=unique_pairs)
    except RecursionError:
        raise ValueError('JSON nesting exceeds supported limit') from None


def main():
    if len(sys.argv) != 1 or os.geteuid() != 0 or not sys.flags.isolated:
        print(json.dumps({'status': 'REFUSED', 'reason': 'requires root, isolated Python, no arguments'})); return 1
    try:
        raw = sys.stdin.buffer.read(1000001)
        if len(raw) > 1000000:
            raise ValueError('input too large')
        bundle = parse_bundle(raw)
        result = install(bundle)
    except (ValueError, UnicodeDecodeError) as exc:
        result = {'status': 'REFUSED', 'reason': str(exc)}
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0 if result['status'] == 'INSTALLED' else 1

if __name__ == '__main__':
    sys.exit(main())
