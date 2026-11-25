"""Non-consuming transport fixtures; no SSH, server or application execution."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock
import shutil
import subprocess
import sys

SPEC = importlib.util.spec_from_file_location('transport', Path(__file__).with_name('stage10-qualification-transport.py'))
transport = importlib.util.module_from_spec(SPEC)
if SPEC.loader and Path(SPEC.origin).exists():
    SPEC.loader.exec_module(transport)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'prepared'
        self.source.mkdir(mode=0o700)
        (self.source / 'runner.mjs').write_text('export const fixture = true;\n')
        (self.source / 'runner.mjs').chmod(0o600)
        (self.source / 'alias.mjs').symlink_to('runner.mjs')
        self.archive = self.root / 'harness.tar'

    def test_deterministic_archive_roundtrip_and_exact_inventory(self):
        receipt = transport.pack(self.source, self.archive)
        self.assertEqual(receipt['scope'], 'TEST_HARNESS_ONLY_NOT_RUNTIME_OR_ACCEPTANCE')
        self.assertEqual(transport.verify(self.archive, receipt), receipt)
        other = self.root / 'second.tar'
        self.assertEqual(transport.pack(self.source, other), receipt)
        self.assertEqual(self.archive.read_bytes(), other.read_bytes())
        self.assertEqual(self.archive.stat().st_mode & 0o777, 0o600)
        with tarfile.open(self.archive) as tf:
            self.assertEqual(tf.getnames(), ['alias.mjs', 'runner.mjs'])

    def test_external_absolute_and_dangling_links_rejected_before_output(self):
        for target in ('../outside', '/etc/passwd', 'missing'):
            with self.subTest(target=target):
                (self.source / 'bad').symlink_to(target)
                with self.assertRaises(ValueError):
                    transport.pack(self.source, self.archive)
                self.assertFalse(self.archive.exists())
                (self.source / 'bad').unlink()

    def test_special_file_and_privileged_mode_rejected(self):
        os.mkfifo(self.source / 'pipe')
        with self.assertRaises(ValueError):
            transport.pack(self.source, self.archive)
        (self.source / 'pipe').unlink()
        (self.source / 'runner.mjs').chmod(0o4600)
        with self.assertRaises(ValueError):
            transport.pack(self.source, self.archive)

    def test_occupied_output_preserved(self):
        for kind in ('file', 'symlink', 'directory'):
            with self.subTest(kind=kind):
                out = self.root / kind
                if kind == 'file':
                    out.write_bytes(b'KEEP')
                elif kind == 'symlink':
                    out.symlink_to(self.root / 'absent')
                else:
                    out.mkdir()
                with self.assertRaises((FileExistsError, ValueError)):
                    transport.pack(self.source, out)
                if kind == 'file':
                    self.assertEqual(out.read_bytes(), b'KEEP')
                elif kind == 'symlink':
                    self.assertTrue(out.is_symlink())
                else:
                    self.assertTrue(out.is_dir())

    def test_corrupt_archive_and_inventory_refused(self):
        receipt = transport.pack(self.source, self.archive)
        receipt['files'][0]['path'] = '../escape'
        with self.assertRaises(ValueError):
            transport.verify(self.archive, receipt)
        self.archive.write_bytes(b'changed')
        with self.assertRaises(ValueError):
            transport.verify(self.archive, receipt)

    def test_archive_extra_entry_rejected_even_with_rehashed_archive(self):
        receipt = transport.pack(self.source, self.archive)
        with tarfile.open(self.archive, 'a') as tf:
            info = tarfile.TarInfo('../escape')
            tf.addfile(info)
        receipt['sha256'] = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        receipt['bytes'] = self.archive.stat().st_size
        with self.assertRaises(ValueError):
            transport.verify(self.archive, receipt)

    def test_archive_members_cannot_live_below_a_symlink(self):
        import io
        rows = [
            {'path': 'alias', 'kind': 'symlink', 'target': 'dir', 'mode': 0o777},
            {'path': 'alias/injected', 'kind': 'file', 'bytes': 1,
             'sha256': hashlib.sha256(b'x').hexdigest(), 'mode': 0o600},
            {'path': 'dir', 'kind': 'directory', 'mode': 0o700},
        ]
        with tarfile.open(self.archive, 'w') as tf:
            for row in rows:
                item = tarfile.TarInfo(row['path'])
                item.mode = row['mode']
                if row['kind'] == 'symlink':
                    item.type = tarfile.SYMTYPE
                    item.linkname = row['target']
                elif row['kind'] == 'directory':
                    item.type = tarfile.DIRTYPE
                else:
                    item.size = 1
                tf.addfile(item, io.BytesIO(b'x') if item.isfile() else None)
        receipt = {'schemaVersion': 1, 'scope': transport.SCOPE,
                   'bytes': self.archive.stat().st_size,
                   'sha256': hashlib.sha256(self.archive.read_bytes()).hexdigest(), 'files': rows}
        with self.assertRaises(ValueError):
            transport.verify(self.archive, receipt)

    def test_verify_uses_bounded_inventory_scans_for_many_links(self):
        for number in range(20):
            (self.source / f'link-{number}').symlink_to('runner.mjs')
        receipt = transport.pack(self.source, self.archive)
        class CountingRows(list):
            iterations = 0
            def __iter__(self):
                self.iterations += 1
                return super().__iter__()
        rows = CountingRows(receipt['files'])
        receipt['files'] = rows
        transport.verify(self.archive, receipt)
        self.assertLessEqual(rows.iterations, 5)

    def test_unpack_uses_member_objects_not_linear_name_lookup(self):
        receipt = transport.pack(self.source, self.archive)
        original = tarfile.TarFile.extractfile
        def checked_extract(tf, member):
            self.assertIsInstance(member, tarfile.TarInfo)
            return original(tf, member)
        with mock.patch.object(tarfile.TarFile, 'extractfile', checked_extract):
            transport.unpack(self.archive, receipt, self.root / 'extracted')

    def test_directory_links_in_dependency_tree_roundtrip(self):
        (self.source / 'store').mkdir()
        (self.source / 'store/lib.js').write_text('export {};')
        (self.source / 'lib').symlink_to('store', target_is_directory=True)
        receipt = transport.pack(self.source, self.archive)
        self.assertEqual(transport.verify(self.archive, receipt), receipt)

    def test_unpack_checks_exact_bytes_modes_and_contained_links(self):
        (self.source / 'store').mkdir(mode=0o700)
        (self.source / 'store/lib.js').write_bytes(b'fixture-library')
        (self.source / 'lib').symlink_to('store', target_is_directory=True)
        receipt = transport.pack(self.source, self.archive)
        destination = self.root / 'extracted'
        transport.unpack(self.archive, receipt, destination)
        self.assertEqual(transport.inventory(destination), receipt['files'])
        self.assertEqual((destination / 'alias.mjs').read_bytes(), b'export const fixture = true;\n')
        self.assertEqual((destination / 'lib/lib.js').read_bytes(), b'fixture-library')
        self.assertEqual(destination.stat().st_mode & 0o777, 0o700)

    def test_unpack_never_replaces_existing_destination(self):
        receipt = transport.pack(self.source, self.archive)
        for kind in ('file', 'directory', 'dangling-link'):
            destination = self.root / kind
            if kind == 'file':
                destination.write_bytes(b'KEEP')
            elif kind == 'directory':
                destination.mkdir()
                (destination / 'marker').write_bytes(b'KEEP')
            else:
                destination.symlink_to('missing')
            with self.subTest(kind=kind), self.assertRaises(FileExistsError):
                transport.unpack(self.archive, receipt, destination)
            if kind == 'file':
                self.assertEqual(destination.read_bytes(), b'KEEP')
            elif kind == 'directory':
                self.assertEqual((destination / 'marker').read_bytes(), b'KEEP')
            else:
                self.assertEqual(os.readlink(destination), 'missing')

    def test_unpack_rejects_corruption_before_destination_creation(self):
        receipt = transport.pack(self.source, self.archive)
        self.archive.write_bytes(b'CORRUPT')
        destination = self.root / 'extracted'
        with self.assertRaises(ValueError):
            transport.unpack(self.archive, receipt, destination)
        self.assertFalse(destination.exists())

    def test_empty_tree_and_nested_output_refused(self):
        empty = self.root / 'empty'
        empty.mkdir()
        with self.assertRaises(ValueError):
            transport.pack(empty, self.archive)
        with self.assertRaises(ValueError):
            transport.pack(self.source, self.source / 'nested.tar')

    def test_readonly_ssh_is_fixed_and_no_executor_or_forwarding(self):
        args = transport.preflight_command()
        self.assertIn('hermes@192.168.1.33', args)
        self.assertIn('StrictHostKeyChecking=yes', args)
        self.assertIn('ClearAllForwardings=yes', args)
        self.assertIn('IdentityAgent=none', args)
        self.assertNotIn('sudo', ' '.join(args))
        self.assertEqual(args[-1], '/usr/bin/python3 -B -I -')

    def test_unknown_remote_outcome_never_becomes_pass(self):
        for code, received, clean in [(None, False, False), (0, False, True), (0, True, False), (1, True, True)]:
            self.assertNotEqual(transport.outcome(code, received, clean), 'PASS')
        self.assertEqual(transport.outcome(None, False, False), 'UNKNOWN_OUTCOME_PRESERVE')
        self.assertEqual(transport.outcome(0, True, True), 'PASS')

    def test_cleanup_verified_attempt_removes_only_exact_owned_transport(self):
        parent = self.root / 'private'
        parent.mkdir(mode=0o700)
        attempt = parent / 'attempt-abc'
        attempt.mkdir(mode=0o700)
        shutil.copy2(Path(__file__).with_name('stage10-qualification-transport.py'), attempt / 'stage10-qualification-transport.py')
        archive = attempt / 'browser.tar'
        receipt = transport.pack(self.source, archive)
        (attempt / 'browser.json').write_text(json.dumps(receipt))
        (attempt / 'browser.json').chmod(0o600)
        transport.unpack(archive, receipt, attempt / 'browser')
        old = transport.ATTEMPT_PARENT
        transport.ATTEMPT_PARENT = parent
        self.addCleanup(setattr, transport, 'ATTEMPT_PARENT', old)
        self.assertTrue(transport.cleanup_verified_attempt(attempt, 'browser.tar', 'browser.json', 'browser'))
        self.assertFalse(attempt.exists())

    def test_cleanup_refuses_extra_cache_and_preserves_original_bytes(self):
        parent = self.root / 'private'
        parent.mkdir(mode=0o700)
        attempt = parent / 'attempt-abc'
        attempt.mkdir(mode=0o700)
        shutil.copy2(Path(__file__).with_name('stage10-qualification-transport.py'), attempt / 'stage10-qualification-transport.py')
        archive = attempt / 'browser.tar'
        receipt = transport.pack(self.source, archive)
        (attempt / 'browser.json').write_text(json.dumps(receipt))
        (attempt / 'browser.json').chmod(0o600)
        transport.unpack(archive, receipt, attempt / 'browser')
        old = transport.ATTEMPT_PARENT
        transport.ATTEMPT_PARENT = parent
        self.addCleanup(setattr, transport, 'ATTEMPT_PARENT', old)
        (attempt / '__pycache__').mkdir()
        with self.assertRaises(ValueError):
            transport.cleanup_verified_attempt(attempt, 'browser.tar', 'browser.json', 'browser')
        self.assertEqual(transport.digest(archive), receipt['sha256'])
        self.assertTrue((attempt / '__pycache__').is_dir())

    def test_cleanup_refuses_changed_archive_receipt_helper_or_occupied_link(self):
        for altered in ('archive', 'receipt', 'helper', 'link'):
            with self.subTest(altered=altered):
                parent = self.root / altered
                parent.mkdir(mode=0o700)
                attempt = parent / 'attempt-abc'
                attempt.mkdir(mode=0o700)
                shutil.copy2(Path(__file__).with_name('stage10-qualification-transport.py'), attempt / 'stage10-qualification-transport.py')
                archive = attempt / 'browser.tar'
                receipt = transport.pack(self.source, archive)
                (attempt / 'browser.json').write_text(json.dumps(receipt))
                (attempt / 'browser.json').chmod(0o600)
                transport.unpack(archive, receipt, attempt / 'browser')
                old = transport.ATTEMPT_PARENT
                transport.ATTEMPT_PARENT = parent
                try:
                    if altered == 'archive': archive.write_bytes(b'changed')
                    if altered == 'receipt': (attempt / 'browser.json').write_bytes(b'changed')
                    if altered == 'helper': (attempt / 'stage10-qualification-transport.py').write_bytes(b'changed')
                    if altered == 'link':
                        (attempt / 'browser').rename(attempt / 'saved')
                        (attempt / 'browser').symlink_to('saved')
                    with self.assertRaises((ValueError, OSError)):
                        transport.cleanup_verified_attempt(attempt, 'browser.tar', 'browser.json', 'browser')
                    self.assertTrue(attempt.is_dir())
                finally:
                    transport.ATTEMPT_PARENT = old

    def test_isolated_python_import_does_not_generate_cache(self):
        parent = self.root / 'private'
        parent.mkdir()
        script = parent / 'stage10-qualification-transport.py'
        shutil.copy2(Path(__file__).with_name('stage10-qualification-transport.py'), script)
        result = subprocess.run([sys.executable, '-B', '-I', '-c',
            'import importlib.util,sys; s=importlib.util.spec_from_file_location("transport",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)', str(script)],
            capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(p.name for p in parent.iterdir()), [script.name])

    def test_cleanup_command_preserves_attempt_if_unit_is_active_or_unknown(self):
        parent = self.root / 'private'
        parent.mkdir(mode=0o700)
        attempt = parent / 'attempt-abc'
        attempt.mkdir(mode=0o700)
        old = transport.ATTEMPT_PARENT
        transport.ATTEMPT_PARENT = parent
        self.addCleanup(setattr, transport, 'ATTEMPT_PARENT', old)
        for state, exitcode in [('LoadState=loaded\nActiveState=active\n', 0),
                                ('LoadState=not-found\nActiveState=inactive\n', 1),
                                ('unexpected\n', 0)]:
            with self.subTest(state=state, exitcode=exitcode), mock.patch.object(
                transport.subprocess, 'run', return_value=subprocess.CompletedProcess(
                    [], exitcode, state.encode(), b'')) as check:
                with self.assertRaises(ValueError):
                    transport.cleanup_command(attempt, 'browser.tar', 'browser.json', 'browser')
                self.assertTrue(attempt.is_dir())
                self.assertEqual(check.call_args.args[0],
                    ['/usr/bin/systemctl', '--user', 'show', 'travelos-s10-attempt-abc.service',
                     '--property=LoadState', '--property=ActiveState'])


    def test_hardlinks_preserved_in_pack_and_unpack(self):
        (self.source / 'store').mkdir(mode=0o700)
        (self.source / 'store/base.txt').write_bytes(b'shared-content')
        os.link(self.source / 'store/base.txt', self.source / 'dup.txt')
        receipt = transport.pack(self.source, self.archive)
        hardlinks = [row for row in receipt['files'] if row['kind'] == 'hardlink']
        self.assertEqual(len(hardlinks), 1)
        # Directory traversal order determines the target; both names share content.
        target = hardlinks[0]['target']
        self.assertIn(hardlinks[0]['path'], ['dup.txt', 'store/base.txt'])
        self.assertIn(target, ['dup.txt', 'store/base.txt'])
        self.assertNotEqual(hardlinks[0]['path'], target)
        destination = self.root / 'extracted'
        transport.unpack(self.archive, receipt, destination)
        self.assertTrue((destination / 'dup.txt').exists())
        self.assertTrue((destination / 'store/base.txt').exists())
        self.assertEqual((destination / 'dup.txt').stat().st_ino, (destination / 'store/base.txt').stat().st_ino)
        self.assertEqual((destination / 'dup.txt').read_bytes(), b'shared-content')
        self.assertEqual(transport.inventory(destination), receipt['files'])

    def test_multiple_hardlinks_to_same_inode_roundtrip(self):
        (self.source / 'a.txt').write_bytes(b'common')
        for name in ('b.txt', 'c.txt'):
            os.link(self.source / 'a.txt', self.source / name)
        receipt = transport.pack(self.source, self.archive)
        hardlinks = [row for row in receipt['files'] if row['kind'] == 'hardlink']
        self.assertEqual(len(hardlinks), 2)
        destination = self.root / 'extracted'
        transport.unpack(self.archive, receipt, destination)
        inodes = {(destination / name).stat().st_ino for name in ('a.txt', 'b.txt', 'c.txt')}
        self.assertEqual(len(inodes), 1)

    def test_symlink_to_hardlinked_file_roundtrip(self):
        (self.source / 'base.txt').write_bytes(b'base')
        os.link(self.source / 'base.txt', self.source / 'alias.txt')
        (self.source / 'link.txt').symlink_to('base.txt')
        receipt = transport.pack(self.source, self.archive)
        destination = self.root / 'extracted'
        transport.unpack(self.archive, receipt, destination)
        self.assertEqual((destination / 'link.txt').read_bytes(), b'base')
        self.assertEqual((destination / 'alias.txt').stat().st_ino, (destination / 'base.txt').stat().st_ino)
        self.assertTrue((destination / 'link.txt').is_symlink())

    def test_hardlink_target_escape_rejected(self):
        rows = [
            {'path': 'a.txt', 'kind': 'file', 'bytes': 1, 'sha256': hashlib.sha256(b'x').hexdigest(), 'mode': 0o600},
            {'path': 'b.txt', 'kind': 'hardlink', 'target': '../outside', 'mode': 0o600},
        ]
        with tarfile.open(self.archive, 'w') as tf:
            info = tarfile.TarInfo('a.txt')
            info.size = 1
            tf.addfile(info, io.BytesIO(b'x'))
            info = tarfile.TarInfo('b.txt')
            info.type = tarfile.LNKTYPE
            info.linkname = '../outside'
            tf.addfile(info)
        receipt = {'schemaVersion': 1, 'scope': transport.SCOPE,
                   'bytes': self.archive.stat().st_size,
                   'sha256': hashlib.sha256(self.archive.read_bytes()).hexdigest(), 'files': rows}
        with self.assertRaises(ValueError):
            transport.verify(self.archive, receipt)

    def test_dangling_hardlink_target_rejected(self):
        rows = [
            {'path': 'a.txt', 'kind': 'file', 'bytes': 1, 'sha256': hashlib.sha256(b'x').hexdigest(), 'mode': 0o600},
            {'path': 'b.txt', 'kind': 'hardlink', 'target': 'missing', 'mode': 0o600},
        ]
        with tarfile.open(self.archive, 'w') as tf:
            info = tarfile.TarInfo('a.txt')
            info.size = 1
            tf.addfile(info, io.BytesIO(b'x'))
            info = tarfile.TarInfo('b.txt')
            info.type = tarfile.LNKTYPE
            info.linkname = 'missing'
            tf.addfile(info)
        receipt = {'schemaVersion': 1, 'scope': transport.SCOPE,
                   'bytes': self.archive.stat().st_size,
                   'sha256': hashlib.sha256(self.archive.read_bytes()).hexdigest(), 'files': rows}
        with self.assertRaises(ValueError):
            transport.verify(self.archive, receipt)

    def test_setgid_setuid_sticky_modes_rejected_on_directories_and_files(self):
        for mode in (0o2755, 0o4755, 0o1755):
            with self.subTest(mode=oct(mode)):
                (self.source / 'runner.mjs').chmod(mode)
                with self.assertRaises(ValueError):
                    transport.pack(self.source, self.archive)
                (self.source / 'runner.mjs').chmod(0o600)

    def test_hardlink_target_must_be_regular_file_not_symlink(self):
        # A symlink to a file has a different inode than the file, so it cannot
        # be the target of a hardlink entry. The packer treats it as a symlink.
        (self.source / 'base.txt').write_bytes(b'base')
        (self.source / 'link.txt').symlink_to('base.txt')
        receipt = transport.pack(self.source, self.archive)
        kinds = {row['kind'] for row in receipt['files']}
        self.assertIn('symlink', kinds)
        self.assertNotIn('hardlink', kinds)

    def _build_hardlink_tree(self):
        (self.source / 'a').mkdir(mode=0o700)
        (self.source / 'b').mkdir(mode=0o700)
        (self.source / 'a/x.txt').write_bytes(b'pnpm-store-content')
        (self.source / 'a/x.txt').chmod(0o600)
        os.link(self.source / 'a/x.txt', self.source / 'b/y.txt')
        (self.source / 'regular.txt').write_bytes(b'independent')
        (self.source / 'regular.txt').chmod(0o600)
        (self.source / 'sym').symlink_to('regular.txt')

    def test_hardlink_roundtrip_preserves_inode_and_keeps_regular_file_unlinked(self):
        self._build_hardlink_tree()
        receipt = transport.pack(self.source, self.archive)
        destination = self.root / 'extracted'
        transport.unpack(self.archive, receipt, destination)
        x, y = destination / 'a/x.txt', destination / 'b/y.txt'
        self.assertEqual(os.stat(x).st_ino, os.stat(y).st_ino)
        self.assertEqual(os.stat(x).st_nlink, 2)
        self.assertEqual(x.read_bytes(), b'pnpm-store-content')
        self.assertEqual(y.read_bytes(), b'pnpm-store-content')
        # A regular file with identical content must remain an independent inode.
        regular = destination / 'regular.txt'
        self.assertNotEqual(os.stat(regular).st_ino, os.stat(x).st_ino)
        self.assertEqual(os.stat(regular).st_nlink, 1)
        self.assertEqual(regular.read_bytes(), b'independent')
        self.assertEqual(os.readlink(destination / 'sym'), 'regular.txt')
        self.assertEqual(transport.inventory(destination), receipt['files'])

    def test_inventory_reports_one_hardlink_row_targeting_first_occurrence(self):
        self._build_hardlink_tree()
        rows = transport.inventory(self.source)
        hardlinks = [row for row in rows if row['kind'] == 'hardlink']
        self.assertEqual(hardlinks, [{'path': 'b/y.txt', 'kind': 'hardlink',
                                      'target': 'a/x.txt', 'mode': 0o600}])
        content_rows = [row['path'] for row in rows if row.get('sha256') and
                        row['path'] in ('a/x.txt', 'b/y.txt')]
        self.assertEqual(content_rows, ['a/x.txt'])

    def test_tampered_hardlink_target_in_receipt_fails_closed(self):
        self._build_hardlink_tree()
        receipt = transport.pack(self.source, self.archive)
        receipt['files'] = [dict(row, target='regular.txt') if row['kind'] == 'hardlink' else row
                            for row in receipt['files']]
        destination = self.root / 'extracted'
        with self.assertRaises(ValueError):
            transport.unpack(self.archive, receipt, destination)
        self.assertFalse(destination.exists())


if __name__ == '__main__':
    unittest.main()
