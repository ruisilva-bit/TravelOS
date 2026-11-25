"""Harness transport, fixed read-only CT200 preflight and verified scratch cleanup.

No qualification executor is implemented here. Archive hashes establish byte
consistency, not independent provenance/privacy acceptance.
Prepared trees are trusted build-host inputs, not hostile concurrent same-UID input.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile

SCOPE = 'TEST_HARNESS_ONLY_NOT_RUNTIME_OR_ACCEPTANCE'
HERE = Path(__file__).resolve().parent
MAX_BYTES = 4 * 1024 ** 3
MAX_ENTRIES = 200000
ATTEMPT_PARENT = Path('/home/hermes/.local/share/travelos-stage10-qualification')


def require(condition):
    if not condition:
        raise ValueError('STAGE10_TRANSPORT_REJECTED')


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe_name(name):
    require(isinstance(name, str) and bool(name) and '\\' not in name)
    require(not any(ord(c) < 32 or ord(c) == 127 for c in name))
    parsed = PurePosixPath(name)
    require(not parsed.is_absolute() and '..' not in parsed.parts and str(parsed) == name)
    require(name != '.')


def inventory(root):
    require(not root.is_symlink() and root.is_dir())
    root = root.resolve(strict=True)
    rows = []
    total = 0
    inodes = {}

    def visit(directory):
        nonlocal total
        for entry in sorted(directory.iterdir()):
            name = entry.relative_to(root).as_posix()
            safe_name(name)
            info = entry.lstat()
            mode = stat.S_IMODE(info.st_mode)
            require(not mode & 0o7000)
            require(len(rows) < MAX_ENTRIES)
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(entry)
                require(not os.path.isabs(target))
                try:
                    resolved = entry.resolve(strict=True)
                except (OSError, RuntimeError) as error:
                    raise ValueError('STAGE10_TRANSPORT_REJECTED') from error
                require(resolved.is_relative_to(root) and resolved != root)
                require(resolved.is_file() or resolved.is_dir())
                rows.append({'path': name, 'kind': 'symlink', 'target': target, 'mode': mode})
            elif stat.S_ISDIR(info.st_mode):
                rows.append({'path': name, 'kind': 'directory', 'mode': mode})
                visit(entry)
            else:
                require(stat.S_ISREG(info.st_mode))
                inode_key = (info.st_ino, info.st_dev)
                if inode_key in inodes:
                    rows.append({'path': name, 'kind': 'hardlink', 'target': inodes[inode_key], 'mode': mode})
                    continue
                inodes[inode_key] = name
                total += info.st_size
                require(total <= MAX_BYTES)
                rows.append({'path': name, 'kind': 'file', 'mode': mode,
                             'bytes': info.st_size, 'sha256': digest(entry)})
    visit(root)
    require(bool(rows))
    return sorted(rows, key=lambda row: row['path'])


def pack(root, archive):
    root, archive = Path(root), Path(archive)
    require(not archive.resolve().is_relative_to(root.resolve()))
    # Occupied leaves including dangling links are never replaced.
    if archive.exists() or archive.is_symlink():
        raise FileExistsError('STAGE10_TRANSPORT_OUTPUT_OCCUPIED')
    rows = inventory(root)
    with archive.open('xb') as output:
        os.fchmod(output.fileno(), 0o600)
        with tarfile.open(fileobj=output, mode='w', format=tarfile.PAX_FORMAT) as tf:
            for row in rows:
                info = tarfile.TarInfo(row['path'])
                info.mode = row['mode']
                if row['kind'] == 'directory':
                    info.type = tarfile.DIRTYPE
                    tf.addfile(info)
                elif row['kind'] == 'symlink':
                    info.type = tarfile.SYMTYPE
                    info.linkname = row['target']
                    tf.addfile(info)
                elif row['kind'] == 'hardlink':
                    info.type = tarfile.LNKTYPE
                    info.linkname = row['target']
                    tf.addfile(info)
                else:
                    info.size = row['bytes']
                    with (root / row['path']).open('rb') as stream:
                        tf.addfile(info, stream)
        output.flush()
        os.fsync(output.fileno())
    # Preserve incomplete output on failure; never erase an unknown attempt.
    require(inventory(root) == rows)
    receipt = {'schemaVersion': 1, 'scope': SCOPE, 'sha256': digest(archive),
               'bytes': archive.stat().st_size, 'files': rows}
    return verify(archive, receipt)


def verify(archive, receipt):
    archive = Path(archive)
    require(not archive.is_symlink() and archive.is_file())
    require(set(receipt) == {'schemaVersion', 'scope', 'sha256', 'bytes', 'files'})
    require(receipt['schemaVersion'] == 1 and receipt['scope'] == SCOPE)
    require(archive.stat().st_size == receipt['bytes'] and digest(archive) == receipt['sha256'])
    rows = receipt['files']
    require(isinstance(rows, list) and 0 < len(rows) <= MAX_ENTRIES)
    require(len({row['path'] for row in rows}) == len(rows))
    by_name = {row['path']: row for row in rows}
    for row in rows:
        safe_name(row['path'])
        # Every ancestor must be an explicit directory, never a link/file.
        # Otherwise extraction can alias two names or follow a redirected parent.
        for parent in PurePosixPath(row['path']).parents:
            if str(parent) != '.':
                require(by_name.get(str(parent), {}).get('kind') == 'directory')
    with tarfile.open(archive, 'r:') as tf:
        members = tf.getmembers()
        require(len(members) == len(rows))
        total = 0
        for member, row in zip(members, rows):
            safe_name(member.name)
            require(member.name == row['path'] and member.mode == row['mode'])
            require(not member.mode & 0o7000 and member.uid == 0 and member.gid == 0)
            require(member.mtime == 0 and member.uname == '' and member.gname == '')
            require(set(member.pax_headers) <= {'path', 'linkpath'})
            if row['kind'] == 'file':
                require(set(row) == {'path', 'kind', 'mode', 'bytes', 'sha256'})
                require(member.isfile() and member.size == row['bytes'])
                total += member.size
                require(total <= MAX_BYTES)
                with tf.extractfile(member) as stream:
                    require(hashlib.file_digest(stream, 'sha256').hexdigest() == row['sha256'])
            elif row['kind'] == 'directory':
                require(set(row) == {'path', 'kind', 'mode'} and member.isdir())
            elif row['kind'] == 'hardlink':
                require(set(row) == {'path', 'kind', 'mode', 'target'})
                require(member.type == tarfile.LNKTYPE)
                require(member.linkname == row['target'] and not os.path.isabs(member.linkname))
            else:
                require(set(row) == {'path', 'kind', 'mode', 'target'})
                require(row['kind'] == 'symlink' and member.issym())
                require(member.linkname == row['target'] and not os.path.isabs(member.linkname))
                # Resolve links in the archive graph, never against the host filesystem.
                seen = set()
                target = member.name
                while by_name.get(target, {}).get('kind') == 'symlink':
                    require(target not in seen)
                    seen.add(target)
                    target = os.path.normpath(str(PurePosixPath(target).parent / by_name[target]['target']))
                    safe_name(target)
                require(target in by_name)
    return receipt


def unpack(archive, receipt, destination):
    """Extract only a verified harness into a new private local directory.

    Trusted parent and no concurrent same-UID writers are prerequisites. This
    is not a privileged extractor or an application-runtime qualifier. Any
    partial destination is deliberately retained for inspection, never retried.
    """
    archive, destination = Path(archive), Path(destination)
    verify(archive, receipt)
    destination.mkdir(mode=0o700)  # Exclusive, including dangling symlinks.
    destination.chmod(0o700)
    rows = receipt['files']
    directories = sorted((row for row in rows if row['kind'] == 'directory'),
                         key=lambda row: len(PurePosixPath(row['path']).parts))
    for row in directories:
        (destination / row['path']).mkdir(mode=0o700)
    with tarfile.open(archive, 'r:') as tf:
        members = {member.name: member for member in tf.getmembers()}
        for row in rows:
            if row['kind'] != 'file':
                continue
            target = destination / row['path']
            source = tf.extractfile(members[row['path']])
            require(source is not None)
            assert source is not None
            with source, target.open('xb') as output:
                copied = 0
                while block := source.read(1024 * 1024):
                    copied += len(block)
                    require(copied <= row['bytes'])
                    output.write(block)
                require(copied == row['bytes'])
                os.fchmod(output.fileno(), row['mode'])
                output.flush()
                os.fsync(output.fileno())
            require(digest(target) == row['sha256'])
    # Hard links are installed after their file target is written.
    for row in rows:
        if row['kind'] == 'hardlink':
            target = destination / row['path']
            link_target = destination / row['target']
            os.link(link_target, target)
            os.chmod(target, row['mode'])
    # Links are installed last; verified ancestors can never be links.
    for row in rows:
        if row['kind'] == 'symlink':
            (destination / row['path']).symlink_to(row['target'])
    for row in reversed(directories):
        (destination / row['path']).chmod(row['mode'])
    require(inventory(destination) == rows)
    verify(archive, receipt)
    return destination

def cleanup_verified_attempt(attempt, archive_name, receipt_name, tree_name):
    """Remove one exact, inactive, transport-only attempt; never prune extras.

    Caller first proves the matching user unit inactive and no child owns paths.
    No hostile same-UID concurrent writers are allowed during verification/removal.
    A changed or partial attempt remains for read-only reconciliation.
    """
    attempt = Path(attempt)
    require(attempt.is_absolute() and attempt.parent == ATTEMPT_PARENT)
    require(re.fullmatch(r'attempt-[a-z0-9]{3,32}', attempt.name) is not None)
    names = (archive_name, receipt_name, tree_name, 'stage10-qualification-transport.py')
    require(len(set(names)) == 4)
    for name in names:
        safe_name(name)
        require(PurePosixPath(name).name == name)
    info = attempt.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700)
    require({p.name for p in attempt.iterdir()} == set(names))
    helper = attempt / 'stage10-qualification-transport.py'
    require(helper.is_file() and not helper.is_symlink() and digest(helper) == digest(Path(__file__)))
    receipt_file = attempt / receipt_name
    require(receipt_file.is_file() and not receipt_file.is_symlink()
            and receipt_file.stat().st_size <= 16 * 1024 * 1024)
    receipt = json.loads(receipt_file.read_bytes())
    archive = attempt / archive_name
    tree = attempt / tree_name
    require(verify(archive, receipt) == receipt)
    require(inventory(tree) == receipt['files'])
    # A final no-extra check guards against accidental caches during verification.
    require({p.name for p in attempt.iterdir()} == set(names))
    shutil.rmtree(attempt)
    require(not attempt.exists() and not attempt.is_symlink())
    return True

def cleanup_command(attempt, archive_name, receipt_name, tree_name):
    """CLI boundary checks unit readback before destructive cleanup."""
    attempt = Path(attempt)
    require(attempt.is_absolute() and attempt.parent == ATTEMPT_PARENT)
    require(re.fullmatch(r'attempt-[a-z0-9]{3,32}', attempt.name) is not None)
    unit = 'travelos-s10-' + attempt.name + '.service'
    result = subprocess.run(['/usr/bin/systemctl', '--user', 'show', unit,
                             '--property=LoadState', '--property=ActiveState'],
                            capture_output=True, timeout=10,
                            env={'PATH': '/usr/bin:/bin', 'HOME': '/home/hermes',
                                 'LANG': 'C.UTF-8'})
    require(result.returncode == 0 and
            set(result.stdout.decode('ascii').splitlines()) ==
            {'LoadState=not-found', 'ActiveState=inactive'} and not result.stderr)
    return cleanup_verified_attempt(attempt, archive_name, receipt_name, tree_name)


def load_sibling(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def preflight_command():
    pins = load_sibling('stage10-ct200-db-inspection')
    require(pins.KNOWN_HOSTS.read_bytes() == pins.KNOWN_HOST_BYTES)
    return ['/usr/bin/ssh', '-F', '/dev/null', '-i', '/home/hermes/.ssh/travelos_ct200_ed25519',
            '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={pins.KNOWN_HOSTS}',
            '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'HostKeyAlgorithms=ssh-ed25519',
            '-o', 'PermitLocalCommand=no', '-o', 'ClearAllForwardings=yes',
            '-o', 'RequestTTY=no', '-o', 'ConnectTimeout=10', '--',
            'hermes@192.168.1.33', '/usr/bin/python3 -B -I -']


def outcome(exit_code, verified_receipt, cleanup_confirmed):
    if exit_code is None or not verified_receipt or not cleanup_confirmed:
        return 'UNKNOWN_OUTCOME_PRESERVE'
    return 'PASS' if exit_code == 0 else 'FAIL'


def preflight():
    boundary = load_sibling('stage10-process-boundary')
    payload = HERE.joinpath('stage10-qualification-preflight.py').read_bytes()
    result = boundary.bounded_run(preflight_command(), data=payload, timeout=45,
                                  output_limit=65536,
                                  env={'PATH': '/usr/bin:/bin', 'HOME': '/home/hermes', 'LANG': 'C.UTF-8'})
    require(result.returncode == 0 and not result.stderr.strip())
    report = json.loads(result.stdout)
    require(report['scope'] == 'READ_ONLY_METADATA_NOT_QUALIFICATION' and report['uid'] == 1000)
    return report


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--preflight']:
            print(json.dumps(preflight(), sort_keys=True))
        elif len(sys.argv) == 6 and sys.argv[1] == '--cleanup-transport':
            cleanup_command(*sys.argv[2:])
            print(json.dumps({'result': 'TRANSPORT_ATTEMPT_REMOVED_NOT_QUALIFICATION'}))
        else:
            raise ValueError('STAGE10_TRANSPORT_REJECTED')
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError,
            subprocess.TimeoutExpired):
        print(json.dumps({'result': 'FAIL', 'code': 'STAGE10_TRANSPORT_REJECTED'}))
        sys.exit(1)
