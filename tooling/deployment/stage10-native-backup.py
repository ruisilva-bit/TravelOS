#!/usr/bin/env python3
"""Stage 10 peer-plan validation and bounded native PostgreSQL library adapters.

The CLI validates plans only; it does not install/provision or expose privileged
backup execution. Native functions require trusted caller pins and identity;
they do not establish custody, restore readiness or Stage 10 acceptance.
"""
import json
import re
import sys
import os
import stat
import hashlib
import importlib.util
import tempfile
from pathlib import Path

_spec = importlib.util.spec_from_file_location('stage10_backup_process', Path(__file__).with_name('stage10-process-boundary.py'))
assert _spec and _spec.loader
_process = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_process)

# Library execution is for a trusted operator identity, NOT a privileged CLI.
# The public CLI below intentionally continues to expose only validate-plan.
MAX_BACKUP = 128 * 1024 * 1024
PREFLIGHT_SQL = """SELECT json_build_object(
 'currentUser',current_user,'sessionUser',session_user,
 'superuser',rolsuper,'createdb',rolcreatedb,'createrole',rolcreaterole,
 'bypassrls',rolbypassrls,'replication',rolreplication,'login',rolcanlogin,
 'memberships',(SELECT count(*) FROM pg_auth_members WHERE member=r.oid),
 'primary',NOT pg_is_in_recovery(),
 'serverVersion',current_setting('server_version_num')::integer,
 'extraTablespaces',(SELECT count(*) FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')))
 FROM pg_roles r WHERE rolname=current_user;"""


def _private_parent(path, *, private=True):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('STAGE10_NATIVE_BACKUP_PATH_REJECTED')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in path.parts[1:]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            info = os.fstat(fd)
            if info.st_uid not in (0, os.geteuid()) or info.st_mode & 0o022:
                raise ValueError('STAGE10_NATIVE_BACKUP_PATH_REJECTED')
        info = os.fstat(fd)
        if private and (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700):
            raise ValueError('STAGE10_NATIVE_BACKUP_PATH_REJECTED')
        return fd
    except BaseException:
        os.close(fd)
        raise


