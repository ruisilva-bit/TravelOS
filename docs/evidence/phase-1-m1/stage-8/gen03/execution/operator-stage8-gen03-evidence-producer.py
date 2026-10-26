import hashlib,json,os,shutil,subprocess,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
os.chdir(ROOT)
BUNDLE=Path('docs/evidence/phase-1-m1/stage-8/gen03')
STATE=Path('.hermes/state')
def digest(data): return hashlib.sha256(data).hexdigest()
def read(p): return json.loads(Path(p).read_text())
def row(p):
 p=Path(p); b=p.read_bytes(); return {'path':p.as_posix(),'bytes':len(b),'sha256':digest(b)}
def dump(p,data):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('x') as f:f.write(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
def ordered(rows):return sorted(rows,key=lambda r:r['path'].encode())
def aggregate(rows):return digest(b''.join((r['path']+'\0'+str(r['bytes'])+'\0'+r['sha256']+'\n').encode() for r in ordered(rows)))
def scan(files,scope_name):
 scope=STATE/(scope_name+'-scope.json');dump(scope,sorted(set(files)))
 code="import {readFile} from 'node:fs/promises'; import {scanStage8SensitiveFiles} from './tooling/ci/stage-8/source-security-scan.mjs';const files=JSON.parse(await readFile('"+scope.as_posix()+"','utf8'));console.log(JSON.stringify(await scanStage8SensitiveFiles({root:process.cwd(),files})));"
 p=subprocess.run(['node','--input-type=module','--eval',code],capture_output=True,text=True)
 assert p.returncode==0,p.stderr
 result=json.loads(p.stdout);assert result['result']=='PASS' and result['findingCount']==0,json.dumps(result['findings'])
 return result

def verify():
 freeze=read(BUNDLE/'candidate-freeze.json');rows=freeze['entries'];assert len(rows)==freeze['declaredCount'] and len({r['path'] for r in rows})==len(rows)
 assert aggregate(rows)==freeze['aggregateSha256']
 for r in rows: assert row(r['path'])==r,r['path']
 index=read(BUNDLE/'execution/EVIDENCE_INDEX.json')
 assert index['artifactCount']==len(index['artifacts'])
 for r in index['artifacts']:assert row(r['path'])==r,r['path']
 expected={r['path'] for r in index['artifacts']}|{(BUNDLE/'execution/EVIDENCE_INDEX.json').as_posix()}
 actual={p.as_posix() for p in (BUNDLE/'execution').iterdir() if p.is_file()}
 assert expected==actual
 assert aggregate(index['artifacts'])==index['aggregateSha256']
 print(json.dumps({'result':'PASS','freezeEntries':len(rows),'freezeSha256':digest((BUNDLE/'candidate-freeze.json').read_bytes()),'aggregateSha256':freeze['aggregateSha256'],'evidenceArtifacts':index['artifactCount'],'stage9Actions':0}))

if len(sys.argv)>1 and sys.argv[1]=='verify':
 verify();raise SystemExit
assert not BUNDLE.exists(),'Refuse to overwrite a candidate evidence generation'
ci=read(STATE/'stage8-gen03-canonical-ci-receipt.json');assert ci['result']=='PASS' and ci['invocationCount']==1 and ci['completedGateCount']==32
assert digest(Path(ci['logPath']).read_bytes())==ci['logSha256']
assert digest((STATE/'stage8-gen03-artifact.tar.gz').read_bytes())==ci['artifactSha256']
ct=STATE/'stage8-gen03-ct200'
for name in ['backup-restore.json','acl-restore.json','deployment.json','normal-acceptance.json','controlled-acceptance.json','postacceptance-inventory.json','final-runtime-smoke.json','restore-probes-absence.json']:
 assert read(ct/name)['result']=='PASS',name
stage=STATE/'stage8-gen03-evidence-staging';stage.mkdir(exist_ok=False);(stage/'execution').mkdir()
files={}
def add(source,name=None):
 source=Path(source);name=name or source.name
 assert source.is_file() and not source.is_symlink() and name not in files
 files[name]=source
for p in ct.iterdir():
 if p.is_file() and not p.name.endswith('.raw.jsonl'):add(p)
for p in (STATE/'stage8-gen03-local-qualification-final').iterdir():add(p,'qualification-'+p.name)
for name in ['canonical-ci-receipt.json','canonical-ci-claim.json','canonical-ci.log','artifact-build.json','preflight.json','readonly-preflight.json','pve-preci-attempt02.json','pve-predeploy.json','pve-final.json','pve-postscan.json','extracted-verify-final.json','installer-check.json']:
 add(STATE/('stage8-gen03-'+name),name)
add(STATE/'stage8-gen03-artifact/provenance/source-snapshot.json','source-snapshot.json')
pglog=(STATE/'stage8-gen03-local-qualification-final/test-stage8-postgres.log').read_text()
import re
pg=Path(re.findall(r'"evidence":"([^"]+)","result":"PASS"',pglog)[-1])
for name in ['execution.json','postgresql-package-provenance.json','integration-tests.log']:add(pg/name,'postgresql-'+name)
for p in STATE.glob('stage8-gen03-*.py'):add(p,'operator-'+p.name)
add('/home/hermes/.hermes/cache/scratch/travelos-stage8-pve-verify.py','operator-pve-verify.py')
# The rejected candidate's changed source is retained in its existing Git commit, never replaced in its old freeze.
historical=read('docs/evidence/phase-1-m1/stage-8/gen02/candidate-freeze.json');historicalRows=[]
for r in historical['entries']:
 b=Path(r['path']).read_bytes();origin='WORKTREE_UNCHANGED_EVIDENCE'
 if digest(b)!=r['sha256']:
  p=subprocess.run(['git','show','f84d60d07ad9747649245a3a17ab0cf1b7080f1f:'+r['path']],capture_output=True);assert p.returncode==0
  b=p.stdout;origin='IMMUTABLE_GEN02_GIT_BLOB'
 assert len(b)==r['bytes'] and digest(b)==r['sha256'],r['path']
 historicalRows.append({'path':r['path'],'origin':origin,'sha256':digest(b)})
dump(stage/'execution/rejected-gen02-preservation.json',{'result':'PASS','entries':len(historicalRows),'sourceCommit':'f84d60d07ad9747649245a3a17ab0cf1b7080f1f','freezeSha256':digest(Path('docs/evidence/phase-1-m1/stage-8/gen02/candidate-freeze.json').read_bytes()),'recommendation':'NO-GO_PRESERVED','rows':historicalRows})
for name,p in files.items():shutil.copyfile(p,stage/'execution'/name)
# Publish once after all input copies succeeded; every later verification is read-only.
BUNDLE.parent.mkdir(parents=True,exist_ok=True);stage.rename(BUNDLE)
artifacts=ordered([row(p) for p in (BUNDLE/'execution').iterdir()])
dump(BUNDLE/'execution/EVIDENCE_INDEX.json',{'schemaVersion':1,'artifactCount':len(artifacts),'artifacts':artifacts,'aggregateSerialization':'UTF8(path + NUL + decimal(bytes) + NUL + lowercase sha256 + LF), UTF8 path order, terminal LF included','aggregateSha256':aggregate(artifacts)})
snapshot=read(BUNDLE/'execution/source-snapshot.json');assert digest((BUNDLE/'execution/source-snapshot.json').read_bytes())==ci['sourceSnapshotSha256']
for r in snapshot['files']:assert row(r['path'])==r
# Only Stage8 source delta plus explicitly enumerated evidence, not broad untracked local state.
changed=set(subprocess.check_output(['git','diff','--name-only','a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec','--'],text=True).splitlines())
changed.update(subprocess.check_output(['git','ls-files','--others','--exclude-standard'],text=True).splitlines())
source=[r['path'] for r in snapshot['files'] if r['path'] in changed]
validation={'schemaVersion':1,'candidate':'gen03','result':'PASS_AUTHOR_VALIDATION','independentReview':'PENDING_REQUIRED','artifactSha256':ci['artifactSha256'],'artifactId':ci['artifactId'],'sourceSnapshotSha256':ci['sourceSnapshotSha256'],'sourceBaselineCommit':'f84d60d07ad9747649245a3a17ab0cf1b7080f1f','sourceIdentity':'WORKING_TREE_CONTENT_SNAPSHOT_NOT_BASELINE_COMMIT','ci':{'result':'PASS','invocationCount':1,'gates':32,'receiptSha256':digest((BUNDLE/'execution/canonical-ci-receipt.json').read_bytes())},'tests':{'unit':230,'postgresql':75,'stage6':3,'stage7':38,'stage8':34,'normalProbes':34,'controlledProbes':39},'ct200':read(ct/'deployment.json'),'metrics':read(ct/'final-runtime-smoke.json')['metrics'],'findings':{'S8-OBS-001':'CORRECTED_PENDING_INDEPENDENT_ADJUDICATION','S8-OBS-002':'CORRECTED_PENDING_INDEPENDENT_ADJUDICATION'},'limitations':['DEVELOPMENT only; not production approval or production signing.','Null catalog ACLs compared using PostgreSQL acldefault; raw comparison discrepancy preserved, not concealed.','First normal acceptance harness lost inactive oneshot InvocationID; exact invocation and direct 34-probe report recovered from journal artifact-preflight identity, without replaying acceptance.','Initial postdeployment smoke assumed curl existed; corrected to installed Python urllib, no candidate source or system configuration changed.','Evidence producer and operator helpers are closure tooling, not part of the application source snapshot; their exact bytes are frozen here.'],'stage9Actions':0}
dump(BUNDLE/'candidate-validation.json',validation)
paths=source+[p.as_posix() for p in (BUNDLE/'execution').iterdir()]+[(BUNDLE/'candidate-validation.json').as_posix()]
paths=sorted(set(paths));pre=scan(paths,'stage8-gen03-final2-prefreeze');dump(STATE/'stage8-gen03-final2-prefreeze-scan.json',pre)
entries=ordered([row(p) for p in paths]);assert entries==ordered([row(p) for p in paths])
freeze={'schemaVersion':1,'candidate':'gen03','state':'FROZEN_FOR_INDEPENDENT_REVIEW','declaredCount':len(entries),'entries':entries,'aggregateSerialization':'UTF8(path + NUL + decimal(bytes) + NUL + lowercase sha256 + LF), UTF8 path order, terminal LF included','aggregateSha256':aggregate(entries),'artifactSha256':ci['artifactSha256'],'sourceSnapshotSha256':ci['sourceSnapshotSha256'],'sourceDelta':source,'predecessor':'a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec','rejectedGen02SourceCommit':'f84d60d07ad9747649245a3a17ab0cf1b7080f1f','selfExcluded':(BUNDLE/'candidate-freeze.json').as_posix(),'stage9Actions':0}
dump(BUNDLE/'candidate-freeze.json',freeze)
final=scan(paths+[(BUNDLE/'candidate-freeze.json').as_posix()],'stage8-gen03-final2-postfreeze');final.update(candidate='gen03',phase='POST_FREEZE_READ_ONLY',candidateFreezeSha256=digest((BUNDLE/'candidate-freeze.json').read_bytes()))
dump(BUNDLE/'final-candidate-scan.json',final)
verify()
