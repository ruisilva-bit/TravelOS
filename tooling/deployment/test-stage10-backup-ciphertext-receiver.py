"""Disposable receiver tests against the actual private backup store."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).parent

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

receiver = load('receiver', 'stage10-backup-ciphertext-receiver.py')
fixture = load('store_tests', 'test-stage10-backup-store.py')

class ReceiverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cipher, _ = fixture.StoreTests().encrypted()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.patch = mock.patch.object(receiver, 'DESTINATION', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def publish(self, cipher=None, **kw):
        args = dict(approved_source=receiver.SOURCE, approved_recipient=receiver.RECIPIENT, producer_exit_code=0)
        args.update(kw)
        return receiver.publish_received(self.cipher if cipher is None else cipher, **args)

    def test_real_store_publication_and_duplicate_preserves_existing(self):
        receiver.store.initialize_store(self.root)
        with mock.patch.object(receiver.secrets, 'token_hex', return_value='a'*32):
            result = self.publish()
            target = self.root / result['backupId']
            before = {p.name:p.read_bytes() for p in target.iterdir()}
            with self.assertRaises(ValueError): self.publish()
        self.assertEqual(before, {p.name:p.read_bytes() for p in target.iterdir()})
        self.assertEqual(before['backup.cms'], self.cipher)
        self.assertEqual(json.loads(before['backup.json'])['recipientSha256'], receiver.RECIPIENT)
        self.assertEqual(result['state'], 'PUBLISHED')

    def test_existing_unmanaged_data_is_never_initialized_or_deleted(self):
        old = self.root / 'old.dump'; old.write_bytes(b'old')
        with self.assertRaises(ValueError): self.publish()
        self.assertEqual(old.read_bytes(), b'old')
        self.assertEqual([p.name for p in self.root.iterdir()], ['old.dump'])

    def test_rejects_invalid_pins_exit_and_ciphertext(self):
        receiver.store.initialize_store(self.root)
        for kwargs in ({'approved_source':'wrong'}, {'approved_recipient':'0'*64}, {'producer_exit_code':1}, {'producer_exit_code':False}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError): self.publish(**kwargs)
        for cipher in (b'', b'plaintext', self.cipher+b'garbage', b'x'*(receiver.MAX_CIPHERTEXT+1)):
            with self.subTest(size=len(cipher)), self.assertRaises(ValueError): self.publish(cipher)
        self.assertEqual({p.name for p in self.root.iterdir()}, {'manager.json'})

    def test_pipe_read_success_oversize_and_deadline(self):
        r, w = os.pipe()
        os.write(w, b'ciphertext'); os.close(w)
        try: self.assertEqual(receiver.read_ciphertext(r, timeout=1), b'ciphertext')
        finally: os.close(r)
        r, w = os.pipe()
        try:
            with self.assertRaisesRegex(ValueError, 'TIMEOUT'): receiver.read_ciphertext(r, timeout=0.01)
        finally: os.close(r); os.close(w)
        r, w = os.pipe()
        try:
            os.write(w, b'12345'); os.close(w); w = -1
            with mock.patch.object(receiver, 'MAX_CIPHERTEXT', 4):
                with self.assertRaises(ValueError): receiver.read_ciphertext(r, timeout=1)
        finally:
            os.close(r)
            if w != -1: os.close(w)

    def test_pre_and_post_rename_uncertainty_propagates_without_retry(self):
        for phase in ('pre', 'post'):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch') as tmp:
                root = Path(tmp)
                receiver.store.initialize_store(root)
                original_write = receiver.store._write
                original_fsync = os.fsync
                def write(fd, name, data):
                    if phase == 'pre' and name == 'backup.json': raise OSError('private')
                    return original_write(fd, name, data)
                def fsync(fd):
                    if phase == 'post' and os.readlink(f'/proc/self/fd/{fd}') == str(root): raise OSError('private')
                    return original_fsync(fd)
                with mock.patch.object(receiver, 'DESTINATION', root), mock.patch.object(receiver.store, '_write', side_effect=write), mock.patch.object(receiver.store.os, 'fsync', side_effect=fsync):
                    with self.assertRaises(receiver.store.StoreUncertain) as caught: self.publish()
                expected = 'UNPUBLISHED_STAGING_RECONCILIATION_REQUIRED' if phase == 'pre' else 'PUBLISHED_DURABILITY_UNCERTAIN'
                self.assertEqual(caught.exception.state, expected)
                self.assertTrue(Path(caught.exception.destination).exists())
                self.assertNotIn('private', str(caught.exception))

    def test_rejects_regular_file_as_transport_stream(self):
        path = self.root / 'synthetic-file'
        path.write_bytes(b'ciphertext')
        with path.open('rb') as source:
            with self.assertRaises(ValueError): receiver.read_ciphertext(source.fileno(), timeout=1)

    def test_rejects_nonfinite_timeout(self):
        r, w = os.pipe()
        try:
            for value in (float('nan'), float('inf'), True, 0, 121):
                with self.subTest(value=value), self.assertRaises(ValueError): receiver.read_ciphertext(r, timeout=value)
        finally: os.close(r); os.close(w)

if __name__ == '__main__': unittest.main()
