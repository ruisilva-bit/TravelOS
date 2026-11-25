"""Fixed-purpose DEVELOPMENT PostgreSQL backup-key provisioner.

Public CLI: provision/check only, fixed build-host encrypted store, trusted UID.
Rui's key-creation authorization is required operationally; no caller flag can
manufacture it. This is not hostile-same-UID isolation, host-loss recovery,
independent recipient trust, a signing oracle, or Stage10 acceptance.
Private helper destinations exist for disposable qualification only; the CLI
accepts no directory, provider, credential, purpose or command overrides.
"""
import importlib.util
import json
import os
from pathlib import Path
import pwd
import resource
import secrets
import sys


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fs = _load('backup_key_files', 'stage10-development-keystore.py')
native = _load('backup_key_tools', 'stage10-native-backup.py')
crypto = _load('backup_key_crypto', 'stage10-backup-encryption.py')
ROOT = Path('/home/hermes/.config/travelos-stage10-credentials')
TARGET = ROOT / 'backup-recovery-v1'
PINS = {
    'openssl': {'path': '/usr/bin/openssl', 'sha256': '38633817061f9d161c8b14c1ff72c9f223e8208d977a4c15d843010611a5dded'},
    'creds': {'path': '/usr/bin/systemd-creds', 'sha256': '0a4d4f4a51ed49e8fcdb32369df7375e989ba52dcfca6bb56c96585b82b26cf5'},
}
NAMES = {'recovery-key.cred': 'travelos-stage10-pg-backup-private-key',
         'recovery-password.cred': 'travelos-stage10-pg-backup-password'}
BASE = {'schemaVersion': 1, 'environment': 'DEVELOPMENT', 'purpose': 'POSTGRES_BACKUP_RECOVERY',
        'protection': 'ENCRYPTED_PEM_AND_USER_SYSTEMD_CREDS',
        'hostLossRecovery': 'NOT_QUALIFIED', 'independentRecipientTrust': 'PENDING'}


def _require(value):
    if not value:
        raise ValueError('STAGE10_BACKUP_KEY_REJECTED')


def _tools():
    descriptors = []
    try:
        for name in ('openssl', 'creds'):
            descriptors.append(native._pin_tool(PINS[name]))
        return descriptors
    except BaseException:
        for fd in descriptors: os.close(fd)
        raise


def _run(descriptor, arguments, *, data=None, inherited=()):
    environment = {'PATH': '/usr/bin:/bin', 'HOME': '/home/hermes',
                   'XDG_CONFIG_HOME': '/home/hermes/.config', 'LANG': 'C.UTF-8',
                   'OPENSSL_CONF': '/dev/null'}
    result = fs.bounded_run([f'/proc/self/fd/{descriptor}', *arguments], data=data,
        env=environment, pass_fds=(descriptor, *inherited), output_limit=1048576, timeout=60)
    _require(result.returncode == 0)
    return result.stdout


def _protect(descriptor, directory, filename, value):
    encrypted = _run(descriptor, ['--user', f'--name={NAMES[filename]}', 'encrypt', '-', '-'], data=value)
    _require(encrypted)
    fs._write_at(directory, filename, encrypted)


def _unprotect(descriptor, directory, filename):
    return _run(descriptor, ['--user', f'--name={NAMES[filename]}', 'decrypt', '-', '-'],
                data=fs._read_at(directory, filename))


