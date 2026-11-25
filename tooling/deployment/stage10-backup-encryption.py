"""Bounded synthetic-provider primitive; not custody, PG backup, or Stage 10 GO.

Inputs and outputs are bytes, never caller paths. Certificate, encrypted PEM key,
 and password must be immutable sealed memfds. Digest pins the exact PEM bytes.
No plaintext is returned until OpenSSL has authenticated the complete message.
"""
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import stat

_spec = importlib.util.spec_from_file_location('stage10_process_boundary', Path(__file__).with_name('stage10-process-boundary.py'))
assert _spec is not None and _spec.loader is not None
_process = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_process)

MAX_INPUT = 8 * 1024 * 1024
MAX_CERT = 64 * 1024
MAX_KEY = 64 * 1024
MAX_PASSWORD = 1024
OPENSSL = '/usr/bin/openssl'
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'HOME': '/nonexistent', 'OPENSSL_CONF': '/dev/null'}
_SEALS = fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE

class AdapterError(ValueError):
    pass

def _reject():
    raise AdapterError('STAGE10_ENCRYPTION_REJECTED') from None

def _read_sealed(fd, limit):
    try:
        if isinstance(fd, bool) or not isinstance(fd, int) or fd < 0:
            _reject()
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size < 1 or st.st_size > limit:
            _reject()
        if fcntl.fcntl(fd, fcntl.F_GET_SEALS) & _SEALS != _SEALS:
            _reject()
        value = os.pread(fd, st.st_size, 0)
        if len(value) != st.st_size:
            _reject()
        return value
    except (OSError, OverflowError):
        _reject()

def _openssl():
    try:
        st = os.stat(OPENSSL, follow_symlinks=False)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_mode & (0o022 | stat.S_ISUID | stat.S_ISGID):
            _reject()
    except OSError:
        _reject()

def _recipient(cert_fd, pin):
    cert = _read_sealed(cert_fd, MAX_CERT)
    if not isinstance(pin, str) or not re.fullmatch(r'[0-9a-f]{64}', pin):
        _reject()
    if not cert.startswith(b'-----BEGIN CERTIFICATE-----\n') or hashlib.sha256(cert).hexdigest() != pin:
        _reject()
    return pin

def _run(args, data, fds):
    _openssl()
    try:
        result = _process.bounded_run([OPENSSL, *args], data=data, output_limit=MAX_INPUT + 131072,
                                      timeout=60, env=ENV, pass_fds=tuple(fds))
        if result.returncode != 0:
            _reject()
        return result.stdout
    except (OSError, ValueError):
        _reject()

def encrypt(plaintext, cert_fd, recipient_sha256):
    """Return (DER ciphertext, pinned certificate PEM digest)."""
    if not isinstance(plaintext, bytes) or len(plaintext) > MAX_INPUT:
        _reject()
    pin = _recipient(cert_fd, recipient_sha256)
    result = _run(['cms', '-encrypt', '-binary', '-aes-256-gcm', '-outform', 'DER',
                   f'/proc/self/fd/{cert_fd}'], plaintext, (cert_fd,))
    return result, pin

def _tlv(data, pos, expected):
    if pos + 2 > len(data) or data[pos] != expected:
        _reject()
    first = data[pos + 1]
    pos += 2
    if first & 128:
        count = first & 127
        if count == 0 or count > 4 or pos + count > len(data) or data[pos] == 0:
            _reject()
        length = int.from_bytes(data[pos:pos + count], 'big')
        pos += count
        if length < 128:
            _reject()
    else:
        length = first
    if pos + length > len(data):
        _reject()
    return pos, pos + length

def _authenticated_aes256_envelope(data):
    # Only inspect DER framing/OIDs; OpenSSL performs all cryptography and
    # validates the remainder. This excludes CMS EnvelopedData (e.g. CBC).
    outer, end = _tlv(data, 0, 0x30)
    if end != len(data):
        _reject()
    p, q = _tlv(data, outer, 0x06)
    if data[p:q] != bytes.fromhex('2a864886f70d0109100117'):
        _reject()
    p, q = _tlv(data, q, 0xa0)
    if q != end:
        _reject()
    p, q2 = _tlv(data, p, 0x30)
    if q2 != q:
        _reject()
    _, p = _tlv(data, p, 0x02)  # version
    if p < q and data[p] == 0xa0:  # optional originatorInfo
        _, p = _tlv(data, p, 0xa0)
    _, p = _tlv(data, p, 0x31)  # recipientInfos
    p, info_end = _tlv(data, p, 0x30)
    typ, p = _tlv(data, p, 0x06)
    if data[typ:p] != bytes.fromhex('2a864886f70d010701'):
        _reject()
    alg, alg_end = _tlv(data, p, 0x30)
    oid, oid_end = _tlv(data, alg, 0x06)
    if alg_end > info_end or oid_end > alg_end or data[oid:oid_end] != bytes.fromhex('60864801650304012e'):
        _reject()

def decrypt(ciphertext, cert_fd, key_fd, password_fd, recipient_sha256):
    """Return authenticated plaintext bytes only; failure returns no plaintext."""
    if not isinstance(ciphertext, bytes) or not ciphertext or len(ciphertext) > MAX_INPUT + 131072:
        _reject()
    _authenticated_aes256_envelope(ciphertext)
    _recipient(cert_fd, recipient_sha256)
    key = _read_sealed(key_fd, MAX_KEY)
    password = _read_sealed(password_fd, MAX_PASSWORD)
    if not key.startswith(b'-----BEGIN ENCRYPTED PRIVATE KEY-----\n') or b'\n' in password or b'\r' in password or b'\x00' in password:
        _reject()
    os.lseek(password_fd, 0, os.SEEK_SET)
    result = _run(['cms', '-decrypt', '-binary', '-inform', 'DER', '-recip', f'/proc/self/fd/{cert_fd}',
                   '-inkey', f'/proc/self/fd/{key_fd}', '-passin', f'fd:{password_fd}'],
                  ciphertext, (cert_fd, key_fd, password_fd))
    if len(result) > MAX_INPUT:
        _reject()
    return result
