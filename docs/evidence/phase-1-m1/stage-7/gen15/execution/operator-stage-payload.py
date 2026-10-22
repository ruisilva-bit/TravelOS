import hashlib
import json
from pathlib import Path
import shlex
import subprocess

ROOT = Path.cwd()
STATE = ROOT / '.hermes/state'
COMMIT = '5609bcb44edb9baa2d10ff43e7e69c356de6ca35'
GENERATION = 'gen15'
RELEASE_NAME = 'travelos-stage7-gen15-5609bcb4'
RELEASE = '/opt/travelos/releases/' + RELEASE_NAME

def run(args, timeout=300):
    process = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    if process.returncode != 0:
        raise RuntimeError('Operation failed: ' + args[0] + '\n' + process.stderr[:3000])
    return process.stdout.strip()

def remote(args, timeout=300):
    return run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'travelos-dev', shlex.join(args)], timeout)

def save(name, value):
    (STATE / name).write_text(json.dumps(value, indent=2) + '\n')

ci_path = ROOT / 'docs/evidence/phase-1-m1/stage-7/gen15/canonical-ci-execution.json'
ci_bytes = ci_path.read_bytes()
ci = json.loads(ci_bytes)
build = json.loads((STATE / 'stage7-gen15-artifact-build.json').read_text())
backup = json.loads((STATE / 'stage7-gen15-ct200-predeploy.json').read_text())
backup_permissions = json.loads((STATE / 'stage7-gen15-ct200-backup-permissions.json').read_text())
assert ci['result'] == 'PASS' and ci['ciConsumed'] == 'YES' and ci['invocationCount'] == 1
assert ci['candidateCommit'] == COMMIT and ci['completedGateCount'] == ci['expectedGateCount'] == len(ci['gates']) == 42
assert all(gate['result'] == 'PASS' and gate['exitCode'] == 0 for gate in ci['gates'])
assert ci['stage8Actions'] == 0
assert backup['result'] == 'PASS' and backup['generation'] == GENERATION
assert backup['restoreProbe']['dropped'] and backup['restoreProbe']['absenceVerified']
assert backup_permissions['finalMode'] == '600' and backup_permissions['contentUnchanged']
archive = ROOT / build['archivePath']
assert hashlib.sha256(archive.read_bytes()).hexdigest() == build['artifactSha256'] == ci['artifactSha256']
metadata = (ROOT / build['artifactRoot'] / 'release.json').read_bytes()
assert hashlib.sha256(metadata).hexdigest() == build['releaseMetadataSha256']
ci_sha = hashlib.sha256(ci_bytes).hexdigest()
remote_home = remote(['python3', '-c', 'from pathlib import Path; print(Path.home())'])
assert remote_home.startswith('/') and '\n' not in remote_home
transport_archive = remote_home + '/' + RELEASE_NAME + '.tar.gz'
transport_ci = remote_home + '/' + RELEASE_NAME + '-ci.json'
for target in [transport_archive, transport_ci, RELEASE]:
    remote(['test', '!', '-e', target])
run(['scp', '-q', str(archive), 'travelos-dev:' + transport_archive])
run(['scp', '-q', str(ci_path), 'travelos-dev:' + transport_ci])
remote_hashes = remote(['sha256sum', transport_archive, transport_ci]).splitlines()
assert len(remote_hashes) == 2
assert remote_hashes[0].split()[0] == ci['artifactSha256']
assert remote_hashes[1].split()[0] == ci_sha
save('stage7-gen15-ct200-transport.json', {'result':'PASS', 'archivePath':transport_archive, 'ciReceiptPath':transport_ci, 'archiveSha256':ci['artifactSha256'], 'ciReceiptSha256':ci_sha, 'stage8Actions':0})
assert remote(['travelos-agentctl', 'prepare-release', RELEASE_NAME]) == RELEASE
remote(['tar', '--no-same-owner', '-xzf', transport_archive, '-C', RELEASE])
expected_tree = run(['git', 'rev-parse', COMMIT + '^{tree}'])
verifier_command = [RELEASE + '/runtime/node/bin/node', RELEASE + '/deployment/verify-stage7-artifact.mjs', '--artifact-root=' + RELEASE, '--release-root=/opt/travelos/releases', '--generation=gen15', '--archive=' + transport_archive, '--expected-commit=' + COMMIT, '--expected-tree=' + expected_tree]
verified = json.loads(remote(verifier_command, 480))
assert verified['result'] == 'PASS' and verified['generation'] == GENERATION
assert verified['artifactId'] == build['artifactId'] and verified['artifactSha256'] == ci['artifactSha256']
assert verified['sensitiveDataScan']['result'] == 'PASS'
save('stage7-gen15-ct200-artifact-verify.json', verified)
shape_code = 'import pathlib,json; r=pathlib.Path(' + repr(RELEASE) + '); paths=["apps/admin-api/dist/main.js","apps/portal-api/dist/main.js","apps/worker/dist/main.js","migrator/run-stage6-migrations.mjs","migrator/migrations/0013_stage7_runtime_acceptance_cleanup.cjs","admin-web/index.html","portal-web/index.html"]; assert all((r/p).is_file() for p in paths); print(json.dumps({"result":"PASS","installedUnitPathsPresent":paths}))'
shape = json.loads(remote(['python3', '-c', shape_code]))
save('stage7-gen15-ct200-unit-layout.json', shape)
assert remote(['travelos-agentctl', 'seal-release', RELEASE_NAME]) == RELEASE
assert remote(['stat', '-c', '%U:%G:%a', RELEASE]) == 'root:root:755'
installer_options = ['--artifact-root=' + RELEASE, '--generation=gen15', '--release-sha256=' + build['releaseMetadataSha256'], '--ci-receipt=' + transport_ci, '--ci-sha256=' + ci_sha]
installer_command = [RELEASE + '/runtime/node/bin/node', RELEASE + '/operator/install-operator-unit.mjs'] + installer_options
check = json.loads(remote(installer_command, 480))
assert check['result'] == 'PASS' and check['installed'] is False and check['started'] is False and check['enabled'] is False
assert check['ciReceiptSha256'] == ci_sha and check['releaseMetadataSha256'] == build['releaseMetadataSha256']
save('stage7-gen15-ct200-installer-check.json', check)
assert remote(['travelos-agentctl', 'current-release']) == '/opt/travelos/releases/travelos-stage7-gen09-0cf07d04'
save('stage7-gen15-ct200-staging.json', {'result':'PASS','generation':GENERATION,'releaseRoot':RELEASE,'archiveSha256':ci['artifactSha256'],'ciReceiptSha256':ci_sha,'sealedOwner':'root:root:755','artifactVerification':'PASS','installedServiceLayout':'PASS','packagedInstallerCheck':'PASS','activeReleaseStillGen09':True,'migrationApplied':False,'activated':False,'stage8Actions':0})
print(json.dumps(json.loads((STATE / 'stage7-gen15-ct200-staging.json').read_text()), indent=2))
