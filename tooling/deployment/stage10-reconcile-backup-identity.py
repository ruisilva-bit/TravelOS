#!/usr/bin/python3 -I
"""One-time CT200 pre-account failure reconciliation; exclusive admin window required.

Not a provisioner, backup/restore proof, or Stage 10 gate. Never auto-retry after
any failure: inspect both directory names and obtain independent review first.
"""
import ctypes
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import resource
import stat
import sys

INSTALL = '/usr/local/lib/travelos/stage10-identity'
HOST_HASH = 'ecd367fbdbbced323199ad3d8c789d0a83040337969d5ad17dee84eb412d9148'
CIPHER_HASH = 'e5de7b52f6210fd3709916ab42cffd942c81704f09e8652203eded41dc4ac3de'
PARENT = '/var/lib/travelos'
STATE = 'stage10-backup-identity'
ARCHIVE = 'stage10-backup-identity-failed-useradd-option-parse-ct200-01'
NAMES = {'000.json', '001.json', '002.json', '003.json', 'snapshot.cms'}
EVENTS = ['snapshot', 'started', 'user_intent', 'reconciliation_required']
RULES = b'local replication travelos_backup peer\nlocal postgres travelos_backup peer\n'


def reject():
    raise ValueError('RECONCILIATION_REQUIRES_MANUAL_REVIEW')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def _read(fd, name, owner, limit):
    f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        a = os.fstat(f)
        if (not stat.S_ISREG(a.st_mode) or a.st_uid != owner or a.st_nlink != 1
                or stat.S_IMODE(a.st_mode) != 0o600 or not 0 < a.st_size <= limit):
            reject()
        data = os.read(f, limit + 1)
        if len(data) != a.st_size or a != os.fstat(f):
            reject()
        return data
    finally:
        os.close(f)


def _pairs(values):
    out = {}
    for k, v in values:
        if k in out: reject()
        out[k] = v
    return out


def _directory(fd, owner):
    s = os.fstat(fd)
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != owner or stat.S_IMODE(s.st_mode) != 0o700:
        reject()
    return s


