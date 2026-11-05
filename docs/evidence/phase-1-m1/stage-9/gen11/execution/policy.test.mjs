import assert from 'node:assert/strict';
import {test} from 'node:test';
const policy = await import('./policy.mjs').catch(error => {if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const marker='stage9-final-12345678-1234-4234-9234-123456789abc';
test('accepts only exact approved DEVELOPMENT origin and synthetic run identity',()=>{
  assert.equal(typeof policy.validateRun,'function','live QA target policy is not implemented');
  assert.equal(policy.validateRun({marker,adminOrigin:'http://admin.travelos.test',portalOrigin:'http://portal.travelos.test',artifactId:'travelos-stage9-gen11-d6610462'}),marker);
  for(const change of [{adminOrigin:'https://admin.travelos.test'},{portalOrigin:'http://portal.travelos.test:8080'},{artifactId:'another-release'},{marker:'stage9-final-../unsafe'}])assert.throws(()=>policy.validateRun({marker,adminOrigin:'http://admin.travelos.test',portalOrigin:'http://portal.travelos.test',artifactId:'travelos-stage9-gen11-d6610462',...change}));
});
test('public output removes unknown fields and refuses nested secret payloads',()=>{
  assert.equal(typeof policy.publicResult,'function','public QA allowlist is not implemented');
  assert.deepEqual(policy.publicResult({result:'PASS',phase:'verified',marker,resources:{tripId:'synthetic-id'},unexpected:'not-public'}),{result:'PASS',phase:'verified',marker,resources:{tripId:'synthetic-id'}});
  for(const field of ['password','token','totpSeed','cookie','credentials','email'])assert.throws(()=>policy.publicResult({result:'FAIL',resources:{[field]:'synthetic-fixture-only'}}));
});
test('operator credentials remain references and test identities never use the human recipient',()=>{
  assert.equal(typeof policy.syntheticAccounts,'function','synthetic account boundary is not implemented');
  const result=policy.syntheticAccounts(marker);
  assert.deepEqual(Object.keys(result).sort(),['authorized','staff','ungranted']);
  assert.equal(new Set(Object.values(result)).size,3);
  assert.ok(Object.values(result).every(value=>value.endsWith('@example.test')&&value.includes('12345678-1234-4234-9234-123456789abc')));
});
