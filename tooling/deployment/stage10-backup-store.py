"""Private managed encrypted-backup store; trusted-caller mechanism only.

No privileged CLI, scheduler or canonical-evidence authority. The installed
caller must supply an authenticated recipient pin, verified encryption output,
a fixed dedicated store and a trusted clock. CMS framing is a defensive format
check, NOT proof of encryption, provenance or privacy approval.
"""
import ctypes
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import stat


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


expiry = _load('store_expiry', 'stage10-backup-expiry.py')
crypto = _load('store_crypto', 'stage10-backup-encryption.py')
POLICY = {'schemaVersion': 1, 'manager': expiry.MANAGER, 'environment': 'DEVELOPMENT',
          'retentionSeconds': expiry.WEEK}


class StoreUncertain(ValueError):
    def __init__(self, state, destination):
        super().__init__('STAGE10_BACKUP_STORE_RECONCILIATION_REQUIRED')
        self.state = state
        self.destination = destination


def _require(value):
    if not value:
        raise ValueError('STAGE10_BACKUP_STORE_REJECTED')


def _json(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def _write(directory, name, data):
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    with os.fdopen(fd, 'wb') as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def initialize_store(store):
    parent = expiry._native._private_parent(store)
    try:
        fcntl.flock(parent, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _require(expiry._names(parent, 1) == [])
        destination = str(Path(os.readlink(f'/proc/self/fd/{parent}')) / 'manager.json')
        failed = False
        try:
            _write(parent, 'manager.json', _json(POLICY))
            os.fsync(parent)
        except BaseException:
            failed = True
        if failed:
            raise StoreUncertain('INITIALIZATION_RECONCILIATION_REQUIRED', destination)
        return {'state': 'INITIALIZED', 'retentionSeconds': expiry.WEEK}
    finally:
        os.close(parent)


def publish_backup(store, backup_id, ciphertext, *, recipient_sha256, created_at):
    _require(type(backup_id) is str and expiry.IDENTIFIER.fullmatch(backup_id)
             and type(ciphertext) is bytes and 0 < len(ciphertext) <= expiry.MAX_CIPHERTEXT
             and type(recipient_sha256) is str and re.fullmatch('[a-f0-9]{64}', recipient_sha256)
             and type(created_at) is int and 0 <= created_at <= 253402300799 - expiry.WEEK)
    crypto._authenticated_aes256_envelope(ciphertext)
    metadata = {'schemaVersion': 1, 'manager': expiry.MANAGER, 'environment': 'DEVELOPMENT',
                'backupId': backup_id, 'createdAt': created_at, 'expiresAt': created_at + expiry.WEEK,
                'ciphertextBytes': len(ciphertext), 'ciphertextSha256': hashlib.sha256(ciphertext).hexdigest(),
                'recipientSha256': recipient_sha256}
    parent = expiry._native._private_parent(store)
    stage = None
    try:
        fcntl.flock(parent, fcntl.LOCK_EX | fcntl.LOCK_NB)
        names = expiry._names(parent, 512)
        _require('manager.json' in names and backup_id not in names and len(names) < 512)
        _require(all(name == 'manager.json' or expiry.IDENTIFIER.fullmatch(name) for name in names))
        for entry in names:
            if entry != 'manager.json':
                info = os.stat(entry, dir_fd=parent, follow_symlinks=False)
                _require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                         and stat.S_IMODE(info.st_mode) == 0o700)
        policy = json.loads(expiry._read(parent, 'manager.json', 16384), object_pairs_hook=expiry._pairs)
        _require(type(policy) is dict and set(policy) == set(POLICY)
                 and all(type(policy[k]) is type(v) and policy[k] == v for k, v in POLICY.items()))
        base = Path(os.readlink(f'/proc/self/fd/{parent}'))
        name = '.publishing-' + secrets.token_hex(16)
        phase = 'UNPUBLISHED_STAGING_RECONCILIATION_REQUIRED'
        destination = str(base / name)
        failed = False
        try:
            os.mkdir(name, 0o700, dir_fd=parent)
            stage = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.fchmod(stage, 0o700)
            _write(stage, 'backup.cms', ciphertext)
            _write(stage, 'backup.json', _json(metadata))
            os.fsync(stage)
            rename = ctypes.CDLL(None, use_errno=True).renameat2
            rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            rename.restype = ctypes.c_int
            _require(rename(parent, name.encode(), parent, backup_id.encode(), 1) == 0)
            phase = 'PUBLISHED_DURABILITY_UNCERTAIN'
            destination = str(base / backup_id)
            os.fsync(parent)
        except BaseException:
            failed = True
        if failed:
            raise StoreUncertain(phase, destination)
        return {'state': 'PUBLISHED', **metadata}
    finally:
        if stage is not None:
            os.close(stage)
        os.close(parent)