def _rename_no_replace(parent, old, new):
    fn = ctypes.CDLL(None, use_errno=True).renameat2
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    if fn(parent, os.fsencode(old), parent, os.fsencode(new), 1) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def _reconcile(host, parent_path, state_name, archive_name, owner, cipher_hash, cipher_size, *, fault=None):
    # Arguments above are private fixture injection, never CLI inputs. Real entry
    # validates every ancestor and passes fixed constants and already-locked host.
    parent = os.open(parent_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    state = None
    try:
        state = os.open(state_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        original_inode = _directory(state, owner)
        if hasattr(host, 'state'):
            held = os.fstat(host.state)
            if (held.st_dev, held.st_ino) != (original_inode.st_dev, original_inode.st_ino): reject()
        else:
            fcntl.flock(state, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if set(os.listdir(state)) != NAMES: reject()
        blobs = {n: _read(state, n, owner, 131072 if n == 'snapshot.cms' else 8192) for n in NAMES}
        if len(blobs['snapshot.cms']) != cipher_size or digest(blobs['snapshot.cms']) != cipher_hash: reject()
        values = [json.loads(blobs[f'{i:03d}.json'], object_pairs_hook=_pairs) for i in range(4)]
        meta = values[0].get('metadata')
        keys = {'recipient', 'original_hba_sha256', 'bound_hba_sha256', 'cipher_sha256', 'hba_uid', 'hba_gid', 'hba_mode', 'hba_bytes'}
        if type(meta) is not dict or set(meta) != keys: reject()
        for i, value in enumerate(values):
            if (set(value) != {'version', 'sequence', 'event', 'metadata'} or type(value['version']) is not int
                    or value['version'] != 1 or type(value['sequence']) is not int or value['sequence'] != i
                    or value['event'] != EVENTS[i]
                    or json.dumps(value['metadata'], sort_keys=True) != json.dumps(meta, sort_keys=True)): reject()
        if (type(meta['hba_uid']) is not int or meta['hba_uid'] != 102
                or type(meta['hba_gid']) is not int or meta['hba_gid'] != 106
                or type(meta['hba_mode']) is not int or meta['hba_mode'] != 0o640
                or type(meta['hba_bytes']) is not int or not 0 < meta['hba_bytes'] <= 65536
                or meta['cipher_sha256'] != cipher_hash): reject()
        # Installed adapter performs strict journal, snapshot, HBA metadata and
        # cluster verification through its fixed, pinned read-only facilities.
        if host.read_journal() != 'reconciliation_required': reject()
        if host.meta != meta: reject()
        data = host.read_hba().encode('utf-8')
        if (len(data) != meta['hba_bytes'] or digest(data) != meta['original_hba_sha256']
                or digest(RULES + data) != meta['bound_hba_sha256']
                or b'travelos_backup' in data): reject()
        if host.user_exists('travelos_backup') or not host.group_absent() or host.role_exists('travelos_backup'): reject()
        if set(os.listdir(state)) != NAMES: reject()
        if any(_read(state, n, owner, 131072 if n == 'snapshot.cms' else 8192) != b for n, b in blobs.items()): reject()
        current = os.stat(state_name, dir_fd=parent, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (original_inode.st_dev, original_inode.st_ino): reject()
        # Sync retained evidence before making the atomic, non-overwriting move.
        for n in NAMES:
            fd = os.open(n, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=state)
            try: os.fsync(fd)
            finally: os.close(fd)
        os.fsync(state)
        _rename_no_replace(parent, state_name, archive_name)
        os.fsync(parent)
        if fault: fault('archived')
        archived = os.open(archive_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            st = _directory(archived, owner)
            if (st.st_dev, st.st_ino) != (original_inode.st_dev, original_inode.st_ino): reject()
            if set(os.listdir(archived)) != NAMES: reject()
            if any(_read(archived, n, owner, 131072 if n == 'snapshot.cms' else 8192) != b for n, b in blobs.items()): reject()
        finally: os.close(archived)
        if fault: fault('verified')
        os.mkdir(state_name, 0o700, dir_fd=parent)
        fresh = os.open(state_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            _directory(fresh, owner)
            if os.listdir(fresh): reject()
            os.fsync(fresh)
        finally: os.close(fresh)
        os.fsync(parent)
        if fault: fault('rearmed')
    finally:
        if state is not None: os.close(state)
        os.close(parent)


def main():
    host = None
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.umask(0o077)
        if (sys.argv[1:] or os.geteuid() != 0 or not sys.flags.isolated
                or str(Path(__file__)) != INSTALL + '/stage10-reconcile-backup-identity.py'): reject()
        # Source is read through protected ancestry, pinned to the installed
        # adapter that produced this exact journal, before executing it.
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in INSTALL.split('/')[1:]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd); fd = child
                info = os.fstat(fd)
                if info.st_uid != 0 or info.st_mode & 0o022: reject()
            # Adapter is typically 0644, not private journal mode.
            sourcefd = os.open('stage10-backup-identity-host.py', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                st = os.fstat(sourcefd)
                if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_nlink != 1 or st.st_mode & 0o022 or st.st_size > 131072: reject()
                source = os.read(sourcefd, 131073)
                if len(source) != st.st_size or st != os.fstat(sourcefd) or digest(source) != HOST_HASH: reject()
            finally: os.close(sourcefd)
        finally: os.close(fd)
        namespace = {'__name__': 'stage10_identity_host', '__file__': INSTALL + '/stage10-backup-identity-host.py'}
        exec(compile(source, namespace['__file__'], 'exec'), namespace)
        engine, native = namespace['dependencies'](INSTALL)
        parent = namespace['directory'](PARENT)
        os.close(parent)
        host = namespace['Host'](engine, native)
        def group_absent():
            try: grp.getgrnam('travelos_backup')
            except KeyError: return True
            return False
        host.group_absent = group_absent
        _reconcile(host, PARENT, STATE, ARCHIVE, 0, CIPHER_HASH, 761)
        print('{"state":"REARMED_REQUIRES_SEPARATE_PROVISION"}')
        return 0
    except Exception:
        print('{"state":"RECONCILIATION_REQUIRES_MANUAL_REVIEW"}')
        return 1
    finally:
        if host is not None: host.close()


if __name__ == '__main__': sys.exit(main())
