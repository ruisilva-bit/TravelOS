import importlib.util
import io
import os
from pathlib import Path
import unittest

P = Path(__file__).with_name('stage10-ct200-backup-operator.py')


class OperatorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('operator', P)
        cls.op = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.op)

    def test_compression_roundtrip_and_bound(self):
        import gzip
        data = b'synthetic backup' * 1000
        self.assertEqual(gzip.decompress(self.op.compress_bounded(data, 1024)), data)
        with self.assertRaises(ValueError):
            self.op.compress_bounded(os.urandom(4096), 100)

    def test_pipeline_verifies_before_encrypting_and_returns_only_ciphertext(self):
        calls = []
        class Native:
            MAX_BACKUP = 1024
            def native_backup_tar(self, *args, **kwargs):
                calls.append('backup'); return {'archive': b'synthetic', 'sha256': __import__('hashlib').sha256(b'synthetic').hexdigest(), 'bytes': 9}
            def verify_native_tar(self, data, *args, **kwargs):
                calls.append('verify'); return {'nativeManifestVerified': True, 'walParsed': True, 'archiveSha256': __import__('hashlib').sha256(data).hexdigest()}
        class Crypto:
            MAX_INPUT = 1024
            def encrypt(self, data, cert, pin):
                calls.append('encrypt'); self.data = data; return b'encrypted', pin
        crypto = Crypto()
        tools = {name: {} for name in ('psql', 'pg_basebackup', 'pg_verifybackup', 'pg_waldump')}
        result = self.op.create_encrypted(Native(), crypto, 3, 'pin', {}, tools, '/fixture')
        self.assertEqual(result, b'encrypted')
        self.assertEqual(calls, ['backup', 'verify', 'encrypt'])
        self.assertEqual(__import__('gzip').decompress(crypto.data), b'synthetic')

    def test_failed_verification_never_encrypts(self):
        class Native:
            MAX_BACKUP = 1024
            def native_backup_tar(self, *a, **kw): return {'archive': b'synthetic', 'sha256': 'bad', 'bytes': 9}
            def verify_native_tar(self, *a, **kw): raise AssertionError('must reject before verify')
        tools = {name: {} for name in ('psql', 'pg_basebackup', 'pg_verifybackup', 'pg_waldump')}
        with self.assertRaises(ValueError):
            self.op.create_encrypted(Native(), object(), 3, 'pin', {}, tools, '/fixture')

    def test_verifier_rejection_prevents_encrypt(self):
        class Native:
            MAX_BACKUP = 1024
            def native_backup_tar(self, *a, **kw):
                data = b'synthetic'
                return {'archive': data, 'sha256': __import__('hashlib').sha256(data).hexdigest(), 'bytes': len(data)}
            def verify_native_tar(self, *a, **kw):
                return {'nativeManifestVerified': False, 'walParsed': True, 'archiveSha256': 'wrong'}
        tools = {name: {} for name in ('psql', 'pg_basebackup', 'pg_verifybackup', 'pg_waldump')}
        with self.assertRaises(ValueError):
            self.op.create_encrypted(Native(), object(), 3, 'pin', {}, tools, '/fixture')

    def test_no_new_privs_is_inherited_by_executed_subprocess(self):
        import subprocess, sys
        code = """import importlib.util, subprocess
s = importlib.util.spec_from_file_location('operator', %r)
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
from unittest.mock import patch
from types import SimpleNamespace
with patch.object(m.os, 'setgroups'), patch.object(m.os, 'setgid'), patch.object(m.os, 'setuid'), patch.object(m.os, 'geteuid', return_value=123), patch.object(m.os, 'getegid', return_value=456), patch.object(m.os, 'getgroups', return_value=[]):
    m.drop_identity(SimpleNamespace(pw_uid=123, pw_gid=456))
p = subprocess.run(['/usr/bin/python3', '-c', "print(next(x for x in open('/proc/self/status') if x.startswith('NoNewPrivs:')).strip())"], capture_output=True, text=True, check=True)
print(p.stdout.strip())
""" % str(P)
        result = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), 'NoNewPrivs:\t1')

    def test_drop_fails_closed_if_no_new_privs_fails(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        account = SimpleNamespace(pw_uid=123, pw_gid=456)
        with patch.object(self.op.os, 'setgroups'), patch.object(self.op.os, 'setgid'), patch.object(self.op.os, 'setuid'), \
             patch.object(self.op.os, 'geteuid', return_value=123), patch.object(self.op.os, 'getegid', return_value=456), \
             patch.object(self.op.os, 'getgroups', return_value=[]), \
             patch.object(self.op, 'enable_no_new_privs', side_effect=OSError('prctl failed')):
            with self.assertRaises(OSError):
                self.op.drop_identity(account)

    def test_cli_rejects_arguments(self):
        import subprocess, sys
        p = subprocess.run([sys.executable, str(P), '--tool', '/bin/sh'], capture_output=True)
        self.assertNotEqual(p.returncode, 0)
        self.assertEqual(p.stdout, b'')

if __name__ == '__main__': unittest.main()
