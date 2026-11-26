"""Build a separate, exact-inventory Stage 10 test harness; never build an app.

This packages local mutable test inputs, not a signed candidate or canonical
qualification. Accepted blobs are exported only on the build host from gen11.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
PREDECESSOR = 'f65a64d9c3aabd446ca95a605faed92630a72963'
SOURCE_DIRS = ('apps', 'packages', 'tests', 'tooling', 'deploy', 'config', 'migrations')
SOURCE_FILES = ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json')
SKIP = {'.git', '.hermes', 'coverage', '__pycache__', '.vite-temp'}


def require_new_attempt(path):
    path = Path(path)
    if path.exists() or path.is_symlink():
        raise FileExistsError('STAGE10_ATTEMPT_OCCUPIED')
    path.mkdir(mode=0o700)
    return path


def contained_links(root, allowed=None):
    root = Path(root).resolve(strict=True)
    allowed = Path(allowed).resolve(strict=True) if allowed else root
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            entry = Path(directory, name)
            if entry.is_symlink():
                try:
                    target = entry.resolve(strict=True)
                except (OSError, RuntimeError) as exc:
                    raise ValueError('STAGE10_HARNESS_LINK_REJECTED') from exc
                if not target.is_relative_to(allowed) or target == allowed:
                    raise ValueError('STAGE10_HARNESS_LINK_REJECTED')


def check_dependency_tree(root):
    root = Path(root)
    if not re.search(r"^lockfileVersion: ['\"]9\.0['\"]$",
                     (root / 'pnpm-lock.yaml').read_text(), re.M):
        raise ValueError('STAGE10_LOCK_REJECTED')
    if not (root / 'node_modules/.pnpm').is_dir() and not (root / 'node_modules/lib').is_dir():
        raise ValueError('STAGE10_DEPS_MISSING')
    contained_links(root / 'node_modules', allowed=root)
    return '9.0'


def copy_harness(root, output, directories=SOURCE_DIRS):
    root, output = Path(root).resolve(strict=True), Path(output)
    check_dependency_tree(root)
    require_new_attempt(output)
    for name in SOURCE_FILES:
        source = root / name
        if source.is_file():
            shutil.copy2(source, output / name)
    for name in directories:
        source = root / name
        if source.is_dir():
            shutil.copytree(source, output / name, symlinks=True,
                            ignore=lambda _path, names: [n for n in names if n in SKIP])
    # Preserve pnpm's relative symlinks (as the delivered v9 harness did) instead
    # of dereferencing them into duplicate store copies. contained_links() below
    # rejects any dangling or escaping link, and the transport re-verifies them.
    shutil.copytree(root / 'node_modules', output / 'node_modules', symlinks=True,
                    ignore=lambda _path, names: [n for n in names if n in {'.vite-temp', '__pycache__'}])
    contained_links(output)
    check_dependency_tree(output)
    return output


def load_transport():
    spec = importlib.util.spec_from_file_location('transport', HERE / 'stage10-qualification-transport.py')
    if spec is None or spec.loader is None:
        raise ValueError('STAGE10_TRANSPORT_MISSING')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def export_accepted(root, output):
    """Export each pinned historical source byte, never remote git history."""
    root, output = Path(root), Path(output)
    text = (root / 'tooling/ci/stage-10/postgres-successor-coverage.mjs').read_text()
    # Prettier may wrap a long key/value pair onto two lines; both layouts are pins.
    pairs = re.findall(r'^  "([^\"]+)":\s*"([0-9a-f]{64})",$', text, re.M)
    if len(pairs) != 7:
        raise ValueError('STAGE10_ACCEPTED_SET_REJECTED')
    require_new_attempt(output)
    import hashlib
    for name, expected in pairs:
        source = root / name
        from_git = subprocess.run(['git', 'show', f'{PREDECESSOR}:{name}'], cwd=root,
                                  capture_output=True, timeout=30, check=True).stdout
        if source.read_bytes() != from_git or hashlib.sha256(from_git).hexdigest() != expected:
            raise ValueError('STAGE10_ACCEPTED_BYTES_REJECTED')
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(from_git)
    return output


def main():
    if len(sys.argv) != 3:
        raise ValueError('usage: stage10-qualification-package.py SOURCE NEW_ATTEMPT')
    root, attempt = Path(sys.argv[1]).resolve(strict=True), Path(sys.argv[2])
    require_new_attempt(attempt)
    harness = copy_harness(root, attempt / 'harness')
    accepted = export_accepted(root, harness / 'accepted-blobs')
    transport = load_transport()
    archive = attempt / 'harness.tar'
    receipt = transport.pack(harness, archive)
    (attempt / 'harness.receipt.json').write_text(json.dumps(receipt, sort_keys=True) + '\n')
    transport.unpack(archive, receipt, attempt / 'harness-readback')
    print(json.dumps({'archive': str(archive), 'sha256': receipt['sha256'],
                      'bytes': receipt['bytes'], 'entries': len(receipt['files']),
                      'acceptedBlobs': len(list(accepted.rglob('*.ts'))) + len(list(accepted.rglob('*.mjs'))),
                      'lockfile': '9.0', 'scope': 'TEST_HARNESS_NOT_RUNTIME'}))


if __name__ == '__main__':
    main()
