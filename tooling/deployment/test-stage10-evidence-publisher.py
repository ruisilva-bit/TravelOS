import importlib.util
import pathlib
import tempfile
import unittest
import os
import concurrent.futures
import shutil
from unittest import mock

path = pathlib.Path(__file__).with_name('stage10-evidence-publisher.py')
if path.exists():
    spec = importlib.util.spec_from_file_location('publisher', path)
    publisher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publisher)
else:
    publisher = None

class PublisherTests(unittest.TestCase):
    def test_permissive_root_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            os.chmod(root, 0o777)
            with self.assertRaises(ValueError):
                publisher.publish_fixture(pathlib.Path(root), publisher.PAYLOAD)
            self.assertEqual(list(pathlib.Path(root).iterdir()), [])

    def test_destination_replacement_does_not_publish_in_replacement(self):
        with tempfile.TemporaryDirectory() as parent:
            root = pathlib.Path(parent) / 'root'
            root.mkdir(mode=0o700)
            moved = pathlib.Path(parent) / 'moved'
            original = publisher._rename_noreplace
            def replace_root(*args):
                root.rename(moved)
                shutil.copytree(moved, root)
                return original(*args)
            with mock.patch.object(publisher, '_rename_noreplace', side_effect=replace_root):
                with self.assertRaises((ValueError, OSError, publisher.Undetermined)):
                    publisher.publish_fixture(root, publisher.PAYLOAD)
            self.assertFalse((root / 'fixture-replay-1').exists())

    def test_synthetic_publication_and_replay(self):
        self.assertIsNotNone(publisher, 'synthetic publisher is not implemented')
        with tempfile.TemporaryDirectory() as root:
            obj, pin = publisher.publish_fixture(pathlib.Path(root), b'SYNTHETIC EVIDENCE\n')
            self.assertTrue(publisher.verify_fixture(obj, pin))
            with self.assertRaises(publisher.Replay):
                publisher.publish_fixture(pathlib.Path(root), b'SYNTHETIC EVIDENCE\n')

    def test_unknown_bytes_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                publisher.publish_fixture(pathlib.Path(root), b'real data')
            self.assertEqual(list(pathlib.Path(root).iterdir()), [])

    def test_tampering_extra_file_symlink_and_hardlink_rejected(self):
        for attack in ('bytes', 'extra', 'symlink', 'hardlink'):
            with self.subTest(attack=attack), tempfile.TemporaryDirectory() as root:
                obj, pin = publisher.publish_fixture(pathlib.Path(root), publisher.PAYLOAD)
                target = obj / 'payload.txt'
                if attack == 'bytes':
                    target.write_bytes(b'x' * len(publisher.PAYLOAD))
                elif attack == 'extra':
                    (obj / 'extra').write_bytes(b'x')
                elif attack == 'symlink':
                    target.unlink()
                    target.symlink_to(obj / 'manifest.json')
                else:
                    os.link(target, pathlib.Path(root) / 'hardlink')
                with self.assertRaises((ValueError, OSError)):
                    publisher.verify_fixture(obj, pin)

    def test_bad_pin_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            obj, pin = publisher.publish_fixture(pathlib.Path(root), publisher.PAYLOAD)
            with self.assertRaises(ValueError):
                publisher.verify_fixture(obj, '0' * len(pin))

    def test_concurrent_replay_has_one_winner(self):
        with tempfile.TemporaryDirectory() as root:
            def run(_):
                try:
                    publisher.publish_fixture(pathlib.Path(root), publisher.PAYLOAD)
                    return 'success'
                except publisher.Replay:
                    return 'replay'
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(run, range(8)))
            self.assertEqual(results.count('success'), 1)
            self.assertEqual(results.count('replay'), 7)

    def test_write_failure_leaves_no_object(self):
        with tempfile.TemporaryDirectory() as root:
            with mock.patch.object(publisher.os, 'write', side_effect=OSError(28, 'no space')):
                with self.assertRaises(OSError):
                    publisher.publish_fixture(pathlib.Path(root), publisher.PAYLOAD)
            self.assertEqual(list(pathlib.Path(root).iterdir()), [])

    def test_post_rename_failure_is_undetermined(self):
        with tempfile.TemporaryDirectory() as root:
            original = publisher._sync_dir
            def fail_parent(fd):
                if os.fstat(fd).st_ino == os.stat(root).st_ino:
                    raise OSError('fsync failed')
                return original(fd)
            with mock.patch.object(publisher, '_sync_dir', side_effect=fail_parent):
                with self.assertRaises(publisher.Undetermined):
                    publisher.publish_fixture(pathlib.Path(root), publisher.PAYLOAD)
            self.assertTrue((pathlib.Path(root) / 'fixture-replay-1').is_dir())
            with self.assertRaises(publisher.Replay):
                publisher.publish_fixture(pathlib.Path(root), publisher.PAYLOAD)

if __name__ == '__main__':
    unittest.main()
