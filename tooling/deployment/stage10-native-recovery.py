"""Nonprivileged native recovery of a verified backup into private tmpfs.

Pins and library paths are trusted operator configuration, never request data.
This is a mechanism check, not migration qualification or ADR-014 clearance.
"""
import ctypes
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import pwd
import resource
import shlex
import shutil
import tarfile
import tempfile

_spec = importlib.util.spec_from_file_location('stage10_recovery_native', Path(__file__).with_name('stage10-native-backup.py'))
_native = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_native)

SQL = """SELECT json_build_object(
 'ledgerHead',(SELECT max(name) FROM travelos_meta.schema_migrations),
 'ledgerCount',(SELECT count(*) FROM travelos_meta.schema_migrations),
 'tripCount',(SELECT count(*) FROM trip_ops.trip),
 'personCount',(SELECT count(*) FROM crm.person),
 'customerCount',(SELECT count(*) FROM crm.customer),
 'adminTripSelect',has_table_privilege('travelos_admin_runtime','trip_ops.trip','SELECT'),
 'portalTripSelect',has_table_privilege('travelos_portal_runtime','trip_ops.trip','SELECT'),
 'listenAddresses',current_setting('listen_addresses'),
 'archiveMode',current_setting('archive_mode'), 'inRecovery',pg_is_in_recovery());"""
CONFIG = """listen_addresses = ''
ssl = off
archive_mode = off
archive_command = ''
restore_command = ''
archive_cleanup_command = ''
recovery_end_command = ''
primary_conninfo = ''
primary_slot_name = ''
shared_preload_libraries = ''
session_preload_libraries = ''
local_preload_libraries = ''
jit = off
logging_collector = off
log_statement = 'none'
log_min_error_statement = 'panic'
"""
ERROR = 'STAGE10_RECOVERY_REJECTED'
CLEANUP_ERROR = 'STAGE10_RECOVERY_CLEANUP_FAILED_ROOT_PRESERVED'


def _swap_disabled():
    # Cgroup v2: an ancestor with limit zero constrains all descendants.
    try:
        lines = Path('/proc/self/cgroup').read_text().splitlines()
        entry = next(line[3:] for line in lines if line.startswith('0::/'))
        base = Path('/sys/fs/cgroup')
        current = base / entry.lstrip('/')
        if not current.resolve().is_relative_to(base):
            return False
        if (current / 'memory.swap.current').read_text().strip() != '0':
            return False
        while True:
            if (current / 'memory.swap.max').read_text().strip() == '0':
                return True
            if current == base:
                return False
            current = current.parent
    except (OSError, StopIteration, ValueError):
        return False


def _preflight(parent):
    if os.getuid() == 0 or os.getuid() != os.geteuid():
        raise ValueError(ERROR)
    if resource.getrlimit(resource.RLIMIT_CORE) != (0, 0) or not _swap_disabled():
        raise ValueError(ERROR)
    if str(parent) not in ('/run/travelos-stage10-backup', f'/run/user/{os.geteuid()}'):
        raise ValueError(ERROR)
    fd = _native._private_parent(parent)
    try:
        # Linux fstatfs, with a buffer larger than struct statfs on supported ABIs.
        buf = ctypes.create_string_buffer(512)
        if ctypes.CDLL(None, use_errno=True).fstatfs(fd, ctypes.byref(buf)) != 0:
            raise ValueError(ERROR)
        if ctypes.c_long.from_buffer(buf).value != 0x01021994:  # TMPFS_MAGIC
            raise ValueError(ERROR)
    finally:
        os.close(fd)


def _check_result(value):
    keys = {'ledgerHead', 'ledgerCount', 'tripCount', 'personCount', 'customerCount',
            'adminTripSelect', 'portalTripSelect', 'listenAddresses', 'archiveMode', 'inRecovery'}
    if type(value) is not dict or set(value) != keys:
        raise ValueError(ERROR)
    if (type(value['ledgerHead']) is not str or len(value['ledgerHead']) > 255
            or any(type(value[k]) is not int or value[k] < 0 for k in ('ledgerCount', 'tripCount', 'personCount', 'customerCount'))
            or value['adminTripSelect'] is not True or value['portalTripSelect'] is not False
            or value['listenAddresses'] != '' or value['archiveMode'] != 'off' or value['inRecovery'] is not False):
        raise ValueError(ERROR)
    return {k: value[k] for k in ('ledgerHead', 'ledgerCount', 'tripCount', 'personCount', 'customerCount', 'adminTripSelect', 'portalTripSelect')}


def _cleanup_recovery(root, clone, sock, started, start_confirmed, pid, run, args):
    """Return failure without deleting a clone whose shutdown is unverified."""
    if root is None:
        return False
    try:
        if started:
            pidfile = clone / 'postmaster.pid'
            if pid is None and pidfile.exists():
                pid = int(pidfile.read_text().splitlines()[0])
            if pid is None and not start_confirmed:
                return True
            if pid is not None:
                if pid <= 1:
                    return True
                try:
                    run(0, args + ['-m', 'fast', 'stop'], timeout=35)
                except Exception:
                    run(0, args + ['-m', 'immediate', 'stop'], timeout=35)
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    pass
                else:
                    return True
            if pidfile.exists() or (sock / '.s.PGSQL.6544').exists():
                return True
        shutil.rmtree(root)
        return False
    except Exception:
        return True


