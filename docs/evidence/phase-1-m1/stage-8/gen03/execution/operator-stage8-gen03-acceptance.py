import datetime, hashlib, json, subprocess, time
from pathlib import Path

base = Path('.hermes/state/stage8-gen03-ct200')
assert json.loads((base/'deployment.json').read_text())['result']=='PASS'

def ssh(command):
 p=subprocess.run(['ssh','-o','BatchMode=yes','travelos-dev',command],text=True,capture_output=True)
 assert p.returncode==0, 'REMOTE_ACCEPTANCE_OPERATION_FAILED_'+str(p.returncode)
 return p.stdout

def inventory():
 sql='''BEGIN READ ONLY;
 SELECT json_build_object(
 'ledgerCount',(SELECT count(*) FROM travelos_meta.schema_migrations),
 'migrationHead',(SELECT max(name) FROM travelos_meta.schema_migrations),
 'unresolvedRuns',(SELECT count(*) FROM portal_access.runtime_acceptance_fixture_run WHERE state<>'CLEANED'),
 'runs',(SELECT json_agg(json_build_object('id',r."fixtureRunId",'state',r.state,'trips',(SELECT count(*) FROM portal_access.runtime_acceptance_fixture_trip t WHERE t."fixtureRunId"=r."fixtureRunId"),'cancelledTrips',(SELECT count(*) FROM portal_access.runtime_acceptance_fixture_trip t JOIN trip_ops.trip trip ON trip.id=t."tripId" AND trip."agencyId"=t."agencyId" WHERE t."fixtureRunId"=r."fixtureRunId" AND trip.state='CANCELLED'),'principalRetired',EXISTS(SELECT 1 FROM portal_access.portal_principal_context p WHERE p."portalPrincipalId"=r."portalPrincipalId" AND p."retiredAt" IS NOT NULL),'activePointers',(SELECT count(*) FROM portal_access.runtime_acceptance_fixture_trip t JOIN trip_ops.publication_pointer p USING ("agencyId","tripId") WHERE t."fixtureRunId"=r."fixtureRunId")) ORDER BY r."createdAt") FROM portal_access.runtime_acceptance_fixture_run r),
 'missingDeliveries',(SELECT count(*) FROM integration.activity_source s LEFT JOIN integration.outbox_delivery d USING ("agencyId","messageId") WHERE d."messageId" IS NULL),
 'nonterminalJobs',(SELECT count(*) FROM job_runtime.job WHERE state IN ('PENDING','RETRY','RUNNING')),
 'jobStates',(SELECT json_object_agg(state,cnt) FROM (SELECT state,count(*) cnt FROM job_runtime.job GROUP BY state) x),
 'unregisteredTripFingerprint',(SELECT encode(sha256(convert_to(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY t.id),''),'UTF8')),'hex') FROM trip_ops.trip t WHERE NOT EXISTS (SELECT 1 FROM portal_access.runtime_acceptance_fixture_trip f WHERE f."agencyId"=t."agencyId" AND f."tripId"=t.id)),
 'unregisteredSnapshotFingerprint',(SELECT encode(sha256(convert_to(coalesce(string_agg(row_to_json(s)::text,'' ORDER BY s."publicationId"),''),'UTF8')),'hex') FROM trip_ops.publication_snapshot s WHERE NOT EXISTS (SELECT 1 FROM portal_access.runtime_acceptance_fixture_trip f WHERE f."agencyId"=s."agencyId" AND f."tripId"=s."tripId"))
 ); ROLLBACK;'''
 p=subprocess.run(['ssh','-o','BatchMode=yes','travelos-dev','/usr/local/bin/travelos-pg-psql -X -A -t -v ON_ERROR_STOP=1 -d travelos_development'],input=sql,text=True,capture_output=True)
 assert p.returncode==0, 'READ_ONLY_INVENTORY_FAILED'
 return json.loads(next(l for l in p.stdout.splitlines() if l.startswith('{')))

preinventory=base/'preacceptance-inventory.json'
if preinventory.exists(): before=json.loads(preinventory.read_text())
else:
 before=inventory(); preinventory.write_text(json.dumps(before,indent=2)+'\n')
