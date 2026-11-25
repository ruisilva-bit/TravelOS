"""Synthetic packaging tests only; no CT200 mutation."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).with_name('stage10-qualification-package.py')
SPEC = importlib.util.spec_from_file_location('qualification_package', SOURCE)
package = importlib.util.module_from_spec(SPEC)
if SOURCE.exists():
    SPEC.loader.exec_module(package)


class PackageTests(unittest.TestCase):
    def test_contained_lock_and_accepted_blobs_required(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch) / 'source'
            root.mkdir()
            (root / 'pnpm-lock.yaml').write_text("lockfileVersion: '9.0'\n")
            (root / 'node_modules').mkdir()
            (root / 'node_modules' / '.pnpm').mkdir()
            (root / 'node_modules' / 'library').mkdir()
            (root / 'node_modules' / 'link').symlink_to('library')
            self.assertEqual(package.check_dependency_tree(root), '9.0')
            (root / 'node_modules' / 'escape').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):
                package.check_dependency_tree(root)
            (root / 'node_modules' / 'escape').unlink()
            (root / 'pnpm-lock.yaml').write_text('lockfileVersion: 8.0\n')
            with self.assertRaises(ValueError):
                package.check_dependency_tree(root)

    def test_copy_preserves_source_and_rejects_occupied_or_escaping_links(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch) / 'source'
            root.mkdir()
            (root / 'pnpm-lock.yaml').write_text("lockfileVersion: '9.0'\n")
            (root / 'package.json').write_text('{}')
            (root / 'node_modules').mkdir()
            (root / 'node_modules' / '.pnpm').mkdir()
            (root / 'node_modules' / 'lib').mkdir()
            (root / 'node_modules' / 'lib' / 'index.js').write_text('ok')
            (root / 'node_modules' / 'link').symlink_to('lib')
            (root / 'tests').mkdir()
            (root / 'tests' / 'case.ts').write_text('test')
            output = Path(scratch) / 'harness'
            package.copy_harness(root, output, ('tests',))
            self.assertEqual((output / 'node_modules/link/index.js').read_text(), 'ok')
            self.assertTrue((output / 'node_modules/link').is_symlink())
            with self.assertRaises(FileExistsError):
                package.copy_harness(root, output, ('tests',))
            (root / 'tests' / 'escape').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):
                package.copy_harness(root, Path(scratch) / 'other', ('tests',))

    def test_harness_contains_root_tsconfig_and_workspace_dependency_links(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch) / 'source'
            root.mkdir()
            (root / 'pnpm-lock.yaml').write_text("lockfileVersion: '9.0'\n")
            (root / 'tsconfig.base.json').write_text('{}')
            (root / 'node_modules/.pnpm').mkdir(parents=True)
            (root / 'node_modules/.pnpm/fixture').mkdir()
            (root / 'apps/app/node_modules').mkdir(parents=True)
            (root / 'apps/app/dist').mkdir()
            (root / 'apps/app/dist/index.js').write_text('built fixture')
            (root / 'apps/app/node_modules/dep').symlink_to('../../../node_modules/.pnpm/fixture')
            out = Path(scratch) / 'out'
            package.copy_harness(root, out, ('apps',))
            self.assertTrue((out / 'tsconfig.base.json').is_file())
            self.assertEqual((out / 'apps/app/dist/index.js').read_text(), 'built fixture')
            self.assertTrue((out / 'apps/app/node_modules/dep').is_symlink())
            self.assertTrue((out / 'apps/app/node_modules/dep').is_dir())

    def test_runtime_is_distinct_and_stale_attempt_never_overwritten(self):
        with tempfile.TemporaryDirectory() as scratch:
            attempt = Path(scratch) / 'attempt-abc'
            attempt.mkdir()
            runtime = attempt / 'runtime'
            runtime.mkdir()
            (runtime / 'keep').write_text('previous')
            with self.assertRaises(FileExistsError):
                package.require_new_attempt(attempt)
            self.assertEqual((runtime / 'keep').read_text(), 'previous')


if __name__ == '__main__':
    unittest.main()
