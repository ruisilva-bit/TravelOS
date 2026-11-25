"""Seven-day expiry of newly managed DEVELOPMENT backups only.

Trusted-operator library, not a privileged CLI or scheduler. The installed caller
must fix the store path, authenticate publisher metadata and establish a trusted
clock. Private ownership/markers do not prove external provenance. No historical
backup root is scanned, no secret is read, and no timer is installed here.
"""
import ctypes
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
from typing import Any, cast

_spec = importlib.util.spec_from_file_location('stage10_native_paths', Path(__file__).with_name('stage10-native-backup.py'))
assert _spec and _spec.loader
_native = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_native)
MANAGER = 'stage10-development-native-backup-v1'
WEEK = 604800
MAX_CIPHERTEXT = 8 * 1024 * 1024 + 131072
IDENTIFIER = re.compile(r'stage10-[a-f0-9]{32}\Z')


class ExpiryUncertain(ValueError):
    def __init__(self, state, destination):
        super().__init__('STAGE10_BACKUP_EXPIRY_RECONCILIATION_REQUIRED')
        self.state = state
        self.destination = destination


def _require(condition):
    if not condition:
        raise ValueError('STAGE10_BACKUP_EXPIRY_REJECTED')


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result)
        result[key] = value
    return result


def _read(directory, name, maximum):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        info = os.fstat(fd)
        _require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600
                 and 0 < info.st_size <= maximum)
        data = bytearray()
        while len(data) <= maximum:
            block = os.read(fd, min(65536, maximum + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        _require(len(data) == info.st_size and len(data) <= maximum)
        return bytes(data)
    finally:
        os.close(fd)


def _names(directory, maximum):
    result = []
    with os.scandir(directory) as entries:
        for entry in entries:
            _require(len(result) < maximum)
            result.append(entry.name)
    return result


def expire_backup(store, backup_id, *, now):
    """Expire one recognized object; every ambiguous operation stops retries.

    Caller trust excludes hostile same-UID writers. flock serializes cooperating
    managers; all root entries must be recognizable before any deletion occurs.
    A quarantined/partial object requires reconciliation, never blind replay.
    """
    _require(type(backup_id) is str and IDENTIFIER.fullmatch(backup_id)
             and type(now) is int and 0 <= now <= 253402300799)
    parent = _native._private_parent(store)
    directory = None
    try:
        fcntl.flock(parent, fcntl.LOCK_EX | fcntl.LOCK_NB)
        names = _names(parent, 512)
        _require('manager.json' in names and backup_id in names)
        _require(all(n == 'manager.json' or IDENTIFIER.fullmatch(n) for n in names))
        for entry in names:
            if entry != 'manager.json':
                info = os.stat(entry, dir_fd=parent, follow_symlinks=False)
                _require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                         and stat.S_IMODE(info.st_mode) == 0o700)
        policy = json.loads(_read(parent, 'manager.json', 16384), object_pairs_hook=_pairs)
        expected = {'schemaVersion': 1, 'manager': MANAGER, 'environment': 'DEVELOPMENT', 'retentionSeconds': WEEK}
        _require(type(policy) is dict and set(policy) == set(expected)
                 and all(type(policy[k]) is type(v) and policy[k] == v for k, v in expected.items()))
        directory = os.open(backup_id, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        info = os.fstat(directory)
        _require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700)
        _require(set(_names(directory, 2)) == {'backup.cms', 'backup.json'})
        metadata = cast(dict[str, Any], json.loads(_read(directory, 'backup.json', 16384), object_pairs_hook=_pairs))
        keys = {'schemaVersion', 'manager', 'environment', 'backupId', 'createdAt', 'expiresAt',
                'ciphertextBytes', 'ciphertextSha256', 'recipientSha256'}
        _require(type(metadata) is dict and set(metadata) == keys)
        _require(type(metadata['schemaVersion']) is int and metadata['schemaVersion'] == 1
                 and metadata['manager'] == MANAGER and metadata['environment'] == 'DEVELOPMENT'
                 and metadata['backupId'] == backup_id)
        _require(type(metadata['createdAt']) is int and 0 <= metadata['createdAt'] <= now
                 and type(metadata['expiresAt']) is int
                 and metadata['expiresAt'] == metadata['createdAt'] + WEEK
                 and metadata['expiresAt'] <= 253402300799)
        _require(type(metadata['ciphertextBytes']) is int and 0 < metadata['ciphertextBytes'] <= MAX_CIPHERTEXT)
        for key in ('ciphertextSha256', 'recipientSha256'):
            _require(type(metadata[key]) is str and re.fullmatch(r'[a-f0-9]{64}', metadata[key]))
        ciphertext = _read(directory, 'backup.cms', MAX_CIPHERTEXT)
        _require(len(ciphertext) == metadata['ciphertextBytes']
                 and hashlib.sha256(ciphertext).hexdigest() == metadata['ciphertextSha256'])
        if now < metadata['expiresAt']:
            return {'state': 'NOT_DUE', 'backupId': backup_id}
        quarantine = '.expiring-' + backup_id
        destination = str(Path(os.readlink(f'/proc/self/fd/{parent}')) / quarantine)
        rename = ctypes.CDLL(None, use_errno=True).renameat2
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        _require(rename(parent, backup_id.encode(), parent, quarantine.encode(), 1) == 0)
        uncertain = None
        phase = 'QUARANTINED_DURABILITY_UNCERTAIN'
        try:
            os.fsync(parent)
            phase = 'PARTIAL_OR_COMPLETE_DELETION_RECONCILIATION_REQUIRED'
            os.unlink('backup.cms', dir_fd=directory)
            os.unlink('backup.json', dir_fd=directory)
            os.fsync(directory)
            os.rmdir(quarantine, dir_fd=parent)
            phase = 'DELETION_DURABILITY_UNCERTAIN'
            os.fsync(parent)
        except BaseException:
            uncertain = phase
        # Outside handler: no raw message, cause, or hidden exception context.
        if uncertain:
            raise ExpiryUncertain(uncertain, destination)
        return {'state': 'EXPIRED', 'backupId': backup_id,
                'ciphertextSha256': metadata['ciphertextSha256'], 'expiredAt': now}
    finally:
        if directory is not None:
            os.close(directory)
        os.close(parent)
