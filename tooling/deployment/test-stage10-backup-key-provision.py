"""Disposable backup-key provisioning tests; never invoke real provision CLI."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from types import ModuleType
import unittest
from unittest import mock
import contextlib

FILE = Path(__file__).with_name('stage10-backup-key-provision.py')
module = ModuleType('missing_provisioner')
if FILE.exists():
    spec = importlib.util.spec_from_file_location('backup_key_provision', FILE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(FILE.exists(), 'fixed-purpose backup-key provisioning path missing')
        self.temporary = tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_real_encrypted_key_readback_and_same_host_recovery(self):
        target = self.root / 'disposable'
        result = module._provision(target)
        self.assertEqual(result['state'], 'ENCRYPTED_RECOVERY_KEY_PROVISIONED_NOT_COMPLETE_CUSTODY')
        self.assertEqual(result['purpose'], 'POSTGRES_BACKUP_RECOVERY')
        self.assertEqual(result['hostLossRecovery'], 'NOT_QUALIFIED')
        self.assertEqual(module._check(target)['recipientSha256'], result['recipientSha256'])
        self.assertEqual(set(p.name for p in target.iterdir()),
                         {'recovery-key.cred','recovery-password.cred','recipient.pem','metadata.json'})
        self.assertFalse((target/'recovery-key.cred').read_bytes().startswith(b'-----BEGIN'))
        for path in target.iterdir(): self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertFalse(any(p.name.startswith('.stage10-') for p in self.root.iterdir()))

    def test_existing_destination_never_rotates_or_overwrites_key(self):
        target = self.root / 'existing'
        module._provision(target)
        before = {p.name:p.read_bytes() for p in target.iterdir()}
        with self.assertRaises(ValueError): module._provision(target)
        self.assertEqual(before,{p.name:p.read_bytes() for p in target.iterdir()})

    def test_purpose_change_and_unknown_metadata_rejected(self):
        target = self.root / 'disposable'
        module._provision(target)
        metadata_file = target/'metadata.json'
        original = json.loads(metadata_file.read_bytes())
        for change in ('purpose','unknown'):
            value = dict(original)
            if change == 'purpose': value['purpose'] = 'SIGNING'
            else: value['untrusted'] = True
            metadata_file.write_text(json.dumps(value))
            with self.subTest(change=change), self.assertRaises(ValueError): module._check(target)

    def test_partial_provisioning_does_not_publish_destination(self):
        target = self.root/'failed'
        with mock.patch.object(module,'_protect',side_effect=ValueError('synthetic failure')):
            with self.assertRaises(ValueError): module._provision(target)
        self.assertFalse(target.exists())
        self.assertFalse(any(p.name.startswith('.stage10-') for p in self.root.iterdir()))

    def test_publication_uncertainty_is_sanitized_and_preserves_destination(self):
        target = self.root/'uncertain'
        original = os.fsync
        def fail_parent(fd):
            if os.readlink(f'/proc/self/fd/{fd}') == str(self.root): raise OSError('synthetic-private-detail')
            return original(fd)
        with mock.patch.object(module.fs.os,'fsync',side_effect=fail_parent):
            with self.assertRaises(module.fs.PublicationDurabilityError) as caught: module._provision(target)
        self.assertEqual(caught.exception.publication_state,'PUBLISHED_DURABILITY_UNCERTAIN')
        self.assertEqual(caught.exception.destination,str(target))
        self.assertIsNone(caught.exception.__context__)
        self.assertNotIn('synthetic-private-detail',str(caught.exception))
        self.assertTrue((target/'recovery-key.cred').exists())

    def test_cli_no_target_override_or_other_identity(self):
        for args in ([],['provision','--directory',str(self.root)],['sign'],['decrypt']):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(module.dispatch(args),1)
            self.assertEqual(json.loads(output.getvalue()),{'state':'REJECTED'})
        with mock.patch.object(module.os,'getuid',return_value=0), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(module.dispatch(['provision']),1)
        self.assertFalse(list(self.root.iterdir()))


if __name__ == '__main__': unittest.main()
