import fcntl
import hashlib
import importlib.util
import os
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

PATH = Path(__file__).with_name('stage10-backup-encryption.py')
spec = importlib.util.spec_from_file_location('backup_encryption', PATH)
assert spec is not None and spec.loader is not None
if PATH.exists():
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)

def sealed(value):
    fd = os.memfd_create('stage10-test', os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
    os.write(fd, value)
    fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_WRITE | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SEAL)
    return fd

class EncryptionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fds = []
        cls.identities = [cls.identity(), cls.identity()]

    @classmethod
    def keep(cls, value):
        fd = sealed(value)
        cls.fds.append(fd)
        return fd

    @classmethod
    def identity(cls):
        password = cls.keep(os.urandom(32).hex().encode())
        def call(args, fds):
            result = adapter._process.bounded_run([adapter.OPENSSL, *args], env=adapter.ENV, pass_fds=fds, timeout=60, output_limit=65536)
            if result.returncode:
                raise RuntimeError('synthetic identity generation failed')
            return result.stdout
        os.lseek(password, 0, os.SEEK_SET)
        key = cls.keep(call(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-aes-256-cbc', '-pass', f'fd:{password}'], (password,)))
        os.lseek(password, 0, os.SEEK_SET)
        cert = cls.keep(call(['req', '-new', '-x509', '-key', f'/proc/self/fd/{key}', '-passin', f'fd:{password}', '-subj', '/CN=Stage10 Synthetic', '-days', '1'], (key, password)))
        pin = hashlib.sha256(os.pread(cert, os.fstat(cert).st_size, 0)).hexdigest()
        return cert, key, password, pin

    @classmethod
    def tearDownClass(cls):
        for fd in cls.fds:
            os.close(fd)

    def test_openssl_rejects_setid_executable(self):
        for bits in (stat.S_ISUID, stat.S_ISGID, stat.S_ISUID | stat.S_ISGID):
            with self.subTest(bits=bits):
                metadata = SimpleNamespace(st_mode=stat.S_IFREG | 0o755 | bits, st_uid=0)
                with patch.object(adapter.os, 'stat', return_value=metadata):
                    with self.assertRaises(adapter.AdapterError):
                        adapter._openssl()

    def test_openssl_accepts_non_setid_executable(self):
        metadata = SimpleNamespace(st_mode=stat.S_IFREG | 0o755, st_uid=0)
        with patch.object(adapter.os, 'stat', return_value=metadata):
            adapter._openssl()

    def test_roundtrip_and_pin(self):
        cert, key, password, pin = self.identities[0]
        plaintext = os.urandom(65537)
        encrypted, got = adapter.encrypt(plaintext, cert, pin)
        self.assertEqual(pin, got)
        self.assertNotIn(plaintext, encrypted)
        self.assertEqual(plaintext, adapter.decrypt(encrypted, cert, key, password, pin))
        self.assertTrue(os.pread(key, 40, 0).startswith(b'-----BEGIN ENCRYPTED PRIVATE KEY-----'))

    def test_failure_no_publication(self):
        cert, key, password, pin = self.identities[0]
        othercert, otherkey, otherpass, otherpin = self.identities[1]
        encrypted, _ = adapter.encrypt(os.urandom(50000), cert, pin)
        wrongpass = self.keep(b'incorrect-password')
        bad = [ (encrypted[:-1] + bytes([encrypted[-1] ^ 1]), cert, key, password, pin),
                (encrypted[:-12], cert, key, password, pin),
                (b'not DER', cert, key, password, pin),
                (encrypted, othercert, otherkey, otherpass, otherpin),
                (encrypted, cert, key, wrongpass, pin) ]
        for args in bad:
            target = b'untouched'
            with self.assertRaises(adapter.AdapterError) as caught:
                target = adapter.decrypt(*args)
            self.assertEqual(target, b'untouched')
            self.assertEqual(str(caught.exception), 'STAGE10_ENCRYPTION_REJECTED')

    def test_cbc_rejected_and_secret_free_arguments(self):
        cert, key, password, pin = self.identities[0]
        cbc = adapter._process.bounded_run([adapter.OPENSSL, 'cms', '-encrypt', '-binary', '-aes-256-cbc', '-outform', 'DER', f'/proc/self/fd/{cert}'], data=b'synthetic', env=adapter.ENV, pass_fds=(cert,))
        self.assertEqual(cbc.returncode, 0)
        with self.assertRaises(adapter.AdapterError):
            adapter.decrypt(cbc.stdout, cert, key, password, pin)
        commands = []
        original = adapter._process.bounded_run
        def checked(command, **kwargs):
            commands.append(command)
            return original(command, **kwargs)
        adapter._process.bounded_run = checked
        try:
            encrypted, _ = adapter.encrypt(b'test', cert, pin)
            self.assertEqual(adapter.decrypt(encrypted, cert, key, password, pin), b'test')
        finally:
            adapter._process.bounded_run = original
        secret = os.pread(password, 1024, 0).decode()
        self.assertTrue(commands)
        for command in commands:
            self.assertNotIn(secret, ' '.join(command))
            self.assertNotIn('PRIVATE KEY', ' '.join(command))

    def test_invalid_bounds_and_fds(self):
        cert, key, password, pin = self.identities[0]
        for data, fd, digest in [(b'x' * (adapter.MAX_INPUT + 1), cert, pin), (b'x', cert, '0'*64), (b'x', -1, pin)]:
            with self.assertRaises(adapter.AdapterError):
                adapter.encrypt(data, fd, digest)
        fd = os.memfd_create('unsealed')
        try:
            os.write(fd, b'x')
            with self.assertRaises(adapter.AdapterError):
                adapter.encrypt(b'x', fd, pin)
        finally:
            os.close(fd)

if __name__ == '__main__':
    unittest.main()
