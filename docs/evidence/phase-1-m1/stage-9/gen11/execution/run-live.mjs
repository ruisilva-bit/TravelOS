import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {ARTIFACT,SOURCE,ADMIN,PORTAL,validateRun,syntheticAccounts,publicResult} from './policy.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'../../..');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const sha=value=>createHash('sha256').update(value).digest('hex');
const preflight=process.argv.includes('--readonly-preflight');
const marker='stage9-final-'+randomUUID();
validateRun({marker,adminOrigin:ADMIN,portalOrigin:PORTAL,artifactId:ARTIFACT});
const report={schemaVersion:1,result:'FAIL',phase:'source-binding',artifactId:ARTIFACT,sourceSnapshotSha256:SOURCE,marker,actor:'Alex — dedicated synthetic invitation-created Trip Operations Staff, never Owner for business QA',environment:'CT200 DEVELOPMENT through actual Caddy/Admin/Portal APIs',startedAt:new Date().toISOString(),resources:{},probes:[],cleanup:{ownerSessionRevoked:false,ownedBrowserContextsClosed:false,issuedGrantsRevoked:false,retention:'Synthetic identities, Trip/Customer/Traveller/items, immutable publication/audit/outbox records retained under the unique marker; no invented hard-delete endpoint or SQL deletion.'},stage10Actions:0};
const nativeLaunch=chromium.launch.bind(chromium);
const launched=[];
let processRemote;let setupBrowser;let setupContext;let staffContext;let qaCookie;let prepared;let remoteLines;let cleanupFailure=false;let launchedCount=0;let operatorFinished=false;let localFailure;
const accounts=Object.fromEntries(Object.entries(syntheticAccounts(marker)).map(([kind,email])=>[kind,{email,password:randomBytes(32).toString('base64url')} ]));
const rpc=async command=>{
 processRemote.stdin.write(JSON.stringify(command)+'\n');const line=await remoteLines.next();assert.ok(!line.done,'OPERATOR_EOF');const value=JSON.parse(line.value);
 if(value.event==='ERROR'){report.code=value.code;report.execution={operatorFailurePhase:value.phase,operatorDetailCode:value.detailCode};report.cleanup.ownerSessionRevoked=value.ownerSessionRevoked===true;throw new Error('OPERATOR_REJECTED');}return value;
};
const request=({origin=ADMIN,method='GET',route,body,cookie})=>new Promise((resolve,reject)=>{
 assert.ok([ADMIN,PORTAL].includes(origin));assert.ok(route.startsWith('/api/')&&!route.includes('?token='));
 const payload=body===undefined?undefined:Buffer.from(JSON.stringify(body));const headers={host:new URL(origin).host,accept:'application/json'};if(method!=='GET')headers.origin=origin;if(cookie)headers.cookie=cookie;
 if(payload){headers['content-type']='application/json';headers['content-length']=payload.length;}
 const req=http.request({host:'192.168.1.33',port:80,method,path:route,headers,timeout:15000},res=>{const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>2097152)req.destroy();else chunks.push(chunk);});res.on('end',()=>{try{const text=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,body:text?JSON.parse(text):null});}catch{reject(new Error('INVALID_RESPONSE'));}});});req.on('error',()=>reject(new Error('REQUEST_FAILED')));req.on('timeout',()=>req.destroy());if(payload)req.write(payload);req.end();
});
const cookieFor=async(context,origin)=>(await context.cookies(origin)).filter(value=>value.value).map(value=>value.name+'='+value.value).join('; ');
chromium.launch=async options=>{
 const args=(options?.args??[]).filter(value=>!value.startsWith('--host-resolver-rules='));
 args.push('--host-resolver-rules=MAP admin.travelos.test 192.168.1.33, MAP portal.travelos.test 192.168.1.33','--no-proxy-server');
 const browser=await nativeLaunch({...options,args});launchedCount++;const close=browser.close.bind(browser);let closed=false;
 browser.close=async()=>{if(closed)return;closed=true;for(const context of browser.contexts()){for(const origin of [ADMIN,PORTAL]){const cookie=await cookieFor(context,origin);if(!cookie)continue;try{const realm=origin===ADMIN?'staff':'portal';const out=await request({origin,method:'POST',route:'/api/auth/'+realm+'/sign-out',body:{},cookie});assert.equal(out.status,200);const check=await request({origin,route:origin===ADMIN?'/api/staff/session-context':'/api/portal/session-context',cookie});assert.equal(check.status,401);}catch{cleanupFailure=true;}}}await close();};launched.push(browser);return browser;
};
const grantIds=[];
try{
 const snapshotFile=ROOT+'/.hermes/state/stage9-gen11-extracted/provenance/source-snapshot.json';
 const {sourceSnapshot}=await import(pathToFileURL(ROOT+'/tooling/ci/stage-9/source-snapshot.mjs'));
 const actual=await sourceSnapshot(ROOT);assert.equal(actual.sha256,SOURCE);assert.deepEqual(actual.bytes,await readFile(snapshotFile));
 const driver=await readFile(HERE+'/operator.mjs','utf8');
 const unit='travelos-stage9-browser-qa-'+marker.slice(-8);
 const remote=['sudo','-n','systemd-run','--quiet','--pipe','--wait','--collect','--unit='+unit,'-p','DynamicUser=yes','-p','NoNewPrivileges=yes','-p','ProtectSystem=strict','-p','ProtectHome=yes','-p','PrivateTmp=yes','-p','RuntimeMaxSec=900'];
 if(!preflight){for(const name of ['stage7-staff-email','stage7-staff-password','stage7-staff-totp','portal-api-db','portal-auth-realm'])remote.push('-p','LoadCredentialEncrypted='+name+':/etc/credstore.encrypted/travelos-'+name);}
 remote.push('/opt/travelos/releases/'+ARTIFACT+'/runtime/node/bin/node','--input-type=module','-e',driver);if(preflight)remote.push('--','--readonly-preflight');
 processRemote=spawn('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','travelos-dev',remote.map(quote).join(' ')],{stdio:['pipe','pipe','ignore']});
 remoteLines=createInterface({input:processRemote.stdout,crlfDelay:Infinity})[Symbol.asyncIterator]();
 if(preflight){const line=await remoteLines.next();assert.ok(!line.done);const out=JSON.parse(line.value);assert.equal(out.event,'PREFLIGHT');assert.equal(out.credentialValuesRead,false);assert.equal(out.nativePortalEnrollment,true);report.result='PASS';report.phase='readonly-preflight';report.execution={nativeOperatorPreflight:out,operatorSha256:sha(driver),sourceBytesUnchanged:true};}
 else{
  report.phase='native-test-identity-preparation';prepared=await rpc({action:'prepare',marker,accounts});assert.equal(prepared.event,'PREPARED');assert.equal(prepared.artifactId,ARTIFACT);assert.match(prepared.token,/^[A-Za-z0-9_-]{43}$/u);
  report.resources.invitationId=prepared.invitationId;report.resources.authorizedPortalPrincipalId=prepared.portalIds.authorized;report.resources.ungrantedPortalPrincipalId=prepared.portalIds.ungranted;
  report.phase='browser-invitation-acceptance';
  setupBrowser=await chromium.launch({headless:true});setupContext=await setupBrowser.newContext({locale:'pt-PT',timezoneId:'Europe/Lisbon'});const page=await setupContext.newPage();page.setDefaultTimeout(15000);
  await page.goto(ADMIN+'/#/staff/invitations/accept',{waitUntil:'networkidle'});
  await page.getByLabel('Código do convite',{exact:true}).fill(prepared.token);await page.getByLabel('Nome completo',{exact:true}).fill('Stage 9 Synthetic Trip Operations');await page.getByLabel('Criar palavra-passe',{exact:true}).fill(accounts.staff.password);
  await page.getByRole('button',{name:'Aceitar convite',exact:true}).click();await expect(page.getByRole('heading',{name:'Convite aceite',exact:true})).toBeVisible();prepared.token='';report.probes.push('synthetic-staff-created-through-real-invitation-ui');
  await page.getByRole('link',{name:'Iniciar sessão',exact:true}).click();await page.getByLabel('Email profissional').fill(accounts.staff.email);await page.getByLabel('Palavra-passe',{exact:true}).fill(accounts.staff.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Configurar autenticação de dois fatores'})).toBeVisible();
  qaCookie=await cookieFor(setupContext,ADMIN);const noMfa=await request({route:'/api/staff/session-context',cookie:qaCookie});assert.ok([401,403].includes(noMfa.status));report.probes.push('admin-context-denied-before-mfa-http-'+noMfa.status);
  report.phase='browser-native-mfa-enrollment';await page.getByLabel('Palavra-passe atual',{exact:true}).fill(accounts.staff.password);await page.getByRole('button',{name:'Ativar autenticação',exact:true}).click();
  await expect(page.getByLabel('URI de configuração TOTP',{exact:true})).toBeVisible();const uri=await page.getByLabel('URI de configuração TOTP',{exact:true}).inputValue();accounts.staff.totpSeed=new URL(uri).searchParams.get('secret');assert.ok(accounts.staff.totpSeed);
  let recoveryCodes=await page.getByRole('list',{name:'Códigos de recuperação',exact:true}).locator('code').allTextContents();assert.ok(recoveryCodes.length>0);
  await page.getByLabel('Guardei os códigos de recuperação num local seguro',{exact:true}).check();await page.getByRole('button',{name:'Continuar',exact:true}).click();recoveryCodes=[];
  await page.getByLabel('Código da aplicação de autenticação',{exact:true}).fill((await rpc({action:'totp',seed:accounts.staff.totpSeed})).value);await page.getByRole('button',{name:'Validar e continuar',exact:true}).click();await expect(page.getByRole('heading',{name:'Visão geral',exact:true})).toBeVisible();
  qaCookie=await cookieFor(setupContext,ADMIN);const context=await request({route:'/api/staff/session-context',cookie:qaCookie});assert.equal(context.status,200);staffContext=context.body;assert.equal(staffContext.canInviteStaff,false);report.resources.staffPrincipalId=staffContext.principalId;report.resources.agencyId=staffContext.agencyId;
  assert.equal((await request({route:'/api/admin/staff/invitations',cookie:qaCookie})).status,403);await expect(page.getByRole('link',{name:'Convites de equipa',exact:true})).toHaveCount(0);report.probes.push('native-mfa-enrollment-and-owner-capability-denial');
  const trips=await request({route:'/api/admin/trips?limit=1',cookie:qaCookie});assert.equal(trips.status,200);assert.ok(trips.body.items.length>=1,'NEEDS_EXISTING_DENIAL_REFERENCE');const deniedTripId=trips.body.items[0].id;assert.match(deniedTripId,/^[0-9a-f-]{36}$/u);report.resources.readOnlyExistingDenialTripId=deniedTripId;
  report.phase='live-browser-admin-publish-portal-journeys';
  const {runStage9BrowserJourney}=await import(pathToFileURL(ROOT+'/tests/integration/helpers/stage9-browser-acceptance.ts'));
  const browserDirectory=HERE+'/browser';
  const title='QA Stage 9 '+marker;
  const journey=await runStage9BrowserJourney({adminOrigin:ADMIN,portalOrigin:PORTAL,staffCookieName:prepared.staffCookieName,portalCookieName:prepared.portalCookieName,tripId:deniedTripId,workspaceTripTitle:title,revisedWorkspaceTripTitle:title+' revista',publishedSnapshotTitle:title,flightTitle:'Voo sintético Stage 9',revisedFlightTitle:'Voo sintético Stage 9 revisto',initialAccommodationTitle:'Alojamento sintético Stage 9 v1',revisedAccommodationTitle:'Alojamento sintético Stage 9 v2',staff:accounts.staff,authorizedPortal:accounts.authorized,ungrantedPortal:accounts.ungranted,artifactIdentity:{candidate:'gen11',artifactId:ARTIFACT,sourceSnapshotSha256:SOURCE},makeTotpCode:async seed=>(await rpc({action:'totp',seed})).value,evidenceDirectory:browserDirectory,grantCreatedTripAccess:async tripId=>{
   report.resources.createdTripId=tripId;
   const out=await request({method:'POST',route:'/api/admin/trips/'+tripId+'/portal-access-grants',body:{agencyId:staffContext.agencyId,portalPrincipalId:prepared.portalIds.authorized,tripId,idempotencyKey:marker+'-grant',expiresAt:new Date(Date.now()+15*60000).toISOString(),relationshipLabel:'Stage 9 synthetic browser acceptance'},cookie:qaCookie});assert.equal(out.status,201);assert.equal(out.body.tripId,tripId);assert.equal(out.body.portalPrincipalId,prepared.portalIds.authorized);grantIds.push(out.body.grantId);report.resources.grantIds=[...grantIds];
  }});
  Object.assign(report.resources,journey);
  const raw=await readFile(browserDirectory+'/browser-acceptance.json');const parsed=JSON.parse(raw);assert.equal(parsed.result,'PASS');assert.equal(parsed.artifact.sourceSnapshotSha256,SOURCE);
  report.browser={result:'PASS',actualOrigins:[ADMIN,PORTAL],transport:'real CT200 Caddy, no mocked API or local replica',resolution:'Chromium-process-only exact host maps to 192.168.1.33',runnerScopeCorrection:'The reused helper hardcodes an isolated-loopback scope label. Its unchanged raw output is preserved; this wrapper records and asserts the actual installed-target origins and process-only resolver. It is not disposable-target evidence.',rawHelperReport:{path:'browser/browser-acceptance.json',bytes:raw.length,sha256:sha(raw)},viewports:parsed.viewports,journeys:parsed.journeys,accessibility:parsed.accessibility,network:parsed.network,isolation:parsed.isolation,screenshots:parsed.screenshots};
  report.probes.push('full-live-admin-create-edit-preview-publish-v1-v2-portal-immutable-denial');
  report.result='PASS';report.phase='functional-journeys-complete';
 }
}catch(error){localFailure=error;report.code??='LIVE_QA_FAILED';report.execution={...report.execution,errorType:error?.constructor?.name??'Error',assertionCode:/^[A-Z0-9_]{1,64}$/u.test(error?.code??'')?error.code:null};}
finally{
 if(!preflight&&qaCookie&&staffContext){for(const grantId of grantIds){try{const out=await request({method:'POST',route:'/api/admin/portal-access-grants/'+grantId+'/revocations',body:{agencyId:staffContext.agencyId,grantId,idempotencyKey:marker+'-revoke-'+grantId},cookie:qaCookie});assert.equal(out.status,200);assert.ok(out.body.revokedAt!==null);}catch{cleanupFailure=true;}}report.cleanup.issuedGrantsRevoked=grantIds.length===0||!cleanupFailure;}
 for(const browser of launched){try{await browser.close();}catch{cleanupFailure=true;}}
 report.cleanup.ownedBrowserContextsClosed=!cleanupFailure;
 if(processRemote&&!preflight){try{if(!operatorFinished){const out=await rpc({action:'finish'});assert.equal(out.event,'FINISHED');report.cleanup.ownerSessionRevoked=out.ownerSessionRevoked===true;operatorFinished=true;}}catch{cleanupFailure=true;}}
 if(processRemote){processRemote.stdin.end();await new Promise(resolve=>{if(processRemote.exitCode!==null)resolve();else{processRemote.once('close',resolve);setTimeout(()=>{processRemote.kill('SIGTERM');resolve();},15000).unref();}});}
 chromium.launch=nativeLaunch;
 for(const account of Object.values(accounts))for(const key of Object.keys(account))account[key]='';qaCookie=undefined;
 if(cleanupFailure||(!preflight&&!report.cleanup.ownerSessionRevoked)){report.result='FAIL';report.cleanup.verified=false;}else report.cleanup.verified=true;
 report.completedAt=new Date().toISOString();report.execution={...report.execution,wrapperSha256:sha(await readFile(fileURLToPath(import.meta.url))),operatorSha256:sha(await readFile(HERE+'/operator.mjs')),qaBrowserLaunches:launchedCount,canonicalCiInvoked:false};
 const name=preflight?'readonly-preflight.json':'live-acceptance.json';await writeFile(HERE+'/'+name,JSON.stringify(publicResult(report),null,2)+'\n',{flag:'w',mode:0o600});
 console.log(JSON.stringify({result:report.result,phase:report.phase,code:report.code??null,report:'.hermes/state/stage9-gen11-final-live-001/'+name,artifactId:ARTIFACT,stage10Actions:0}));
}
if(report.result!=='PASS')process.exitCode=1;
