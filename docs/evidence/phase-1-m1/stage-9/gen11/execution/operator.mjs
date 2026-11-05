// DEVELOPMENT-only QA operator. JSON stdout is a private SSH pipe, never a log.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
const artifactId='travelos-stage9-gen11-d6610462';
const root='/opt/travelos/releases/'+artifactId;
const input=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const receive=async()=>{const item=await input.next();assert.ok(!item.done&&item.value.length<65536);return JSON.parse(item.value);};
let phase='identity';let ownerCookie;let requestAdmin;let database;let invitation;let ownerRevoked=false;let generator;
const cleanup=async()=>{if(ownerCookie&&!ownerRevoked){const out=await requestAdmin({method:'POST',route:'/api/auth/staff/sign-out',body:{},cookie:ownerCookie});assert.equal(out.status,200);assert.equal((await requestAdmin({method:'GET',route:'/api/staff/session-context',cookie:ownerCookie})).status,401);ownerRevoked=true;}};
try{
 assert.equal(await realpath('/opt/travelos/current'),root);
 const release=JSON.parse(await readFile(root+'/release.json','utf8'));assert.equal(release.artifactId,artifactId);
 const native=await import(pathToFileURL(root+'/operator/stage7-regression.mjs'));
 const appRoot=root+'/apps/portal-api';
 const config=await import(await native.resolveRuntimePackageImport({appRoot,packageName:'@travelos/config'}));
 const manifest=await config.loadDevelopmentInstanceManifest('/etc/travelos/instances/development.json');
 assert.equal(manifest.environment,'DEVELOPMENT');assert.equal(manifest.hosts.admin,'admin.travelos.test');assert.equal(manifest.hosts.portal,'portal.travelos.test');
 const listener=manifest.runtime.listeners.adminApi;assert.equal(listener.host,'127.0.0.1');
 requestAdmin=({method,route,body,cookie})=>new Promise((resolve,reject)=>{
  const payload=body===undefined?undefined:Buffer.from(JSON.stringify(body));const headers={host:manifest.hosts.admin,accept:'application/json'};
  if(payload){headers['content-type']='application/json';headers['content-length']=payload.length;}if(method!=='GET')headers.origin='http://'+manifest.hosts.admin;if(cookie)headers.cookie=cookie;
  const req=http.request({host:listener.host,port:listener.port,method,path:route,headers,timeout:10000},res=>{let bytes=0;const chunks=[];res.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576)req.destroy();else chunks.push(chunk);});res.on('end',()=>{try{const text=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,headers:res.headers,body:text?JSON.parse(text):undefined});}catch{reject(new Error('INVALID_RESPONSE'));}});});req.on('error',()=>reject(new Error('REQUEST_FAILED')));req.on('timeout',()=>req.destroy());if(payload)req.write(payload);req.end();
 });
 generator=await native.createRuntimeTotpGenerator(appRoot);
 const portalAuth=await import(await native.resolveRuntimePackageImport({appRoot,packageName:'@travelos/auth-adapters',exportName:'./portal'}));
 const realmEntry=await realpath(path.join(appRoot,'node_modules/@travelos/auth-adapters/dist/realm.js'));
 const realm=await import(pathToFileURL(realmEntry));
 if(process.argv.includes('--readonly-preflight')){send({event:'PREFLIGHT',artifactId,environment:manifest.environment,nativeMfa:true,nativePortalEnrollment:typeof realm.createLocalOperatorPortalEnrollmentService==='function',credentialValuesRead:false});process.exit(0);}
 const start=await receive();assert.equal(start.action,'prepare');assert.match(start.marker,/^stage9-final-[0-9a-f-]{36}$/u);
 for(const [kind,account]of Object.entries(start.accounts)){assert.equal(account.email,start.marker+'-'+kind+'@example.test');assert.match(account.password,/^[A-Za-z0-9_-]{43}$/u);}
 phase='native-owner-mfa';
 const directory=process.env.CREDENTIALS_DIRECTORY;assert.ok(path.isAbsolute(directory));
 const read=async name=>(await readFile(path.join(directory,name),'utf8')).trim();
 const credentials={staffEmail:await read('stage7-staff-email'),staffPassword:await read('stage7-staff-password'),staffTotpSeed:await read('stage7-staff-totp')};
 ownerCookie=await native.signInStaff({credentials,makeStaffTotpCode:generator,requestAdmin:request=>requestAdmin({...request,route:request.path})});
 for(const key of Object.keys(credentials))credentials[key]='';
 assert.equal((await requestAdmin({method:'GET',route:'/api/staff/session-context',cookie:ownerCookie})).status,200);
 phase='synthetic-staff-invitation';
 const issued=await requestAdmin({method:'POST',route:'/api/admin/staff/invitations',body:{targetEmail:start.accounts.staff.email},cookie:ownerCookie});assert.equal(issued.status,201);invitation=issued.body;
 const listed=await requestAdmin({method:'GET',route:'/api/admin/staff/invitations?limit=50',cookie:ownerCookie});assert.equal(listed.status,200);assert.deepEqual(listed.body.items.find(item=>item.invitationId===invitation.invitation.invitationId),invitation.invitation);
 phase='native-portal-enrollment';
 database=portalAuth.createAuthRealmPostgresDatabase({host:manifest.database.host,port:manifest.database.port,database:manifest.database.name,user:manifest.database.runtimeRoles.portalApi.roleName,password:await read('portal-api-db'),tls:{mode:manifest.database.tlsPolicy},applicationName:'travelos-stage9-browser-qa',maxConnections:2});
 const realmKey=await read('portal-auth-realm');
 const portalRealm=realm.createPortalAuthRealm({database:database.database,canonicalOrigin:'http://'+manifest.hosts.portal,realmKeyMaterial:realmKey,environment:'DEVELOPMENT'});
 const enrollment=realm.createLocalOperatorPortalEnrollmentService({database:database.database,canonicalOrigin:'http://'+manifest.hosts.portal,realmKeyMaterial:realmKey,environment:'DEVELOPMENT'});
 const portalIds={};for(const kind of ['authorized','ungranted']){const enrolled=await enrollment.enroll({...start.accounts[kind],name:'Stage 9 Synthetic '+kind});portalIds[kind]=enrolled.portalPrincipalId;}
 const staffCookieName=ownerCookie.split(';')[0].split('=')[0].trim();assert.ok(staffCookieName);
 send({event:'PREPARED',artifactId,invitationId:invitation.invitation.invitationId,token:invitation.token,portalIds,staffCookieName,portalCookieName:portalRealm.cookieName});
 phase='qa-support';
 while(true){const command=await receive();if(command.action==='totp'){assert.match(command.seed,/^[A-Z2-7]+$/u);send({event:'TOTP',value:await generator(command.seed)});command.seed='';}else{assert.equal(command.action,'finish');break;}}
 await cleanup();send({event:'FINISHED',ownerSessionRevoked:ownerRevoked});
}catch(error){try{if(invitation&&ownerCookie){const row=(await requestAdmin({method:'GET',route:'/api/admin/staff/invitations?limit=50',cookie:ownerCookie})).body?.items?.find(item=>item.invitationId===invitation.invitation.invitationId);if(row?.status==='PENDING')await requestAdmin({method:'POST',route:'/api/admin/staff/invitations/'+row.invitationId+'/revocations',body:{},cookie:ownerCookie});}await cleanup();}catch{}
 send({event:'ERROR',code:'OPERATOR_FAILED',phase,detailCode:/^[0-9A-Z_]{1,48}$/u.test(error?.code??'')?error.code:null,ownerSessionRevoked:ownerRevoked});process.exitCode=1;
}finally{if(invitation)invitation.token='';if(database)await database.database.destroy();try{await cleanup();}catch{process.exitCode=1;}ownerCookie=undefined;process.stdin.destroy();}
