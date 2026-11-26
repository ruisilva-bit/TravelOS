"""CT200-only synthetic runner. No Stage 10 readiness or custody claim.

Transport the exact named files to a new private attempt BEFORE --run. This
script refuses missing/changed inputs, never deletes failed or unknown attempts.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import shutil

ATTEMPT_PARENT = Path('/home/hermes/.local/share/travelos-stage10-qualification')
FILES = ('harness.tar', 'harness.receipt.json', 'runtime.tar', 'runtime.receipt.json',
         'browser.tar', 'browser.receipt.json', 'artifact.tar.gz', 'receipt.json',
         'inputs.json', 'predecessor.tar.gz', 'stage10-qualification-transport.py',
         'stage10-qualification-resource.py', 'stage10-qualification-remote.py')
PREDECESSOR_SHA = '8b74c305c12eecb9339acdd777449fbdb0b3bf25c498d87a2c7d43931bb6d125'
USER_ENV = {'PATH': '/usr/bin:/bin', 'HOME': '/home/hermes', 'LANG': 'C.UTF-8',
            'XDG_RUNTIME_DIR': '/run/user/1000',
            'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/run/user/1000/bus'}


def attempt_path(text):
    if not isinstance(text, str) or not text.startswith(str(ATTEMPT_PARENT) + '/'
            ) or '..' in text or '\\' in text:
        raise ValueError('STAGE10_ATTEMPT_REJECTED')
    path = Path(text)
    if path.parent != ATTEMPT_PARENT or not re.fullmatch(r'attempt-[a-z0-9]{3,32}', path.name):
        raise ValueError('STAGE10_ATTEMPT_REJECTED')
    return path


def classify(primary, verified):
    if primary is None or not verified:
        return 'UNKNOWN_OUTCOME_PRESERVE'
    return 'PASS' if primary == 0 else 'FAIL_PRESERVE'


def unit_command(attempt):
    attempt = attempt_path(str(attempt))
    return ['/usr/bin/systemd-run', '--user', '--wait', '--pipe', '--collect',
            '--unit=travelos-s10-' + attempt.name,
            '-p', 'MemoryMax=3221225472', '-p', 'MemorySwapMax=0',
            '-p', 'TasksMax=128', '-p', 'CPUQuota=300%',
            '-p', 'RuntimeMaxSec=1800', '-p', 'LimitCORE=0',
            '/usr/bin/python3', '-B', '-I', str(attempt / 'stage10-qualification-remote.py'),
            '--child', str(attempt)]


def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def sibling(attempt, name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), attempt / (name + '.py'))
    if spec is None or spec.loader is None:
        raise ValueError('STAGE10_HELPER_REJECTED')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def checked(attempt, prepared=False, completed=False):
    attempt = attempt_path(str(attempt))
    info = attempt.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError('STAGE10_ATTEMPT_REJECTED')
    expected = set(FILES) | {'manifest.json'}
    if prepared:
        expected |= {'harness', 'runtime', 'browser'}
    if {p.name for p in attempt.iterdir()} != expected:
        raise ValueError('STAGE10_ATTEMPT_FILES_REJECTED')
    manifest_file = attempt / 'manifest.json'
    if manifest_file.is_symlink() or manifest_file.stat().st_size > 8192:
        raise ValueError('STAGE10_MANIFEST_REJECTED')
    manifest = json.loads(manifest_file.read_bytes())
    if set(manifest) != set(FILES) or any(not isinstance(x, str) or not re.fullmatch('[0-9a-f]{64}', x) for x in manifest.values()):
        raise ValueError('STAGE10_MANIFEST_REJECTED')
    for name in FILES:
        file = attempt / name
        if file.is_symlink() or not file.is_file() or sha(file) != manifest[name]:
            raise ValueError('STAGE10_FILE_REJECTED')
    if manifest['predecessor.tar.gz'] != PREDECESSOR_SHA:
        raise ValueError('STAGE10_PREDECESSOR_REJECTED')
    transport = sibling(attempt, 'stage10-qualification-transport')
    for prefix in ('harness', 'runtime', 'browser'):
        receipt = json.loads((attempt / (prefix + '.receipt.json')).read_bytes())
        transport.verify(attempt / (prefix + '.tar'), receipt)
    return transport, manifest


def prepare(attempt):
    transport, manifest = checked(attempt)
    # Fresh leaves only. A failed extraction is preserved; never replay in place.
    for prefix in ('harness', 'runtime'):
        transport.unpack(attempt / (prefix + '.tar'),
                         json.loads((attempt / (prefix + '.receipt.json')).read_bytes()),
                         attempt / prefix)
    (attempt / 'browser').mkdir(mode=0o700)
    transport.unpack(attempt / 'browser.tar',
                     json.loads((attempt / 'browser.receipt.json').read_bytes()),
                     attempt / 'browser/chromium_headless_shell-1234')
    return manifest


def child(attempt):
    attempt = attempt_path(str(attempt))
    # Before ANY subprocess, verify exact inputs and effective child cgroup.
    transport, manifest = checked(attempt, prepared=True)
    for prefix in ('harness', 'runtime', 'browser'):
        receipt = json.loads((attempt / (prefix + '.receipt.json')).read_bytes())
        tree = attempt / prefix
        if prefix == 'browser':
            tree = tree / 'chromium_headless_shell-1234'
        if transport.inventory(tree) != receipt['files']:
            raise ValueError('STAGE10_EXTRACTED_DRIFT')
    resource = sibling(attempt, 'stage10-qualification-resource').inspect_child()
    harness = attempt / 'harness'
    runtime = attempt / 'runtime'
    node = runtime / 'runtime/node/bin/node'
    if not node.is_file() or node.is_symlink():
        raise ValueError('STAGE10_RUNTIME_MISSING')
    (harness / '.hermes/state').mkdir(parents=True, exist_ok=True)
    scratch = attempt / 'scratch'
    scratch.mkdir(mode=0o700)
    receipt_dir = harness / '.hermes/state' / 'ct200-run'
    env = {'PATH': f'{node.parent}:/usr/lib/postgresql/18/bin:/usr/bin:/bin',
           'HOME': str(attempt), 'TMPDIR': str(scratch), 'LANG': 'C.UTF-8',
           'TRAVELOS_STAGE10_ACCEPTED_BLOBS': str(harness / 'accepted-blobs'),
           'TRAVELOS_STAGE10_NATIVE_PG_BIN': '/usr/lib/postgresql/18/bin',
           'TRAVELOS_STAGE10_EXTRACTED_ROOT': str(runtime),
           'TRAVELOS_STAGE10_ARCHIVE': str(attempt / 'artifact.tar.gz'),
           'TRAVELOS_STAGE10_RECEIPT': str(attempt / 'receipt.json'),
           'TRAVELOS_STAGE10_INPUTS': str(attempt / 'inputs.json'),
           'TRAVELOS_STAGE10_PREDECESSOR_ARCHIVE': str(attempt / 'predecessor.tar.gz'),
           'TRAVELOS_STAGE10_RECEIPT_SHA256': manifest['receipt.json'],
           'TRAVELOS_STAGE10_INPUTS_SHA256': manifest['inputs.json'],
           'TRAVELOS_STAGE10_NODE_SHA256': sha(node),
           'TRAVELOS_STAGE10_EVIDENCE_DIR': str(receipt_dir),
           'PLAYWRIGHT_BROWSERS_PATH': str(attempt / 'browser')}
    command = [str(node), str(harness / 'tooling/database/run-stage-10-postgres-disposable.mjs')]
    try:
        result = subprocess.run(command, cwd=harness, env=env, capture_output=True, timeout=1740,
                                check=False)
        primary = result.returncode
        for name, data in (('stdout.log', result.stdout), ('stderr.log', result.stderr)):
            with (attempt / name).open('xb') as output:
                output.write(data)
    except subprocess.TimeoutExpired:
        primary = None
    execution = receipt_dir / 'execution.json'
    cleanup = None
    verified = execution.is_file() and not execution.is_symlink()
    if verified:
        execution_report = json.loads(execution.read_bytes())
        cleanup = execution_report.get('cleanup', {})
        verified = (execution_report.get('stage') == 'PHASE_1_M1_STAGE_10' and
                    execution_report.get('result') in ('PASS', 'FAIL') and
                    cleanup.get('clusterStopped') is True and
                    cleanup.get('disposableRootsAbsent') is True)
        passed = (verified and execution_report['result'] == 'PASS' and
                  execution_report.get('testExitCode') == 0 and
                  len(execution_report.get('assertionResults') or []) == 95)
    else:
        passed = False
    status = classify(primary, verified)
    if status == 'PASS' and not passed:
        status = 'UNKNOWN_OUTCOME_PRESERVE'
    report = {'result': status, 'primaryExit': primary, 'executionSha256': sha(execution) if verified else None,
              'resource': resource, 'scope': 'CT200_DIAGNOSTIC_NOT_CANONICAL',
              'cleanup': cleanup if verified else None}
    with (attempt / 'remote-outcome.json').open('x') as output:
        output.write(json.dumps(report, sort_keys=True) + '\n')
    print(json.dumps(report, sort_keys=True))
    return 0 if status == 'PASS' else primary if primary and primary > 0 else 1


def run(attempt):
    prepare(attempt)
    result = subprocess.run(unit_command(attempt), cwd=attempt, capture_output=True,
                            env=USER_ENV,
                            timeout=1830, check=False)
    # Preserve even failed unit output, but do not overwrite an unknown attempt.
    for name, data in (('unit-stdout.log', result.stdout), ('unit-stderr.log', result.stderr)):
        with (attempt / name).open('xb') as output:
            output.write(data)
    # systemd-run's exit alone is NOT a test result. Child receipt/readback wins.
    outcome = attempt / 'remote-outcome.json'
    if not outcome.is_file():
        return 'UNKNOWN_OUTCOME_PRESERVE'
    report = json.loads(outcome.read_bytes())
    if result.returncode or report.get('result') != 'PASS':
        return 'FAIL_PRESERVE' if report.get('primaryExit') is not None else 'UNKNOWN_OUTCOME_PRESERVE'
    completed(attempt)
    return 'PASS'

def exit_status(attempt, result):
    if result == 'PASS':
        return 0
    if result == 'FAIL_PRESERVE':
        report = json.loads((attempt / 'remote-outcome.json').read_bytes())
        primary = report.get('primaryExit')
        if type(primary) is int and 0 < primary < 256:
            return primary
    return 1


def completed(attempt):
    """Verify the exact post-run receipt without running, retrying or deleting."""
    transport, manifest = checked_completed_inputs(attempt)
    attempt = attempt_path(str(attempt))
    expected = set(FILES) | {'manifest.json', 'harness', 'runtime', 'browser',
                             'scratch', 'stdout.log', 'stderr.log', 'remote-outcome.json',
                             'unit-stdout.log', 'unit-stderr.log'}
    if {p.name for p in attempt.iterdir()} != expected:
        raise ValueError('STAGE10_COMPLETED_FILES_REJECTED')
    for prefix in ('harness', 'runtime', 'browser'):
        receipt = json.loads((attempt / (prefix + '.receipt.json')).read_bytes())
        tree = attempt / prefix
        if prefix == 'browser':
            tree = tree / 'chromium_headless_shell-1234'
        if prefix == 'harness':
            # The only allowed changes in the source harness are its receipts.
            rows = transport.inventory(tree)
            baseline = receipt['files']
            rows = [row for row in rows if row['path'] != '.hermes' and
                    not row['path'].startswith('.hermes/')]
            if rows != baseline:
                raise ValueError('STAGE10_HARNESS_DRIFT')
        elif transport.inventory(tree) != receipt['files']:
            raise ValueError('STAGE10_EXTRACTED_DRIFT')
    outcome = attempt / 'remote-outcome.json'
    if outcome.is_symlink() or outcome.stat().st_size > 8192:
        raise ValueError('STAGE10_OUTCOME_REJECTED')
    report = json.loads(outcome.read_bytes())
    execution = attempt / 'harness/.hermes/state/ct200-run/execution.json'
    if execution.is_symlink() or not execution.is_file() or sha(execution) != report.get('executionSha256'):
        raise ValueError('STAGE10_EXECUTION_REJECTED')
    detail = json.loads(execution.read_bytes())
    cleanup = detail.get('cleanup', {})
    if (report.get('result') != 'PASS' or report.get('primaryExit') != 0 or
        detail.get('result') != 'PASS' or detail.get('testExitCode') != 0 or
        cleanup.get('clusterStopped') is not True or
        cleanup.get('disposableRootsAbsent') is not True or
        report.get('cleanup') != cleanup or
        len(detail.get('assertionResults') or []) != 95 or
        any(row.get('status') != 'passed' for row in detail['assertionResults']) or
        detail.get('assertionCoverage', {}).get('expectedTests') != 95):
        raise ValueError('STAGE10_COMPLETED_NOT_PASS')
    # Runtime is independently requalified by the actual runner; the receipt
    # remains a diagnostic, never a canonical readiness/custody assertion.
    return {'result': 'PASS', 'scope': 'DIAGNOSTIC_NOT_CANONICAL',
            'executionSha256': sha(execution), 'inputManifestSha256': sha(attempt / 'manifest.json'),
            'logs': {name: sha(attempt / name) for name in
                     ('stdout.log', 'stderr.log', 'unit-stdout.log', 'unit-stderr.log')},
            'assertions': 95, 'primaryExit': 0, 'cleanup': cleanup}

def checked_completed_inputs(attempt):
    """Verify immutable inputs even though the child added result files."""
    attempt = attempt_path(str(attempt))
    info = attempt.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError('STAGE10_ATTEMPT_REJECTED')
    manifest_file = attempt / 'manifest.json'
    if manifest_file.is_symlink() or manifest_file.stat().st_size > 8192:
        raise ValueError('STAGE10_MANIFEST_REJECTED')
    manifest = json.loads(manifest_file.read_bytes())
    if set(manifest) != set(FILES) or any(not re.fullmatch('[0-9a-f]{64}', value) for value in manifest.values()):
        raise ValueError('STAGE10_MANIFEST_REJECTED')
    if manifest['predecessor.tar.gz'] != PREDECESSOR_SHA:
        raise ValueError('STAGE10_PREDECESSOR_REJECTED')
    for name in FILES:
        file = attempt / name
        if file.is_symlink() or not file.is_file() or sha(file) != manifest[name]:
            raise ValueError('STAGE10_FILE_REJECTED')
    transport = sibling(attempt, 'stage10-qualification-transport')
    for prefix in ('harness', 'runtime', 'browser'):
        receipt = json.loads((attempt / (prefix + '.receipt.json')).read_bytes())
        transport.verify(attempt / (prefix + '.tar'), receipt)
    return transport, manifest

def cleanup(attempt, receipt_sha256):
    """Only remove a PASS attempt after the operator retained its receipt."""
    attempt = attempt_path(str(attempt))
    if not re.fullmatch('[0-9a-f]{64}', receipt_sha256):
        raise ValueError('STAGE10_EXTERNAL_RECEIPT_REQUIRED')
    result = completed(attempt)
    if result['executionSha256'] != receipt_sha256:
        raise ValueError('STAGE10_EXTERNAL_RECEIPT_MISMATCH')
    unit = 'travelos-s10-' + attempt.name + '.service'
    status = subprocess.run(['/usr/bin/systemctl', '--user', 'show', unit,
                             '--property=LoadState', '--property=ActiveState'],
                            capture_output=True, timeout=10,
                            env=USER_ENV)
    if status.returncode or set(status.stdout.decode('ascii').splitlines()) != {
            'LoadState=not-found', 'ActiveState=inactive'} or status.stderr:
        raise ValueError('STAGE10_UNIT_NOT_CONFIRMED_STOPPED')
    shutil.rmtree(attempt)
    if attempt.exists() or attempt.is_symlink():
        raise ValueError('STAGE10_CLEANUP_UNCERTAIN')
    return {'result': 'PASS_ATTEMPT_REMOVED', 'executionSha256': receipt_sha256,
            'scope': result['scope']}


if __name__ == '__main__':
    try:
        if (len(sys.argv) not in (3, 4) or sys.argv[1] not in
                ('--run', '--child', '--completed', '--cleanup') or
                (sys.argv[1] == '--cleanup') != (len(sys.argv) == 4)):
            raise ValueError('STAGE10_COMMAND_REJECTED')
        attempt = attempt_path(sys.argv[2])
        if sys.argv[1] == '--child':
            sys.exit(child(attempt))
        if sys.argv[1] == '--completed':
            print(json.dumps(completed(attempt), sort_keys=True))
        elif sys.argv[1] == '--cleanup':
            print(json.dumps(cleanup(attempt, sys.argv[3]), sort_keys=True))
        else:
            result = run(attempt)
            print(json.dumps({'result': result, 'attempt': attempt.name}))
            sys.exit(exit_status(attempt, result))
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError,
            subprocess.TimeoutExpired):
        print(json.dumps({'result': 'UNKNOWN_OUTCOME_PRESERVE'}))
        sys.exit(1)