def recover_native_tar(archive, tools, private_parent, *, library_directories=()):
    """Verify and query a disposable clone; no caller-supplied SQL or commands."""
    root = None
    fds = []
    started = False
    start_confirmed = False
    pid = None
    try:
        _preflight(private_parent)
        _native._object(tools, ('pg_ctl', 'postgres', 'psql', 'pg_verifybackup', 'pg_waldump'))
        if type(archive) is not bytes or not 0 < len(archive) <= _native.MAX_BACKUP:
            raise ValueError(ERROR)
        user = pwd.getpwuid(os.geteuid()).pw_name
        if not _native.IDENTIFIER.fullmatch(user):
            raise ValueError(ERROR)
        verified = _native.verify_native_tar(archive, {k: tools[k] for k in ('pg_verifybackup', 'pg_waldump')}, private_parent, library_directories=library_directories)
        if verified.get('nativeManifestVerified') is not True or verified.get('walParsed') is not True:
            raise ValueError(ERROR)
        for name in ('pg_ctl', 'postgres', 'psql'):
            fds.append(_native._pin_tool(tools[name]))
        root = Path(tempfile.mkdtemp(prefix='stage10-recovery-', dir=private_parent))
        clone, sock = root / 'db', root / 's'
        clone.mkdir(mode=0o700); sock.mkdir(mode=0o700)
        # postgres closes inherited descriptors during startup, so its argv[0]
        # cannot be /proc/self/fd. Materialize only the sealed, pinned image in
        # the private tmpfs clone; no unverified caller pathname is executed.
        original_bin = Path(tools['postgres']['path']).parent
        if original_bin.parts[-4:] != ('lib', 'postgresql', '18', 'bin'):
            raise ValueError(ERROR)
        usr = original_bin.parents[3]
        pg_share = usr / 'share/postgresql/18'
        sharefd = _native._private_parent(str(pg_share), private=False)
        os.close(sharefd)
        binary_dir = root / 'usr/lib/postgresql/18/bin'
        binary_dir.mkdir(mode=0o700, parents=True)
        share_target = root / 'usr/share/postgresql/18'
        share_target.parent.mkdir(mode=0o700, parents=True)
        share_target.symlink_to(pg_share, target_is_directory=True)
        pg_lib = library_directories[-1] if library_directories else str(original_bin.parent / 'lib')
        libfd = _native._private_parent(pg_lib, private=False)
        os.close(libfd)
        (binary_dir.parent / 'lib').symlink_to(pg_lib, target_is_directory=True)
        for index, name in ((0, 'pg_ctl'), (1, 'postgres')):
            image = binary_dir / name
            with image.open('xb') as target:
                offset = 0
                while True:
                    block = os.pread(fds[index], 65536, offset)
                    if not block:
                        break
                    target.write(block)
                    offset += len(block)
            image.chmod(0o500)
        postgres_image = binary_dir / 'postgres'
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:') as tar:
            tar.extractall(clone, filter='data')
        clone.chmod(0o700)
        if (clone / 'standby.signal').exists() or (clone / 'recovery.signal').exists():
            raise ValueError(ERROR)
        (clone / 'postgresql.auto.conf').unlink(missing_ok=True)
        (clone / 'pg_hba.conf').write_text('local all postgres peer map=stage10_recovery\n')
        (clone / 'pg_ident.conf').write_text(f'stage10_recovery {user} postgres\n')
        config = clone / 'stage10-recovery.conf'
        config.write_text(CONFIG)
        env = {'PATH': '/usr/bin:/bin', 'HOME': str(root), 'LANG': 'C', 'LC_ALL': 'C'}
        if library_directories:
            env['LD_LIBRARY_PATH'] = ':'.join(library_directories)
        def run(index, args, timeout=45):
            executable = str(binary_dir / 'pg_ctl') if index == 0 else f'/proc/self/fd/{fds[index]}'
            result = _native._process.bounded_run([executable, *args],
                env=env, cwd=str(root), pass_fds=tuple(fds), timeout=timeout, output_limit=16384)
            if result.returncode:
                raise ValueError(ERROR)
            return result.stdout
        args = ['-D', str(clone), '-w', '-t', '30']
        options = shlex.join(['-c', 'config_file='+str(config), '-c', 'data_directory='+str(clone),
            '-c', 'hba_file='+str(clone/'pg_hba.conf'), '-c', 'ident_file='+str(clone/'pg_ident.conf'),
            '-c', 'unix_socket_directories='+str(sock), '-c', 'port=6544'])
        started = True  # start may fail after creating a postmaster
        run(0, args + ['-p', str(postgres_image), '-l', str(root/'recovery.log'), '-o', options, 'start'])
        start_confirmed = True
        pid = int((clone/'postmaster.pid').read_text().splitlines()[0])
        raw = run(2, ['-X', '-qAt', '-h', str(sock), '-p', '6544', '-U', 'postgres', '-d',
                      'travelos_development', '-v', 'ON_ERROR_STOP=1', '-c', SQL])
        result = _check_result(json.loads(raw, object_pairs_hook=_native._pairs))
        output = {'result': 'NATIVE_CLONE_QUERIED_NOT_QUALIFIED', 'archiveSha256': hashlib.sha256(archive).hexdigest(),
                  'nativeManifestVerified': True, 'walParsed': True, 'restored': result,
                  'dataAvailability': 'CLOSED_PENDING_PRIVACY_INTERVAL_RECONCILIATION'}
    except Exception:
        output = None
    finally:
        cleanup_failed = _cleanup_recovery(root, clone if root else None,
            sock if root else None, started, start_confirmed, pid,
            run if started else None, args if started else None)
        for fd in fds:
            os.close(fd)
    if cleanup_failed:
        raise ValueError(CLEANUP_ERROR) from None
    if output is None:
        raise ValueError(ERROR) from None
    return output
