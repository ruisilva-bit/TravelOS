import importlib.util
import pathlib
import unittest
import os
import tempfile
import hashlib
import fcntl

path = pathlib.Path(__file__).with_name('stage10-native-backup.py')
spec = importlib.util.spec_from_file_location('native_backup', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def plan():
    return {'schemaVersion': 1, 'environment': 'DEVELOPMENT',
            'socketDirectory': '/run/postgresql', 'port': 5432,
            'osUser': 'backup_agent', 'replicationRole': 'backup_agent',
            'authentication': {'method': 'peer', 'osUser': 'backup_agent',
                               'databaseRole': 'backup_agent'},
            'role': {'login': True, 'replication': True, 'superuser': False,
                     'createdb': False, 'createrole': False, 'bypassrls': False},
            'hba': {'connectionType': 'local', 'database': 'replication',
                    'user': 'backup_agent', 'method': 'peer'}}


class PlanTests(unittest.TestCase):
    def test_live_identity_rejects_elevation_membership_version_and_wrong_session(self):
        value = {'currentUser': 'backup_agent', 'sessionUser': 'backup_agent',
                 'superuser': False, 'createdb': False, 'createrole': False,
                 'bypassrls': False, 'replication': True, 'login': True,
                 'memberships': 0, 'primary': True, 'serverVersion': 180006,
                 'extraTablespaces': 0}
        module.validate_live_identity(value, 'backup_agent')
        for key, replacement in [('superuser', True), ('replication', False), ('memberships', 1),
                                 ('serverVersion', 180005), ('sessionUser', 'postgres'),
                                 ('extraTablespaces', 1), ('primary', False), ('memberships', False)]:
            bad = dict(value); bad[key] = replacement
            with self.subTest(key=key), self.assertRaises(ValueError):
                module.validate_live_identity(bad, 'backup_agent')

    def test_private_parent_rejects_symlinks_and_group_write(self):
        with tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch') as temporary:
            root = pathlib.Path(temporary)
            linked = root / 'link'
            linked.symlink_to(root, target_is_directory=True)
            with self.assertRaises((ValueError, OSError)):
                module._private_parent(linked)
            root.chmod(0o770)
            try:
                with self.assertRaises(ValueError): module._private_parent(root)
            finally:
                root.chmod(0o700)

    def test_binary_pins_snapshot_and_reject_modified_or_linked_files(self):
        with tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch') as temporary:
            root = pathlib.Path(temporary)
            executable = root / 'fixture'
            original = b'synthetic pinned file, never executed'
            executable.write_bytes(original); executable.chmod(0o700)
            record = {'path': str(executable), 'sha256': hashlib.sha256(original).hexdigest()}
            descriptor = module._pin_tool(record)
            try:
                executable.write_bytes(b'modified')
                self.assertEqual(os.pread(descriptor, 1000, 0), original)
                self.assertTrue(fcntl.fcntl(descriptor, fcntl.F_GET_SEALS) & fcntl.F_SEAL_WRITE)
            finally:
                os.close(descriptor)
            with self.assertRaises(ValueError): module._pin_tool(record)
            executable.write_bytes(original)
            alias = root / 'alias'; os.link(executable, alias)
            with self.assertRaises(ValueError): module._pin_tool(record)
            alias.unlink()
            executable.unlink(); executable.symlink_to('/usr/bin/true')
            with self.assertRaises((ValueError, OSError)): module._pin_tool(record)

    def test_binary_pin_rejects_setuid_and_setgid_modes(self):
        with tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch') as temporary:
            executable = pathlib.Path(temporary) / 'fixture'
            data = b'synthetic pinned file, never executed'
            executable.write_bytes(data)
            record = {'path': str(executable), 'sha256': hashlib.sha256(data).hexdigest()}
            for mode in (0o4700, 0o2700, 0o6700):
                with self.subTest(mode=oct(mode)):
                    executable.chmod(mode)
                    self.assertEqual(executable.stat().st_mode & 0o6000, mode & 0o6000)
                    with self.assertRaisesRegex(ValueError, 'STAGE10_NATIVE_BACKUP_TOOL_REJECTED'):
                        descriptor = module._pin_tool(record)
                        os.close(descriptor)

    def test_native_bounds_reject_before_filesystem_or_process(self):
        tools = {'psql': {}, 'pg_basebackup': {}}
        for maximum in (True, 0, -1, module.MAX_BACKUP + 1):
            with self.subTest(maximum=maximum), self.assertRaises(ValueError):
                module.native_backup_tar(plan(), tools, '/does-not-exist', maximum_bytes=maximum)

    def test_archive_policy_rejects_links_traversal_and_duplicates(self):
        import io
        import tarfile
        from unittest import mock
        for name, kind in [('../outside', tarfile.REGTYPE), ('/outside', tarfile.REGTYPE),
                           ('linked', tarfile.SYMTYPE), ('duplicate', tarfile.REGTYPE)]:
            stream = io.BytesIO()
            with tarfile.open(fileobj=stream, mode='w') as archive:
                member = tarfile.TarInfo(name); member.type = kind
                archive.addfile(member)
                if name == 'duplicate': archive.addfile(member)
            with tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch') as temporary:
                # Parser-only fixture: no vendor process may be invoked.
                with mock.patch.object(module, '_pin_tool', side_effect=lambda _: os.open('/dev/null', os.O_RDONLY)), mock.patch.object(module._process, 'bounded_run', side_effect=AssertionError('vendor must not run')):
                    with self.assertRaises(ValueError):
                        module.verify_native_tar(stream.getvalue(), {'pg_verifybackup': {}, 'pg_waldump': {}}, temporary)
                self.assertFalse(list(pathlib.Path(temporary).iterdir()))

    def test_valid_plan_never_claims_execution(self):
        result = module.validate_plan(plan())
        self.assertEqual(result['result'], 'STRUCTURALLY_VALID_PLAN')
        self.assertEqual(result['provisioning'], 'NOT_PERFORMED')
        self.assertEqual(result['authentication'], 'NOT_VERIFIED')
        self.assertEqual(result['publication'], 'NOT_ATTEMPTED_OUTCOME_UNKNOWN')

    def test_reject_missing_unknown_and_weak_auth(self):
        for change in ('missing', 'unknown', 'trust', 'other_user', 'superuser', 'bool_port'):
            p = plan()
            if change == 'missing': del p['authentication']
            if change == 'unknown': p['arbitrary'] = 'value'
            if change == 'trust': p['hba']['method'] = 'trust'
            if change == 'other_user': p['authentication']['osUser'] = 'other'
            if change == 'superuser': p['role']['superuser'] = True
            if change == 'bool_port': p['port'] = True
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.validate_plan(p)

    def test_reject_socket_traversal_or_unsupported_identity(self):
        for value in ('relative', '/run/../tmp', '/run//pg', '/run/pg/'):
            p = plan(); p['socketDirectory'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.validate_plan(p)
        p = plan(); p['replicationRole'] = 'postgres'
        with self.assertRaises(ValueError): module.validate_plan(p)


if __name__ == '__main__':
    unittest.main()
