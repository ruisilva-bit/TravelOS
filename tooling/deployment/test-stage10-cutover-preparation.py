import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('cutover', HERE / 'stage10-cutover-preparation.py')


class CutoverPreparationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=os.environ['TMPDIR'])
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_render_validates_inputs_and_sudoers(self):
        policy = self.module.render('travelos', 'a' * 64)
        self.assertTrue(self.module.visudo_valid(policy, self.root))
        for user, digest in [('root ALL=(ALL) ALL', 'a'*64), ('travelos', 'bad'), ('root', 'a'*64)]:
            with self.subTest(user=user, digest=digest), self.assertRaises(ValueError):
                self.module.render(user, digest)

    def test_rehearsal_restores_original_after_forced_failure(self):
        old = b'baseline policy\n'
        target = self.root / 'policy'
        target.write_bytes(old)
        with self.assertRaises(RuntimeError):
            self.module.rehearse(target, self.module.render('travelos', 'a'*64), fail_after_replace=True)
        self.assertEqual(target.read_bytes(), old)

    def test_rehearsal_rejects_invalid_candidate_without_modification(self):
        target = self.root / 'policy'
        target.write_bytes(b'baseline\n')
        with self.assertRaises(ValueError):
            self.module.rehearse(target, 'not sudoers !!!\n')
        self.assertEqual(target.read_bytes(), b'baseline\n')

    def test_rehearsal_rejects_symlink_target(self):
        victim = self.root / 'victim'; victim.write_bytes(b'unchanged')
        target = self.root / 'policy'; target.symlink_to(victim)
        with self.assertRaises(ValueError):
            self.module.rehearse(target, self.module.render('travelos', 'a'*64))
        self.assertEqual(victim.read_bytes(), b'unchanged')

    def test_rehearsal_installs_candidate_only_in_scratch(self):
        target = self.root / 'policy'; target.write_bytes(b'old\n')
        candidate = self.module.render('travelos', 'a'*64)
        self.module.rehearse(target, candidate)
        self.assertEqual(target.read_text(), candidate)
        with self.assertRaises(ValueError):
            self.module.rehearse(Path('/etc/sudoers'), candidate)


if __name__ == '__main__':
    unittest.main()