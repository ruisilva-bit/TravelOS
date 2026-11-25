"""Scratch-only rehearsal, not a host policy installer or privilege boundary."""
import os
from pathlib import Path
import re
import subprocess
import tempfile

TEMPLATE = Path(__file__).with_name('stage10-operator.sudoers.in')


def render(operator, entry_sha256):
    if (not isinstance(operator, str) or not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', operator)
            or operator == 'root' or not isinstance(entry_sha256, str)
            or not re.fullmatch(r'[0-9a-f]{64}', entry_sha256)):
        raise ValueError('invalid operator or digest')
    return TEMPLATE.read_text().replace('@OPERATOR@', operator).replace('@ENTRY_SHA256@', entry_sha256)


def scratch_directory(directory):
    scratch = Path(os.environ['TMPDIR']).resolve(strict=True)
    resolved = directory.resolve(strict=True)
    if resolved == scratch or not resolved.is_relative_to(scratch) or not resolved.is_dir():
        raise ValueError('scratch subdirectory required')
    return resolved


def visudo_valid(policy, directory):
    directory = scratch_directory(directory)
    with tempfile.NamedTemporaryFile(mode='w', dir=directory, encoding='utf-8') as file:
        file.write(policy)
        file.flush()
        return subprocess.run(['/usr/sbin/visudo', '-cf', file.name], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, check=False).returncode == 0


def rehearse(target, policy, *, fail_after_replace=False):
    """Exercise an atomic file swap and error rollback, not crash recovery."""
    target = Path(target)
    directory = scratch_directory(target.parent)
    if target.is_symlink() or not target.is_file() or target.parent.resolve() != directory:
        raise ValueError('ordinary scratch file required')
    if not visudo_valid(policy, directory):
        raise ValueError('invalid sudoers candidate')
    old = target.read_bytes()

    def replace(data):
        name = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, delete=False) as file:
                name = file.name
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
            os.replace(name, target)
            name = None
        finally:
            if name is not None:
                os.unlink(name)

    replace(policy.encode('utf-8'))
    try:
        if fail_after_replace:
            raise RuntimeError('injected rehearsal failure')
    except Exception:
        replace(old)
        raise