def _pin_tool(record):
    _object(record, ('path', 'sha256'))
    if type(record['sha256']) is not str or not re.fullmatch('[a-f0-9]{64}', record['sha256']):
        raise ValueError('STAGE10_NATIVE_BACKUP_TOOL_REJECTED')
    path = Path(record['path'])
    # Walk binary ancestors independently; unlike backup staging these need not
    # be private, but must exclude untrusted/group writers and symlinks.
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('STAGE10_NATIVE_BACKUP_TOOL_REJECTED')
    parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    fd = None
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
            info = os.fstat(parent)
            if info.st_uid not in (0, os.geteuid()) or info.st_mode & 0o022:
                raise ValueError('STAGE10_NATIVE_BACKUP_TOOL_REJECTED')
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0, os.geteuid())
                or info.st_mode & (0o022 | stat.S_ISUID | stat.S_ISGID) or not info.st_mode & 0o111
                or info.st_nlink != 1 or not 0 < info.st_size <= 32 * 1024 * 1024):
            raise ValueError('STAGE10_NATIVE_BACKUP_TOOL_REJECTED')
        data = bytearray()
        while len(data) <= 32 * 1024 * 1024:
            block = os.read(fd, min(65536, 32 * 1024 * 1024 + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        if len(data) > 32 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != record['sha256']:
            raise ValueError('STAGE10_NATIVE_BACKUP_TOOL_REJECTED')
        import fcntl
        sealed = os.memfd_create('stage10-pg-tool', os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
        try:
            view = memoryview(data)
            while view:
                written = os.write(sealed, view)
                if written <= 0:
                    raise ValueError('STAGE10_NATIVE_BACKUP_TOOL_REJECTED')
                view = view[written:]
            fcntl.fcntl(sealed, fcntl.F_ADD_SEALS, fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL)
            return sealed
        except BaseException:
            os.close(sealed)
            raise
    finally:
        if fd is not None:
            os.close(fd)
        os.close(parent)


def validate_live_identity(value, role):
    expected = {'currentUser': role, 'sessionUser': role, 'superuser': False,
                'createdb': False, 'createrole': False, 'bypassrls': False,
                'replication': True, 'login': True, 'memberships': 0,
                'primary': True, 'serverVersion': 180006, 'extraTablespaces': 0}
    if (type(value) is not dict or set(value) != set(expected)
            or any(type(value[k]) is not type(v) or value[k] != v for k, v in expected.items())):
        raise ValueError('STAGE10_NATIVE_BACKUP_IDENTITY_REJECTED')


def native_backup_tar(plan, tools, private_parent, *, maximum_bytes=MAX_BACKUP, library_directories=()):
    """Return native WAL-inclusive tar bytes in memory; never publish plaintext.

    Caller must encrypt before off-instance transfer. This is a real native
    provider boundary, not a qualified installed operator or recovery proof.
    Tool pins must come from the trusted caller, not an untrusted request.
    """
    validate_plan(plan)
    _object(tools, ('psql', 'pg_basebackup'))
    if type(maximum_bytes) is not int or not 1 <= maximum_bytes <= MAX_BACKUP:
        raise ValueError('STAGE10_NATIVE_BACKUP_BOUNDS_REJECTED')
    import pwd
    if pwd.getpwuid(os.geteuid()).pw_name != plan['osUser']:
        raise ValueError('STAGE10_NATIVE_BACKUP_IDENTITY_REJECTED')
    if type(library_directories) is not tuple or len(library_directories) > 4:
        raise ValueError('STAGE10_NATIVE_BACKUP_PATH_REJECTED')
    for directory in library_directories:
        if type(directory) is not str or ':' in directory:
            raise ValueError('STAGE10_NATIVE_BACKUP_PATH_REJECTED')
        descriptor = _private_parent(directory, private=False)
        os.close(descriptor)
    parent = _private_parent(private_parent)
    descriptors = []
    try:
        descriptors = []
        for name in ('psql', 'pg_basebackup'):
            descriptors.append(_pin_tool(tools[name]))
        with tempfile.TemporaryDirectory(prefix='stage10-native-', dir=f'/proc/self/fd/{parent}') as home:
            environment = {'PATH': '/usr/bin:/bin', 'HOME': home, 'LANG': 'C.UTF-8',
                           'PGCONNECT_TIMEOUT': '10', 'PGAPPNAME': 'travelos-stage10-backup'}
            if library_directories:
                environment['LD_LIBRARY_PATH'] = ':'.join(library_directories)
            connection = ['--host', plan['socketDirectory'], '--port', str(plan['port']),
                          '--username', plan['replicationRole'], '--no-password']
            def run(index, args, limit, timeout):
                result = _process.bounded_run([f'/proc/self/fd/{descriptors[index]}', *args],
                    pass_fds=tuple(descriptors), env=environment, cwd=home,
                    output_limit=limit, timeout=timeout)
                if result.returncode:
                    raise ValueError('STAGE10_NATIVE_BACKUP_PROVIDER_REJECTED')
                return result.stdout
            raw = run(0, [*connection, '-X', '--quiet', '--tuples-only', '--no-align',
                          '--dbname', 'postgres', '--set', 'ON_ERROR_STOP=1',
                          '--command', PREFLIGHT_SQL], 16384, 20)
            validate_live_identity(json.loads(raw, object_pairs_hook=_pairs), plan['replicationRole'])
            data = run(1, [*connection, '--format=tar', '--wal-method=fetch', '--pgdata=-',
                           '--manifest-checksums=SHA256', '--max-rate=8192', '--checkpoint=fast'], maximum_bytes, 120)
            if not data:
                raise ValueError('STAGE10_NATIVE_BACKUP_PROVIDER_REJECTED')
            return {'result': 'NATIVE_WAL_TAR_CREATED_NOT_MANIFEST_VERIFIED',
                    'archive': data, 'sha256': hashlib.sha256(data).hexdigest(),
                    'bytes': len(data), 'publication': 'NOT_ATTEMPTED',
                    'encryption': 'NOT_PERFORMED', 'restore': 'NOT_PERFORMED'}
    finally:
        for fd in descriptors:
            os.close(fd)
        os.close(parent)

def verify_native_tar(data, tools, private_parent, *, library_directories=()):
    """Verify native file checksums AND WAL records in private ephemeral storage.

    No publication or restore is performed. No archive member uses extractall.
    Libraries, like binary pins, belong to the trusted operator configuration.
    """
    import io
    import tarfile
    _object(tools, ('pg_verifybackup', 'pg_waldump'))
    if type(data) is not bytes or not 0 < len(data) <= MAX_BACKUP:
        raise ValueError('STAGE10_NATIVE_BACKUP_BOUNDS_REJECTED')
    if type(library_directories) is not tuple or len(library_directories) > 4:
        raise ValueError('STAGE10_NATIVE_BACKUP_PATH_REJECTED')
    for directory in library_directories:
        if type(directory) is not str or ':' in directory:
            raise ValueError('STAGE10_NATIVE_BACKUP_PATH_REJECTED')
        fd = _private_parent(directory, private=False)
        os.close(fd)
    parent = _private_parent(private_parent)
    pinned = []
    try:
        for name in ('pg_verifybackup', 'pg_waldump'):
            pinned.append(_pin_tool(tools[name]))
        with tempfile.TemporaryDirectory(prefix='stage10-verify-', dir=f'/proc/self/fd/{parent}') as temporary:
            destination = os.open(temporary, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                seen = set()
                total = 0
                with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
                    for member in archive:
                        name = member.name.rstrip('/')
                        if name.startswith('./'):
                            name = name[2:]
                        if name == '.' and member.isdir():
                            continue
                        parts = name.split('/')
                        if (not name or any(part in ('', '.', '..') for part in parts)
                                or name in seen or len(seen) >= 10000
                                or member.issparse() or not (member.isdir() or member.isfile())
                                or member.size < 0):
                            raise ValueError('STAGE10_NATIVE_BACKUP_ARCHIVE_REJECTED')
                        seen.add(name)
                        total += member.size
                        if total > MAX_BACKUP:
                            raise ValueError('STAGE10_NATIVE_BACKUP_BOUNDS_REJECTED')
                        directory = os.dup(destination)
                        try:
                            for part in parts[:-1]:
                                try:
                                    os.mkdir(part, 0o700, dir_fd=directory)
                                except FileExistsError:
                                    pass
                                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                                os.close(directory)
                                directory = child
                            if member.isdir():
                                try:
                                    os.mkdir(parts[-1], 0o700, dir_fd=directory)
                                except FileExistsError:
                                    check = os.open(parts[-1], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                                    os.close(check)
                            else:
                                fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
                                with os.fdopen(fd, 'wb') as output:
                                    source = archive.extractfile(member)
                                    if source is None:
                                        raise ValueError('STAGE10_NATIVE_BACKUP_ARCHIVE_REJECTED')
                                    with source:
                                        remaining = member.size
                                        while remaining:
                                            block = source.read(min(65536, remaining))
                                            if not block:
                                                raise ValueError('STAGE10_NATIVE_BACKUP_ARCHIVE_REJECTED')
                                            output.write(block)
                                            remaining -= len(block)
                        finally:
                            os.close(directory)
                environment = {'PATH': '/usr/bin:/bin', 'HOME': temporary, 'LANG': 'C.UTF-8'}
                if library_directories:
                    environment['LD_LIBRARY_PATH'] = ':'.join(library_directories)
                def checked(index, arguments):
                    result = _process.bounded_run([f'/proc/self/fd/{pinned[index]}', *arguments],
                        env=environment, cwd=temporary, pass_fds=(parent, *pinned), timeout=60, output_limit=16384)
                    if result.returncode:
                        raise ValueError('STAGE10_NATIVE_BACKUP_VERIFICATION_REJECTED')
                # Execute WAL parsing separately because a sealed verifybackup
                # image cannot discover its sibling waldump via its memfd path.
                checked(0, ['--exit-on-error', '--no-parse-wal', temporary])
                manifest_path = Path(temporary) / 'backup_manifest'
                if manifest_path.stat().st_size > 8 * 1024 * 1024:
                    raise ValueError('STAGE10_NATIVE_BACKUP_BOUNDS_REJECTED')
                manifest = json.loads(manifest_path.read_bytes(), object_pairs_hook=_pairs)
                ranges = manifest.get('WAL-Ranges')
                if type(ranges) is not list or not 1 <= len(ranges) <= 16:
                    raise ValueError('STAGE10_NATIVE_BACKUP_MANIFEST_REJECTED')
                for item in ranges:
                    _object(item, ('Timeline', 'Start-LSN', 'End-LSN'))
                    if (type(item['Timeline']) is not int or not 0 < item['Timeline'] <= 0xffffffff
                            or any(type(item[key]) is not str or not re.fullmatch(r'[0-9A-F]{1,8}/[0-9A-F]{1,8}', item[key])
                                   for key in ('Start-LSN', 'End-LSN'))):
                        raise ValueError('STAGE10_NATIVE_BACKUP_MANIFEST_REJECTED')
                    checked(1, ['--quiet', '--path', str(Path(temporary) / 'pg_wal'),
                                '--timeline', str(item['Timeline']), '--start', item['Start-LSN'], '--end', item['End-LSN']])
                return {'result': 'NATIVE_MANIFEST_AND_WAL_VERIFIED_NOT_RESTORED',
                        'archiveSha256': hashlib.sha256(data).hexdigest(), 'walRanges': len(ranges),
                        'nativeManifestVerified': True, 'walParsed': True,
                        'publication': 'NOT_ATTEMPTED', 'restore': 'NOT_PERFORMED'}
            finally:
                os.close(destination)
    finally:
        for fd in pinned:
            os.close(fd)
        os.close(parent)


IDENTIFIER = re.compile(r'[a-z_][a-z0-9_]{0,62}\Z', re.ASCII)
MAX_INPUT = 16384


def _object(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        raise ValueError('invalid fields')


def _identity(value):
    if type(value) is not str or not IDENTIFIER.fullmatch(value) or value == 'postgres':
        raise ValueError('invalid identity')


def validate_plan(plan):
    _object(plan, ('schemaVersion', 'environment', 'socketDirectory', 'port',
                   'osUser', 'replicationRole', 'authentication', 'role', 'hba'))
    if type(plan['schemaVersion']) is not int or plan['schemaVersion'] != 1 or plan['environment'] != 'DEVELOPMENT':
        raise ValueError('invalid policy')
    port = plan['port']
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError('invalid port')
    socket = plan['socketDirectory']
    if (type(socket) is not str or not socket.startswith('/') or '\x00' in socket
            or any(part in ('', '.', '..') for part in socket[1:].split('/'))):
        raise ValueError('invalid socket directory')
    user, role = plan['osUser'], plan['replicationRole']
    _identity(user); _identity(role)
    # No implicit pg_ident map: peer matches the OS identity exactly.
    if user != role:
        raise ValueError('peer identity mismatch')
    auth = plan['authentication']
    _object(auth, ('method', 'osUser', 'databaseRole'))
    if auth != {'method': 'peer', 'osUser': user, 'databaseRole': role}:
        raise ValueError('invalid authentication')
    privileges = plan['role']
    _object(privileges, ('login', 'replication', 'superuser', 'createdb', 'createrole', 'bypassrls'))
    expected = {'login': True, 'replication': True, 'superuser': False,
                'createdb': False, 'createrole': False, 'bypassrls': False}
    if any(type(privileges[key]) is not bool or privileges[key] != value for key, value in expected.items()):
        raise ValueError('invalid role plan')
    hba = plan['hba']
    _object(hba, ('connectionType', 'database', 'user', 'method'))
    if hba != {'connectionType': 'local', 'database': 'replication', 'user': role, 'method': 'peer'}:
        raise ValueError('invalid hba plan')
    return {'result': 'STRUCTURALLY_VALID_PLAN', 'provisioning': 'NOT_PERFORMED',
            'authentication': 'NOT_VERIFIED', 'rolePrivileges': 'NOT_VERIFIED',
            'planProvenance': 'NOT_AUTHENTICATED', 'backup': 'NOT_PERFORMED',
            'publication': 'NOT_ATTEMPTED_OUTCOME_UNKNOWN'}


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate field')
        result[key] = value
    return result


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT or sys.argv[1:] != ['validate-plan']:
            raise ValueError('invalid invocation')
        plan = json.loads(raw, object_pairs_hook=_pairs)
        result = validate_plan(plan)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValueError, UnicodeError, RecursionError):
        print(json.dumps({'result': 'REJECTED'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
