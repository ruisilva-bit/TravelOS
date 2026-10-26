import datetime, hashlib, json, subprocess, uuid
from pathlib import Path

root = Path.cwd()
def read(p): return json.loads(Path(p).read_text())
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
receipt = read('.hermes/state/stage8-gen03-canonical-ci-receipt.json')
assert receipt['result'] == 'PASS' and receipt['invocationCount'] == 1
assert receipt['completedGateCount'] == receipt['expectedGateCount'] == 32
assert receipt['artifactSha256'] == sha('.hermes/state/stage8-gen03-artifact.tar.gz')
assert sha(receipt['logPath']) == receipt['logSha256']
base = Path('.hermes/state/stage8-gen03-ct200'); base.mkdir(exist_ok=False)

def ssh(script, label):
    p = subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','travelos-dev','bash','-s'], input='set -euo pipefail\n'+script, text=True, capture_output=True)
    (base/(label+'.stdout.log')).write_text(p.stdout)
    (base/(label+'.stderr.log')).write_text(p.stderr)
    (base/(label+'.receipt.json')).write_text(json.dumps({'exitCode':p.returncode,'stdoutSha256':hashlib.sha256(p.stdout.encode()).hexdigest(),'stderrSha256':hashlib.sha256(p.stderr.encode()).hexdigest()},indent=2)+'\n')
    if p.returncode: raise RuntimeError(label+' failed; sanitized logs preserved')
    return p.stdout

stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'_'+uuid.uuid4().hex[:6]
backup = '/var/tmp/travelos-stage8-pre-migration.gen03-'+stamp
probe = 'travelos_stage8_restore_gen03_'+stamp.lower()
# Catalog projection is identifier/schema/privilege metadata only, never row payloads.
inventory_sql = """SELECT json_build_object(
'ledger',(SELECT json_agg(x ORDER BY name) FROM (SELECT name FROM travelos_meta.schema_migrations) x),
'relations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('travelos_meta','agency_org','staff_access','portal_access','crm','trip_ops','integration','job_runtime','activity','audit') AND c.relkind IN ('r','v','p')),
'constraints',(SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')),
'indexes',(SELECT count(*) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema')),
'userTriggers',(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal),
'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'),
'workerPrivileges',(SELECT json_agg(x ORDER BY table_schema,table_name,privilege_type,column_name) FROM (SELECT table_schema,table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='travelos_worker') x)
);"""
# Probe a custom backup, restricted before reading, using existing approved PostgreSQL helpers only.
script = f"""
active=$(/usr/local/bin/travelos-agentctl current-release)
[ "$active" = /opt/travelos/releases/travelos-stage8-gen02-b8c47d7b ]
/usr/local/bin/travelos-pg-dump --format=custom --file='{backup}' travelos_development
sudo -n chmod 0600 '{backup}'
/usr/local/bin/travelos-agentctl backup-sha '{backup}'
/usr/local/bin/travelos-pg-createdb --template=template0 '{probe}'
/usr/local/bin/travelos-pg-restore --exit-on-error --dbname='{probe}' '{backup}'
/usr/local/bin/travelos-pg-psql -X -A -t -v ON_ERROR_STOP=1 -d travelos_development <<'SQL'
{inventory_sql}
SQL
/usr/local/bin/travelos-pg-psql -X -A -t -v ON_ERROR_STOP=1 -d '{probe}' <<'SQL'
{inventory_sql}
SQL
/usr/local/bin/travelos-pg-dropdb '{probe}'
/usr/local/bin/travelos-pg-psql -X -A -t -v ON_ERROR_STOP=1 -d postgres -c "SELECT count(*) FROM pg_database WHERE datname='{probe}'"
/usr/local/bin/travelos-agentctl current-release
"""
output = ssh(script, 'backup-restore')
inventories = [json.loads(l) for l in output.splitlines() if l.startswith('{')]
assert len(inventories)==2 and inventories[0] == inventories[1]
assert len(inventories[0]['ledger']) == 14
assert output.splitlines()[-2] == '0'
report={'result':'PASS','target':{'node':'pxmx2','ctid':200,'environment':'DEVELOPMENT'},'backupPath':backup,'probeDatabase':probe,'probeDroppedAndAbsenceVerified':True,'sourceRestoreParity':inventories[0],'artifactSha256':receipt['artifactSha256'],'stage9Actions':0}
(base/'backup-restore.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'result':'PASS','backupPath':backup,'probeDroppedAndAbsenceVerified':True}))
