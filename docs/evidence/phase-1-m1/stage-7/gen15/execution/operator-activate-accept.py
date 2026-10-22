import datetime
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time

ROOT = Path.cwd()
STATE = ROOT / '.hermes/state'
RELEASE_NAME = 'travelos-stage7-gen15-5609bcb4'
RELEASE = '/opt/travelos/releases/' + RELEASE_NAME
UNIT = 'travelos-stage7-runtime-acceptance.service'

def remote(args, timeout=300):
    p = subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','travelos-dev',shlex.join(args)],text=True,capture_output=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError('Approved operation failed: '+args[0]+'\n'+p.stderr[:2000])
    return p.stdout

def save(name, value):
    data = value if isinstance(value,str) else json.dumps(value,indent=2)+'\n'
    p = STATE/name
    if p.exists():
        assert p.read_text()==data, 'Divergent existing operation evidence: '+name
    else:
        p.write_text(data)

def sql(query):
    return json.loads(remote(['travelos-migrator-exec','/usr/bin/psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',query]))

migration=json.loads((STATE/'stage7-gen15-ct200-migration.json').read_text())
assert migration['result']=='PASS' and migration['after']['migrationCount']==13
assert sys.argv[1:] in [[], ['--resume-activated']]
resume_activated = sys.argv[1:] == ['--resume-activated']
expected_current = RELEASE if resume_activated else '/opt/travelos/releases/travelos-stage7-gen09-0cf07d04'
assert remote(['travelos-agentctl','current-release']).strip()==expected_current
baseline_sql="""BEGIN READ ONLY; SET LOCAL ROLE travelos_owner; SET LOCAL TIME ZONE 'UTC'; SELECT json_build_object(
 'tripCount',(SELECT count(*) FROM trip_ops.trip),
 'snapshotCount',(SELECT count(*) FROM trip_ops.publication_snapshot),
 'activePointerCount',(SELECT count(*) FROM trip_ops.publication_pointer),
 'activeGrantCount',(SELECT count(*) FROM portal_access.trip_access_grant WHERE "grantState"='ACTIVE'),
 'fixtureRunCount',(SELECT count(*) FROM portal_access.runtime_acceptance_fixture_run),
 'unregisteredTripRowsSha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') FROM trip_ops.trip t WHERE NOT EXISTS(SELECT 1 FROM portal_access.runtime_acceptance_fixture_trip f WHERE f."agencyId"=t."agencyId" AND f."tripId"=t.id)),
 'unregisteredSnapshotRowsSha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(s)::text,E'\\n' ORDER BY to_jsonb(s)::text),''),'UTF8')),'hex') FROM trip_ops.publication_snapshot s WHERE NOT EXISTS(SELECT 1 FROM portal_access.runtime_acceptance_fixture_trip f WHERE f."agencyId"=s."agencyId" AND f."tripId"=s."tripId"))
); COMMIT;"""
before=sql(baseline_sql)
assert before['fixtureRunCount']==0
save('stage7-gen15-ct200-pre-acceptance-inventory.json',before)
if not resume_activated:
    assert remote(['travelos-agentctl','activate-release',RELEASE_NAME]).strip()==RELEASE
assert remote(['travelos-agentctl','current-release']).strip()==RELEASE
if not resume_activated:
    remote(['travelos-agentctl','restart-runtime'],120)
