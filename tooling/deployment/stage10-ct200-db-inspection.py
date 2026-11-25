"""Fixed build-host CT200 read-only metadata inspection, not a privileged installer.

Uses the existing approved credential executor; credentials never enter this process.
Does not qualify that executor for least privilege or authorize a migration/backup.
"""
import importlib.util
import json
from pathlib import Path
import shlex
import subprocess
import sys

EXPECTED_MIGRATIONS = [
    '0001_foundation_schemas', '0002_runtime_schema_boundaries',
    '0003_creator_default_privileges', '0004_authentication_realms',
    '0005_root_agency_staff_authorization', '0006_stage4_authorization_hardening',
    '0007_stage5_m1_domain_slice', '0008_stage5_cardinality_only',
    '0009_stage5_revision_and_lock_version_hardening', '0010_stage5_temporal_persistence_parity',
    '0011_stage6_trip_publication', '0012_stage7_portal_trip_access',
    '0013_stage7_runtime_acceptance_cleanup', '0014_stage8_worker_activity',
    '0015_stage9_trip_workspace_writes', '0016_stage9_staff_invitations',
]
KNOWN_HOSTS = Path(__file__).with_name('stage10-ct200-known-hosts')
KNOWN_HOST_BYTES = b'192.168.1.33 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHqtSXydX0XvHTEWwB5VCVZPBfflovUlT6Wf2RJz+jUu\n'

SQL = """BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT json_build_object('phase','session','currentUser',current_user,'sessionUser',session_user,'database',current_database());
SET LOCAL ROLE travelos_owner;
SET LOCAL search_path TO pg_catalog;
SELECT json_build_object('phase','owner','currentUser',current_user,'sessionUser',session_user,'superuser',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls,'serverVersion',current_setting('server_version_num')::integer) FROM pg_catalog.pg_roles WHERE rolname=current_user;
SELECT json_build_object('phase','ledger','count',count(*),'head',max(name),'names',json_agg(name ORDER BY run_on,id)) FROM travelos_meta.schema_migrations;
ROLLBACK;"""


def reject_unless(condition):
    if not condition:
        raise ValueError('STAGE10_DATABASE_INSPECTION_REJECTED')


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        reject_unless(key not in result)
        result[key] = value
    return result


def decode_output(output):
    reject_unless(isinstance(output, str) and len(output.encode('utf-8')) <= 16384)
    try:
        values = [json.loads(line, object_pairs_hook=unique_pairs) for line in output.splitlines() if line.strip()]
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ValueError('STAGE10_DATABASE_INSPECTION_REJECTED') from error
    reject_unless(len(values) == 3 and all(isinstance(value, dict) for value in values))
    session, owner, ledger = values
    reject_unless(session == {'phase': 'session', 'currentUser': 'travelos_migrator', 'sessionUser': 'travelos_migrator', 'database': 'travelos_development'})
    reject_unless(set(owner) == {'phase', 'currentUser', 'sessionUser', 'superuser', 'createDb', 'createRole', 'replication', 'bypassRls', 'serverVersion'})
    reject_unless(owner['phase'] == 'owner' and owner['currentUser'] == 'travelos_owner' and owner['sessionUser'] == 'travelos_migrator')
    reject_unless(all(owner[key] is False for key in ('superuser', 'createDb', 'createRole', 'replication', 'bypassRls')))
    reject_unless(type(owner['serverVersion']) is int and owner['serverVersion'] // 10000 == 18)
    reject_unless(set(ledger) == {'phase', 'count', 'head', 'names'} and ledger['phase'] == 'ledger')
    reject_unless(type(ledger['count']) is int and ledger['count'] == 16 and ledger['head'] == '0016_stage9_staff_invitations')
    reject_unless(ledger['names'] == EXPECTED_MIGRATIONS)
    return {
        'result': 'READ_ONLY_DATABASE_INSPECTION_PASS',
        'target': 'CT200_DEVELOPMENT',
        'sessionUser': session['sessionUser'],
        'initialCurrentUser': session['currentUser'],
        'ownerCurrentUser': owner['currentUser'],
        'ownerClusterRoleFlags': 'ALL_FIVE_CHECKED_FALSE',
        'databaseObjectPrivileges': 'NOT_INSPECTED',
        'serverVersion': owner['serverVersion'],
        'migrationCount': ledger['count'],
        'migrationHead': ledger['head'],
        'orderedMigrationNames': ledger['names'],
        'transaction': 'READ_ONLY_ROLLED_BACK',
        'credentialDelivery': 'EXISTING_SYSTEMD_ENCRYPTED_CREDENTIAL_EXECUTOR',
        'executorLeastPrivilege': 'NOT_QUALIFIED',
        'migrationExecution': 'NOT_PERFORMED',
        'backupRestore': 'NOT_PERFORMED',
        'stage11Actions': 0,
    }


def inspect():
    # Fixed approved identity and pinned host key; no ambient config, proxy,
    # agent, host, SQL, environment, command or executor override is accepted.
    # Source/build UID is trusted; this is not hostile same-UID isolation.
    reject_unless(KNOWN_HOSTS.read_bytes() == KNOWN_HOST_BYTES)
    spec = importlib.util.spec_from_file_location('stage10_process_boundary', Path(__file__).with_name('stage10-process-boundary.py'))
    assert spec is not None and spec.loader is not None
    boundary = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(boundary)
    command = ['/usr/local/bin/travelos-migrator-exec', '/usr/bin/psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', SQL]
    child = boundary.bounded_run([
        '/usr/bin/ssh', '-F', '/dev/null', '-i', '/home/hermes/.ssh/travelos_ct200_ed25519',
        '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={KNOWN_HOSTS}',
        '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'HostKeyAlgorithms=ssh-ed25519',
        '-o', 'PermitLocalCommand=no', '-o', 'ClearAllForwardings=yes',
        '-o', 'RequestTTY=no', '-o', 'ConnectTimeout=10', '--', 'hermes@192.168.1.33', shlex.join(command),
    ], output_limit=16384, timeout=30,
        env={'PATH': '/usr/bin:/bin', 'HOME': '/home/hermes', 'LANG': 'C.UTF-8'})
    reject_unless(child.returncode == 0 and not child.stderr.strip())
    return decode_output(child.stdout.decode('utf-8', errors='strict'))


def main():
    try:
        reject_unless(sys.argv[1:] == ['--inspect'])
        result = inspect()
    except (ValueError, OSError, subprocess.TimeoutExpired, UnicodeError):
        # Never echo raw executor/SSH/database output or exception details.
        print(json.dumps({'result': 'FAIL', 'code': 'STAGE10_DATABASE_INSPECTION_REJECTED'}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
