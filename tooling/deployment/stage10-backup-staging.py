"""Local synthetic integrity staging only; never a database backup adapter.

No privileged entry, shell, executable, path argument, DB access, or activation.
The fixed directory must already exist, be private and owned by this user.
"""
import hashlib
import json
import os
import secrets
import signal
import stat
import sys

ROOT = '/home/hermes/.hermes/cache/scratch/travelos-stage10-backup-preparation'
MAX_BYTES = 8 * 1024 * 1024
MAGIC = b'TRAVELOS-SYNTHETIC-STAGING-1\n'
TIMEOUT_SECONDS = 10


def _timeout(_signum, _frame):
    raise TimeoutError('deadline')


def _open_root():
    # Open each component without following links, avoiding path traversal/races.
    if not ROOT.startswith('/') or any(x in ('', '.', '..') for x in ROOT[1:].split('/')):
        raise ValueError('invalid fixed policy root')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in ROOT[1:].split('/'):
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = nxt
        info = os.fstat(fd)
        if info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError('staging directory must be private and owned')
        return fd
    except BaseException:
        os.close(fd)
        raise


def _read(root, name, limit):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=root)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != os.geteuid() or before.st_size > limit:
            raise ValueError('unsafe file')
        chunks = []
        size = 0
        while True:
            chunk = os.read(fd, min(65536, limit + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise ValueError('too large')
            chunks.append(chunk)
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns, before.st_nlink) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_nlink):
            raise ValueError('file changed during read')
        return b''.join(chunks)
    finally:
        os.close(fd)


def _publish(root, name, data):
    temp = '.stage-' + secrets.token_hex(16)
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=root)
    try:
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
        if _read(root, temp, len(data)) != data:
            raise ValueError('staging readback mismatch')
        # Link fails if final name exists; never replace existing material.
        os.link(temp, name, src_dir_fd=root, dst_dir_fd=root, follow_symlinks=False)
        os.unlink(temp, dir_fd=root)
        os.fsync(root)
        if _read(root, name, len(data)) != data:
            raise ValueError('publication readback mismatch')
    finally:
        try:
            os.unlink(temp, dir_fd=root)
        except FileNotFoundError:
            pass


def dispatch(args):
    if args not in (['backup'], ['restore']):
        print(json.dumps({'result': 'REJECTED'}))
        return 1
    old_handler = signal.signal(signal.SIGALRM, _timeout)
    signal.alarm(TIMEOUT_SECONDS)
    try:
        root = _open_root()
        try:
            if args == ['backup']:
                data = _read(root, 'source.bin', MAX_BYTES)
                digest = hashlib.sha256(data).hexdigest().encode('ascii')
                _publish(root, 'backup.bin', MAGIC + digest + b'\n' + data)
            else:
                archive = _read(root, 'backup.bin', MAX_BYTES + len(MAGIC) + 65)
                if not archive.startswith(MAGIC) or len(archive) < len(MAGIC) + 65:
                    raise ValueError('invalid archive')
                digest = archive[len(MAGIC):len(MAGIC) + 64]
                if archive[len(MAGIC) + 64:len(MAGIC) + 65] != b'\n':
                    raise ValueError('invalid archive')
                data = archive[len(MAGIC) + 65:]
                if hashlib.sha256(data).hexdigest().encode('ascii') != digest:
                    raise ValueError('checksum mismatch')
                _publish(root, 'restored.bin', data)
        finally:
            os.close(root)
        print(json.dumps({'result': 'INTEGRITY_STAGED', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}))
        return 0
    except (OSError, ValueError, TimeoutError):
        print(json.dumps({'result': 'FAILED'}))
        return 1
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)


if __name__ == '__main__':
    if os.geteuid() == 0:
        print(json.dumps({'result': 'REJECTED'}))
        raise SystemExit(1)
    raise SystemExit(dispatch(sys.argv[1:]))