services={u:remote(['systemctl','is-active',u]).strip() for u in ['travelos-admin-api.service','travelos-portal-api.service','travelos-worker.service']}
assert all(v=='active' for v in services.values())
probe_code='''import http.client,json,time
checks=[]
for port,host in [(3101,"admin.travelos.test"),(3102,"portal.travelos.test")]:
 for requested,expected in [(host,200),("not-allowed.invalid",404)]:
  for attempt in range(30):
   try:
    c=http.client.HTTPConnection("127.0.0.1",port,timeout=5); c.request("GET","/health/live",headers={"Host":requested}); r=c.getresponse(); status=r.status; r.read(); c.close(); break
   except OSError:
    if attempt==29: raise
    time.sleep(0.2)
  assert status==expected,(port,requested,status)
  checks.append({"listener":"127.0.0.1:"+str(port),"host":requested,"path":"/health/live","status":status,"expected":expected})
for host,expected in [("admin.travelos.test",200),("portal.travelos.test",200),("not-allowed.invalid",421)]:
 c=http.client.HTTPConnection("192.168.1.33",80,timeout=5); c.request("GET","/health/live",headers={"Host":host}); r=c.getresponse(); status=r.status; r.read(); c.close(); assert status==expected,(host,status); checks.append({"listener":"192.168.1.33:80","host":host,"path":"/health/live","status":status,"expected":expected})
print(json.dumps({"result":"PASS","checks":checks}))'''
health=json.loads(remote(['python3','-c',probe_code],60))
assert health['result']=='PASS'
activation={'result':'PASS','generation':'gen15','activeRelease':RELEASE,'services':services,'exactHostAndHealthChecks':health['checks'],'buildOrDependencyInstallOnTarget':False,'resumedAfterProbeTargetCorrection':resume_activated,'caddyConfigUnchangedSha256':'0c5a22ecc033b17d2920ddcd63e359dc97631c9ebc6855137aaab3f29a3c7bb4','stage8Actions':0}
save('stage7-gen15-ct200-activation.json',activation)
start=remote(['date','-u','+%Y-%m-%dT%H:%M:%S.%6NZ']).strip()
datetime.datetime.strptime(start,'%Y-%m-%dT%H:%M:%S.%fZ')
remote(['sudo','-n','/usr/bin/systemctl','start','--no-block',UNIT])
invocation=''
observed_running=False
deadline=time.monotonic()+560
while time.monotonic()<deadline:
    text=remote(['systemctl','show',UNIT,'--property=InvocationID,ActiveState,SubState,Result,ExecMainStatus,MainPID,ControlPID,ExecStartPre,ExecStart,FragmentPath,UnitFileState']).strip()
    props=dict(line.split('=',1) for line in text.splitlines() if '=' in line)
    if re.fullmatch('[a-f0-9]{32}',props.get('InvocationID','')):
        invocation=props['InvocationID']
    if props.get('ActiveState') in ['activating','active']:
        observed_running=True
    if invocation and props.get('ActiveState') in ['inactive','failed']:
        break
    time.sleep(0.5)
else:
    remote(['sudo','-n','/usr/bin/systemctl','stop',UNIT])
    raise RuntimeError('One-shot exceeded bounded operator timeout and was stopped')
assert invocation and observed_running
journal=remote(['sudo','-n','/usr/bin/journalctl','_SYSTEMD_INVOCATION_ID='+invocation,'--no-pager','-o','json'],60)
entries=[json.loads(line) for line in journal.splitlines() if line.strip()]
messages=[entry.get('MESSAGE','') for entry in entries if isinstance(entry.get('MESSAGE'),str)]
combined='\n'.join(messages)
objects=[]
decoder=json.JSONDecoder()
for match in re.finditer(r'(?m)^\{',combined):
    try:
        value,_=decoder.raw_decode(combined[match.start():])
        if isinstance(value,dict): objects.append(value)
    except json.JSONDecodeError:
        pass
preflights=[v for v in objects if v.get('generation')=='gen15' and v.get('artifactId')=='travelos-phase-1-m1-stage-7-gen15-5609bcb4' and 'sensitiveDataScan' in v]
reports=[]
for entry in entries:
    try:
        value=json.loads(entry.get('MESSAGE',''))
    except (json.JSONDecodeError,TypeError):
        continue
    if isinstance(value,dict) and isinstance(value.get('probes'),list):
        reports.append((entry,value))
