"""Synthetic DEVELOPMENT experiments only; not a provisioning or release-signing API.

This module generates disposable test keys. Callers must not use real keys or data.
The invoking UID, its primary GID and root are trusted; other users and groups are
not. Host-bound recovery is not host-loss recovery or independent trust.
"""
import ctypes
import errno
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import stat
import tempfile

COSIGN_SHA256 = '4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71'
CREDS = '/usr/bin/systemd-creds'
NAMES = {'key.cred': 'travelos-development-private-key', 'password.cred': 'travelos-development-key-password'}
LIMIT = 1048576

# Import the fixed sibling by pathname, never an attacker-selected sys.path module.
_spec = importlib.util.spec_from_file_location('_stage10_process_boundary', Path(__file__).with_name('stage10-process-boundary.py'))
if _spec is None or _spec.loader is None:
    raise ImportError('STAGE10_PROCESS_BOUNDARY_UNAVAILABLE')
_boundary = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_boundary)
bounded_run = _boundary.bounded_run


def require(condition):
    if not condition:
        raise ValueError('STAGE10_KEYSTORE_REJECTED')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def _open_directory(path, private=False):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts)
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        for component in path.parts[1:]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = child
            info = os.fstat(fd)
            require(info.st_uid in (0, os.getuid()))
            # Even a trusted primary group is not allowed to mutate ancestors.
            require(not info.st_mode & 0o022)
        info = os.fstat(fd)
        if private:
            require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700)
        return fd
    except BaseException:
        os.close(fd)
        raise


def private_directory(directory):
    fd = _open_directory(directory, private=True)
    os.close(fd)


