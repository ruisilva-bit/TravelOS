import assert from 'node:assert/strict';
export const ARTIFACT='travelos-stage9-gen11-d6610462';
export const SOURCE='d661046212cc291122ae126953bdedf93fcac15b3a4928bf5f9b25b0354488e9';
export const ADMIN='http://admin.travelos.test';
export const PORTAL='http://portal.travelos.test';
export const validateRun=({marker,adminOrigin,portalOrigin,artifactId})=>{
  assert.match(marker,/^stage9-final-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
  assert.equal(adminOrigin,ADMIN);assert.equal(portalOrigin,PORTAL);assert.equal(artifactId,ARTIFACT);return marker;
};
export const syntheticAccounts=marker=>{
  validateRun({marker,adminOrigin:ADMIN,portalOrigin:PORTAL,artifactId:ARTIFACT});
  return Object.fromEntries(['staff','authorized','ungranted'].map(kind=>[kind,`${marker}-${kind}@example.test`]));
};
export const publicResult=value=>{
  const result=Object.fromEntries(['schemaVersion','result','phase','code','artifactId','sourceSnapshotSha256','marker','actor','environment','startedAt','completedAt','resources','probes','cleanup','browser','execution','stage10Actions'].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
  const inspect=object=>{if(!object||typeof object!=='object')return;for(const [key,item]of Object.entries(object)){assert.ok(!/^(password|token|totpSeed|cookie|credentials|email|secret|backupCodes)$/iu.test(key),'SECRET_FIELD_REFUSED');inspect(item);}};
  inspect(result);return result;
};
