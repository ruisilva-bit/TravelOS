import datetime, hashlib, json, subprocess, uuid

def run(args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=180)
    if result.returncode:
        raise RuntimeError('approved operation failed: ' + args[0])
    return result.stdout.strip()

def psql(db, query):
    return run(['travelos-pg-psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '--dbname='+db, '-c', 'BEGIN READ ONLY; '+query+'; COMMIT;'])

suffix = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '_' + uuid.uuid4().hex[:6]
backup = '/var/tmp/travelos-stage7-pre-migration.gen15-' + suffix
probe = 'travelos_stage7_restore_gen15_' + suffix.lower()
query = """SELECT json_build_object(
'ledger', (SELECT json_agg(name ORDER BY id) FROM travelos_meta.schema_migrations),
'relations', (SELECT json_agg(x ORDER BY n,c) FROM (SELECT n.nspname n,c.relname c,c.relkind k FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','S')) x),
'constraints', (SELECT json_agg(x ORDER BY n,t,c) FROM (SELECT n.nspname n,r.relname t,c.conname c,pg_get_constraintdef(c.oid,true) def,c.convalidated valid FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace LEFT JOIN pg_class r ON r.oid=c.conrelid WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema') x),
'indexes', (SELECT json_agg(x ORDER BY n,t,c) FROM (SELECT n.nspname n,r.relname t,i.relname c,pg_get_indexdef(i.oid,0,true) def,x.indisvalid valid FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class r ON r.oid=x.indrelid JOIN pg_namespace n ON n.oid=i.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema') x),
'triggers', (SELECT json_agg(x ORDER BY n,t,c) FROM (SELECT n.nspname n,r.relname t,t.tgname c,pg_get_triggerdef(t.oid,true) def,t.tgenabled enabled FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE NOT t.tgisinternal AND n.nspname NOT LIKE 'pg_%') x),
'functions', (SELECT json_agg(x ORDER BY n,c,args) FROM (SELECT n.nspname n,p.proname c,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) def,p.prosecdef security_definer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND p.prokind IN ('f','p')) x), 'portalPrivileges', json_build_array(json_build_object('snapshotRead',has_column_privilege('travelos_portal_api','trip_ops.publication_snapshot','canonicalPayload','SELECT'),'grantRead',has_column_privilege('travelos_portal_api','portal_access.trip_access_grant','grantId','SELECT'),'workspaceRead',has_table_privilege('travelos_portal_api','trip_ops.trip','SELECT'),'internalCostRead',has_table_privilege('travelos_portal_api','finance.supplier_cost_line','SELECT'))))"""
active = run(['readlink','-f','/opt/travelos/current'])
services = {u:run(['systemctl','is-active',u]) for u in ['travelos-admin-api.service','travelos-portal-api.service','travelos-worker.service']}
assert all(s=='active' for s in services.values())
assert active == '/opt/travelos/releases/travelos-stage7-gen09-0cf07d04'
check = run(['travelos-stage7-operatorctl','check'])
assert 'encrypted_credentials=5/5 PASS' in check
identityQuery = "BEGIN READ ONLY; SET LOCAL ROLE travelos_owner; SELECT json_build_object('sessionUser',session_user,'currentUser',current_user,'database',current_database(),'version',current_setting('server_version'),'listenAddresses',current_setting('listen_addresses'),'migrationCount',(SELECT count(*) FROM travelos_meta.schema_migrations),'migrationHead',(SELECT name FROM travelos_meta.schema_migrations ORDER BY id DESC LIMIT 1)); COMMIT;"
identity = json.loads(run(['travelos-migrator-exec','/usr/bin/psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',identityQuery]))
assert identity['sessionUser']=='travelos_migrator' and identity['currentUser']=='travelos_owner'
assert identity['migrationCount']==12 and identity['migrationHead']=='0012_stage7_portal_trip_access'
source = json.loads(psql('travelos_development',query))
assert source['portalPrivileges'] == [{'snapshotRead':True,'grantRead':True,'workspaceRead':False,'internalCostRead':False}]
run(['travelos-pg-dump','--format=custom','--file='+backup,'travelos_development'])
backupMeta = run(['travelos-agentctl','backup-sha',backup])
created = False
try:
    run(['travelos-pg-createdb','--template=template0','--encoding=UTF8','--locale=C',probe])
    created = True
    run(['travelos-pg-restore','--exit-on-error','--dbname='+probe,backup])
    restored = json.loads(psql(probe,query))
    assert source == restored, 'restore structural/ledger mismatch'
finally:
    if created: run(['travelos-pg-dropdb',probe])
assert psql('postgres',"SELECT count(*) FROM pg_database WHERE datname='"+probe+"'")=='0'
assert source == json.loads(psql('travelos_development',query))
serialization = json.dumps(source,sort_keys=True,separators=(',',':')).encode()
print(json.dumps({'schemaVersion':1,'result':'PASS','generation':'gen15','observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'activeRelease':active,'services':services,'credentialReferencesChecked':5,'credentialValuesEmitted':False,'database':identity,'backup':{'path':backup,'metadataAndSha256':backupMeta,'retained':True},'restoreProbe':{'database':probe,'structuralLedgerParity':'PASS','inventorySha256':hashlib.sha256(serialization).hexdigest(),'inventoryBytes':len(serialization),'counts':{k:len(v) for k,v in source.items()},'dropped':True,'absenceVerified':True},'stage8Actions':0},indent=2))
