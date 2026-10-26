import hashlib,json,subprocess
from pathlib import Path
base=Path('.hermes/state/stage8-gen03-ct200')
script='''import json,os,stat,time,subprocess,urllib.request
from pathlib import Path
root=Path('/opt/travelos/current').resolve()
assert str(root)=='/opt/travelos/releases/travelos-stage8-gen03-3d6c977d'
units=['travelos-admin-api.service','travelos-portal-api.service','travelos-worker.service']
states={u:subprocess.check_output(['systemctl','is-active',u],text=True).strip() for u in units}
assert all(x=='active' for x in states.values())
runtime=Path('/run/travelos-worker');metrics=runtime/'metrics.prom';health=json.loads((runtime/'health.json').read_text())
assert health['ready'] and health['live'] and time.time()*1000-health['checkedAt']<30000
assert stat.S_IMODE(runtime.stat().st_mode)==0o700 and stat.S_IMODE(metrics.stat().st_mode)==0o600
assert time.time()-metrics.stat().st_mtime<30
expected=['travelos_worker_stats_available','travelos_worker_jobs_pending','travelos_worker_jobs_oldest_pending_seconds','travelos_worker_jobs_running','travelos_worker_jobs_retries','travelos_worker_jobs_dead_letters','travelos_worker_jobs_unknown_outcomes','travelos_worker_jobs_expired_leases']
contents=metrics.read_text();samples={}
for line in contents.splitlines():
 if line.startswith('#'):continue
 name,value=line.split(' ');assert name in expected and value.isdigit();samples[name]=int(value)
assert list(samples)==expected and samples['travelos_worker_stats_available']==1 and '{' not in contents
checks=[]
for address,host,expectedCode in [('127.0.0.1:3101','admin.travelos.test',200),('127.0.0.1:3101','unlisted.travelos.test',404),('127.0.0.1:3102','portal.travelos.test',200),('127.0.0.1:3102','unlisted.travelos.test',404),('192.168.1.33:80','admin.travelos.test',200),('192.168.1.33:80','portal.travelos.test',200),('192.168.1.33:80','unlisted.travelos.test',421)]:
 request=urllib.request.Request('http://'+address+'/health/live',headers={'Host':host})
 try:
  with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=5) as response: code=response.status
 except urllib.error.HTTPError as error: code=error.code
 assert code==expectedCode
 checks.append({'listener':address,'host':host,'status':code,'expected':expectedCode})
for unit in ['travelos-stage8-runtime-acceptance.service','travelos-stage8-controlled-acceptance.service']:
 assert subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','--value'],text=True).strip()=='inactive'
 assert not Path('/run/credentials/'+unit).exists()
assert not Path('/home/hermes/travelos-stage8-gen03-3d6c977d.tar.gz').exists()
print(json.dumps({'result':'PASS','release':str(root),'services':states,'health':{'live':health['live'],'ready':health['ready']},'metrics':{'samples':samples,'fileMode':'0600','directoryMode':'0700','fresh':True,'labels':False},'httpChecks':checks,'oneShotsInactive':True,'ephemeralCredentialDirectoriesAbsent':True,'transportAbsent':True,'stage9Actions':0}))
'''
p=subprocess.run(['ssh','-o','BatchMode=yes','travelos-dev','sudo -n python3 -'],input=script,text=True,capture_output=True)
if p.returncode:
 (base/'final-runtime-smoke-failure.stderr.log').write_text(p.stderr)
 print(p.stderr)
 raise RuntimeError('FINAL_RUNTIME_SMOKE_FAILED')
r=json.loads(p.stdout)
(base/'final-runtime-smoke.json').write_text(json.dumps(r,indent=2)+'\n')
p=subprocess.run(['ssh','-o','BatchMode=yes','travelos-dev',"/usr/local/bin/travelos-pg-psql -X -A -t -d postgres -c \"SELECT count(*) FROM pg_database WHERE datname LIKE 'travelos_stage8_gen03_acl_%'\""],text=True,capture_output=True)
assert p.returncode==0 and p.stdout.strip()=='0'
(base/'restore-probes-absence.json').write_text(json.dumps({'result':'PASS','matchingRemainingDatabases':0})+'\n')
print(json.dumps({'result':'PASS','release':r['release'],'httpChecks':len(r['httpChecks']),'metrics':len(r['metrics']['samples']),'privateMetrics':True,'stage9Actions':0}))
