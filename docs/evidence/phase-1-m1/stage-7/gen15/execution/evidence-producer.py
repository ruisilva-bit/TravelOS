import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

ROOT=Path.cwd()
STATE=ROOT/'.hermes/state'
EVID=Path('docs/evidence/phase-1-m1/stage-7/gen15')
EXEC=EVID/'execution'
BASE=Path('docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_GEN15.json')
INDEX=EXEC/'EVIDENCE_INDEX.json'
VALIDATION=EVID/'candidate-validation.json'
FREEZE=EVID/'candidate-freeze.json'
COMMIT='5609bcb44edb9baa2d10ff43e7e69c356de6ca35'

def digest(data): return hashlib.sha256(data).hexdigest()
def encode(value): return (json.dumps(value,indent=2,ensure_ascii=False)+'\n').encode()
def load(p): return json.loads((ROOT/p).read_bytes())
def row(p):
    p=Path(p)
    absolute=ROOT/p
    assert absolute.is_file() and not absolute.is_symlink(),str(p)
    data=absolute.read_bytes()
    return {'path':p.as_posix(),'bytes':len(data),'sha256':digest(data)}
def ordered(paths): return sorted(set(str(p) for p in paths),key=lambda p:p.encode('utf-8'))
def collect(paths): return [row(p) for p in ordered(paths)]
def aggregate(rows): return digest(''.join(r['path']+'\0'+str(r['bytes'])+'\0'+r['sha256']+'\n' for r in rows).encode())
def once(p,data):
    p=ROOT/p
    p.parent.mkdir(parents=True,exist_ok=True)
    if p.exists(): assert p.read_bytes()==data,'Divergent existing evidence: '+str(p)
    else:
        with p.open('xb') as f: f.write(data)
def verify_source():
    b=load(BASE)
    assert b['candidateGeneration']=='gen15' and b['candidateCommit']==COMMIT and b['stage8Actions']==0
    assert b['sourceCount']==len(b['sourceFiles'])==114
    for expected in b['sourceFiles']:
        actual=row(expected['path'])
        assert actual['sha256']==expected['sha256'] and actual['bytes']==expected['bytes'],actual['path']
    return b

def execution_validation():
    ci=load(EVID/'canonical-ci-execution.json')
    log=(ROOT/EVID/'canonical-ci.log').read_bytes()
    assert ci['result']=='PASS' and ci['invocationCount']==1 and ci['ciConsumed']=='YES'
    assert ci['candidateCommit']==COMMIT and ci['completedGateCount']==ci['expectedGateCount']==len(ci['gates'])==42
    assert all(x['result']=='PASS' and x['exitCode']==0 for x in ci['gates'])
    assert digest(log)==ci['logSha256'] and len(log)==ci['logBytes']
    assert json.loads(log.decode().split('=== TRAVELOS_STAGE7_CANONICAL_CI_RESULT ===',1)[1])==ci['finalMarker']
    assert digest((STATE/'stage7-gen15-canonical-ci-guard.json').read_bytes())==ci['guardSha256']
    report=load(STATE.relative_to(ROOT)/'stage7-gen15-ct200-runtime-acceptance.json')
    rehearsal=load(STATE.relative_to(ROOT)/'stage7-gen15-packaged-rehearsal.json')
    assert report['result']=='PASS' and report['probes']==rehearsal['probes'] and len(report['probes'])==25
    summary=load(STATE.relative_to(ROOT)/'stage7-gen15-ct200-acceptance-summary.json')
    assert summary['result']=='PASS' and summary['registeredRunsCleaned']==1 and summary['registeredTripsCancelled']==2
    assert summary['activeFixtureGrants']==summary['activeFixturePublications']==summary['liveFixturePortalSessions']==summary['liveAcceptanceStaffSessions']==0
    assert summary['oneShotInactive'] and summary['credentialDirectoryAbsent'] and summary['unregisteredHistoricalRowsPreserved']
    assert report['stage8Actions']==ci['stage8Actions']==summary['stage8Actions']==0
    return ci,report,summary,log

