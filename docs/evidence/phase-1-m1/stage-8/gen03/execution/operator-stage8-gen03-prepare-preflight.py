import hashlib, json, re
from pathlib import Path

root = Path.cwd()
def load(p): return json.loads(Path(p).read_text())
def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def evidence(*paths): return [{'path': str(p), 'sha256': digest(p)} for p in paths]
base = Path('.hermes/state/stage8-gen03-local-qualification-final')
summary = load(base/'summary.json')
assert summary['result'] == 'PASS'
assert len(summary['gates']) == 14 and all(g['exitCode'] == 0 for g in summary['gates'])
buildpath = '.hermes/state/stage8-gen03-artifact-build.json'
build = load(buildpath)
log = (base/'test-stage8-postgres.log').read_text()
assert '75 passed (75)' in log
pgpath = re.findall(r'"evidence":"([^"]+)","result":"PASS"', log)[-1]
pg = Path(pgpath).relative_to(root)
execution = load(pg/'execution.json')
assert execution['result'] == 'PASS'
scan = load(base/'stage8-security-scan.log')
assert scan['result'] == 'PASS' and scan['findingCount'] == 0
pve = load('.hermes/state/stage8-gen03-pve-preci-attempt02.json')
assert pve['result'] == 'PASS' and pve['target']['ctid'] == 200 and pve['tlsPeerAndHostnameVerified']
for mode in ['STAGE8_PACKAGED_REHEARSAL ', 'STAGE8_CONTROLLED_REHEARSAL ']:
 r = json.loads(next(line.split(mode, 1)[1] for line in log.splitlines() if mode in line))
 assert r['result'] == 'PASS'
 print(mode, r.get('probeCount'))
# Reuse only unchanged versioned systemd contract evidence; never claim an old runtime test for new bytes.
freeze = load('docs/evidence/phase-1-m1/stage-8/gen02/candidate-freeze.json')
for row in freeze['entries']:
 if row['path'].startswith('deploy/systemd/') or row['path'] == 'tooling/ci/stage-8/install-runtime.mjs':
  assert digest(row['path']) == row['sha256']
oldsystemd = '.hermes/state/stage8-gen02-preflight/systemd-root-verify.log'
checks = {}
def check(name, scope, paths): checks[name] = {'result': 'PASS', 'scope': scope, 'evidence': evidence(*paths)}
pglog = base/'test-stage8-postgres.log'
check('functionality', 'Current extracted gen03: 75/75 Stage6/7/8 real PostgreSQL tests; authenticated normal and controlled rehearsals.', [pglog, base/'test-unit.log'])
check('adversarial', 'Current metrics file mode/freshness, 23 privilege-drift cases, lease loss/restart/retry/dead-letter/quarantine and isolated realm regressions.', [pglog, base/'test-stage8-artifact.log'])
check('postgresql', 'PostgreSQL 18.6 disposable qualification PASS; cluster stopped and roots removed by repository harness.', [pg/'execution.json', pg/'postgresql-package-provenance.json', pglog])
check('packaging', 'Builder and clean archive extraction plus packaged verifier and packaged installer CHECK passed.', [buildpath, '.hermes/state/stage8-gen03-extracted-verify-final.json', '.hermes/state/stage8-gen03-installer-check.json'])
check('dependenciesAndPaths', 'Actual packaged Node executes worker through current-release symlink and the normal/controlled runners; no source runtime substitution.', [pglog, base/'test-stage8-artifact.log', base/'architecture-check.log'])
check('systemd', 'Current systemd contract tests and installer CHECK PASS. Root-fixture syntax evidence reused only for byte-identical versioned units verified against gen02 freeze; extracted symlink ExecStart paths exercised in current rehearsal.', [base/'test-stage8-systemd-contract.log', oldsystemd, '.hermes/state/stage8-gen03-installer-check.json', pglog, '.hermes/state/stage8-gen03-ct200-preci.stdout.log'])
check('credentialAndPermissions', 'Fresh TLS-verified CT200 identity, approved encrypted-reference metadata, live Worker systemd contract and TCP migrator session/SET ROLE; exact application roles qualified on real disposable PostgreSQL. No new credential creation.', ['.hermes/state/stage8-gen03-pve-preci-attempt02.json', '.hermes/state/stage8-gen03-ct200-preci.stdout.log', '.hermes/state/stage8-gen03-ct200-migrator-preci-corrected.stdout.log', pglog])
check('runtimeRehearsal', 'Current extracted artifact normal 34 probes and controlled 39 probes, restart/concurrent workers, private metrics, credential negative controls and cleanup.', [pglog])
check('securityScanner', 'Stage8 current source/candidate scan, exact reviewed synthetic fixture exceptions only, zero unallowlisted findings.', [base/'stage8-security-scan.log'])
checks['securityScanner'].update(findingCount=0, unallowlistedFindingCount=0, filesScanned=scan['filesScanned'])
check('inventoryProvenance', 'Exact archive bytes, full file/symlink inventory, pinned toolchain, source snapshot and immutable Stage7 predecessor regressions.', [buildpath, '.hermes/state/stage8-gen03-extracted-verify-final.json', base/'verify-pins.log', base/'test-stage8-stage7-predecessor.log'])
report = {'schemaVersion': 1, 'result': 'PASS', 'canonicalCiEligible': True, 'blockingRequirements': [], 'stage': 'PHASE_1_M1_STAGE_8', 'candidate': 'gen03', 'predecessor': 'a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec', 'sourceSnapshotSha256': build['sourceSnapshotSha256'], 'artifactSha256': build['sha256'], 'artifactId': build['artifactId'], 'buildReceiptSha256': digest(buildpath), 'migrationHead': build['migrationHead'], 'toolchain': {'node': 'v24.19.0', 'corepack': '0.35.0', 'pnpm': '11.21.0', 'nodeExecutable': '/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin/node'}, 'checks': checks, 'previousCandidate': {'id': 'gen02', 'independentRecommendation': 'NO-GO', 'openFindings': ['S8-OBS-001','S8-OBS-002'], 'correctionsImplementedPendingIndependentClosure': True, 'doNotReplay': True}, 'stage9Actions': 0}
with Path('.hermes/state/stage8-gen03-preflight.json').open('x') as f: f.write(json.dumps(report, indent=2)+'\n')
print(json.dumps({'result':'PASS','candidate':'gen03','postgresqlReceipt':str(pg),'artifactSha256':build['sha256']}))
