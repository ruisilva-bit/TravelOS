#!/usr/bin/env python3
"""Disposable isolated test suite for stage10-backup-identity-host.

Validates fixed constants, argument handling, fail-closed boundaries,
and isolation guards without mutating the host environment.
"""
import importlib.util
import json
import os
import shlex
import subprocess
from pathlib import Path
import stat
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import tempfile

HERE = Path(__file__).resolve().parent
HOST_SCRIPT = HERE / 'stage10-backup-identity-host.py'

spec = importlib.util.spec_from_file_location('host_adapter', str(HOST_SCRIPT))
assert spec and spec.loader
host_adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host_adapter)


class HostAdapterContractTests(unittest.TestCase):
    def test_regular_read_accepts_read_induced_atime_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'journal'
            path.write_bytes(b'synthetic journal')
            os.chmod(path, 0o600)
            old = path.stat().st_mtime_ns - 86400 * 1000000000
            os.utime(path, ns=(old, path.stat().st_mtime_ns))
            parent = os.open(temporary, os.O_RDONLY | os.O_DIRECTORY)
            try:
                before = path.stat()
                data, _ = host_adapter.read_regular(parent, 'journal', os.geteuid(), 0o600, 8192)
                after = path.stat()
                self.assertNotEqual(before.st_atime_ns, after.st_atime_ns)
                self.assertEqual(data, b'synthetic journal')
            finally:
                os.close(parent)

    def test_regular_read_rejects_concurrent_same_size_content_or_metadata_change(self):
        for mutation in ('content', 'mode'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / 'journal'
                path.write_bytes(b'synthetic journal')
                os.chmod(path, 0o600)
                parent = os.open(temporary, os.O_RDONLY | os.O_DIRECTORY)
                real_read = os.read
                def changing_read(fd, size):
                    data = real_read(fd, size)
                    if mutation == 'content':
                        path.write_bytes(b'altered   journal')
                    else:
                        os.chmod(path, 0o400)
                    return data
                try:
                    with patch.object(host_adapter.os, 'read', side_effect=changing_read):
                        with self.assertRaisesRegex(ValueError, 'STAGE10_BACKUP_IDENTITY_REJECTED'):
                            host_adapter.read_regular(parent, 'journal', os.geteuid(), 0o600, 8192)
                finally:
                    os.close(parent)

    def test_fixed_constants_match_ct200_contracts(self):
        self.assertEqual(host_adapter.NAME, 'travelos_backup')
        self.assertEqual(host_adapter.HBA, '/etc/postgresql/18/main/pg_hba.conf')
        self.assertEqual(host_adapter.CERT, '/etc/travelos/stage10-backup-recipient.pem')
        self.assertEqual(host_adapter.RECIPIENT, 'b7e09a9f4165c4798d33aa171e2a3d1b5fab0789d6c51f8bf88717db4240cd92')
        self.assertEqual(host_adapter.MAX_HBA, 65536)
        self.assertEqual(host_adapter.TOOLS['psql'][0], '/usr/lib/postgresql/18/bin/psql')
        self.assertEqual(host_adapter.TOOLS['openssl'][0], '/usr/bin/openssl')
        self.assertEqual(host_adapter.TOOLS['useradd'][0], '/usr/sbin/useradd')
        self.assertEqual(host_adapter.TOOLS['userdel'][0], '/usr/sbin/userdel')

    def test_useradd_fixed_arguments_parse_with_pinned_binary(self):
        host = SimpleNamespace(_unix=Mock(side_effect=[None, (120, 120)]),
                               _record=Mock(), _run=Mock(), meta={})
        with patch.object(host_adapter.grp, 'getgrnam', side_effect=KeyError):
            host_adapter.Host.create_user(host, host_adapter.NAME)
        args = host._run.call_args.args[1]
        self.assertEqual(args, ['--system', '--user-group', '--no-create-home',
                                '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin',
                                '--password', '!', host_adapter.NAME])
        host._run.assert_called_once_with('useradd', args, mutation=True)
        # --help exits before account writes, but only after preceding options parse.
        binary = Path(host_adapter.TOOLS['useradd'][0])
        import hashlib
        if not binary.exists() or hashlib.sha256(binary.read_bytes()).hexdigest() != host_adapter.TOOLS['useradd'][1]:
            self.skipTest('pinned CT200 useradd binary unavailable locally')
        result = subprocess.run([str(binary), *args[:-1], '--help'], capture_output=True,
                                text=True, timeout=10, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Usage:', result.stdout)

    def test_fixed_role_attributes(self):
        attrs = host_adapter.ROLE_ATTRS
        self.assertFalse(attrs['rolsuper'])
        self.assertFalse(attrs['rolcreatedb'])
        self.assertFalse(attrs['rolcreaterole'])
        self.assertFalse(attrs['rolbypassrls'])
        self.assertTrue(attrs['rolreplication'])
        self.assertTrue(attrs['rolcanlogin'])
        self.assertFalse(attrs['rolinherit'])
        self.assertEqual(attrs['rolconnlimit'], 2)
        self.assertTrue(attrs['password_null'])
        self.assertEqual(attrs['memberships'], 0)

    def test_pairs_rejects_duplicate_keys(self):
        self.assertEqual(host_adapter.pairs([('a', 1), ('b', 2)]), {'a': 1, 'b': 2})
        with self.assertRaises(ValueError):
            host_adapter.pairs([('a', 1), ('a', 2)])

    def test_directory_rejects_relative_or_dot_components(self):
        for bad in ('var/lib', '/var/../etc', '/var/./lib', 'etc'):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    host_adapter.directory(bad)

    def test_replaced_user_is_not_deleted(self):
        uncertain = RuntimeError('synthetic reconciliation required')
        host = SimpleNamespace(
            user=(120, 120), _unix=Mock(return_value=(121, 121)),
            _uncertain=Mock(side_effect=uncertain), _record=Mock(), _run=Mock())
        with self.assertRaisesRegex(RuntimeError, 'synthetic reconciliation required'):
            host_adapter.Host.delete_user(host, host_adapter.NAME)
        host._run.assert_not_called()
        host._record.assert_not_called()

    def test_matching_user_is_preserved_for_manual_reconciliation(self):
        host = SimpleNamespace(
            user=(120, 120), _unix=Mock(return_value=(120, 120)),
            _uncertain=Mock(side_effect=RuntimeError('synthetic reconciliation required')),
            _record=Mock(), _run=Mock())
        with self.assertRaisesRegex(RuntimeError, 'synthetic reconciliation required'):
            host_adapter.Host.delete_user(host, host_adapter.NAME)
        host._run.assert_not_called()
        host._record.assert_not_called()

    def test_replaced_role_is_not_deleted(self):
        host = SimpleNamespace(
            oid=123, verify_role=Mock(return_value=False),
            _uncertain=Mock(side_effect=RuntimeError('synthetic reconciliation required')),
            _record=Mock(), _sql=Mock())
        with self.assertRaisesRegex(RuntimeError, 'synthetic reconciliation required'):
            host_adapter.Host.delete_role(host, host_adapter.NAME)
        host._sql.assert_not_called()
        host._record.assert_not_called()

    def test_changed_hba_is_not_published_or_restored(self):
        for restoring in (False, True):
            with self.subTest(restoring=restoring):
                host = SimpleNamespace(
                    original=b'original', engine=SimpleNamespace(RULES='rules'),
                    _hba=Mock(return_value=(b'concurrent edit', None)),
                    _uncertain=Mock(side_effect=RuntimeError('synthetic reconciliation required')))
                with self.assertRaisesRegex(RuntimeError, 'synthetic reconciliation required'):
                    host_adapter.Host._publish(host, b'candidate', restoring)

    def test_exclusive_snapshot_publication_never_overwrites_existing_bytes(self):
        with tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch') as temporary:
            parent = os.open(temporary, os.O_RDONLY | os.O_DIRECTORY)
            host = SimpleNamespace(state=parent, _uncertain=Mock(side_effect=RuntimeError('uncertain')))
            try:
                host_adapter.Host._exclusive(host, 'snapshot.cms', b'synthetic ciphertext')
                destination = Path(temporary) / 'snapshot.cms'
                self.assertEqual(destination.read_bytes(), b'synthetic ciphertext')
                self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
                self.assertFalse((Path(temporary) / '.pending').exists())
                with self.assertRaisesRegex(RuntimeError, 'uncertain'):
                    host_adapter.Host._exclusive(host, 'snapshot.cms', b'replacement')
                self.assertEqual(destination.read_bytes(), b'synthetic ciphertext')
                self.assertTrue((Path(temporary) / '.pending').exists())
            finally:
                os.close(parent)

    def test_snapshot_post_link_sync_failure_preserves_publication_for_reconciliation(self):
        with tempfile.TemporaryDirectory(dir='/home/hermes/.hermes/cache/scratch') as temporary:
            parent = os.open(temporary, os.O_RDONLY | os.O_DIRECTORY)
            host = SimpleNamespace(state=parent, _uncertain=Mock(side_effect=RuntimeError('uncertain')))
            real_fsync = os.fsync
            def sync(fd):
                if fd == parent:
                    raise OSError('synthetic directory sync failure')
                return real_fsync(fd)
            try:
                with patch.object(host_adapter.os, 'fsync', side_effect=sync):
                    with self.assertRaisesRegex(RuntimeError, 'uncertain'):
                        host_adapter.Host._exclusive(host, 'snapshot.cms', b'synthetic ciphertext')
                self.assertEqual((Path(temporary) / 'snapshot.cms').read_bytes(), b'synthetic ciphertext')
                self.assertTrue((Path(temporary) / '.pending').exists())
                host._uncertain.assert_called_once()
            finally:
                os.close(parent)

    def test_sealed_memfd_creation_and_seals(self):
        data = b'test-sealed-content'
        fd = host_adapter.sealed(data)
        try:
            self.assertGreaterEqual(fd, 0)
            read_back = os.read(fd, len(data))
            self.assertEqual(read_back, data)
        finally:
            os.close(fd)


class PostgreSQL18RoleQueryTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('STAGE10_PG18_PACKAGE'), 'set STAGE10_PG18_PACKAGE for disposable PostgreSQL 18 integration')
    def test_role_query_rejects_global_and_database_role_settings(self):
        package = Path(os.environ['STAGE10_PG18_PACKAGE']).resolve(strict=True)
        binary = package / 'usr/lib/postgresql/18/bin'
        env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent',
               'LD_LIBRARY_PATH': ':'.join(str(package / p) for p in
                   ('usr/lib/x86_64-linux-gnu', 'usr/lib/postgresql/18/lib'))}
        with tempfile.TemporaryDirectory(prefix='stage10-role-pg-', dir='/home/hermes/.hermes/cache/scratch') as temporary:
            root = Path(temporary)
            data, socket = root / 'data', root / 's'
            socket.mkdir()
            def run(name, args):
                return subprocess.run([str(binary / name), *args], env=env, check=True,
                                      capture_output=True, text=True, timeout=45).stdout.strip()
            run('initdb', ['-D', str(data), '-L', str(package / 'usr/share/postgresql/18'),
                           '-U', 'fixture_admin', '--auth-local=trust', '--auth-host=reject',
                           '--encoding=UTF8', '--locale=C.UTF-8', '--no-instructions'])
            started = False
            try:
                run('pg_ctl', ['-D', str(data), '-l', str(root / 'postgres.log'), '-w', '-t', '30',
                               '-o', shlex.join(['-c', 'listen_addresses=', '-c', f'unix_socket_directories={socket}',
                                                '-c', 'port=6547']), 'start'])
                started = True
                def sql(query):
                    return run('psql', ['-X', '-qAt', '-h', str(socket), '-p', '6547',
                                        '-U', 'fixture_admin', '-d', 'postgres',
                                        '-v', 'ON_ERROR_STOP=1', '-c', query])
                self.assertEqual(sql(host_adapter.ROLE_SQL), '')
                sql('CREATE ROLE travelos_backup LOGIN REPLICATION NOINHERIT CONNECTION LIMIT 2')
                self.assertTrue(json.loads(sql(host_adapter.ROLE_SQL))['config_null'])
                sql("ALTER ROLE travelos_backup SET work_mem = '4MB'")
                self.assertFalse(json.loads(sql(host_adapter.ROLE_SQL))['config_null'])
                sql('ALTER ROLE travelos_backup RESET ALL')
                self.assertTrue(json.loads(sql(host_adapter.ROLE_SQL))['config_null'])
                sql("ALTER ROLE travelos_backup IN DATABASE postgres SET work_mem = '4MB'")
                self.assertFalse(json.loads(sql(host_adapter.ROLE_SQL))['config_null'])
            finally:
                if started:
                    run('pg_ctl', ['-D', str(data), '-w', '-t', '30', '-m', 'immediate', 'stop'])


if __name__ == '__main__':
    unittest.main()
