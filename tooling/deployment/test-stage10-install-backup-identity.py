import base64
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

P = Path(__file__).with_name('stage10-install-backup-identity.py')
if P.exists():
    spec = importlib.util.spec_from_file_location('installer', P)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
else:
    mod = None

NAMES = ('stage10-backup-identity-host.py', 'stage10-backup-identity.py', 'stage10-native-backup.py', 'stage10-process-boundary.py', 'stage10-backup-recipient.pem')

def bundle():
    result = {}
    for name in NAMES:
        data = ('fixture:' + name).encode()
        result[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'data': base64.b64encode(data).decode()}
    return result

class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for path in ('usr/local/lib', 'var/lib', 'etc/travelos'):
            (self.root / path).mkdir(parents=True)
        for path in self.root.rglob('*'):
            if path.is_dir():
                path.chmod(0o755)
        self.b = bundle()

    def run_install(self):
        self.assertIsNotNone(mod, 'installer must exist')
        return mod.install(self.b, _root=self.root, _owner=os.geteuid(), _cert_hash=self.b[NAMES[-1]]['sha256'])

    def test_install_and_refuse_retry(self):
        self.assertEqual(self.run_install()['status'], 'INSTALLED')
        dest = self.root / 'usr/local/lib/travelos/stage10-identity'
        for n in NAMES[:-1]:
            self.assertEqual((dest / n).read_bytes(), base64.b64decode(self.b[n]['data']))
            self.assertEqual((dest / n).stat().st_mode & 0o777, 0o644)
        self.assertEqual((self.root / 'var/lib/travelos/stage10-backup-identity').stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.root / 'etc/travelos' / NAMES[-1]).read_bytes(), base64.b64decode(self.b[NAMES[-1]]['data']))
        self.assertEqual(self.run_install()['status'], 'REFUSED')

    def test_duplicate_json_keys_rejected_at_every_depth(self):
        for raw in (b'{"x":1,"x":2}', b'{"file":{"sha256":"a","sha256":"b"}}'):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
                    mod.parse_bundle(raw)
        self.assertEqual(mod.parse_bundle(b'{"x":{"y":1}}'), {'x': {'y': 1}})

    def test_excessive_json_nesting_is_a_structured_input_error(self):
        with self.assertRaisesRegex(ValueError, 'JSON nesting exceeds supported limit'):
            mod.parse_bundle(b'[' * 10000 + b'0' + b']' * 10000)

    def test_bad_digest_no_mutation(self):
        self.b[NAMES[0]]['sha256'] = '0' * 64
        self.assertEqual(self.run_install()['status'], 'REFUSED')
        self.assertFalse((self.root / 'usr/local/lib/travelos').exists())

    def test_symlink_ancestor_refused(self):
        (self.root / 'usr/local/lib/travelos').symlink_to(self.root / 'etc')
        self.assertEqual(self.run_install()['status'], 'REFUSED')
        self.assertFalse((self.root / 'etc/stage10-identity').exists())

    def test_existing_certificate_refused_without_overwrite(self):
        cert = self.root / 'etc/travelos' / NAMES[-1]
        cert.write_bytes(b'old')
        self.assertEqual(self.run_install()['status'], 'REFUSED')
        self.assertEqual(cert.read_bytes(), b'old')
        self.assertFalse((self.root / 'usr/local/lib/travelos').exists())

    def test_interruption_requires_reconciliation_and_refuses_retry(self):
        with mock.patch.object(mod, '_parent', side_effect=OSError('simulated interruption')):
            result = self.run_install()
        self.assertEqual(result['status'], 'RECONCILIATION_REQUIRED')
        self.assertTrue((self.root / 'etc/travelos/.stage10-identity-install-started').exists())
        self.assertEqual(self.run_install()['status'], 'REFUSED')

    def test_unknown_bundle_name_refused(self):
        self.b['extra'] = self.b[NAMES[0]]
        self.assertEqual(self.run_install()['status'], 'REFUSED')

    def test_group_writable_ancestor_refused(self):
        (self.root / 'etc/travelos').chmod(0o775)
        self.assertEqual(self.run_install()['status'], 'REFUSED')

if __name__ == '__main__':
    unittest.main()
