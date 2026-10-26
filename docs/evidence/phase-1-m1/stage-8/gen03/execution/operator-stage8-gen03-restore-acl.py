import hashlib,json,subprocess,uuid
from pathlib import Path
base=Path('.hermes/state/stage8-gen03-ct200');backup=json.loads((base/'backup-restore.json').read_text())['backupPath']
probe='travelos_stage8_gen03_acl_'+uuid.uuid4().hex[:12]
sql="""SELECT jsonb_build_object('relations',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'acl',c.relacl::text,'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'),'schemas',(SELECT jsonb_agg(jsonb_build_object('schema',nspname,'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'));"""
# NULL ACL means PostgreSQL's owner-only default, not absence of privileges.
sql=sql.replace("c.relacl::text", "coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::\"char\" ELSE 'r'::\"char\" END,c.relowner))::text").replace("nspacl::text", "coalesce(nspacl,acldefault('n',nspowner))::text")
script=f"""set -euo pipefail
/usr/local/bin/travelos-pg-createdb --template=template0 {probe}
trap '/usr/local/bin/travelos-pg-dropdb {probe}' EXIT
/usr/local/bin/travelos-pg-restore --exit-on-error --dbname={probe} '{backup}'
/usr/local/bin/travelos-pg-psql -X -A -t -v ON_ERROR_STOP=1 -d travelos_development <<'SQL'
{sql}
SQL
/usr/local/bin/travelos-pg-psql -X -A -t -v ON_ERROR_STOP=1 -d {probe} <<'SQL'
{sql}
SQL
"""
p=subprocess.run(['ssh','-o','BatchMode=yes','travelos-dev','bash','-s'],input=script,text=True,capture_output=True)
(base/'acl-restore-effective.stdout.log').write_text(p.stdout);(base/'acl-restore-effective.stderr.log').write_text(p.stderr)
assert p.returncode==0
rows=[json.loads(l) for l in p.stdout.splitlines() if l.startswith('{')];assert len(rows)==2 and rows[0]==rows[1]
p=subprocess.run(['ssh','-o','BatchMode=yes','travelos-dev',f"/usr/local/bin/travelos-pg-psql -X -A -t -d postgres -c \"SELECT count(*) FROM pg_database WHERE datname='{probe}'\""],text=True,capture_output=True)
assert p.returncode==0 and p.stdout.strip()=='0'
report={'result':'PASS','probeDatabase':probe,'probeDroppedAndAbsenceVerified':True,'relationCount':len(rows[0]['relations']),'schemaCount':len(rows[0]['schemas']),'sourceRestoreSchemaTableColumnAclParity':True,'aclComparison':'coalesce nullable ACL with PostgreSQL acldefault for the object owner; NULL ACL is owner-only default, not zero privileges. Prior raw catalog comparison preserved separately.','stdoutSha256':hashlib.sha256((base/'acl-restore-effective.stdout.log').read_bytes()).hexdigest(),'backupUnmodified':True,'stage9Actions':0}
(base/'acl-restore.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