systemd={'generation':'gen15','unit':UNIT,'acceptanceStartUtc':start,'capturedInvocationId':invocation,'observedActivation':observed_running,'properties':props,'journalEntryCount':len(entries),'retainedAssertionEntries':len(reports),'journalFilter':'Exact invocation ID; retain only JSON-object MESSAGE with probes array; metadata allowlist MESSAGE,__REALTIME_TIMESTAMP,_SYSTEMD_INVOCATION_ID','rawJournalSha256':hashlib.sha256(journal.encode()).hexdigest(),'stage8Actions':0}
save('stage7-gen15-ct200-one-shot-systemd.json',systemd)
assert len(reports)==1, 'Missing or ambiguous assertion-level runner output'
entry,report=reports[0]
retained={k:entry[k] for k in ['MESSAGE','__REALTIME_TIMESTAMP','_SYSTEMD_INVOCATION_ID'] if k in entry}
save('stage7-gen15-ct200-one-shot-journal.jsonl',json.dumps(retained,sort_keys=True)+'\n')
save('stage7-gen15-ct200-runtime-acceptance.json',entry['MESSAGE']+'\n')
assert report['result']=='PASS' and report['stage8Actions']==0
expected=json.loads((STATE/'stage7-gen15-packaged-rehearsal.json').read_text())
assert report['probes']==expected['probes']
assert len(preflights)==1 and preflights[0]['result']=='PASS'
save('stage7-gen15-ct200-one-shot-preflight.json',preflights[0])
assert props['ActiveState']=='inactive' and props['SubState']=='dead' and props['Result']=='success' and props['ExecMainStatus']=='0'
assert props['MainPID']=='0' and props['ControlPID']=='0' and props['UnitFileState']!='enabled'
remote(['sudo','-n','test','!','-e','/run/credentials/'+UNIT])
inventory_source=Path('/home/hermes/.hermes/cache/scratch/stage7-gen15-final-inventory.sql').read_text()
assert inventory_source.count(":'acceptanceStart'")==1
final_sql=inventory_source.replace(":'acceptanceStart'","'"+start+"'")
final=sql(final_sql)
save('stage7-gen15-ct200-final-inventory.json',final)
assert final['sessionUser']=='travelos_migrator' and final['currentUser']=='travelos_owner'
assert final['migrationCount']==13 and final['migrationHead']=='0013_stage7_runtime_acceptance_cleanup'
assert final['fixtureRuns']==final['cleanedFixtureRuns']==1 and final['unresolvedFixtureRuns']==0
assert final['registeredTrips']==final['cancelledTrips']==2
assert final['activeFixturePublications']==final['activeFixtureGrants']==0
assert final['fixturePrincipals']==final['retiredFixturePrincipals']==1
assert final['liveFixturePortalSessions']==final['liveStaffSessionsCreatedDuringAcceptance']==0
assert final['retainedPublicationSnapshots']==2 and final['retainedFixtureAuditEvents']>0
assert final['portalPrivileges']=={'snapshotRead':True,'grantRead':True,'workspaceRead':False,'internalCostRead':False,'fixtureRegistryRead':False}
after=sql(baseline_sql)
assert after['tripCount']==before['tripCount']+2 and after['snapshotCount']==before['snapshotCount']+2
assert after['activePointerCount']==before['activePointerCount'] and after['activeGrantCount']==before['activeGrantCount']
assert after['unregisteredTripRowsSha256']==before['unregisteredTripRowsSha256'] and after['unregisteredSnapshotRowsSha256']==before['unregisteredSnapshotRowsSha256']
retention={'result':'PASS','before':before,'after':after,'unregisteredTripAndSnapshotBytesPreserved':True,'scope':'Registered gen15 fixture only; unrelated and historical rows were not cleanup targets','stage8Actions':0}
save('stage7-gen15-ct200-retention.json',retention)
summary={'result':'PASS','generation':'gen15','activeRelease':RELEASE,'invocationId':invocation,'assertionProbes':len(report['probes']),'registeredRunsCleaned':final['cleanedFixtureRuns'],'registeredTripsCancelled':final['cancelledTrips'],'fixturePrincipalsRetired':final['retiredFixturePrincipals'],'retainedPublicationSnapshots':final['retainedPublicationSnapshots'],'retainedFixtureAuditEvents':final['retainedFixtureAuditEvents'],'activeFixtureGrants':final['activeFixtureGrants'],'activeFixturePublications':final['activeFixturePublications'],'liveFixturePortalSessions':final['liveFixturePortalSessions'],'liveAcceptanceStaffSessions':final['liveStaffSessionsCreatedDuringAcceptance'],'oneShotInactive':True,'credentialDirectoryAbsent':True,'unregisteredHistoricalRowsPreserved':True,'stage8Actions':0}
save('stage7-gen15-ct200-acceptance-summary.json',summary)
print(json.dumps(summary,indent=2))