assert before['unresolvedRuns']==0
for mode,unit,count in [('normal','travelos-stage8-runtime-acceptance.service',34),('controlled','travelos-stage8-controlled-acceptance.service',39)]:
 start=time.monotonic()
 startpath=base/(mode+'-start.json')
 if startpath.exists(): start_code=json.loads(startpath.read_text())['exitCode']
 else:
  p=subprocess.run(['ssh','-o','BatchMode=yes','travelos-dev','sudo -n systemctl start '+unit],text=True,capture_output=True,timeout=600)
  start_code=p.returncode
  startpath.write_text(json.dumps({'exitCode':start_code,'elapsedSeconds':round(time.monotonic()-start,3),'stderrSha256':hashlib.sha256(p.stderr.encode()).hexdigest()},indent=2)+'\n')
 fields=ssh('systemctl show '+unit+' -p InvocationID -p ActiveState -p ExecMainStatus -p Result')
 meta=dict(line.split('=',1) for line in fields.splitlines())
 invocation=meta['InvocationID']
 if not invocation:
  journal=ssh('sudo -n journalctl -u '+unit+' --output=json --no-pager')
  candidates=[]
  for line in journal.splitlines():
   entry=json.loads(line)
   try: message=json.loads(entry.get('MESSAGE',''))
   except (ValueError,TypeError): continue
   if isinstance(message,dict) and message.get('artifactId')=='travelos-stage8-gen03-3d6c977d':
    candidates.append(entry['_SYSTEMD_INVOCATION_ID'])
  assert len(set(candidates))==1, 'ONE_EXACT_ARTIFACT_INVOCATION_REQUIRED'
  invocation=candidates[0]
 assert len(invocation)==32
 journal=ssh('sudo -n journalctl _SYSTEMD_INVOCATION_ID='+invocation+' --output=json --no-pager')
 messages=[]
 for line in journal.splitlines():
  entry=json.loads(line)
  try: message=json.loads(entry.get('MESSAGE',''))
  except (ValueError,TypeError): continue
  if isinstance(message,dict) and message.get('result') in ('PASS','FAIL'): messages.append(message)
 reports=[m for m in messages if m.get('stage')=='PHASE_1_M1_STAGE_8']
 assert len(reports)==1, 'EXACT_RUNNER_REPORT_REQUIRED'
 report=reports[0]
 result={'result':report['result'],'mode':mode,'invocationId':invocation,'systemd':meta,'startExitCode':start_code,'invocationSource':'exact artifact preflight journal _SYSTEMD_INVOCATION_ID; inactive DynamicUser oneshot may clear systemctl InvocationID','directRunnerOutput':report,'artifactPreflight':[m for m in messages if 'artifactId' in m],'credentialDirectoryAbsent':ssh('if [ -e /run/credentials/'+unit+' ]; then printf PRESENT; else printf ABSENT; fi')=='ABSENT','stage9Actions':0}
 (base/(mode+'-acceptance.json')).write_text(json.dumps(result,indent=2)+'\n')
 assert start_code==0 and report['result']=='PASS' and report['probeCount']==count
 assert len(report['probes'])+len(report['regressionProbes'])==count
 assert meta['ExecMainStatus']=='0' and meta['ActiveState']=='inactive' and result['credentialDirectoryAbsent']
 assert all(m['artifactId']=='travelos-stage8-gen03-3d6c977d' for m in result['artifactPreflight'])
 if mode=='controlled': ssh('sudo -n systemctl start travelos-worker.service; systemctl is-active travelos-worker.service')
 print(json.dumps({'result':'PASS','mode':mode,'probes':count,'invocationId':invocation}),flush=True)
# Wait only for the real normal worker readiness and post-cleanup outboxes.
after=inventory()
for _ in range(100):
 after=inventory()
 if after['nonterminalJobs']==0 and after['missingDeliveries']==0: break
 time.sleep(.25)
assert after['ledgerCount']==14 and after['migrationHead']=='0014_stage8_worker_activity'
assert after['unresolvedRuns']==after['nonterminalJobs']==after['missingDeliveries']==0
ids={r['id'] for r in (before['runs'] or [])}; added=[r for r in after['runs'] if r['id'] not in ids]
assert len(added)==2
for r in added: assert r['state']=='CLEANED' and r['trips']==r['cancelledTrips']==2 and r['principalRetired'] and r['activePointers']==0
for k in ['unregisteredTripFingerprint','unregisteredSnapshotFingerprint']: assert after[k]==before[k]
after['newRunCount']=len(added); after['result']='PASS'; after['stage9Actions']=0
(base/'postacceptance-inventory.json').write_text(json.dumps(after,indent=2)+'\n')
print(json.dumps({'result':'PASS','newRunsCleaned':len(added),'unregisteredDataUnchanged':True,'stage9Actions':0}))
