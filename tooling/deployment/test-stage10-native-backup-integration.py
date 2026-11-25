"""Explicit local synthetic PG18 fixture; no root, TCP, CT200 or real payloads.
Usage: /usr/bin/python3 this-file.py <checksum-prepared-PG-package-root>
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import pwd
import shlex
import subprocess
import sys
import tarfile
import tempfile


def main(package_root):
    if sys.flags.optimize:
        raise RuntimeError('integration assertions must not be disabled')
    package = Path(package_root).resolve(strict=True)
    binary = package / 'usr/lib/postgresql/18/bin'
    libraries = (str(package / 'usr/lib/x86_64-linux-gnu'), str(package / 'usr/lib/postgresql/18/lib'))
    spec = importlib.util.spec_from_file_location('native_backup', Path(__file__).with_name('stage10-native-backup.py'))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    user = pwd.getpwuid(os.geteuid()).pw_name
    assert module.IDENTIFIER.fullmatch(user) and os.geteuid() != 0
    with tempfile.TemporaryDirectory(prefix='stage10-pg-fixture-', dir='/home/hermes/.hermes/cache/scratch') as temporary:
        root = Path(temporary)
        data, socket, staging = root / 'data', root / 's', root / 'private'
        socket.mkdir(mode=0o700)
        staging.mkdir(mode=0o700)
        environment = {'PATH': '/usr/bin:/bin', 'HOME': str(root), 'LANG': 'C.UTF-8',
                       'LD_LIBRARY_PATH': ':'.join(libraries)}
        def run(name, arguments):
            result = subprocess.run([str(binary / name), *arguments], env=environment,
                                    capture_output=True, timeout=60)
            if result.returncode:
                raise RuntimeError('FIXTURE_' + name.upper() + '_FAILED')
            return result.stdout
        run('initdb', ['-D', str(data), '-L', str(package / 'usr/share/postgresql/18'),
                       '-U', 'stage10_fixture_admin', '--auth-local=peer', '--auth-host=reject',
                       '--encoding=UTF8', '--locale=C.UTF-8', '--no-instructions'])
        # Isolated fixture map only: same OS actor, distinct database principals.
        # This proves native protocol behavior, NOT real OS-principal separation.
        (data / 'pg_hba.conf').write_text(
            'local all stage10_fixture_admin peer map=fixture_admin\n'
            f'local postgres {user} peer\nlocal replication {user} peer\n')
        (data / 'pg_ident.conf').write_text(f'fixture_admin {user} stage10_fixture_admin\n')
        started = False
        try:
            started = True
            run('pg_ctl', ['-D', str(data), '-l', str(root / 'postgres.log'), '-w', '-t', '30',
                           '-o', shlex.join(['-c', 'listen_addresses=', '-c', f'unix_socket_directories={socket}',
                                           '-c', 'port=6543', '-c', 'wal_level=replica',
                                           '-c', 'max_wal_senders=2', '-c', 'logging_collector=off']), 'start'])
            run('psql', ['-X', '-q', '-h', str(socket), '-p', '6543', '-U', 'stage10_fixture_admin',
                         '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
                         f'CREATE ROLE {user} LOGIN REPLICATION; CREATE TABLE stage10_backup_fixture(id integer PRIMARY KEY); INSERT INTO stage10_backup_fixture VALUES (1);'])
            plan = {'schemaVersion': 1, 'environment': 'DEVELOPMENT',
                    'socketDirectory': str(socket), 'port': 6543, 'osUser': user, 'replicationRole': user,
                    'authentication': {'method': 'peer', 'osUser': user, 'databaseRole': user},
                    'role': {'login': True, 'replication': True, 'superuser': False,
                             'createdb': False, 'createrole': False, 'bypassrls': False},
                    'hba': {'connectionType': 'local', 'database': 'replication', 'user': user, 'method': 'peer'}}
            tools = {name: {'path': str(binary / name), 'sha256': hashlib.sha256((binary / name).read_bytes()).hexdigest()}
                     for name in ('psql', 'pg_basebackup')}
            parity_sql = "SELECT json_build_object('fixtureRows',(SELECT count(*) FROM stage10_backup_fixture),'roles',(SELECT count(*) FROM pg_roles),'databases',(SELECT count(*) FROM pg_database));"
            source_parity = json.loads(run('psql', ['-X', '-qAt', '-h', str(socket), '-p', '6543',
                '-U', 'stage10_fixture_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', parity_sql]))
            result = module.native_backup_tar(plan, tools, staging, library_directories=libraries)
            assert result['result'] == 'NATIVE_WAL_TAR_CREATED_NOT_MANIFEST_VERIFIED'
            with tarfile.open(fileobj=io.BytesIO(result['archive']), mode='r:') as archive:
                names = archive.getnames()
                assert 'backup_manifest' in names and 'backup_label' in names
                assert any(name.startswith('pg_wal/') and len(Path(name).name) == 24 for name in names)
            verify_tools = {name: {'path': str(binary / name), 'sha256': hashlib.sha256((binary / name).read_bytes()).hexdigest()}
                            for name in ('pg_verifybackup', 'pg_waldump')}
            verification = module.verify_native_tar(result['archive'], verify_tools, staging, library_directories=libraries)
            assert verification['nativeManifestVerified'] and verification['walParsed']
            with tarfile.open(fileobj=io.BytesIO(result['archive']), mode='r:') as archive:
                member = archive.getmember('global/pg_control')
                position = member.offset_data
            tampered = bytearray(result['archive'])
            tampered[position] ^= 1
            try:
                module.verify_native_tar(bytes(tampered), verify_tools, staging, library_directories=libraries)
            except ValueError:
                pass
            else:
                raise AssertionError('native checksum verification accepted tampered pg_control')
            crypto_spec = importlib.util.spec_from_file_location('crypto_fixture', Path(__file__).with_name('test-stage10-backup-encryption.py'))
            assert crypto_spec and crypto_spec.loader
            crypto_fixture = importlib.util.module_from_spec(crypto_spec)
            crypto_spec.loader.exec_module(crypto_fixture)
            crypto_fixture.EncryptionTest.fds = []
            try:
                import gzip
                cert, key, password, pin = crypto_fixture.EncryptionTest.identity()
                compressed = gzip.compress(result['archive'], mtime=0)
                ciphertext, _ = crypto_fixture.adapter.encrypt(compressed, cert, pin)
                clear = crypto_fixture.adapter.decrypt(ciphertext, cert, key, password, pin)
                with gzip.GzipFile(fileobj=io.BytesIO(clear)) as decoded:
                    recovered = decoded.read(module.MAX_BACKUP + 1)
                assert recovered == result['archive']
                store_spec = importlib.util.spec_from_file_location('managed_store', Path(__file__).with_name('stage10-backup-store.py'))
                assert store_spec and store_spec.loader
                store = importlib.util.module_from_spec(store_spec)
                store_spec.loader.exec_module(store)
                managed = root / 'managed'
                managed.mkdir(mode=0o700)
                store.initialize_store(managed)
                backup_id = 'stage10-' + 'f' * 32
                import time
                created = int(time.time())
                published = store.publish_backup(managed, backup_id, ciphertext, recipient_sha256=pin, created_at=created)
                stored = (managed / backup_id / 'backup.cms').read_bytes()
                assert stored == ciphertext and published['state'] == 'PUBLISHED'
                assert crypto_fixture.adapter.decrypt(stored, cert, key, password, pin) == compressed
                assert store.expiry.expire_backup(managed, backup_id, now=created + store.expiry.WEEK - 1)['state'] == 'NOT_DUE'
                assert store.expiry.expire_backup(managed, backup_id, now=created + store.expiry.WEEK)['state'] == 'EXPIRED'
                assert set(p.name for p in managed.iterdir()) == {'manager.json'}
                encrypted_bytes = len(ciphertext)
            finally:
                crypto_fixture.EncryptionTest.tearDownClass()
            # Materialize only the identical bytes already accepted by the strict
            # native verifier (no links/traversal/duplicate files, bounded size).
            # Python's data filter is an additional guard, not that verification.
            clone, recovery_socket = root / 'clone', root / 'r'
            clone.mkdir(mode=0o700)
            recovery_socket.mkdir(mode=0o700)
            with tarfile.open(fileobj=io.BytesIO(recovered), mode='r:') as archive:
                archive.extractall(path=clone, filter='data')
            clone.chmod(0o700)
            assert not (clone / 'standby.signal').exists()
            assert not (clone / 'recovery.signal').exists()
            (clone / 'postgresql.auto.conf').unlink(missing_ok=True)
            (clone / 'pg_hba.conf').write_text('local postgres stage10_fixture_admin peer map=fixture_recovery\n')
            (clone / 'pg_ident.conf').write_text(f'fixture_recovery {user} stage10_fixture_admin\n')
            configuration = clone / 'probe.conf'
            configuration.write_text(
                "listen_addresses = ''\nssl = off\narchive_mode = off\narchive_command = ''\n"
                "restore_command = ''\narchive_cleanup_command = ''\nrecovery_end_command = ''\n"
                "primary_conninfo = ''\nprimary_slot_name = ''\nshared_preload_libraries = ''\n"
                "session_preload_libraries = ''\nlocal_preload_libraries = ''\njit = off\n"
                "logging_collector = off\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\n")
            try:
                run('pg_ctl', ['-D', str(clone), '-l', str(root / 'recovery.log'), '-w', '-t', '30',
                    '-o', shlex.join(['-c', f'config_file={configuration}', '-c', f'data_directory={clone}',
                                     '-c', f'hba_file={clone / "pg_hba.conf"}', '-c', f'ident_file={clone / "pg_ident.conf"}',
                                     '-c', f'unix_socket_directories={recovery_socket}', '-c', 'port=6544']), 'start'])
                restored_parity = json.loads(run('psql', ['-X', '-qAt', '-h', str(recovery_socket), '-p', '6544',
                    '-U', 'stage10_fixture_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', parity_sql]))
                assert source_parity == restored_parity
                clone_settings = json.loads(run('psql', ['-X', '-qAt', '-h', str(recovery_socket), '-p', '6544',
                    '-U', 'stage10_fixture_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
                    "SELECT json_build_object('listenAddresses',current_setting('listen_addresses'),'inRecovery',pg_is_in_recovery(),'archiveMode',current_setting('archive_mode'));"]))
                assert clone_settings == {'listenAddresses': '', 'inRecovery': False, 'archiveMode': 'off'}
            finally:
                if (clone / 'postmaster.pid').exists():
                    run('pg_ctl', ['-D', str(clone), '-w', '-t', '30', '-m', 'immediate', 'stop'])
                assert not (clone / 'postmaster.pid').exists()
            assert not list(staging.iterdir())
            print(json.dumps({'result': 'REAL_LOCAL_NATIVE_PG_BACKUP_PASS_NOT_STAGE10_GO',
                              'bytes': result['bytes'], 'sha256': result['sha256'],
                              'peerAuthenticatedRole': user, 'superuser': False,
                              'tcpListeners': False, 'manifestIncluded': True,
                              'walIncluded': True, 'nativeManifestVerified': verification['nativeManifestVerified'],
                              'walParsed': verification['walParsed'], 'tamperedControlRejected': True,
                              'encryption': 'EPHEMERAL_AES256GCM_ROUNDTRIP_PASS',
                              'ciphertextBytes': encrypted_bytes, 'definitiveKeysProvisioned': False,
                              'restoredCloneStarted': True, 'sourceParity': source_parity,
                              'restoredParity': restored_parity, 'recoverySettings': clone_settings,
                              'recoveryCloneStopped': True, 'managedEncryptedStoreReadback': True,
                              'virtualSevenDayExpiryVerified': True, 'liveTargetActions': 0}))
        finally:
            if started:
                run('pg_ctl', ['-D', str(data), '-w', '-t', '30', '-m', 'immediate', 'stop'])
            assert not (data / 'postmaster.pid').exists()


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('exact prepared package root required')
    main(sys.argv[1])
