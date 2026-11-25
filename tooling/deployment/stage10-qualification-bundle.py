"""Assemble separate, byte-inventoried CT200 inputs from a local package rehearsal.

No build, claim, remote transfer, execution or attempt overwrite occurs here.
The runtime package must already have passed its own extracted-artifact check.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys

HERE = Path(__file__).resolve().parent
BROWSER = Path('/home/hermes/.cache/ms-playwright/chromium_headless_shell-1234')
PREDECESSOR = Path('.hermes/state/stage9-gen11-artifact.tar.gz')
PIN = '8b74c305c12eecb9339acdd777449fbdb0b3bf25c498d87a2c7d43931bb6d125'


def sha(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    if spec is None or spec.loader is None:
        raise ValueError('STAGE10_BUNDLE_HELPER_REJECTED')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assemble(source, destination, runtime_package, harness_package):
    source, destination = Path(source).resolve(strict=True), Path(destination)
    runtime_package, harness_package = Path(runtime_package).resolve(strict=True), Path(harness_package).resolve(strict=True)
    remote, transport = load('stage10-qualification-remote'), load('stage10-qualification-transport')
    outcome = json.loads((runtime_package / 'outcome.json').read_bytes())
    inputs = json.loads((runtime_package / 'inputs.json').read_bytes())
    receipt = json.loads((runtime_package / 'receipt.json').read_bytes())
    checks = json.loads((runtime_package / 'package-checks.json').read_bytes())
    if (outcome.get('result') != 'PASS' or
        checks.get('result') != 'PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED' or
        outcome.get('inputDigest') != inputs.get('inputDigest') or
        receipt.get('archiveSha256') != sha(runtime_package / 'artifact.tar.gz') or
        checks.get('archiveSha256') != receipt['archiveSha256'] or
        checks.get('inputDigest') != inputs['inputDigest'] or
        not (runtime_package / 'extracted/runtime/node/bin/node').is_file()):
        raise ValueError('STAGE10_RUNTIME_NOT_SEPARATELY_VERIFIED')
    if sha(source / PREDECESSOR) != PIN:
        raise ValueError('STAGE10_PREDECESSOR_REJECTED')
    if not re.fullmatch('[0-9a-f]{64}', sha(harness_package / 'harness.tar')):
        raise ValueError('STAGE10_HARNESS_REJECTED')
    transport.verify(harness_package / 'harness.tar',
                     json.loads((harness_package / 'harness.receipt.json').read_bytes()))
    if not BROWSER.is_dir():
        raise ValueError('STAGE10_BROWSER_MISSING')
    if destination.exists() or destination.is_symlink():
        raise FileExistsError('STAGE10_BUNDLE_OCCUPIED')
    destination.mkdir(mode=0o700)
    files = {'harness.tar': harness_package / 'harness.tar',
             'harness.receipt.json': harness_package / 'harness.receipt.json',
             'artifact.tar.gz': runtime_package / 'artifact.tar.gz',
             'receipt.json': runtime_package / 'receipt.json',
             'inputs.json': runtime_package / 'inputs.json',
             'predecessor.tar.gz': source / PREDECESSOR}
    for name in ('stage10-qualification-transport', 'stage10-qualification-resource',
                 'stage10-qualification-remote'):
        files[name + '.py'] = HERE / (name + '.py')
    for name, path in files.items():
        shutil.copyfile(path, destination / name)
        (destination / name).chmod(0o600)
    for prefix, tree in (('runtime', runtime_package / 'extracted'), ('browser', BROWSER)):
        packed = transport.pack(tree, destination / (prefix + '.tar'))
        (destination / (prefix + '.receipt.json')).write_text(json.dumps(packed, sort_keys=True) + '\n')
    manifest = {name: sha(destination / name) for name in remote.FILES}
    (destination / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True) + '\n')
    # The remote attempt path is different; local verification checks content.
    for prefix in ('harness', 'runtime', 'browser'):
        transport.verify(destination / (prefix + '.tar'),
                         json.loads((destination / (prefix + '.receipt.json')).read_bytes()))
    if set(manifest) != set(remote.FILES) or manifest['predecessor.tar.gz'] != PIN:
        raise ValueError('STAGE10_BUNDLE_INCOMPLETE')
    return {'scope': 'DIAGNOSTIC_INPUTS_NOT_CURRENT_RUNTIME_ASSERTION',
            'directory': str(destination), 'inputDigest': inputs['inputDigest'],
            'manifestSha256': sha(destination / 'manifest.json'),
            'archives': {name: {'sha256': manifest[name], 'bytes': (destination / name).stat().st_size,
                                'entries': len(json.loads((destination / name.replace('.tar', '.receipt.json')).read_bytes())['files'])}
                         for name in ('harness.tar', 'runtime.tar', 'browser.tar')},
            'runtimePackage': str(runtime_package)}


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise SystemExit('usage: stage10-qualification-bundle.py SOURCE NEW_ATTEMPT RUNTIME_PACKAGE HARNESS_PACKAGE')
    print(json.dumps(assemble(*sys.argv[1:]), sort_keys=True))
