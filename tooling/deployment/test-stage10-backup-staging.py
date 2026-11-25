import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('staging', Path(__file__).with_name('stage10-backup-staging.py'))
staging = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(staging)
except FileNotFoundError:
    staging = None


class BackupStagingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='stage10-backup-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        if staging is not None:
            staging.ROOT = str(self.root)

    def test_synthetic_round_trip_and_no_overwrite(self):
        self.assertIsNotNone(staging, 'integrity staging adapter is missing')
        data = b'synthetic only\x00\xff' * 137
        (self.root / 'source.bin').write_bytes(data)
        self.assertEqual(staging.dispatch(['backup']), 0)
        self.assertEqual(staging.dispatch(['restore']), 0)
        self.assertEqual((self.root / 'restored.bin').read_bytes(), data)
        self.assertNotEqual(staging.dispatch(['restore']), 0)
        self.assertEqual((self.root / 'restored.bin').read_bytes(), data)

    def test_reject_tampering_and_unsafe_files(self):
        self.assertIsNotNone(staging, 'integrity staging adapter is missing')
        source = self.root / 'source.bin'
        source.write_bytes(b'fixture')
        os.link(source, self.root / 'link')
        self.assertNotEqual(staging.dispatch(['backup']), 0)
        (self.root / 'link').unlink()
        self.assertEqual(staging.dispatch(['backup']), 0)
        archive = self.root / 'backup.bin'
        payload = bytearray(archive.read_bytes()); payload[-1] ^= 1; archive.write_bytes(payload)
        self.assertNotEqual(staging.dispatch(['restore']), 0)
        self.assertFalse((self.root / 'restored.bin').exists())
        archive.unlink(); source.unlink(); source.symlink_to('/etc/passwd')
        self.assertNotEqual(staging.dispatch(['backup']), 0)

    def test_reject_symlink_parent_hardlinked_archive_and_destination(self):
        (self.root / 'source.bin').write_bytes(b'abc')
        self.assertEqual(staging.dispatch(['backup']), 0)
        archive = self.root / 'backup.bin'
        os.link(archive, self.root / 'archive-link')
        self.assertNotEqual(staging.dispatch(['restore']), 0)
        (self.root / 'archive-link').unlink()
        (self.root / 'restored.bin').symlink_to('/etc/passwd')
        self.assertNotEqual(staging.dispatch(['restore']), 0)
        self.assertTrue((self.root / 'restored.bin').is_symlink())
        with tempfile.TemporaryDirectory(prefix='stage10-link-') as other:
            alias = Path(other) / 'alias'
            alias.symlink_to(self.root, target_is_directory=True)
            staging.ROOT = str(alias)
            self.assertNotEqual(staging.dispatch(['backup']), 0)

    def test_write_failure_removes_partial_temporary_file(self):
        from unittest.mock import patch
        (self.root / 'source.bin').write_bytes(b'abc')
        with patch.object(staging.os, 'write', side_effect=OSError('disk full')):
            self.assertNotEqual(staging.dispatch(['backup']), 0)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['source.bin'])

    def test_cli_rejects_extra_paths(self):
        import json
        import subprocess
        import sys
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('stage10-backup-staging.py')), 'backup', '../escape'], capture_output=True, text=True, timeout=5, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)['result'], 'REJECTED')

    def test_reject_arguments_and_oversized_input(self):
        self.assertIsNotNone(staging, 'integrity staging adapter is missing')
        (self.root / 'source.bin').write_bytes(b'x' * (8 * 1024 * 1024 + 1))
        self.assertNotEqual(staging.dispatch(['backup']), 0)
        for args in ([], ['backup', '../other'], ['restore', '/tmp/x'], ['shell']):
            self.assertNotEqual(staging.dispatch(args), 0)
        self.assertFalse((self.root / 'backup.bin').exists())


if __name__ == '__main__':
    unittest.main()
