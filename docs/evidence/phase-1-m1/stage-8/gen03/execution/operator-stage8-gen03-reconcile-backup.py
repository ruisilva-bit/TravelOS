import hashlib,json,re
from pathlib import Path
base=Path('.hermes/state/stage8-gen03-ct200')
receipt=json.loads((base/'backup-restore.receipt.json').read_text());assert receipt['exitCode']==0
raw=(base/'backup-restore.stdout.log').read_text();assert hashlib.sha256(raw.encode()).hexdigest()==receipt['stdoutSha256']
decoder=json.JSONDecoder();objects=[];position=raw.index('{')
while position<len(raw) and raw[position]=='{':
 value,n=decoder.raw_decode(raw[position:]);objects.append(value);position+=n
 while position<len(raw) and raw[position].isspace():position+=1
assert len(objects)==2 and objects[0]==objects[1]
assert len(objects[0]['ledger'])==14 and objects[0]['ledger'][-1]['name']=='0014_stage8_worker_activity'
assert raw.splitlines()[-2]=='0' and raw.splitlines()[-1]=='/opt/travelos/releases/travelos-stage8-gen02-b8c47d7b'
backup=re.search(r'path=(\S+) owner=postgres:postgres mode=600 bytes=(\d+)',raw);assert backup
h=re.search(r'\n([a-f0-9]{64})  '+re.escape(backup[1]),raw);assert h
report={'result':'PASS','target':{'node':'pxmx2','ctid':200,'environment':'DEVELOPMENT'},'backupPath':backup[1],'backupBytes':int(backup[2]),'backupSha256':h[1],'backupMode':'0600','probeDroppedAndAbsenceVerified':True,'sourceRestoreParity':objects[0],'aclParityClaimed':False,'limitation':'information_schema filtered by the login returned null for travelos_worker (privileges are assigned through travelos_worker_runtime); no ACL parity claim is inferred. Real application role privileges are qualified separately. Initial JSON parser assumed one-line JSON and failed after successful remote cleanup; this receipt decodes the original multi-line stream without repeating backup/restore.','stage9Actions':0}
with (base/'backup-restore.json').open('x') as f:f.write(json.dumps(report,indent=2)+'\n')
print(json.dumps({'result':'PASS','backupSha256':h[1],'probeDroppedAndAbsenceVerified':True,'originalExecutionReplayed':False}))
