#!/usr/bin/python3
"""Fixed CT200 DEVELOPMENT database-only encrypted backup producer.

Run only from its reviewed root-owned installation, as root with python3 -I.
The only output on stdout is authenticated CMS ciphertext. It is not a complete
restore point, retention manager, transport, restore or Stage 10 acceptance.
"""
import ctypes
import fcntl
import hashlib
import importlib.util
import json
import os
import pwd
import resource
import stat
import subprocess
import sys
import zlib
from pathlib import Path

INSTALL = '/usr/local/lib/travelos/stage10-backup'
IDENTITY = '/usr/local/lib/travelos/stage10-identity/stage10-backup-identity-host.py'
IDENTITY_SHA256 = '8845d47b34440a6458e882b57308e92b591415e7f27212079005f3cbdbb61b8f'
CERT = '/etc/travelos/stage10-backup-recipient.pem'
RECIPIENT = 'b7e09a9f4165c4798d33aa171e2a3d1b5fab0789d6c51f8bf88717db4240cd92'
STAGING = '/run/travelos-stage10-backup'
SOURCES = {
    'stage10-native-backup.py': '12e4be08deacb47af799d4e5c78253a86e9b473998ab0349584f1a6bc5a67a7c',
    'stage10-backup-encryption.py': '3e494e07a3a86a2aa6937a6ff03fffa275ac3422425803b235549383b144cd3f',
    'stage10-process-boundary.py': '443a10b92a5978a1b4224dcb08d8de9939368a6ef5301e9b58ee2cbc8ca3e9bc',
}
TOOLS = {
    'psql': ('/usr/lib/postgresql/18/bin/psql', '651b44cd205e8c25e7fc6a1079e949188a7acb2d9119db1c8c4479c08b7b0d3c'),
    'pg_basebackup': ('/usr/lib/postgresql/18/bin/pg_basebackup', '62666e936201f4acba4386377859abd01e1671b50dd49f816e54182f71d64640'),
    'pg_verifybackup': ('/usr/lib/postgresql/18/bin/pg_verifybackup', 'de53e1fd1487aafb4c5b090018d6585f39683d5eef1c5daa66f88f862a334b20'),
    'pg_waldump': ('/usr/lib/postgresql/18/bin/pg_waldump', '6be752d56db65c6e6b5a4a47c31859dbe4ced2da836e58cf09b60f0c0c4a4bd5'),
}
NAME = 'travelos_backup'
PLAN = {'schemaVersion': 1, 'environment': 'DEVELOPMENT', 'socketDirectory': '/var/run/postgresql',
        'port': 5432, 'osUser': NAME, 'replicationRole': NAME,
        'authentication': {'method': 'peer', 'osUser': NAME, 'databaseRole': NAME},
        'role': {'login': True, 'replication': True, 'superuser': False, 'createdb': False,
                 'createrole': False, 'bypassrls': False},
        'hba': {'connectionType': 'local', 'database': 'replication', 'user': NAME, 'method': 'peer'}}


def compress_bounded(data, limit):
    if type(data) is not bytes or not data or type(limit) is not int or limit < 1:
        raise ValueError('invalid input')
    compressor = zlib.compressobj(6, zlib.DEFLATED, 31)
    output = bytearray()
    for start in range(0, len(data), 65536):
        output.extend(compressor.compress(data[start:start + 65536]))
        if len(output) > limit:
            raise ValueError('compressed backup exceeds encryption bound')
    output.extend(compressor.flush())
    if len(output) > limit:
        raise ValueError('compressed backup exceeds encryption bound')
    return bytes(output)


def create_encrypted(native, crypto, cert_fd, pin, plan, tools, staging):
    backup = native.native_backup_tar(plan, {k: tools[k] for k in ('psql', 'pg_basebackup')},
                                      staging, maximum_bytes=native.MAX_BACKUP)
    archive = backup['archive']
    digest = hashlib.sha256(archive).hexdigest()
    if not archive or backup['bytes'] != len(archive) or backup['sha256'] != digest:
        raise ValueError('backup digest mismatch')
    verified = native.verify_native_tar(archive, {k: tools[k] for k in ('pg_verifybackup', 'pg_waldump')}, staging)
    if (verified.get('nativeManifestVerified') is not True or verified.get('walParsed') is not True
            or verified.get('archiveSha256') != digest):
        raise ValueError('native verification failed')
    compressed = compress_bounded(archive, crypto.MAX_INPUT)
    ciphertext, actual_pin = crypto.encrypt(compressed, cert_fd, pin)
    if actual_pin != pin or not ciphertext:
        raise ValueError('encryption failed')
    return ciphertext


