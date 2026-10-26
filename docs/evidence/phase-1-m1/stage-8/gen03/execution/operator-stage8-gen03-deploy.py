import hashlib, json, subprocess
from pathlib import Path

base = Path('.hermes/state/stage8-gen03-ct200')
receipt = json.loads(Path('.hermes/state/stage8-gen03-canonical-ci-receipt.json').read_text())
assert receipt['result'] == 'PASS' and receipt['invocationCount'] == 1
archive = Path('.hermes/state/stage8-gen03-artifact.tar.gz')
assert hashlib.sha256(archive.read_bytes()).hexdigest() == receipt['artifactSha256']
assert json.loads((base/'backup-restore.json').read_text())['result']=='PASS'
release = receipt['artifactId']; target='/opt/travelos/releases/'+release
transport = '/home/hermes/'+release+'.tar.gz'

def ssh(script,label):
 p=subprocess.run(['ssh','-o','BatchMode=yes','travelos-dev','bash','-s'],input='set -euo pipefail\n'+script,text=True,capture_output=True)
 (base/(label+'.stdout.log')).write_text(p.stdout)
 (base/(label+'.stderr.log')).write_text(p.stderr)
 (base/(label+'.receipt.json')).write_text(json.dumps({'exitCode':p.returncode,'stdoutSha256':hashlib.sha256(p.stdout.encode()).hexdigest(),'stderrSha256':hashlib.sha256(p.stderr.encode()).hexdigest()},indent=2)+'\n')
 assert p.returncode==0, label+' failed; logs preserved'
 return p.stdout

ssh('/usr/local/bin/travelos-agentctl prepare-release '+release,'prepare-release')
p=subprocess.run(['scp','-q',str(archive),'travelos-dev:'+transport],capture_output=True)
assert p.returncode==0, 'transfer failed'
output=ssh(f"""
[ "$(sha256sum '{transport}' | cut -d' ' -f1)" = '{receipt['artifactSha256']}' ]
tar --extract --gzip --file='{transport}' --directory='{target}' --no-same-owner
'{target}/runtime/node/bin/node' '{target}/deployment/verify-artifact.mjs' --artifact-root='{target}'
/usr/local/bin/travelos-agentctl seal-release '{release}'
'{target}/runtime/node/bin/node' '{target}/deployment/verify-artifact.mjs' --artifact-root='{target}'
'{target}/runtime/node/bin/node' '{target}/deployment/install-runtime.mjs' --check
cmp '{target}/deployment/worker-stage8.conf' /etc/systemd/system/travelos-worker.service.d/stage8.conf
cmp '{target}/deployment/travelos-stage8-runtime-acceptance.service' /etc/systemd/system/travelos-stage8-runtime-acceptance.service
cmp '{target}/deployment/travelos-stage8-controlled-acceptance.service' /etc/systemd/system/travelos-stage8-controlled-acceptance.service
stat -c '%U:%G %a' '{target}'
""",'stage-seal-verify')
reports=[json.loads(l) for l in output.splitlines() if l.startswith('{')]
assert all(r['result']=='PASS' for r in reports) and len(reports)==3
# Append-only chain already at 0014; the exact packaged canonical runner must prove no-op.
ssh(f"/usr/local/bin/travelos-agentctl migrator '{target}/runtime/node/bin/node' '{target}/migrator/run-stage6-migrations.mjs' up",'canonical-migration-noop')
output=ssh(f"""
/usr/local/bin/travelos-agentctl activate-release '{release}'
/usr/local/bin/travelos-agentctl restart-runtime
/usr/local/bin/travelos-agentctl current-release
/usr/local/bin/travelos-agentctl runtime-status
/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/deployment/verify-artifact.mjs --artifact-root=/opt/travelos/current
for unit in travelos-admin-api.service travelos-portal-api.service travelos-worker.service; do
 pid=$(systemctl show "$unit" -p MainPID --value)
 [ "$(sudo -n readlink -f /proc/$pid/exe)" = '{target}/runtime/node/bin/node' ]
done
rm -- '{transport}'
[ ! -e '{transport}' ]
""",'activate-runtime')
assert output.count('\nactive\n') >= 1 and target in output
report={'result':'PASS','release':target,'artifactSha256':receipt['artifactSha256'],'migrationHead':'0014_stage8_worker_activity','targetCompiled':False,'transportRemoved':True,'runtimeExecutableMatchesArtifact':True,'versionedUnitsByteIdentical':True,'stage9Actions':0}
(base/'deployment.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
