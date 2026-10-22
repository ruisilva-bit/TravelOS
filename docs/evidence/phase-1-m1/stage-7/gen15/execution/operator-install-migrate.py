import hashlib
import json
from pathlib import Path
import shlex
import subprocess

ROOT = Path.cwd()
STATE = ROOT / '.hermes/state'
RELEASE = '/opt/travelos/releases/travelos-stage7-gen15-5609bcb4'

def remote(args, timeout=300):
    p = subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','travelos-dev',shlex.join(args)],text=True,capture_output=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError('Approved operation failed: ' + args[0] + '\n' + p.stderr[:3000])
    return p.stdout

def save(name, value):
    data = value if isinstance(value, str) else json.dumps(value, indent=2) + '\n'
    path = STATE / name
    if path.exists():
        assert path.read_text() == data, 'Divergent existing operation evidence: ' + name
    else:
        path.write_text(data)

staged = json.loads((STATE / 'stage7-gen15-ct200-staging.json').read_text())
check = json.loads((STATE / 'stage7-gen15-ct200-installer-check.json').read_text())
transport = json.loads((STATE / 'stage7-gen15-ct200-transport.json').read_text())
prestate = json.loads(Path('/home/hermes/.hermes/cache/scratch/stage7-gen15-ct200-prestate.json').read_text())
assert staged['result'] == 'PASS' and staged['activeReleaseStillGen09']
assert staged['ciReceiptSha256'] == transport['ciReceiptSha256'] == check['ciReceiptSha256']
assert remote(['travelos-agentctl','current-release']).strip() == prestate['activeRelease']
command = ['sudo','-n',RELEASE+'/runtime/node/bin/node',RELEASE+'/operator/install-operator-unit.mjs','--artifact-root='+RELEASE,'--generation=gen15','--release-sha256='+check['releaseMetadataSha256'],'--ci-receipt='+transport['ciReceiptPath'],'--ci-sha256='+transport['ciReceiptSha256'],'--install']
installed = json.loads(remote(command,480))
assert installed['result'] == 'PASS' and installed['installed'] and not installed['enabled'] and not installed['started']
assert installed['unitSha256'] == check['unitSha256']
save('stage7-gen15-ct200-installer-install.json', installed)
code = 'import pathlib,hashlib,json,stat; p=pathlib.Path("/etc/systemd/system/travelos-stage7-runtime-acceptance.service"); s=p.lstat(); old=pathlib.Path('+repr(prestate['oldOperatorUnit']['resolvedPath'])+'); helper=pathlib.Path("/usr/local/libexec/travelos-stage7-operatorctl"); assert p.is_file() and not p.is_symlink() and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o644; print(json.dumps({"unitSha256":hashlib.sha256(p.read_bytes()).hexdigest(),"oldUnitSha256":hashlib.sha256(old.read_bytes()).hexdigest(),"oldHelperSha256":hashlib.sha256(helper.read_bytes()).hexdigest(),"owner":"root","mode":"644","symlink":False}))'
readback = json.loads(remote(['python3','-c',code]))
assert readback['unitSha256'] == check['unitSha256']
assert readback['oldUnitSha256'] == prestate['oldOperatorUnit']['sha256']
assert readback['oldHelperSha256'] == prestate['oldHelperSha256']
unit_state = remote(['systemctl','show','travelos-stage7-runtime-acceptance.service','--property=LoadState,ActiveState,UnitFileState,FragmentPath']).strip()
assert 'LoadState=loaded' in unit_state and 'ActiveState=inactive' in unit_state and 'UnitFileState=enabled' not in unit_state
readback.update({'result':'PASS','generation':'gen15','loadedUnitProperties':unit_state,'oldUnitAndHelperUnchanged':True,'stage8Actions':0})
save('stage7-gen15-ct200-installer-readback.json',readback)
identity_sql = "BEGIN READ ONLY; SET LOCAL ROLE travelos_owner; SELECT json_build_object('sessionUser',session_user,'currentUser',current_user,'migrationCount',(SELECT count(*) FROM travelos_meta.schema_migrations),'migrationHead',(SELECT name FROM travelos_meta.schema_migrations ORDER BY id DESC LIMIT 1),'migrations',(SELECT json_agg(name ORDER BY id) FROM travelos_meta.schema_migrations)); COMMIT;"
def identity():
    x = json.loads(remote(['travelos-migrator-exec','/usr/bin/psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',identity_sql]))
    assert x['sessionUser']=='travelos_migrator' and x['currentUser']=='travelos_owner'
    return x
before = identity()
assert before['migrationCount']==12 and before['migrationHead']=='0012_stage7_portal_trip_access'
migrate = ['travelos-migrator-exec',RELEASE+'/runtime/node/bin/node',RELEASE+'/migrator/run-stage6-migrations.mjs','up']
first = remote(migrate,480)
save('stage7-gen15-ct200-migration-up.log',first)
after = identity()
assert after['migrationCount']==13 and after['migrationHead']=='0013_stage7_runtime_acceptance_cleanup'
assert after['migrations'][:-1]==before['migrations']
second = remote(migrate,480)
save('stage7-gen15-ct200-migration-noop.log',second)
noop = identity()
assert noop==after
assert remote(['travelos-agentctl','current-release']).strip()==prestate['activeRelease']
summary = {'result':'PASS','generation':'gen15','approvedMigrationCommand':migrate,'before':before,'after':after,'noOpRerun':{'commandExitCode':0,'ledgerUnchanged':True,'logSha256':hashlib.sha256(second.encode()).hexdigest()},'firstLogSha256':hashlib.sha256(first.encode()).hexdigest(),'operatorUnitInstalled':True,'operatorUnitStarted':False,'previousUnitAndHelperUnchanged':True,'activeReleaseStillGen09':True,'stage8Actions':0}
save('stage7-gen15-ct200-migration.json',summary)
print(json.dumps(summary,indent=2))