def materialize():
    b=verify_source()
    ci,report,summary,log=execution_validation()
    payload={}
    sources={}
    def add(name,source):
        p=Path(source)
        assert p.is_file() and not p.is_symlink(),str(p)
        assert name not in payload
        payload[name]=p.read_bytes()
        sources[name]={'sourcePath':str(p),'sourceSha256':digest(payload[name]),'transform':'BYTE_IDENTICAL_COPY'}
    for suffix in ['artifact-build.json','artifact-verify.json','packaged-rehearsal.json','packaged-rehearsal.log','canonical-ci-guard.json','canonical-ci-claim.json','final-source-scope.json','cleanup.json']:
        add(suffix,STATE/('stage7-gen15-'+suffix))
    for p in sorted(STATE.glob('stage7-gen15-ct200-*.json')):
        add(p.name.removeprefix('stage7-gen15-'),p)
    for suffix in ['ct200-migration-up.log','ct200-migration-noop.log']:
        add(suffix,STATE/('stage7-gen15-'+suffix))
    add('ct200-prestate.json',Path('/home/hermes/.hermes/cache/scratch/stage7-gen15-ct200-prestate.json'))
    add('canonical-ci-execution.json',ROOT/EVID/'canonical-ci-execution.json')
    add('canonical-ci.log',ROOT/EVID/'canonical-ci.log')
    for suffix in ['predeploy.py','stage-payload.py','install-migrate.py','activate-accept.py']:
        add('operator-'+suffix,STATE/('stage7-gen15-'+suffix))
    add('final-inventory.sql',Path('/home/hermes/.hermes/cache/scratch/stage7-gen15-final-inventory.sql'))
    add('sensitive-scan.mjs',STATE/'stage7-gen15-final-scan.mjs')
    add('evidence-producer.py',Path(__file__).resolve())
    add('release.json',STATE/'stage7-gen15-artifact/release.json')
    text=re.sub(r'\x1b\[[0-9;]*m','',log.decode())
    def section(label):
        marker='=== TravelOS Stage 7 CI gate: '+label
        assert marker in text,label
        return text.split(marker,1)[1].split('=== TravelOS Stage 7 CI gate:',1)[0]
    unit_match=re.search(r'Tests\s+(\d+) passed',section('test:unit'))
    pg_match=re.search(r'Tests\s+(\d+) passed',section('test:stage7:postgres'))
    assert unit_match is not None and pg_match is not None
    unit=unit_match.group(1)
    pg=pg_match.group(1)
    assert int(unit)==212 and int(pg)==38
    payload['child-pin-report.log']=section('verify:pins').encode()
    sources['child-pin-report.log']={'sourcePath':str(EVID/'canonical-ci.log'),'sourceSha256':ci['logSha256'],'transform':'EXACT_CHILD_GATE_SECTION_WITH_ANSI_COLOR_REMOVED'}
    notes={'schemaVersion':1,'owner':'Alex','result':'PASS','classification':'INTERNAL_SYNTHETIC_DEVELOPMENT_EXECUTION_EVIDENCE','credentialValuesRetained':False,'ciGates':len(ci['gates']),'unitTests':int(unit),'stage7PostgresqlTests':int(pg),'ct200AssertionProbes':len(report['probes']),'executionEvidenceSources':sources,'normalization':'Some operator receipts were parsed from actual stdout and pretty-serialized without dropping assertion fields; runtime-acceptance.json preserves the exact journal MESSAGE plus one newline. No execution assertion was reconstructed from exit status or SQL.','journalFilter':'Exact systemd invocation; only JSON MESSAGE containing probes; metadata keys MESSAGE,__REALTIME_TIMESTAMP,_SYSTEMD_INVOCATION_ID.','caddyProbeCorrection':{'firstProbe':'127.0.0.1:80 refused; no Caddy loopback binding','secondProbe':'LAN host root path returned404 because this Caddy forwards to API, not a SPA','verifiedTopology':'Existing Caddy192.168.1.33:80 forwards /health/live to APIs; allowed hosts200; unknown host421. APIs independently return404 for unknown Host. No Caddy/listener/firewall change was made.','hashClaimBoundary':'The activation receipt field named caddyConfigUnchangedSha256 is an observation after activation, matched again in final poststate; it is not a byte-for-byte pre-task Caddy baseline.'},'backupPermissions':'Approved backup helper initially emitted mode664. The newly created backup alone was immediately restricted to0600 before release staging; exact SHA and mode were read back. Original receipt and restriction receipt are both preserved. No claim is made about unobserved reads during the initial interval.','retention':'Only the registered gen15 fixture is retired/cancelled. Immutable snapshots/audit/outbox and unrelated or unregistered historical rows are retained. Pre/post row fingerprints prove unregistered Trip and snapshot bytes unchanged.','scope':'CT200 DEVELOPMENT only; no production, new credential, listener, public exposure, root SSH/sudoers change, direct auth-table edit, push or Stage8.','stage8Actions':0}
    payload['evidence-provenance.json']=encode(notes)
    rows=[{'path':(EXEC/name).as_posix(),'bytes':len(data),'sha256':digest(data),'execution':None if name in ['evidence-provenance.json','evidence-producer.py','sensitive-scan.mjs','final-inventory.sql','release.json'] or name.startswith('operator-') else {'source':sources.get(name,{}),'kind':'PERSISTED_ACTUAL_TOOL_OR_RUNNER_OUTPUT'}} for name,data in sorted(payload.items())]
    index={'schemaVersion':1,'candidateGeneration':'gen15','candidateCommit':COMMIT,'artifactSha256':ci['artifactSha256'],'artifactCount':len(rows),'artifacts':rows,'aggregateSerialization':'UTF8(path + NUL + decimal(bytes) + NUL + lowercase sha256 + LF), ordered by UTF8 path bytes; terminal LF included','aggregateSha256':aggregate(rows),'executionDirectory':EXEC.as_posix(),'selfExcluded':INDEX.as_posix(),'stage8Actions':0}
    payload['EVIDENCE_INDEX.json']=encode(index)
    if (ROOT/EXEC).exists():
        assert {p.name for p in (ROOT/EXEC).iterdir()}==set(payload)
        assert all((ROOT/EXEC/name).read_bytes()==data for name,data in payload.items())
    else:
        staging=Path(tempfile.mkdtemp(prefix='travelos-gen15-evidence-',dir=os.environ['TMPDIR']))
        for name,data in payload.items():
            with (staging/name).open('xb') as f: f.write(data)
        assert {p.name for p in staging.iterdir()}==set(payload)
        assert all((staging/name).read_bytes()==data for name,data in payload.items())
        os.rename(staging,ROOT/EXEC)
    logs=['canonical-ci.log']+['execution/'+name for name in payload if name.endswith('.log')]
    attributes='# Preserve exact archived execution output; no application-source exception.\n'+''.join(name+' whitespace=-blank-at-eol,-blank-at-eof\n' for name in sorted(logs))
    once(EVID/'.gitattributes',attributes.encode())
    verify_index()
    paths=ordered([r['path'] for r in b['sourceFiles']]+[str(BASE),str(INDEX),str(EVID/'.gitattributes'),str(EVID/'canonical-ci.log'),str(EVID/'canonical-ci-execution.json')]+[r['path'] for r in rows])
    once(STATE.relative_to(ROOT)/'stage7-gen15-pre-freeze-scan-input.json',encode({'phase':'PRE_FREEZE_SOURCE_AND_FINAL_EVIDENCE','files':paths}))
    print(json.dumps({'result':'PASS','executionArtifacts':len(rows),'sourceRows':b['sourceCount'],'indexSha256':digest((ROOT/INDEX).read_bytes()),'scanInput':'.hermes/state/stage7-gen15-pre-freeze-scan-input.json'},indent=2))

