"""Trusted build-host receiver for a transport-authenticated CT200 producer.

No transport or identity authentication is implemented here. The caller MUST pin
SSH host and command, confirm successful producer exit, and supply the locally
approved source and recipient values, not values read from the remote stream.
This module neither initializes the fixed store nor performs retention/deletion.
DER framing is not proof of recipient, provenance, or authenticated decryption.
"""
import hashlib
import importlib.util
import os
from pathlib import Path
import secrets
import select
import stat
import time


def _load():
    spec = importlib.util.spec_from_file_location('receiver_store', Path(__file__).with_name('stage10-backup-store.py'))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


store = _load()
DESTINATION = Path('/home/hermes/.local/share/travelos-stage10-backups')
SOURCE = 'CT200-DEVELOPMENT-DATABASE'
RECIPIENT = 'b7e09a9f4165c4798d33aa171e2a3d1b5fab0789d6c51f8bf88717db4240cd92'
MAX_CIPHERTEXT = store.expiry.MAX_CIPHERTEXT


def read_ciphertext(fd, *, timeout=120):
    """Read only ciphertext from a pipe, with absolute deadline and hard cap.

    EOF alone does not prove producer success; the transport caller must check
    exit status independently before invoking publish_received.
    """
    if type(fd) is not int or fd < 0 or type(timeout) not in (int, float) or not 0 < timeout <= 120:
        raise ValueError('STAGE10_RECEIVER_REJECTED')
    # Require an exclusively consumed pipe: regular files or devices can make
    # readiness unrelated to bounded transport progress. The caller owns fd and
    # must not read it concurrently.
    try:
        if not stat.S_ISFIFO(os.fstat(fd).st_mode):
            raise ValueError('STAGE10_RECEIVER_REJECTED')
    except OSError:
        raise ValueError('STAGE10_RECEIVER_REJECTED') from None
    deadline = time.monotonic() + timeout
    chunks = bytearray()
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ValueError('STAGE10_RECEIVER_TIMEOUT')
        ready, _, _ = select.select([fd], [], [], remaining)
        if not ready:
            raise ValueError('STAGE10_RECEIVER_TIMEOUT')
        block = os.read(fd, min(65536, MAX_CIPHERTEXT + 1 - len(chunks)))
        if not block:
            break
        chunks.extend(block)
        if len(chunks) > MAX_CIPHERTEXT:
            raise ValueError('STAGE10_RECEIVER_REJECTED')
    if not chunks:
        raise ValueError('STAGE10_RECEIVER_REJECTED')
    return bytes(chunks)


def publish_received(ciphertext, *, approved_source, approved_recipient, producer_exit_code):
    """Publish after caller independently verifies SSH identity and exit status.

    Only local trusted callers may invoke this API. The producer sends bytes,
    never metadata or pins. StoreUncertain propagates for manual reconciliation;
    callers must not blindly retry. No filesystem root is accepted from callers.
    """
    if (approved_source != SOURCE or approved_recipient != RECIPIENT
            or type(producer_exit_code) is not int or producer_exit_code != 0
            or type(ciphertext) is not bytes or not 0 < len(ciphertext) <= MAX_CIPHERTEXT):
        raise ValueError('STAGE10_RECEIVER_REJECTED')
    backup_id = 'stage10-' + secrets.token_hex(16)
    result = store.publish_backup(DESTINATION, backup_id, ciphertext,
                                  recipient_sha256=RECIPIENT, created_at=int(time.time()))
    return {'state': result['state'], 'backupId': backup_id,
            'ciphertextBytes': len(ciphertext), 'ciphertextSha256': hashlib.sha256(ciphertext).hexdigest()}
