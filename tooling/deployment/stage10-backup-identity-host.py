#!/usr/bin/python3 -I
"""Fixed CT200 root adapter. Source only: installation is a separate reviewed act.

Trust: isolated base-OS Python/stdlib, root, postgres daemon and system libraries.
Not trusted: invoking UID, environment, producer files, existing partial state.
No private recovery key, plaintext disk snapshot, arbitrary SQL/path or sudo grant.
"""
import fcntl
import grp
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import resource
import stat
import sys
import time

INSTALL = '/usr/local/lib/travelos/stage10-identity'
STATE = '/var/lib/travelos/stage10-backup-identity'
HBA = '/etc/postgresql/18/main/pg_hba.conf'
CERT = '/etc/travelos/stage10-backup-recipient.pem'
RECIPIENT = 'b7e09a9f4165c4798d33aa171e2a3d1b5fab0789d6c51f8bf88717db4240cd92'
NAME = 'travelos_backup'
MAX_HBA = 65536
TOOLS = {
    'psql': ('/usr/lib/postgresql/18/bin/psql', '651b44cd205e8c25e7fc6a1079e949188a7acb2d9119db1c8c4479c08b7b0d3c'),
    'openssl': ('/usr/bin/openssl', '4f1d1aecdb983292ea19ef6d9b65e5e6693c0b66715c1704eebe36e21edc18e1'),
    'useradd': ('/usr/sbin/useradd', '3fd1735eb46d2cc6067c509b11c7e7bf1e9dca2ea53f0947bf4f3b1fa93b4225'),
    'userdel': ('/usr/sbin/userdel', '453acfe8d99b41df6af93e0379070c8c859683190b150b4b00c9259166e5c4cb'),
}
ENV = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C', 'LC_ALL': 'C',
       'OPENSSL_CONF': '/dev/null', 'PGCONNECT_TIMEOUT': '5',
       'PGOPTIONS': '-c statement_timeout=5000 -c lock_timeout=2000',
       'PGAPPNAME': 'travelos-stage10-identity'}
ROLE_SQL = """SELECT row_to_json(x) FROM (SELECT oid::bigint AS oid,
 rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolreplication,rolcanlogin,
 rolinherit,rolconnlimit,rolpassword IS NULL AS password_null,
 rolvaliduntil IS NULL AS validity_null,
 NOT EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole=r.oid) AS config_null,
 (SELECT count(*) FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS memberships
 FROM pg_authid r WHERE rolname='travelos_backup') x;"""
ROLE_ATTRS = {'rolsuper': False, 'rolcreatedb': False, 'rolcreaterole': False,
              'rolbypassrls': False, 'rolreplication': True, 'rolcanlogin': True,
              'rolinherit': False, 'rolconnlimit': 2, 'password_null': True,
              'validity_null': True, 'config_null': True, 'memberships': 0}
CLUSTER_SQL = """SELECT json_build_object('data',current_setting('data_directory'),
 'hba',current_setting('hba_file'),'ident',current_setting('ident_file'),
 'port',current_setting('port'),'version',current_setting('server_version_num'),
 'primary',NOT pg_is_in_recovery());"""


