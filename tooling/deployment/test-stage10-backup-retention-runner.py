import importlib.util
from pathlib import Path
import tempfile
import unittest
import json


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runner = load('stage10-backup-retention-runner')
fixture = load('test-stage10-backup-expiry')


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.directory, self.metadata = fixture.prepare(self.root)

    def test_preserve_before_boundary_and_expire_on_boundary(self):
        self.assertEqual(runner._sweep(self.root, 1000)['expired'], 0)
        self.assertTrue((self.directory / 'backup.cms').exists())
        self.assertEqual(runner._sweep(self.root, 1000 + fixture.WEEK)['expired'], 1)
        self.assertFalse(self.directory.exists())

    def test_unknown_legacy_entry_preserves_backup(self):
        (self.root / 'legacy.dump').write_bytes(b'fixture')
        with self.assertRaises(ValueError): runner._sweep(self.root, 1000 + fixture.WEEK)
        self.assertTrue((self.directory / 'backup.cms').exists())

    def test_invalid_second_object_blocks_entire_batch(self):
        second = self.root / ('stage10-' + 'b' * 32)
        second.mkdir(mode=0o700)
        (second / 'backup.json').write_text('{}')
        (second / 'backup.json').chmod(0o600)
        with self.assertRaises(KeyError): runner._sweep(self.root, 1000 + fixture.WEEK)
        self.assertTrue((self.directory / 'backup.cms').exists())

    def test_future_created_at_rejects_clock_regression(self):
        with self.assertRaises(ValueError): runner._sweep(self.root, 999)
        self.assertTrue((self.directory / 'backup.cms').exists())

    def test_corrupt_ciphertext_prevents_expiry(self):
        (self.directory / 'backup.cms').write_bytes(b'bad')
        with self.assertRaises(ValueError): runner._sweep(self.root, 1000 + fixture.WEEK)
        self.assertTrue(self.directory.exists())

    def test_empty_store_policy_still_validated(self):
        runner._sweep(self.root, 1000 + fixture.WEEK)
        self.assertEqual(runner._sweep(self.root, 1000 + fixture.WEEK)['checked'], 0)
        policy = self.root / 'manager.json'
        data = json.loads(policy.read_text());data['retentionSeconds'] = 1;policy.write_text(json.dumps(data))
        with self.assertRaises(ValueError):runner._sweep(self.root, 1000 + fixture.WEEK)


if __name__ == '__main__': unittest.main()
