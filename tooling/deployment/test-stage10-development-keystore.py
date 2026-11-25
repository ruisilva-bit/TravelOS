import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

MODULE = Path(__file__).with_name('stage10-development-keystore.py')
COSIGN = Path('/home/hermes/.local/share/travelos-stage10-tools/cosign-v3.1.3')


def load():
    spec = importlib.util.spec_from_file_location('stage10_development_keystore', MODULE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class KeystoreTest(unittest.TestCase):
    def test_implementation_exists(self):
        self.assertTrue(MODULE.exists(), 'Missing protected development keystore implementation')

    def test_real_encrypted_store_recovery_memfd_sign_and_tamper_rejection(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-test-') as temporary:
            root = Path(temporary)
            store = root / 'store'
            result = module.create_store(store, COSIGN)
            self.assertEqual(result['status'], 'ENCRYPTED_LOCAL_KEYSTORE_CREATED_NOT_DEPLOYMENT_TRUST')
            self.assertEqual(sorted(p.name for p in store.iterdir()), ['key.cred', 'metadata.json', 'password.cred', 'verification.pub'])
            recovered = root / 'recovered'
            proof = module.recovery_probe(store, recovered, COSIGN)
            self.assertEqual(proof['validSignature'], 'PASS')
            self.assertEqual(proof['tamperedArtifact'], 'REJECTED')
            self.assertEqual(proof['recoveryScope'], 'SAME_HOST_ENCRYPTED_BLOB_RESTORE_NOT_HOST_LOSS_RECOVERY')
            self.assertEqual(result['publicKeySha256'], proof['publicKeySha256'])
            with self.assertRaises(ValueError):
                module.create_store(store, COSIGN)

    def test_poisoned_binary_after_pinning_executes_sealed_snapshot(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-pin-') as temporary:
            root = Path(temporary)
            binary = root / 'cosign'
            shutil.copyfile(COSIGN, binary)
            binary.chmod(0o700)
            marker = root / 'poison-executed'
            original_pin = module.pin_cosign

            def pin_then_poison(path):
                fd = original_pin(path)
                with self.assertRaises(OSError):
                    os.pwrite(fd, b'poison', 0)
                binary.write_text(f'#!/bin/sh\ntouch {marker}\nexit 1\n')
                return fd

            with mock.patch.object(module, 'pin_cosign', side_effect=pin_then_poison):
                result = module.create_store(root / 'store', binary)
            self.assertEqual(result['status'], 'ENCRYPTED_LOCAL_KEYSTORE_CREATED_NOT_DEPLOYMENT_TRUST')
            self.assertFalse(marker.exists())
            self.assertEqual(sorted(p.name for p in (root / 'store').iterdir()),
                             ['key.cred', 'metadata.json', 'password.cred', 'verification.pub'])

    def test_partial_create_and_recovery_failures_remove_staging(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-failure-') as temporary:
            root = Path(temporary)
            source = root / 'source'
            original_write = module._write_at

            def fail_after_write(fd, name, data):
                original_write(fd, name, data)
                if name == 'password.cred':
                    raise OSError('injected stage failure')

            with mock.patch.object(module, '_write_at', side_effect=fail_after_write):
                with self.assertRaisesRegex(OSError, 'injected stage failure'):
                    module.create_store(source, COSIGN)
            self.assertEqual(list(root.iterdir()), [])

            module.create_store(source, COSIGN)
            before = {p.name: p.read_bytes() for p in source.iterdir()}
            destination = root / 'restored'
            with mock.patch.object(module, '_write_at', side_effect=fail_after_write):
                with self.assertRaisesRegex(OSError, 'injected stage failure'):
                    module.recovery_probe(source, destination, COSIGN)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['source'])
            self.assertEqual({p.name: p.read_bytes() for p in source.iterdir()}, before)

    def test_publish_never_overwrites_existing_create_or_recovery_destination(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-no-overwrite-') as temporary:
            root = Path(temporary)
            source = root / 'source'
            module.create_store(source, COSIGN)
            destination = root / 'occupied'
            destination.mkdir(mode=0o700)
            sentinel = destination / 'sentinel'
            sentinel.write_bytes(b'unchanged')
            for operation in ('create', 'recovery'):
                with self.subTest(operation=operation):
                    with self.assertRaises(ValueError):
                        if operation == 'create':
                            module.create_store(destination, COSIGN)
                        else:
                            module.recovery_probe(source, destination, COSIGN)
                    self.assertEqual(sentinel.read_bytes(), b'unchanged')
                    self.assertEqual(sorted(p.name for p in destination.iterdir()), ['sentinel'])
                    self.assertEqual(sorted(p.name for p in root.iterdir()), ['occupied', 'source'])

    def test_wrong_binary_and_unsafe_or_incomplete_store_rejected(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-negative-') as temporary:
            root = Path(temporary)
            bad = root / 'bad-cosign'
            bad.write_text('not the pinned binary')
            with self.assertRaises(ValueError):
                module.create_store(root / 'store', bad)
            incomplete = root / 'incomplete'
            incomplete.mkdir(mode=0o700)
            with self.assertRaises((ValueError, FileNotFoundError)):
                module.recovery_probe(incomplete, root / 'recovered', COSIGN)

    def test_group_writable_ancestor_is_rejected(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-ancestor-') as temporary:
            ancestor = Path(temporary) / 'shared'
            ancestor.mkdir(mode=0o770)
            ancestor.chmod(0o770)
            store = ancestor / 'store'
            store.mkdir(mode=0o700)
            with self.assertRaises(ValueError):
                module.private_directory(store)

    def test_creation_rejects_unsafe_parent_before_creating_store(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-parent-') as temporary:
            parent = Path(temporary) / 'shared'
            parent.mkdir(mode=0o777)
            parent.chmod(0o777)
            store = parent / 'store'
            with self.assertRaises(ValueError):
                module.create_store(store, COSIGN)
            self.assertFalse(store.exists(), 'unsafe parent must be rejected before creating a store')

    def test_recovery_rejects_unsafe_parent_before_creating_destination(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-recovery-parent-') as temporary:
            root = Path(temporary)
            source = root / 'source'
            module.create_store(source, COSIGN)
            parent = root / 'shared'
            parent.mkdir(mode=0o777)
            parent.chmod(0o777)
            destination = parent / 'restored'
            with self.assertRaises(ValueError):
                module.recovery_probe(source, destination, COSIGN)
            self.assertFalse(destination.exists(), 'unsafe parent must be rejected before copying credentials')

    def test_store_file_symlinks_and_hardlinks_are_rejected(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-links-') as temporary:
            root = Path(temporary)
            store = root / 'store'
            store.mkdir(mode=0o700)
            target = root / 'target'
            target.write_bytes(b'synthetic fixture')
            target.chmod(0o600)
            linked = store / 'key.cred'
            for kind in ('symlink', 'hardlink'):
                with self.subTest(kind=kind):
                    if kind == 'symlink':
                        linked.symlink_to(target)
                    else:
                        os.link(target, linked)
                    try:
                        with self.assertRaises((ValueError, OSError)):
                            module.file_bytes(linked)
                    finally:
                        linked.unlink()

    def test_parent_fsync_failure_reports_published_durability_uncertain(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-durability-') as temporary:
            target = Path(temporary) / 'published'
            parent, stage, name, leaf = module._begin(target)
            try:
                module._write_at(stage, 'sentinel', b'synthetic')
                original = module.os.fsync

                def fail_parent(fd):
                    if fd == parent:
                        raise OSError('injected parent fsync failure')
                    return original(fd)

                with mock.patch.object(module.os, 'fsync', side_effect=fail_parent):
                    try:
                        module._publish(parent, stage, name, leaf)
                    except Exception as error:
                        self.assertEqual(getattr(error, 'publication_state', None), 'PUBLISHED_DURABILITY_UNCERTAIN')
                        self.assertEqual(getattr(error, 'destination', None), str(target))
                    else:
                        self.fail('parent fsync failure must not be reported as durable success')
                self.assertEqual((target / 'sentinel').read_bytes(), b'synthetic')
            finally:
                module._cleanup(parent, stage, name)
            self.assertTrue(target.is_dir(), 'uncertain publication must remain available for reconciliation')

    def test_public_functions_preserve_uncertain_destination_sanitize_and_reject_retry(self):
        import hashlib
        import traceback
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-public-fsync-') as temporary:
            root = Path(temporary)
            source = root / 'source'
            module.create_store(source, COSIGN)
            original = module.os.fsync
            def fail_parent(fd):
                if os.readlink(f'/proc/self/fd/{fd}') == str(root):
                    raise OSError('synthetic-private-error-detail')
                return original(fd)
            for action in ('create', 'recovery'):
                target = root / action
                def invoke():
                    if action == 'create':
                        return module.create_store(target, COSIGN)
                    return module.recovery_probe(source, target, COSIGN)
                with self.subTest(action=action):
                    with mock.patch.object(module.os, 'fsync', side_effect=fail_parent):
                        with self.assertRaises(module.PublicationDurabilityError) as caught:
                            invoke()
                    error = caught.exception
                    self.assertEqual(error.publication_state, 'PUBLISHED_DURABILITY_UNCERTAIN')
                    self.assertEqual(error.destination, str(target))
                    self.assertEqual(str(error), 'STAGE10_KEYSTORE_PUBLISHED_DURABILITY_UNCERTAIN')
                    self.assertIsNone(error.__cause__)
                    self.assertIsNone(error.__context__)
                    self.assertNotIn('synthetic-private-error-detail', ''.join(traceback.format_exception(error)))
                    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in target.iterdir()}
                    self.assertEqual(set(before), {'key.cred', 'password.cred', 'verification.pub', 'metadata.json'})
                    with self.assertRaises(ValueError):
                        invoke()
                    after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in target.iterdir()}
                    self.assertEqual(before, after)
                    self.assertFalse(any(p.name.startswith('.stage10-') for p in root.iterdir()))

    def test_recovery_rejects_metadata_claiming_production(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='stage10-keystore-metadata-') as temporary:
            root = Path(temporary)
            source = root / 'source'
            module.create_store(source, COSIGN)
            metadata_file = source / 'metadata.json'
            metadata = json.loads(metadata_file.read_text())
            metadata['environment'] = 'PRODUCTION'
            metadata_file.write_text(json.dumps(metadata))
            with self.assertRaises(ValueError):
                module.recovery_probe(source, root / 'restored', COSIGN)


if __name__ == '__main__':
    unittest.main()
