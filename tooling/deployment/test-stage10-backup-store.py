"""Managed-backup publication tests; all keys/files are disposable fixtures."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import ModuleType
import unittest
from unittest import mock

ROOT = Path(__file__).parent
FILE = ROOT / 'stage10-backup-store.py'
module = ModuleType('missing_backup_store')
if FILE.exists():
    spec = importlib.util.spec_from_file_location('backup_store', FILE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
ID = 'stage10-' + 'd' * 32


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(FILE.exists(), 'managed encrypted-backup metadata producer missing')
        self.temporary = tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def encrypted(self):
        spec = importlib.util.spec_from_file_location('crypto_fixture', ROOT / 'test-stage10-backup-encryption.py')
        assert spec and spec.loader
        fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
        fixture.EncryptionTest.fds = []
        try:
            cert, key, password, pin = fixture.EncryptionTest.identity()
            ciphertext, _ = fixture.adapter.encrypt(b'synthetic backup contents', cert, pin)
            return ciphertext, pin
        finally:
            fixture.EncryptionTest.tearDownClass()

    def test_init_publish_expire_actual_encrypted_bytes(self):
        module.initialize_store(self.root)
        cipher, pin = self.encrypted()
        result = module.publish_backup(self.root, ID, cipher, recipient_sha256=pin, created_at=1000)
        self.assertEqual(result['state'], 'PUBLISHED')
        self.assertEqual((self.root / ID / 'backup.cms').read_bytes(), cipher)
        metadata = json.loads((self.root / ID / 'backup.json').read_bytes())
        self.assertEqual(metadata['expiresAt'], 605800)
        self.assertEqual(metadata['recipientSha256'], pin)
        self.assertEqual(module.expiry.expire_backup(self.root, ID, now=605799)['state'], 'NOT_DUE')
        self.assertEqual(module.expiry.expire_backup(self.root, ID, now=605800)['state'], 'EXPIRED')
        self.assertEqual(set(p.name for p in self.root.iterdir()), {'manager.json'})

    def test_initialization_never_adopts_older_or_unknown_backup_files(self):
        legacy = self.root / 'old.dump'; legacy.write_bytes(b'synthetic older object')
        with self.assertRaises(ValueError): module.initialize_store(self.root)
        self.assertEqual(legacy.read_bytes(), b'synthetic older object')
        self.assertFalse((self.root / 'manager.json').exists())

    def test_plaintext_invalid_clock_and_unknown_store_rejected_before_staging(self):
        module.initialize_store(self.root)
        for cipher, created in ((b'plaintext',1000), (b'plaintext',True), (b'plaintext',253402300799)):
            with self.assertRaises(ValueError):
                module.publish_backup(self.root, ID, cipher, recipient_sha256='e'*64, created_at=created)
        self.assertEqual(set(p.name for p in self.root.iterdir()), {'manager.json'})

    def test_duplicate_publication_does_not_overwrite_ciphertext_or_metadata(self):
        module.initialize_store(self.root)
        cipher, pin = self.encrypted()
        module.publish_backup(self.root, ID, cipher, recipient_sha256=pin, created_at=1000)
        before = {p.name:p.read_bytes() for p in (self.root / ID).iterdir()}
        with self.assertRaises(ValueError): module.publish_backup(self.root, ID, cipher, recipient_sha256=pin, created_at=1001)
        self.assertEqual(before,{p.name:p.read_bytes() for p in (self.root / ID).iterdir()})
        self.assertFalse(any(p.name.startswith('.publishing-') for p in self.root.iterdir()))

    def test_postrename_fsync_uncertainty_keeps_published_object_sanitized(self):
        module.initialize_store(self.root)
        cipher, pin = self.encrypted()
        original = os.fsync
        def fail_parent(fd):
            if os.readlink(f'/proc/self/fd/{fd}') == str(self.root): raise OSError('synthetic-private-detail')
            return original(fd)
        with mock.patch.object(module.os, 'fsync', side_effect=fail_parent):
            with self.assertRaises(module.StoreUncertain) as caught:
                module.publish_backup(self.root, ID, cipher, recipient_sha256=pin, created_at=1000)
        self.assertEqual(caught.exception.state,'PUBLISHED_DURABILITY_UNCERTAIN')
        self.assertEqual(caught.exception.destination,str(self.root / ID))
        self.assertIsNone(caught.exception.__context__)
        self.assertNotIn('synthetic-private-detail',str(caught.exception))
        self.assertEqual((self.root / ID / 'backup.cms').read_bytes(),cipher)

    def test_prerename_metadata_failure_preserves_partial_stage_and_rejects_retry(self):
        import traceback
        module.initialize_store(self.root)
        cipher, pin = self.encrypted()
        original = module._write
        def fail_metadata(directory, name, data):
            if name == 'backup.json': raise OSError('synthetic-private-detail')
            return original(directory, name, data)
        with mock.patch.object(module, '_write', side_effect=fail_metadata):
            with self.assertRaises(module.StoreUncertain) as caught:
                module.publish_backup(self.root, ID, cipher, recipient_sha256=pin, created_at=1000)
        error = caught.exception
        self.assertEqual(error.state, 'UNPUBLISHED_STAGING_RECONCILIATION_REQUIRED')
        self.assertIsNone(error.__context__)
        self.assertIsNone(error.__cause__)
        self.assertNotIn('synthetic-private-detail', ''.join(traceback.format_exception(error)))
        stage = Path(error.destination)
        self.assertEqual(stage.parent, self.root)
        self.assertTrue(stage.name.startswith('.publishing-'))
        self.assertEqual((stage / 'backup.cms').read_bytes(), cipher)
        self.assertFalse((stage / 'backup.json').exists())
        self.assertFalse((self.root / ID).exists())
        with self.assertRaises(ValueError):
            module.publish_backup(self.root, ID, cipher, recipient_sha256=pin, created_at=1000)
        self.assertEqual((stage / 'backup.cms').read_bytes(), cipher)

    def test_unknown_root_entry_rejects_valid_cipher_before_staging(self):
        module.initialize_store(self.root)
        cipher, pin = self.encrypted()
        unknown = self.root / 'older-backup.dump'
        unknown.write_bytes(b'synthetic legacy data')
        with self.assertRaises(ValueError):
            module.publish_backup(self.root, ID, cipher, recipient_sha256=pin, created_at=1000)
        self.assertEqual(unknown.read_bytes(), b'synthetic legacy data')
        self.assertFalse((self.root / ID).exists())
        self.assertFalse(any(p.name.startswith('.publishing-') for p in self.root.iterdir()))

    def test_initialization_durability_failure_preserves_policy_for_reconciliation(self):
        with mock.patch.object(module.os,'fsync',side_effect=OSError('synthetic-private-detail')):
            with self.assertRaises(module.StoreUncertain) as caught: module.initialize_store(self.root)
        self.assertEqual(caught.exception.state,'INITIALIZATION_RECONCILIATION_REQUIRED')
        self.assertTrue((self.root / 'manager.json').exists())
        self.assertIsNone(caught.exception.__context__)
        with self.assertRaises(ValueError): module.initialize_store(self.root)


if __name__ == '__main__': unittest.main()
