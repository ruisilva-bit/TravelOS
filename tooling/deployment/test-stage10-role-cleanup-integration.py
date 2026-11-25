"""Disposable local PG18 role-DDL serialization probe; NOT Stage10 GO.

Run: /usr/bin/python3 test-stage10-role-cleanup-integration.py PREPARED_PACKAGE_ROOT
A nonzero exit, including unsupported catalog locking, means no proof.
"""
import json
import os
from pathlib import Path
import pwd
import select
import shlex
import subprocess
import sys
import tempfile
import time


def main(package_root):
    if os.geteuid() == 0:
        raise RuntimeError('refusing to run as root')
    package = Path(package_root).resolve(strict=True)
    binary = package / 'usr/lib/postgresql/18/bin'
    user = pwd.getpwuid(os.geteuid()).pw_name
    if not user.replace('_', '').isalnum():
        raise RuntimeError('unsupported fixture OS user')
    with tempfile.TemporaryDirectory(prefix='stage10-role-lock-', dir='/home/hermes/.hermes/cache/scratch') as temp:
        root = Path(temp)
        data, sock = root / 'data', root / 's'
        sock.mkdir(mode=0o700)
        env = {'PATH': '/usr/bin:/bin', 'HOME': str(root), 'LANG': 'C',
               'LD_LIBRARY_PATH': ':'.join(str(package / p) for p in
                   ('usr/lib/x86_64-linux-gnu', 'usr/lib/postgresql/18/lib'))}
        def run(tool, args, **kwargs):
            return subprocess.run([str(binary / tool), *args], env=env, capture_output=True,
                                  text=True, timeout=60, **kwargs)
        def checked(tool, args):
            result = run(tool, args)
            if result.returncode:
                raise RuntimeError(f'{tool}: {result.stderr.strip()}')
            return result.stdout.strip()
        checked('initdb', ['-D', str(data), '-L', str(package / 'usr/share/postgresql/18'),
                           '-U', 'fixture_admin', '--auth-local=peer', '--auth-host=reject',
                           '--encoding=UTF8', '--locale=C', '--no-instructions'])
        (data / 'pg_hba.conf').write_text('local all fixture_admin peer map=fixture\n')
        (data / 'pg_ident.conf').write_text(f'fixture {user} fixture_admin\n')
        args = ['-X', '-qAt', '-h', str(sock), '-p', '6543', '-U', 'fixture_admin',
                '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
        holder = None
        try:
            checked('pg_ctl', ['-D', str(data), '-l', str(root / 'postgres.log'), '-w', '-t', '30',
                '-o', shlex.join(['-c', 'listen_addresses=', '-c', f'unix_socket_directories={sock}',
                                  '-c', 'port=6543', '-c', 'logging_collector=off']), 'start'])
            version = checked('psql', args + ['-c', 'SHOW server_version_num;'])
            if not version.startswith('18'):
                raise RuntimeError(f'expected PG18, got {version}')
            checked('psql', args + ['-c', 'CREATE ROLE stage10_lock_fixture;'])
            oid = checked('psql', args + ['-c', "SELECT oid FROM pg_roles WHERE rolname='stage10_lock_fixture';"])
            holder = subprocess.Popen([str(binary / 'psql'), *args], env=env, stdin=subprocess.PIPE,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
            if holder.stdin is None or holder.stdout is None or holder.stderr is None:
                raise RuntimeError('failed to open session pipes')
            first_check = ("BEGIN; LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE; "
                           "DO $$ BEGIN IF (SELECT oid FROM pg_roles WHERE rolname='stage10_lock_fixture') "
                           f"IS DISTINCT FROM {int(oid)}::oid THEN RAISE EXCEPTION 'identity'; "
                           "END IF; END $$; SELECT 'LOCK_ACQUIRED';\n")
            holder.stdin.write(first_check.encode())
            deadline = time.monotonic() + 10
            output = b''
            while b'LOCK_ACQUIRED\n' not in output and time.monotonic() < deadline:
                ready, _, _ = select.select([holder.stdout, holder.stderr], [], [], 0.2)
                for stream in ready:
                    chunk = os.read(stream.fileno(), 4096)
                    if stream is holder.stderr and chunk:
                        raise RuntimeError('catalog lock rejected: ' + chunk.decode(errors='replace').strip())
                    output += chunk
                if holder.poll() is not None:
                    raise RuntimeError('catalog lock session exited: ' + holder.stderr.read().decode(errors='replace').strip())
            if b'LOCK_ACQUIRED\n' not in output:
                raise RuntimeError('catalog lock acquisition timed out')
            checked_oid = checked('psql', args + ['-c', "SELECT oid FROM pg_roles WHERE rolname='stage10_lock_fixture';"])
            if oid != checked_oid:
                raise AssertionError('fixture identity changed unexpectedly')
            for ddl in ('ALTER ROLE stage10_lock_fixture NOLOGIN', 'DROP ROLE stage10_lock_fixture'):
                result = run('psql', args + ['-c', "SET lock_timeout='1200ms'; " + ddl + ';'])
                if result.returncode == 0 or 'lock timeout' not in result.stderr.lower():
                    raise AssertionError(f'competing {ddl} was not blocked: {result.stderr.strip()}')
            guard = ("DO $$ BEGIN IF (SELECT oid FROM pg_roles WHERE rolname='stage10_lock_fixture') "
                     f"IS DISTINCT FROM {int(oid)}::oid THEN RAISE EXCEPTION 'identity'; END IF; "
                     "DROP ROLE stage10_lock_fixture; END $$; COMMIT; SELECT 'DROP_COMMITTED';\n")
            holder.stdin.write(guard.encode())
            holder.stdin.close()
            holder.stdin = None
            stdout, stderr = holder.communicate(timeout=10)
            if holder.returncode or b'DROP_COMMITTED' not in stdout:
                raise RuntimeError('guarded drop failed: ' + stderr.decode(errors='replace'))
            holder = None
            checked('psql', args + ['-c', 'CREATE ROLE stage10_lock_fixture;'])
            replacement = checked('psql', args + ['-c', "SELECT oid FROM pg_roles WHERE rolname='stage10_lock_fixture';"])
            if replacement == oid:
                raise AssertionError('replacement retained old OID')
            mismatch = run('psql', args + ['-c', 'BEGIN; LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE; ' + guard.replace("SELECT 'DROP_COMMITTED';", '')])
            if mismatch.returncode == 0 or 'identity' not in mismatch.stderr:
                raise AssertionError('replacement identity mismatch was not rejected')
            preserved = checked('psql', args + ['-c', "SELECT oid FROM pg_roles WHERE rolname='stage10_lock_fixture';"])
            if preserved != replacement:
                raise AssertionError('replacement role was not preserved')
            print(json.dumps({'result': 'LOCAL_PG18_ROLE_LOCK_PASS_NOT_STAGE10_GO', 'server_version_num': version,
                              'competing_alter_blocked': True, 'competing_drop_blocked': True,
                              'replacement_preserved': True, 'tcp_listeners': False}))
        finally:
            if holder is not None:
                holder.kill()
                holder.communicate(timeout=10)
            if (data / 'postmaster.pid').exists():
                checked('pg_ctl', ['-D', str(data), '-w', '-t', '30', '-m', 'immediate', 'stop'])
            if (data / 'postmaster.pid').exists():
                raise RuntimeError('fixture cluster failed to stop')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('exact prepared PG18 package root required')
    try:
        main(sys.argv[1])
    except Exception as error:
        print('LOCAL_PG18_ROLE_LOCK_NOT_PROVEN: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
