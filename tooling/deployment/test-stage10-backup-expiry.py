"""Synthetic filesystem tests only; no real backups or scheduler changes."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from types import ModuleType

FILE = Path(__file__).with_name('stage10-backup-expiry.py')
module = ModuleType('missing_expiry')
if FILE.exists():
    spec = importlib.util.spec_from_file_location('backup_expiry', FILE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

ID = 'stage10-' + 'a' * 32
MANAGER = 'stage10-development-native-backup-v1'
WEEK = 7 * 86400


def prepare(root):
    (root / 'manager.json').write_text(json.dumps({'schemaVersion': 1, 'manager': MANAGER,
        'environment': 'DEVELOPMENT', 'retentionSeconds': WEEK}))
    (root / 'manager.json').chmod(0o600)
    directory = root / ID
    directory.mkdir(mode=0o700)
    ciphertext = b'synthetic opaque ciphertext fixture, not a real backup'
    (directory / 'backup.cms').write_bytes(ciphertext)
    metadata = {'schemaVersion': 1, 'manager': MANAGER, 'environment': 'DEVELOPMENT',
                'backupId': ID, 'createdAt': 1000, 'expiresAt': 1000 + WEEK,
                'ciphertextBytes': len(ciphertext), 'ciphertextSha256': hashlib.sha256(ciphertext).hexdigest(),
                'recipientSha256': 'c' * 64}
    (directory / 'backup.json').write_text(json.dumps(metadata))
    for p in directory.iterdir(): p.chmod(0o600)
    return directory, metadata


class ExpiryTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(FILE.exists(), 'approved seven-day managed-backup expiry mechanism is missing')
        self.temporary = tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.directory, self.metadata = prepare(self.root)

    def test_expired_managed_object_is_deleted_at_exact_boundary(self):
        result = module.expire_backup(self.root, ID, now=1000 + WEEK)
        self.assertEqual(result['state'], 'EXPIRED')
        self.assertEqual(result['backupId'], ID)
        self.assertEqual(set(p.name for p in self.root.iterdir()), {'manager.json'})

    def test_unexpired_ciphertext_is_preserved(self):
        before = (self.directory / 'backup.cms').read_bytes()
        result = module.expire_backup(self.root, ID, now=1000 + WEEK - 1)
        self.assertEqual(result['state'], 'NOT_DUE')
        self.assertEqual((self.directory / 'backup.cms').read_bytes(), before)

    def test_unknown_legacy_root_file_prevents_any_deletion(self):
        older = self.root / 'older-pre-stage10-backup.dump'
        older.write_bytes(b'synthetic legacy fixture')
        with self.assertRaises(ValueError): module.expire_backup(self.root, ID, now=1000 + WEEK)
        self.assertTrue(older.exists())
        self.assertTrue((self.directory / 'backup.cms').exists())

    def test_hash_mismatch_unknown_metadata_and_nonseven_day_policy_reject(self):
        for change in ('digest', 'field', 'retention'):
            metadata = dict(self.metadata)
            if change == 'digest': metadata['ciphertextSha256'] = '0' * 64
            if change == 'field': metadata['callerPath'] = '/outside'
            if change == 'retention': metadata['expiresAt'] += 1
            (self.directory / 'backup.json').write_text(json.dumps(metadata))
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.expire_backup(self.root, ID, now=1000 + WEEK + 1)
            self.assertTrue((self.directory / 'backup.cms').exists())

    def test_symlink_hardlink_and_unsafe_permissions_reject(self):
        ciphertext = self.directory / 'backup.cms'
        original = ciphertext.read_bytes()
        outside = self.root / 'outside'
        # Unknown root entries independently reject too; keep target outside root.
        with tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch') as elsewhere:
            target = Path(elsewhere) / 'protected'
            target.write_bytes(original)
            ciphertext.unlink(); ciphertext.symlink_to(target)
            with self.assertRaises((ValueError, OSError)):
                module.expire_backup(self.root, ID, now=1000 + WEEK)
            self.assertEqual(target.read_bytes(), original)
            ciphertext.unlink(); os.link(target, ciphertext)
            with self.assertRaises((ValueError, OSError)):
                module.expire_backup(self.root, ID, now=1000 + WEEK)
            self.assertTrue(target.exists())
            ciphertext.unlink(); ciphertext.write_bytes(original); ciphertext.chmod(0o660)
            with self.assertRaises(ValueError): module.expire_backup(self.root, ID, now=1000 + WEEK)

    def test_parent_fsync_failure_preserves_quarantined_ciphertext_and_explicit_state(self):
        original = os.fsync
        def fail_root(fd):
            if os.readlink(f'/proc/self/fd/{fd}') == str(self.root):
                raise OSError('synthetic-private-diagnostic')
            return original(fd)
        with mock.patch.object(module.os, 'fsync', side_effect=fail_root):
            with self.assertRaises(module.ExpiryUncertain) as caught:
                module.expire_backup(self.root, ID, now=1000 + WEEK)
        self.assertEqual(caught.exception.state, 'QUARANTINED_DURABILITY_UNCERTAIN')
        self.assertNotIn('synthetic-private-diagnostic', str(caught.exception))
        self.assertIsNone(caught.exception.__context__)
        quarantine = self.root / ('.expiring-' + ID)
        self.assertTrue((quarantine / 'backup.cms').exists())
        self.assertFalse(self.directory.exists())
        with self.assertRaises(ValueError): module.expire_backup(self.root, ID, now=1000 + WEEK)

    def test_final_fsync_failure_reports_deletion_durability_uncertain(self):
        original = os.fsync
        calls = 0
        def fail_final(fd):
            nonlocal calls
            if os.readlink(f'/proc/self/fd/{fd}') == str(self.root):
                calls += 1
                if calls == 2: raise OSError('synthetic-private-detail')
            return original(fd)
        with mock.patch.object(module.os, 'fsync', side_effect=fail_final):
            with self.assertRaises(module.ExpiryUncertain) as caught:
                module.expire_backup(self.root, ID, now=1000 + WEEK)
        self.assertEqual(caught.exception.state, 'DELETION_DURABILITY_UNCERTAIN')
        self.assertIsNone(caught.exception.__context__)
        self.assertEqual(set(p.name for p in self.root.iterdir()), {'manager.json'})

    def test_partial_unlink_failure_is_quarantined_not_retried(self):
        original = os.unlink
        def fail_metadata(name, **kwargs):
            if name == 'backup.json': raise OSError('synthetic-private-detail')
            return original(name, **kwargs)
        with mock.patch.object(module.os, 'unlink', side_effect=fail_metadata):
            with self.assertRaises(module.ExpiryUncertain) as caught:
                module.expire_backup(self.root, ID, now=1000 + WEEK)
        self.assertEqual(caught.exception.state, 'PARTIAL_OR_COMPLETE_DELETION_RECONCILIATION_REQUIRED')
        quarantine = self.root / ('.expiring-' + ID)
        self.assertTrue((quarantine / 'backup.json').exists())
        self.assertFalse((quarantine / 'backup.cms').exists())
        with self.assertRaises(ValueError): module.expire_backup(self.root, ID, now=1000 + WEEK)

    def test_other_recognized_name_symlink_and_cooperative_lock_reject(self):
        import fcntl
        other = self.root / ('stage10-' + 'b' * 32)
        other.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaises(ValueError): module.expire_backup(self.root, ID, now=1000 + WEEK)
        other.unlink()
        descriptor = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError): module.expire_backup(self.root, ID, now=1000 + WEEK)
        finally:
            os.close(descriptor)
        self.assertTrue((self.directory / 'backup.cms').exists())

    def test_inventory_budgets_prevent_deletion(self):
        (self.directory / 'unexpected').write_bytes(b'synthetic')
        with self.assertRaises(ValueError): module.expire_backup(self.root, ID, now=1000 + WEEK)
        (self.directory / 'unexpected').unlink()
        for index in range(511):
            (self.root / ('stage10-' + format(index, '032x'))).mkdir(mode=0o700)
        with self.assertRaises(ValueError): module.expire_backup(self.root, ID, now=1000 + WEEK)
        self.assertTrue((self.directory / 'backup.cms').exists())

    def test_untrusted_clock_and_invalid_id_reject(self):
        for now in (True, -1, 999, 253402300800):
            with self.subTest(now=now), self.assertRaises(ValueError): module.expire_backup(self.root, ID, now=now)
        with self.assertRaises(ValueError): module.expire_backup(self.root, '../outside', now=1000 + WEEK)
        self.assertTrue((self.directory / 'backup.cms').exists())


if __name__ == '__main__': unittest.main()