def verify_index():
    index=load(INDEX)
    rows=index['artifacts']
    assert index['artifactCount']==len(rows)==len({r['path'] for r in rows})
    assert {p.name for p in (ROOT/EXEC).iterdir()}=={Path(r['path']).name for r in rows}|{'EVIDENCE_INDEX.json'}
    for r in rows: assert row(r['path'])=={k:r[k] for k in ['path','bytes','sha256']},r['path']
    assert aggregate(rows)==index['aggregateSha256']
    return index

def freeze():
    b=verify_source(); index=verify_index(); ci,report,summary,_=execution_validation()
    scan=load(EVID/'pre-freeze-scan.json')
    assert scan['result']=='PASS' and scan['phase']=='PRE_FREEZE_SOURCE_AND_FINAL_EVIDENCE' and not scan['findings']
    paths=load(STATE.relative_to(ROOT)/'stage7-gen15-pre-freeze-scan-input.json')['files']
    assert set(paths)==set(scan['paths']) and str(INDEX) in paths
    validation={'schemaVersion':1,'candidateGeneration':'gen15','candidateCommit':COMMIT,'author':'Alex','result':'PASS_AUTHOR_VALIDATION','independentReview':'PENDING_REQUIRED','finalCandidateScan':'PENDING_POST_FREEZE_READ_ONLY_SCAN','sourceRows':b['sourceCount'],'sourceAggregateSha256':b['sourceAggregateSha256'],'baselinePath':BASE.as_posix(),'baselineSha256':digest((ROOT/BASE).read_bytes()),'artifactSha256':ci['artifactSha256'],'ci':{'result':ci['result'],'invocationCount':ci['invocationCount'],'completedGateCount':ci['completedGateCount'],'expectedGateCount':ci['expectedGateCount'],'receiptSha256':digest((ROOT/EVID/'canonical-ci-execution.json').read_bytes()),'logSha256':ci['logSha256']},'evidenceIndex':{'path':INDEX.as_posix(),'sha256':digest((ROOT/INDEX).read_bytes()),'artifactCount':index['artifactCount'],'aggregateSha256':index['aggregateSha256']},'preFreezeScan':{'path':(EVID/'pre-freeze-scan.json').as_posix(),'sha256':digest((ROOT/EVID/'pre-freeze-scan.json').read_bytes()),'result':scan['result'],'filesScanned':scan['filesScanned']},'ct200':summary,'scope':'Phase1 M1 Stage7, CT200 DEVELOPMENT. This author validation is not independent GO. Immutable retained history is not physically deleted. No production readiness or whole-host immutability claim.','stage7Actions':1,'stage8Actions':0}
    once(VALIDATION,encode(validation))
    freeze_paths=ordered(paths+[str(EVID/'pre-freeze-scan.json'),str(VALIDATION)])
    assert str(FREEZE) not in freeze_paths
    first=collect(freeze_paths); second=collect(freeze_paths)
    assert first==second and aggregate(first)==aggregate(second)
    output={'schemaVersion':1,'candidateGeneration':'gen15','candidateCommit':COMMIT,'artifactSha256':ci['artifactSha256'],'state':'FROZEN_PENDING_FINAL_SCAN_AND_INDEPENDENT_REVIEW','declaredCount':len(first),'entries':first,'aggregateSerialization':'UTF8(path + NUL + decimal(bytes) + NUL + lowercase sha256 + LF), ordered by UTF8 path bytes; terminal LF included','aggregateSha256':aggregate(first),'twoReadOnlyCollectionsIdentical':True,'selfExcludedPath':FREEZE.as_posix(),'excludedDerivedOutputs':[(EVID/'final-candidate-scan.json').as_posix(),'docs/reviews/phase-1-m1/stage-7/GEN15_INDEPENDENT_REVIEW.json','docs/reviews/phase-1-m1/stage-7/GEN15_CLOSURE.md'],'stage7Actions':1,'stage8Actions':0}
    once(FREEZE,encode(output))
    once(STATE.relative_to(ROOT)/'stage7-gen15-final-scan-input.json',encode({'phase':'FINAL_CANDIDATE','files':ordered(freeze_paths+[str(FREEZE)]),'freezePath':FREEZE.as_posix(),'validationPath':VALIDATION.as_posix()}))
    verify()

def verify():
    verify_source(); index=verify_index(); freeze=load(FREEZE)
    rows=freeze['entries']; assert freeze['declaredCount']==len(rows)==len({r['path'] for r in rows})
    assert str(FREEZE) not in {r['path'] for r in rows}
    actual=collect([r['path'] for r in rows])
    assert actual==rows and aggregate(actual)==freeze['aggregateSha256']
    print(json.dumps({'result':'PASS','candidateGeneration':'gen15','declared':freeze['declaredCount'],'parsed':len(rows),'matched':len(actual),'duplicates':0,'missing':0,'mismatched':0,'extraRows':0,'aggregateSha256':freeze['aggregateSha256'],'freezeSha256':digest((ROOT/FREEZE).read_bytes()),'evidenceArtifacts':index['artifactCount'],'sourceRows':114,'stage8Actions':0},indent=2))

assert len(sys.argv)==2 and sys.argv[1] in ['materialize','freeze','verify']
{'materialize':materialize,'freeze':freeze,'verify':verify}[sys.argv[1]]()