def _read_at(directory_fd, name, public=False):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory_fd)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1 and not info.st_mode & (0o022 if public else 0o077) and info.st_size <= LIMIT)
        data = bytearray()
        while len(data) <= LIMIT:
            block = os.read(fd, min(65536, LIMIT + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        require(len(data) <= LIMIT)
        return bytes(data)
    finally:
        os.close(fd)


def file_bytes(file):
    file = Path(file)
    fd = _open_directory(file.parent, private=True)
    try:
        return _read_at(fd, file.name)
    finally:
        os.close(fd)


def _write_at(directory_fd, name, data):
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory_fd)
    with os.fdopen(fd, 'wb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def write_new(file, data):
    file = Path(file)
    fd = _open_directory(file.parent, private=True)
    try:
        _write_at(fd, file.name, data)
    finally:
        os.close(fd)


def run(command, *, data=None, password=None, directory=None, descriptors=()):
    environment = {'PATH': '/usr/bin:/bin', 'HOME': str(directory or Path.home()), 'LANG': 'C.UTF-8'}
    if password is not None:
        environment['COSIGN_PASSWORD'] = password.decode('ascii')
    return bounded_run(command, data=data, cwd=directory, env=environment, timeout=60, pass_fds=descriptors)


def checked(command, **kwargs):
    result = run(command, **kwargs)
    require(result.returncode == 0)
    return result.stdout


def _sealed(data, name):
    fd = os.memfd_create(name, os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
    try:
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            require(written > 0)
            view = view[written:]
        os.lseek(fd, 0, os.SEEK_SET)
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL)
        return fd
    except BaseException:
        os.close(fd)
        raise


def pin_cosign(cosign):
    cosign = Path(cosign)
    parent = _open_directory(cosign.parent)
    try:
        fd = os.open(cosign.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent)
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid in (0, os.getuid()) and not info.st_mode & 0o022 and info.st_nlink == 1 and info.st_size <= 256 * LIMIT)
            chunks = []
            size = 0
            while True:
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                require(size <= 256 * LIMIT)
            data = b''.join(chunks)
            require(digest(data) == COSIGN_SHA256)
            return _sealed(data, 'travelos-pinned-cosign')
        finally:
            os.close(fd)
    finally:
        os.close(parent)


def protect(data, file, name):
    encrypted = checked([CREDS, '--user', f'--name={name}', 'encrypt', '-', '-'], data=data)
    require(encrypted)
    write_new(file, encrypted)


def unprotect(file, name):
    return checked([CREDS, '--user', f'--name={name}', 'decrypt', '-', '-'], data=file_bytes(file))


def _protect_at(data, fd, filename):
    encrypted = checked([CREDS, '--user', f'--name={NAMES[filename]}', 'encrypt', '-', '-'], data=data)
    require(encrypted)
    _write_at(fd, filename, encrypted)


def _unprotect_at(fd, filename):
    return checked([CREDS, '--user', f'--name={NAMES[filename]}', 'decrypt', '-', '-'], data=_read_at(fd, filename))


def _begin(destination):
    destination = Path(destination)
    require(destination.is_absolute() and destination.name not in ('', '.', '..'))
    parent = _open_directory(destination.parent, private=True)
    name = '.stage10-' + secrets.token_hex(16)
    created = False
    try:
        os.mkdir(name, 0o700, dir_fd=parent)
        created = True
        stage = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        return parent, stage, name, destination.name
    except BaseException:
        if created:
            os.rmdir(name, dir_fd=parent)
        os.close(parent)
        raise


class PublicationDurabilityError(OSError):
    publication_state = 'PUBLISHED_DURABILITY_UNCERTAIN'
    def __init__(self, destination):
        super().__init__('STAGE10_KEYSTORE_PUBLISHED_DURABILITY_UNCERTAIN')
        self.destination = destination


def _publish(parent, stage, name, destination):
    full_destination = str(Path(os.readlink(f'/proc/self/fd/{parent}')) / destination)
    os.fsync(stage)
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(parent, os.fsencode(name), parent, os.fsencode(destination), 1) != 0:
        err = ctypes.get_errno()
        if err == errno.EEXIST:
            raise ValueError('STAGE10_KEYSTORE_REJECTED')
        raise OSError(err, os.strerror(err), destination)
    uncertain = False
    try:
        os.fsync(parent)
    except OSError:
        uncertain = True
    # Raise outside the handler: retain neither raw message nor hidden context.
    if uncertain:
        raise PublicationDurabilityError(full_destination)


def _cleanup(parent, stage, name):
    os.close(stage)
    try:
        shutil.rmtree(f'/proc/self/fd/{parent}/{name}')
    except FileNotFoundError:
        pass
    finally:
        os.close(parent)


def create_store(directory, cosign):
    executable = pin_cosign(cosign)
    try:
        parent, stage, name, target = _begin(directory)
        try:
            with tempfile.TemporaryDirectory(prefix='work-', dir=f'/proc/self/fd/{stage}') as temporary:
                password = secrets.token_hex(32).encode('ascii')
                checked([f'/proc/self/fd/{executable}', 'generate-key-pair', '--output-key-prefix', 'development'], password=password, directory=temporary, descriptors=(executable, stage))
                work = os.open(temporary, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    encrypted_key = _read_at(work, 'development.key')
                    public_key = _read_at(work, 'development.pub', public=True)
                finally:
                    os.close(work)
                _protect_at(encrypted_key, stage, 'key.cred')
                _protect_at(password, stage, 'password.cred')
                require(_unprotect_at(stage, 'key.cred') == encrypted_key)
                require(_unprotect_at(stage, 'password.cred') == password)
                _write_at(stage, 'verification.pub', public_key)
                metadata = {'schemaVersion': 1, 'environment': 'DEVELOPMENT', 'cosignSha256': COSIGN_SHA256,
                            'publicKeySha256': digest(public_key), 'protection': 'COSIGN_PASSWORD_AND_USER_SYSTEMD_CREDS_HOST_BOUND',
                            'independentTrustDistribution': 'PENDING', 'hostLossRecovery': 'NOT_QUALIFIED'}
                _write_at(stage, 'metadata.json', (json.dumps(metadata, sort_keys=True) + '\n').encode())
            _publish(parent, stage, name, target)
            return {'status': 'ENCRYPTED_LOCAL_KEYSTORE_CREATED_NOT_DEPLOYMENT_TRUST', **metadata}
        finally:
            _cleanup(parent, stage, name)
    finally:
        os.close(executable)


def recovery_probe(source, destination, cosign):
    executable = pin_cosign(cosign)
    try:
        source_fd = _open_directory(source, private=True)
        try:
            parent, stage, name, target = _begin(destination)
            try:
                for filename in ('key.cred', 'password.cred', 'verification.pub', 'metadata.json'):
                    _write_at(stage, filename, _read_at(source_fd, filename))
                metadata = json.loads(_read_at(stage, 'metadata.json'))
                public_key = _read_at(stage, 'verification.pub')
                require(metadata.get('schemaVersion') == 1 and metadata.get('environment') == 'DEVELOPMENT' and metadata.get('cosignSha256') == COSIGN_SHA256 and metadata.get('publicKeySha256') == digest(public_key))
                encrypted_key = _unprotect_at(stage, 'key.cred')
                password = _unprotect_at(stage, 'password.cred')
                with tempfile.TemporaryDirectory(prefix='work-', dir=f'/proc/self/fd/{stage}') as temporary:
                    work = Path(temporary)
                    (work / 'synthetic-artifact').write_bytes(b'synthetic-development-key-recovery-probe\n')
                    (work / 'verification.pub').write_bytes(public_key)
                    cmd = f'/proc/self/fd/{executable}'
                    checked([cmd, 'signing-config', 'create', '--out', 'offline.json'], directory=temporary, descriptors=(executable, stage))
                    key = _sealed(encrypted_key, 'travelos-encrypted-cosign-key')
                    try:
                        checked([cmd, 'sign-blob', '--key', f'/proc/self/fd/{key}', '--signing-config', 'offline.json', '--bundle', 'bundle.json', 'synthetic-artifact'], password=password, directory=temporary, descriptors=(executable, stage, key))
                    finally:
                        os.close(key)
                    verify = [cmd, 'verify-blob', '--key', 'verification.pub', '--bundle', 'bundle.json', '--offline', '--insecure-ignore-tlog', 'synthetic-artifact']
                    checked(verify, directory=temporary, descriptors=(executable, stage))
                    (work / 'synthetic-artifact').write_bytes(b'tampered-synthetic-probe\n')
                    require(run(verify, directory=temporary, descriptors=(executable, stage)).returncode != 0)
                _publish(parent, stage, name, target)
                return {'publicKeySha256': digest(public_key), 'validSignature': 'PASS', 'tamperedArtifact': 'REJECTED',
                        'recoveryScope': 'SAME_HOST_ENCRYPTED_BLOB_RESTORE_NOT_HOST_LOSS_RECOVERY',
                        'transparency': 'OFFLINE_NO_PUBLIC_TRANSPARENCY_PROOF', 'independentTrustDistribution': 'PENDING'}
            finally:
                _cleanup(parent, stage, name)
        finally:
            os.close(source_fd)
    finally:
        os.close(executable)