def reject():
    raise ValueError('STAGE10_BACKUP_IDENTITY_REJECTED')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def directory(path, owner=0, private=False, daemon=False):
    """No symlinks or hostile ancestor writers, including the root ancestor."""
    if not path.startswith('/') or any(x in ('.', '..', '') for x in path.split('/')[1:]):
        reject()
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.split('/')[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            info = os.fstat(fd)
            if info.st_uid not in ((0, 102) if daemon else (owner,)) or info.st_mode & 0o022:
                reject()
        if private and stat.S_IMODE(os.fstat(fd).st_mode) != 0o700:
            reject()
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_shadow_pwd(name):
    parent = directory('/etc', daemon=True)
    try:
        fd = os.open('shadow', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > 1048576:
                reject()
            content = os.read(fd, 1048577).decode('utf-8', errors='replace')
            for line in content.splitlines():
                parts = line.split(':')
                if parts and parts[0] == name:
                    return parts[1] if len(parts) > 1 else ''
            return None
        finally:
            os.close(fd)
    finally:
        os.close(parent)


def read_regular(parent, name, owner, mode, limit):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or before.st_uid != owner or (mode is not None and stat.S_IMODE(before.st_mode) != mode)
                or before.st_mode & 0o022 or not 0 < before.st_size <= limit):
            reject()
        data = os.read(fd, limit + 1)
        after = os.fstat(fd)
        # Reading may update atime. Compare identity and mutation-sensitive metadata
        # explicitly, including nanoseconds (stat_result equality loses precision).
        fields = ('st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_uid', 'st_gid',
                  'st_size', 'st_mtime_ns', 'st_ctime_ns')
        if len(data) != before.st_size or any(getattr(before, key) != getattr(after, key) for key in fields):
            reject()
        return data, before
    finally:
        os.close(fd)


def dependencies(base, *, fixture=False):
    """All local import sources checked before the first local module executes.

    fixture is Python-only test harness capability; never parsed by CLI.
    """
    names = ('stage10-backup-identity.py', 'stage10-native-backup.py', 'stage10-process-boundary.py')
    owner = os.geteuid() if fixture else 0
    fd = directory(str(base), owner)
    try:
        for name in ('stage10-backup-identity-host.py', *names):
            read_regular(fd, name, owner, None, 131072)
        modules = []
        for name in names[:2]:
            spec = importlib.util.spec_from_file_location(name.replace('-', '_'), str(Path(base) / name))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            modules.append(module)
        return tuple(modules)
    finally:
        os.close(fd)


def sealed(data):
    fd = os.memfd_create('stage10-identity-public', os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
    try:
        view = memoryview(data)
        while view:
            n = os.write(fd, view)
            if n <= 0:
                reject()
            view = view[n:]
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW |
                    fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL)
        os.lseek(fd, 0, os.SEEK_SET)
        return fd
    except BaseException:
        os.close(fd)
        raise


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            reject()
        result[key] = value
    return result


class Host:
    """No request configuration. Alternate layout is private test construction only."""
    def __init__(self, engine, native):
        self.engine, self.native = engine, native
        self.owner = 0
        self.hba_path, self.cert_path = HBA, CERT
        self.recipient = RECIPIENT
        self.state = directory(STATE, private=True)
        self.tools = {}
        self.meta = {}
        self.events = []
        self.original = None
        self.user = None
        self.oid = None
        try:
            fcntl.flock(self.state, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for name, (path, pin) in TOOLS.items():
                self.tools[name] = native._pin_tool({'path': path, 'sha256': pin})
            self._socket()
            self._cluster()
        except BaseException:
            self.close()
            raise

    def close(self):
        for fd in self.tools.values():
            os.close(fd)
        self.tools.clear()
        if self.state is not None:
            os.close(self.state)
            self.state = None

    def _uncertain(self):
        raise self.engine.PublicationUncertain()

    def _socket(self):
        fd = directory('/run')
        try:
            target = os.open('postgresql', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                info = os.fstat(target)
                if (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (102, 106, 0o2775):
                    reject()
                sock = os.stat('.s.PGSQL.5432', dir_fd=target, follow_symlinks=False)
                if not stat.S_ISSOCK(sock.st_mode) or (sock.st_uid, sock.st_gid) != (102, 106):
                    reject()
            finally:
                os.close(target)
        finally:
            os.close(fd)
        # This is a daemon-owned directory, NOT a producer directory. No group join.
        var = directory('/var')
        try:
            if os.readlink('run', dir_fd=var) != '/run':
                reject()
        finally:
            os.close(var)

    def _run(self, name, args, *, data=None, identity=None, mutation=False):
        options = {}
        if identity is not None:
            options = {'user': identity[0], 'group': identity[1], 'extra_groups': []}
        try:
            result = self.native._process.bounded_run(
                [f'/proc/self/fd/{self.tools[name]}', *args], data=data,
                output_limit=131072, timeout=20, env=ENV, cwd='/',
                pass_fds=(self.tools[name],), **options)
            if result.returncode:
                if mutation:
                    self._uncertain()
                reject()
            return result.stdout
        except (OSError, ValueError):
            if mutation:
                self._uncertain()
            raise

    def _sql(self, sql, *, identity=(102, 106), replication=False, mutation=False):
        # Call sites are fixed SQL only; this is not a public query API.
        self._socket()
        username = 'postgres' if identity == (102, 106) else NAME
        database = 'replication=true dbname=replication' if replication else 'postgres'
        return self._run('psql', ['-X', '-w', '-q', '-A', '-t', '--host=/run/postgresql',
                         '--port=5432', '--username=' + username, '--dbname=' + database,
                         '--set=ON_ERROR_STOP=1', '--command=' + sql],
                         identity=identity, mutation=mutation).strip()

    def _cluster(self):
        value = json.loads(self._sql(CLUSTER_SQL), object_pairs_hook=pairs)
        if value != {'data': '/var/lib/postgresql/18/main', 'hba': HBA,
                     'ident': '/etc/postgresql/18/main/pg_ident.conf', 'port': '5432',
                     'version': '180006', 'primary': True}:
            reject()

    def _hba(self):
        parent = directory(str(Path(self.hba_path).parent), daemon=True)
        try:
            data, info = read_regular(parent, Path(self.hba_path).name, 102, 0o640, MAX_HBA)
            if info.st_gid != 106:
                reject()
            return data, info
        finally:
            os.close(parent)

    def read_hba(self):
        data, _ = self._hba()
        text = data.decode('utf-8')
        if text.encode('utf-8') != data or '\x00' in text:
            reject()
        if self.events and self.events[-1]['event'] == 'complete':
            if digest(data) != self.meta['bound_hba_sha256']:
                reject()
        return text

    def _record(self, event):
        if len(self.events) >= 24:
            self._uncertain()
        value = {'version': 1, 'sequence': len(self.events), 'event': event,
                 'metadata': dict(self.meta)}
        raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
        self._exclusive(f'{len(self.events):03d}.json', raw)
        self.events.append(value)

    def _exclusive(self, name, data):
        """Fixed known staging; a crash leaves a rejecting partial, never overwritten."""
        staged = '.pending'
        fd = None
        try:
            fd = os.open(staged, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=self.state)
            view = memoryview(data)
            while view:
                n = os.write(fd, view)
                if n <= 0:
                    reject()
                view = view[n:]
            os.fsync(fd)
            os.close(fd)
            fd = None
            # link is atomic no-overwrite; rename could replace another attempt.
            os.link(staged, name, src_dir_fd=self.state, dst_dir_fd=self.state, follow_symlinks=False)
            os.fsync(self.state)
            os.unlink(staged, dir_fd=self.state)
            os.fsync(self.state)
        except (OSError, ValueError):
            self._uncertain()
        finally:
            if fd is not None:
                os.close(fd)

    def read_journal(self):
        names = os.listdir(self.state)
        if not names:
            return None
        journals = sorted(x for x in names if re.fullmatch(r'[0-9]{3}\.json', x))
        if not journals or len(journals) > 24 or set(names) != {'snapshot.cms', *journals}:
            reject()
        events = []
        allowed = {'snapshot', 'started', 'user_intent', 'user_created', 'role_intent',
                   'role_created', 'hba_intent', 'hba_published', 'reload_intent', 'reloaded',
                   'complete', 'restore_intent', 'hba_restored', 'drop_role_intent',
                   'role_deleted', 'delete_user_intent', 'user_deleted', 'rolled_back',
                   'reconciliation_required'}
        prior = {}
        for index, name in enumerate(journals):
            if name != f'{index:03d}.json':
                reject()
            raw, _ = read_regular(self.state, name, self.owner, 0o600, 8192)
            value = json.loads(raw, object_pairs_hook=pairs)
            if (set(value) != {'version', 'sequence', 'event', 'metadata'}
                    or type(value['version']) is not int or value['version'] != 1
                    or type(value['sequence']) is not int or value['sequence'] != index
                    or value['event'] not in allowed or type(value['metadata']) is not dict):
                reject()
            meta = value['metadata']
            if any(k not in meta or meta[k] != v for k, v in prior.items()):
                reject()
            prior = meta
            events.append(value)
        meta = events[-1]['metadata']
        required = {'recipient', 'original_hba_sha256', 'bound_hba_sha256', 'cipher_sha256',
                    'hba_uid', 'hba_gid', 'hba_mode', 'hba_bytes'}
        if not required <= set(meta) or set(meta) - required - {'uid', 'gid', 'oid'}:
            reject()
        for key in ('original_hba_sha256', 'bound_hba_sha256', 'cipher_sha256'):
            if type(meta[key]) is not str or not re.fullmatch('[a-f0-9]{64}', meta[key]):
                reject()
        if (meta['recipient'] != self.recipient or meta['hba_uid'] != 102
                or meta['hba_gid'] != 106 or meta['hba_mode'] != 0o640
                or type(meta['hba_bytes']) is not int or not 0 < meta['hba_bytes'] <= MAX_HBA):
            reject()
        cipher, _ = read_regular(self.state, 'snapshot.cms', self.owner, 0o600, MAX_HBA + 65536)
        if digest(cipher) != meta['cipher_sha256']:
            reject()
        if events[-1]['event'] == 'complete':
            expected = ['snapshot', 'started', 'user_intent', 'user_created', 'role_intent',
                        'role_created', 'hba_intent', 'hba_published', 'reload_intent', 'reloaded', 'complete']
            if [e['event'] for e in events] != expected or not {'uid', 'gid', 'oid'} <= set(meta):
                reject()
            if any(type(meta[k]) is not int or meta[k] <= 0 for k in ('uid', 'gid', 'oid')):
                reject()
        self.events, self.meta = events, dict(meta)
        self.user = (meta['uid'], meta['gid']) if 'uid' in meta and 'gid' in meta else None
        self.oid = meta.get('oid')
        return events[-1]['event']

    def encrypt_snapshot(self, original):
        if os.listdir(self.state):
            reject()
        data, info = self._hba()
        if data != original.encode('utf-8'):
            reject()
        parent = directory(str(Path(self.cert_path).parent))
        try:
            cert, _ = read_regular(parent, Path(self.cert_path).name, self.owner, None, 65536)
        finally:
            os.close(parent)
        if digest(cert) != self.recipient or not cert.startswith(b'-----BEGIN CERTIFICATE-----\n'):
            reject()
        fd = sealed(cert)
        try:
            # Pinned executable, bounded input/output, maintained authenticated CMS.
            result = self.native._process.bounded_run(
                [f'/proc/self/fd/{self.tools["openssl"]}', 'cms', '-encrypt', '-binary',
                 '-aes-256-gcm', '-outform', 'DER', f'/proc/self/fd/{fd}'], data=data,
                output_limit=MAX_HBA + 65536, timeout=20, env=ENV, cwd='/',
                pass_fds=(self.tools['openssl'], fd))
            if result.returncode or not result.stdout:
                reject()
        finally:
            os.close(fd)
        self.original = data
        self.meta = {'recipient': self.recipient, 'original_hba_sha256': digest(data),
                     'bound_hba_sha256': digest(self.engine.RULES.encode() + data),
                     'cipher_sha256': digest(result.stdout), 'hba_uid': info.st_uid,
                     'hba_gid': info.st_gid, 'hba_mode': stat.S_IMODE(info.st_mode),
                     'hba_bytes': len(data)}
        self._exclusive('snapshot.cms', result.stdout)
        self._record('snapshot')

    def write_journal(self, event):
        if event not in ('started', 'complete', 'rolled_back', 'reconciliation_required'):
            reject()
        if event == 'complete' and (not self.verify_role(NAME) or not self.verify_peer(NAME, NAME)):
            reject()
        self._record(event)

    def _unix(self):
        try:
            entry = pwd.getpwnam(NAME)
        except KeyError:
            return None
        shadow_pwd = read_shadow_pwd(NAME)
        if (entry.pw_uid == 0 or entry.pw_gid == 106 or entry.pw_dir != '/nonexistent'
                or entry.pw_shell != '/usr/sbin/nologin' or shadow_pwd is None or not shadow_pwd.startswith(('!', '*'))
                or grp.getgrgid(entry.pw_gid).gr_name != NAME
                or os.getgrouplist(NAME, entry.pw_gid) != [entry.pw_gid]):
            reject()
        return (entry.pw_uid, entry.pw_gid)

    def user_exists(self, name):
        if name != NAME:
            reject()
        value = self._unix()
        if value is not None and self.user is not None and value != self.user:
            reject()
        return value is not None

    def _role(self):
        raw = self._sql(ROLE_SQL)
        return json.loads(raw, object_pairs_hook=pairs) if raw else None

    def role_exists(self, name):
        if name != NAME:
            reject()
        value = self._role()
        if value is not None and self.oid is not None and value.get('oid') != self.oid:
            reject()
        return value is not None

    def create_user(self, name):
        if name != NAME or self._unix() is not None:
            reject()
        try:
            grp.getgrnam(NAME)
        except KeyError:
            pass
        else:
            reject()
        self._record('user_intent')
        self._run('useradd', ['--system', '--user-group', '--no-create-home',
                             '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin',
                             '--password', '!', NAME], mutation=True)
        try:
            self.user = self._unix()
            if self.user is None:
                self._uncertain()
            self.meta.update(uid=self.user[0], gid=self.user[1])
            self._record('user_created')
        except (OSError, ValueError, KeyError):
            self._uncertain()

    def create_role(self, name):
        if name != NAME or self._role() is not None:
            reject()
        self._record('role_intent')
        self._sql('CREATE ROLE travelos_backup LOGIN REPLICATION NOSUPERUSER NOCREATEDB '
                  'NOCREATEROLE NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2 PASSWORD NULL;', mutation=True)
        try:
            value = self._role()
            if value is None or type(value.get('oid')) is not int:
                self._uncertain()
            self.oid = value['oid']
            self.meta['oid'] = self.oid
            self._record('role_created')
        except (OSError, ValueError):
            self._uncertain()

    def verify_role(self, name):
        value = self._role()
        expected = dict(ROLE_ATTRS, oid=self.oid)
        return name == NAME and self.oid is not None and value == expected and all(
            type(value[k]) is type(v) for k, v in expected.items())

    def verify_peer(self, user, role):
        if (user, role) != (NAME, NAME) or self.user is None or self._unix() != self.user:
            return False
        raw = self._sql(self.native.PREFLIGHT_SQL, identity=self.user)
        self.native.validate_live_identity(json.loads(raw, object_pairs_hook=pairs), NAME)
        replication = self._sql('IDENTIFY_SYSTEM;', identity=self.user, replication=True)
        return bool(re.fullmatch(rb'[0-9]+\|[0-9]+\|[0-9A-F]+/[0-9A-F]+\|', replication))

    def _publish(self, data, restoring):
        if self.original is None:
            reject()
        expected = self.original if not restoring else self.engine.RULES.encode() + self.original
        current, info = self._hba()
        if current != expected:
            self._uncertain()
        parent = directory(str(Path(self.hba_path).parent), daemon=True)
        name = Path(self.hba_path).name
        staged = '.travelos-stage10-hba.pending'
        fd = None
        self._record('restore_intent' if restoring else 'hba_intent')
        try:
            fd = os.open(staged, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=parent)
            os.fchown(fd, 102, 106)
            os.fchmod(fd, 0o640)
            view = memoryview(data)
            while view:
                n = os.write(fd, view)
                if n <= 0:
                    reject()
                view = view[n:]
            os.fsync(fd)
            os.close(fd)
            fd = None
            # PG daemon/root are trusted; revalidate inode and bytes before rename.
            latest, observed = self._hba()
            if latest != expected or (observed.st_dev, observed.st_ino) != (info.st_dev, info.st_ino):
                self._uncertain()
            os.replace(staged, name, src_dir_fd=parent, dst_dir_fd=parent)
            os.fsync(parent)
            if self._hba()[0] != data:
                self._uncertain()
            self._record('hba_restored' if restoring else 'hba_published')
        except (OSError, ValueError):
            self._uncertain()
        finally:
            if fd is not None:
                os.close(fd)
            os.close(parent)

    def publish_hba(self, text):
        data = text.encode('utf-8')
        if self.original is None or data != self.engine.RULES.encode() + self.original:
            reject()
        self._publish(data, False)

    def restore_hba(self, text):
        if self.original is None or text.encode('utf-8') != self.original:
            reject()
        self._publish(self.original, True)

    def reload_hba(self):
        self._record('reload_intent')
        if self._sql('SELECT pg_reload_conf();', mutation=True) != b't':
            self._uncertain()
        # Catalog parser proves syntactic validity; fresh peer below proves loading.
        if self._sql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;') != b'0':
            reject()
        self._record('reloaded')

    def delete_role(self, name):
        if name != NAME or self.oid is None or not self.verify_role(NAME):
            self._uncertain()
        self._record('drop_role_intent')
        # Hold the catalog lock through OID verification and name-resolved DROP.
        # Real PG18 two-session fixture proves competing ALTER/DROP block.
        sql = ("BEGIN; LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE; "
               "DO $$ BEGIN IF (SELECT oid FROM pg_roles WHERE rolname='travelos_backup') "
               "IS DISTINCT FROM " + str(int(self.oid)) + "::oid THEN RAISE EXCEPTION 'identity'; "
               "END IF; DROP ROLE travelos_backup; END $$; COMMIT;")
        self._sql(sql, mutation=True)
        if self._role() is not None:
            self._uncertain()
        self._record('role_deleted')

    def delete_user(self, name):
        # userdel resolves a name, not the recorded UID. Even a matching pre-check
        # cannot prevent concurrent trusted account replacement before deletion.
        # Preserve the locked account for identity-reviewed reconciliation instead.
        self._uncertain()


def main():
    host = None
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.umask(0o077)
        if (sys.argv[1:] not in (['provision'], ['check']) or os.geteuid() != 0
                or not sys.flags.isolated or str(Path(__file__)) != INSTALL + '/stage10-backup-identity-host.py'):
            reject()
        engine, native = dependencies(INSTALL)
        host = Host(engine, native)
        result = engine.provision(host) if sys.argv[1] == 'provision' else engine.check(host)
        print(json.dumps(result, sort_keys=True))
        return 0 if result['state'] in ('PROVISIONED', 'VERIFIED') else 1
    except (OSError, ValueError, KeyError, RuntimeError):
        print('{"state":"REJECTED"}')
        return 1
    finally:
        if host is not None:
            host.close()


if __name__ == '__main__':
    sys.exit(main())
