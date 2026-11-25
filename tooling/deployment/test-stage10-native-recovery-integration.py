"""Synthetic PostgreSQL mechanism test; not a 16-migration qualification."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import shlex
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('native', HERE/'stage10-native-backup.py')
native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
spec = importlib.util.spec_from_file_location('recovery', HERE/'stage10-native-recovery.py')
recovery = importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)
package = Path(json.loads((HERE.parent.parent/'.hermes/state/stage10-current-pg-root.json').read_text())['root'])
bin = package/'usr/lib/postgresql/18/bin'
libs = (str(package/'usr/lib/x86_64-linux-gnu'), str(package/'usr/lib/postgresql/18/lib'))
user = pwd.getpwuid(os.geteuid()).pw_name
parent = f'/run/user/{os.geteuid()}'
with tempfile.TemporaryDirectory(prefix='stage10-fixture-', dir=parent) as tmp:
    root = Path(tmp); data = root/'db'; sock = root/'s'; sock.mkdir(mode=0o700)
    env = {'PATH':'/usr/bin:/bin','HOME':tmp,'LANG':'C.UTF-8','LD_LIBRARY_PATH':':'.join(libs)}
    def run(name, args):
        r = subprocess.run([str(bin/name), *args], env=env, capture_output=True, timeout=90)
        if r.returncode:
            raise RuntimeError('fixture '+name+' failed: '+r.stderr.decode(errors='replace')[-3000:])
        return r.stdout
    def sql(db, command):
        return run('psql',['-X','-qAt','-h',str(sock),'-p','6543','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-c',command])
    run('initdb',['-D',str(data),'-L',str(package/'usr/share/postgresql/18'),'-U','postgres','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--locale=C.UTF-8','--no-instructions'])
    run('pg_ctl',['-D',str(data),'-l',str(root/'log'),'-w','-t','30','-o',shlex.join(['-c','listen_addresses=', '-c','unix_socket_directories='+str(sock),'-c','port=6543']), 'start'])
    try:
        sql('postgres', f'CREATE ROLE {user} LOGIN REPLICATION; CREATE ROLE travelos_admin_runtime; CREATE ROLE travelos_portal_runtime;')
        sql('postgres','CREATE DATABASE travelos_development')
        sql('travelos_development', '''CREATE SCHEMA travelos_meta; CREATE SCHEMA trip_ops; CREATE SCHEMA crm;
        CREATE TABLE travelos_meta.schema_migrations(name text); INSERT INTO travelos_meta.schema_migrations VALUES ('synthetic_only');
        CREATE TABLE trip_ops.trip(id int); CREATE TABLE crm.person(id int); CREATE TABLE crm.customer(id int);
        GRANT SELECT ON trip_ops.trip TO travelos_admin_runtime;''')
        plan = {'schemaVersion':1,'environment':'DEVELOPMENT','socketDirectory':str(sock),'port':6543,'osUser':user,'replicationRole':user,
            'authentication':{'method':'peer','osUser':user,'databaseRole':user},
            'role':{'login':True,'replication':True,'superuser':False,'createdb':False,'createrole':False,'bypassrls':False},
            'hba':{'connectionType':'local','database':'replication','user':user,'method':'peer'}}
        def pins(names):
            return {n:{'path':str(bin/n),'sha256':hashlib.sha256((bin/n).read_bytes()).hexdigest()} for n in names}
        backup = native.native_backup_tar(plan,pins(('psql','pg_basebackup')),parent,library_directories=libs)
        result = recovery.recover_native_tar(backup['archive'],pins(('pg_ctl','postgres','psql','pg_verifybackup','pg_waldump')),parent,library_directories=libs)
        assert result['restored']['ledgerHead'] == 'synthetic_only'
        assert result['restored']['ledgerCount'] == 1
        assert result['restored']['adminTripSelect'] is True and result['restored']['portalTripSelect'] is False
        print(json.dumps(result,sort_keys=True))
    finally:
        run('pg_ctl',['-D',str(data),'-w','-t','30','-m','immediate','stop'])