def read_root_file(path, limit):
    parts = Path(path).parts
    if not Path(path).is_absolute() or '..' in parts:
        raise ValueError('path')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd); fd = child
            s = os.fstat(fd)
            if s.st_uid != 0 or s.st_mode & 0o022:
                raise ValueError('unsafe directory')
        child = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=fd)
        try:
            before = os.fstat(child)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_mode & 0o022
                    or before.st_nlink != 1 or not 0 < before.st_size <= limit):
                raise ValueError('unsafe file')
            data = bytearray()
            while len(data) <= limit:
                block = os.read(child, min(65536, limit + 1 - len(data)))
                if not block: break
                data.extend(block)
            after = os.fstat(child)
            fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink')
            if len(data) != before.st_size or any(getattr(before, k) != getattr(after, k) for k in fields):
                raise ValueError('file changed')
            return bytes(data)
        finally:
            os.close(child)
    finally:
        os.close(fd)


def seal(data):
    fd = os.memfd_create('stage10-certificate', os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
    try:
        view = memoryview(data)
        while view:
            n = os.write(fd, view)
            if n <= 0: raise ValueError('short write')
            view = view[n:]
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL)
        return fd
    except BaseException:
        os.close(fd); raise


def validate_staging(native):
    fd = native._private_parent(STAGING)
    try:
        # Linux TMPFS_MAGIC: verified on the opened directory rather than its name.
        buf = ctypes.create_string_buffer(256)
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.fstatfs(fd, ctypes.byref(buf)) != 0 or ctypes.c_long.from_buffer(buf).value != 0x01021994:
            raise ValueError('staging must be tmpfs')
        # tmpfs pages could otherwise spill plaintext into unprotected swap.
        with open('/proc/swaps', 'rt', encoding='ascii') as swaps:
            if len(swaps.read(65537).splitlines()) != 1:
                raise ValueError('swap enabled or unavailable')
        st = os.fstatvfs(fd)
        if st.f_bavail * st.f_frsize < native.MAX_BACKUP + 16 * 1024 * 1024:
            raise ValueError('insufficient tmpfs capacity')
    finally:
        os.close(fd)


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), INSTALL + '/' + name)
    if spec is None or spec.loader is None: raise ValueError('missing dependency')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def enable_no_new_privs():
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))
    if libc.prctl(39, 0, 0, 0, 0) != 1:  # PR_GET_NO_NEW_PRIVS
        raise ValueError('no_new_privs not enforced')


def drop_identity(account):
    os.setgroups([]); os.setgid(account.pw_gid); os.setuid(account.pw_uid)
    if os.geteuid() != account.pw_uid or os.getegid() != account.pw_gid or os.getgroups():
        raise ValueError('identity drop failed')
    enable_no_new_privs()


def main():
    cert = None
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.umask(0o077)
        if sys.argv[1:] or os.geteuid() != 0 or not sys.flags.isolated or __file__ != INSTALL + '/stage10-ct200-backup-operator.py':
            raise ValueError('invocation')
        # Trust in this entry source comes from the root-owned installation; all
        # dynamically loaded sources and the independently installed checker are pinned.
        read_root_file(__file__, 1024 * 1024)
        for name, expected in SOURCES.items():
            if hashlib.sha256(read_root_file(INSTALL + '/' + name, 1024 * 1024)).hexdigest() != expected:
                raise ValueError('source pin')
        if hashlib.sha256(read_root_file(IDENTITY, 1024 * 1024)).hexdigest() != IDENTITY_SHA256:
            raise ValueError('identity pin')
        pem = read_root_file(CERT, 65536)
        if hashlib.sha256(pem).hexdigest() != RECIPIENT:
            raise ValueError('recipient pin')
        cert = seal(pem)
        check = subprocess.run(['/usr/bin/python3', '-I', IDENTITY, 'check'], stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=90,
                               env={'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'})
        if check.returncode or len(check.stdout) > 16384 or json.loads(check.stdout).get('state') != 'VERIFIED':
            raise ValueError('identity not verified')
        account = pwd.getpwnam(NAME)
        if account.pw_uid == 0 or account.pw_gid == 0:
            raise ValueError('invalid backup identity')
        drop_identity(account)
        native = load('stage10-native-backup.py')
        crypto = load('stage10-backup-encryption.py')
        validate_staging(native)
        tools = {name: {'path': path, 'sha256': digest} for name, (path, digest) in TOOLS.items()}
        ciphertext = create_encrypted(native, crypto, cert, RECIPIENT, PLAN, tools, STAGING)
        sys.stdout.buffer.write(ciphertext)
        sys.stdout.buffer.flush()
        return 0
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError, OverflowError):
        print('STAGE10_CT200_BACKUP_FAILED', file=sys.stderr)
        return 1
    finally:
        if cert is not None: os.close(cert)


if __name__ == '__main__':
    sys.exit(main())
