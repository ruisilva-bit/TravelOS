#!/usr/bin/env python3
"""SYNTHETIC FIXTURE ONLY: no real evidence, trust roots, keys or host use.

A single hard-coded, complete fixture is the entire supported envelope. The
receipt and privacy documents are independently fixed constants; they cannot
be supplied by the caller. Their values are test fixtures, not real decisions.
The destination must be a disposable directory under TMPDIR. One replay ID
maps to one immutable directory; all retries reject. No RET finding is closed.
"""
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import tempfile

PAYLOAD = b'SYNTHETIC EVIDENCE\n'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()

# Fixed synthetic identities and content. No caller-provided authority or clock.
BINDING = {'version': 1, 'environment': 'synthetic-only', 'instance': 'fixture',
           'candidate': 'fixture', 'source': 'fixture-source', 'artifact': 'fixture-artifact',
           'replay': 'fixture-replay-1'}
MANIFEST = encode({'payload.txt': {'sha256': digest(PAYLOAD), 'size': len(PAYLOAD)}})
RECEIPT = encode({'binding': BINDING, 'authority': 'fixture-receipt-authority',
                  'receipt': 'fixture-receipt', 'validity': 'fixture-static', 'revocation': 'fixture-none'})
PRIVACY = encode({'binding': BINDING, 'reviewer': 'fixture-privacy-reviewer',
                  'manifest_sha256': digest(MANIFEST), 'receipt_sha256': digest(RECEIPT),
                  'classification': 'synthetic', 'retention': 'disposable', 'access': 'fixture-only',
                  'acceptance_schema': 'fixture-v1'})
ACCEPTANCE = encode({'binding': BINDING, 'manifest_sha256': digest(MANIFEST),
                     'receipt_sha256': digest(RECEIPT), 'privacy_sha256': digest(PRIVACY)})
FILES = {'payload.txt': PAYLOAD, 'manifest.json': MANIFEST, 'receipt.json': RECEIPT,
         'privacy.json': PRIVACY, 'acceptance.json': ACCEPTANCE}
PIN = digest(ACCEPTANCE)

class Replay(Exception):
    pass

class Undetermined(Exception):
    """Rename happened but durable readback could not be established."""

def _sync_dir(fd):
    os.fsync(fd)

def _rename_noreplace(root_fd, src, dst):
    libc = ctypes.CDLL(None, use_errno=True)
    fn = libc.renameat2
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    if fn(root_fd, os.fsencode(src), root_fd, os.fsencode(dst), 1):
        err = ctypes.get_errno()
        if err == errno.EEXIST:
            raise Replay('fixture authorization already used')
        raise OSError(err, os.strerror(err))

def verify_fixture(obj, pin):
    if pin != PIN:
        raise ValueError('acceptance pin mismatch')
    obj = Path(obj)
    fd = os.open(obj, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        return _verify_fd(fd)
    finally:
        os.close(fd)

def _verify_fd(fd):
    if set(os.listdir(fd)) != set(FILES):
        raise ValueError('inventory mismatch')
    for name, expected in FILES.items():
        child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            st = os.fstat(child)
            if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_size != len(expected):
                raise ValueError('unsafe object')
            data = b''
            while len(data) < len(expected):
                part = os.read(child, len(expected) - len(data))
                if not part:
                    break
                data += part
            if data != expected or os.read(child, 1):
                raise ValueError('object bytes differ')
        finally:
            os.close(child)
    return True

def publish_fixture(root, payload):
    if payload != PAYLOAD:
        raise ValueError('only the fixed synthetic payload is supported')
    root = Path(root)
    temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
    resolved = root.resolve(strict=True)
    if root.is_symlink() or resolved == temp_root or not resolved.is_relative_to(temp_root):
        raise ValueError('destination must be a disposable TMPDIR child')
    root_fd = os.open(resolved, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    root_stat = os.fstat(root_fd)
    if root_stat.st_uid != os.getuid() or root_stat.st_mode & 0o077:
        os.close(root_fd)
        raise ValueError('untrusted fixture directory')
    stage = '.fixture-stage-' + secrets.token_hex(16)
    target = 'fixture-replay-1'
    renamed = False
    created = False
    stage_fd = None
    try:
        os.mkdir(stage, 0o700, dir_fd=root_fd)
        created = True
        stage_fd = os.open(stage, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
        for name, data in FILES.items():
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=stage_fd)
            try:
                view = memoryview(data)
                while view:
                    n = os.write(fd, view)
                    if n <= 0:
                        raise OSError('short write')
                    view = view[n:]
                os.fsync(fd)
            finally:
                os.close(fd)
        _sync_dir(stage_fd)
        _verify_fd(stage_fd)
        _rename_noreplace(root_fd, stage, target)
        renamed = True
        _sync_dir(root_fd)
        target_fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
        try:
            promoted = os.fstat(target_fd)
            staged = os.fstat(stage_fd)
            if (promoted.st_dev, promoted.st_ino) != (staged.st_dev, staged.st_ino):
                raise ValueError('promoted directory replaced')
            _verify_fd(target_fd)
        finally:
            os.close(target_fd)
        current = os.stat(resolved, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (root_stat.st_dev, root_stat.st_ino):
            raise ValueError('destination replaced')
        return resolved / target, PIN
    except Exception as exc:
        if renamed:
            raise Undetermined('renamed; inspect fixture, do not retry automatically') from exc
        raise
    finally:
        try:
            if not renamed and created:
                if stage_fd is not None:
                    for name in os.listdir(stage_fd):
                        os.unlink(name, dir_fd=stage_fd)
                os.rmdir(stage, dir_fd=root_fd)
        finally:
            if stage_fd is not None:
                os.close(stage_fd)
            os.close(root_fd)