def _check_at(directory, tools):
    names = set()
    with os.scandir(directory) as entries:
        for entry in entries:
            names.add(entry.name)
            _require(len(names) <= 4)
    _require(names == {'recovery-key.cred','recovery-password.cred','recipient.pem','metadata.json'})
    metadata = json.loads(fs._read_at(directory, 'metadata.json'), object_pairs_hook=_pairs)
    _require(type(metadata) is dict and set(metadata) == set(BASE) | {'recipientSha256'})
    _require(all(type(metadata[k]) is type(v) and metadata[k] == v for k,v in BASE.items()))
    cert_bytes = fs._read_at(directory, 'recipient.pem')
    _require(fs.digest(cert_bytes) == metadata['recipientSha256'])
    descriptors = []
    try:
        for value, name in ((cert_bytes,'backup-recipient'),
                            (_unprotect(tools[1], directory, 'recovery-key.cred'),'backup-encrypted-key'),
                            (_unprotect(tools[1], directory, 'recovery-password.cred'),'backup-password')):
            descriptors.append(fs._sealed(value, name))
        cert, key, password = descriptors
        encrypted, pin = crypto.encrypt(b'stage10-backup-key-readback-probe', cert, metadata['recipientSha256'])
        _require(crypto.decrypt(encrypted, cert, key, password, pin) == b'stage10-backup-key-readback-probe')
    finally:
        for fd in descriptors: os.close(fd)
    return {'state': 'ENCRYPTED_RECOVERY_KEY_READBACK_VERIFIED_NOT_COMPLETE_CUSTODY', **metadata}


def _pairs(pairs):
    value = {}
    for key, item in pairs:
        _require(key not in value)
        value[key] = item
    return value


def _provision(destination):
    """Trusted implementation; production caller is the fixed-purpose CLI only."""
    tools = _tools()
    parent = stage = password = key = name = None
    try:
        parent, stage, name, leaf = fs._begin(destination)
        password = fs._sealed(secrets.token_hex(32).encode('ascii'), 'backup-password')
        encrypted_key = _run(tools[0], ['genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:3072',
                             '-aes-256-cbc','-pass',f'fd:{password}'], inherited=(password,))
        _require(encrypted_key.startswith(b'-----BEGIN ENCRYPTED PRIVATE KEY-----\n'))
        key = fs._sealed(encrypted_key, 'backup-encrypted-key')
        os.lseek(password, 0, os.SEEK_SET)
        certificate = _run(tools[0], ['req','-new','-x509','-key',f'/proc/self/fd/{key}',
                           '-passin',f'fd:{password}','-subj','/CN=TravelOS Stage10 DEVELOPMENT Backup',
                           '-days','365'], inherited=(key,password))
        _protect(tools[1], stage, 'recovery-key.cred', encrypted_key)
        _protect(tools[1], stage, 'recovery-password.cred', os.pread(password, 1024, 0))
        fs._write_at(stage, 'recipient.pem', certificate)
        metadata = {**BASE, 'recipientSha256': fs.digest(certificate)}
        fs._write_at(stage, 'metadata.json', (json.dumps(metadata,sort_keys=True)+'\n').encode())
        _check_at(stage, tools)
        fs._publish(parent, stage, name, leaf)
        return {'state': 'ENCRYPTED_RECOVERY_KEY_PROVISIONED_NOT_COMPLETE_CUSTODY', **metadata}
    finally:
        for fd in (password,key):
            if fd is not None: os.close(fd)
        if parent is not None and stage is not None and name is not None: fs._cleanup(parent,stage,name)
        for fd in tools: os.close(fd)


def _check(destination):
    tools = _tools()
    directory = None
    try:
        directory = fs._open_directory(destination, private=True)
        return _check_at(directory, tools)
    finally:
        if directory is not None: os.close(directory)
        for fd in tools: os.close(fd)


def dispatch(arguments):
    if (arguments not in (['provision'],['check']) or os.getuid()!=1000 or os.geteuid()!=1000
            or pwd.getpwuid(os.getuid()).pw_name!='hermes'):
        print(json.dumps({'state':'REJECTED'}))
        return 1
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    try:
        if arguments == ['provision']:
            parent = fs._open_directory(ROOT.parent)
            try:
                try: os.mkdir(ROOT.name,0o700,dir_fd=parent)
                except FileExistsError: pass
            finally: os.close(parent)
            fs.private_directory(ROOT)
            result = _provision(TARGET)
        else:
            result = _check(TARGET)
        print(json.dumps(result,sort_keys=True))
        return 0
    except fs.PublicationDurabilityError:
        print(json.dumps({'state':'PUBLISHED_DURABILITY_UNCERTAIN','reference':str(TARGET)}))
        return 1
    except (OSError,ValueError,RecursionError):
        print(json.dumps({'state':'REJECTED'}))
        return 1


if __name__ == '__main__': raise SystemExit(dispatch(sys.argv[1:]))
