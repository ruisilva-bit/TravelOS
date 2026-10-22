import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const scannerPath = 'tooling/ci/sensitive-data-scanner.mjs';
const policyPath = 'tooling/ci/scan-source-secrets.mjs';
const { scanSensitiveFiles } = await import(pathToFileURL(path.resolve(root, scannerPath)).href);
// Identical path/rule/line exceptions to the hash-bound approved source policy.
const allowlist = [
  ...[294,303,315,321,331,344,385,403,480,486].map(line => ({path:'tests/integration/stage-4-postgresql.test.ts',rule:'email-address',line})),
  {path:'tooling/ci/stage-7/test-runtime-acceptance-runner.mjs',rule:'email-address',line:231},
  ...['high-entropy-secret-assignment','secret-assignment'].map(rule => ({path:'tests/integration/stage-7-postgresql.test.ts',rule,line:3811})),
];
assert.equal(new Set(input.files).size,input.files.length);
const scan = await scanSensitiveFiles({root,files:input.files,allowlist});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {schemaVersion:1,result:scan.result,phase:input.phase,filesScanned:scan.filesScanned.length,paths:input.files,scannerPath,scannerSha256:hash(await readFile(scannerPath)),policyPath,policySha256:hash(await readFile(policyPath)),explicitAllowlistEntries:allowlist.length,allowlistedFindingCount:scan.allowlistedFindingCount,findings:scan.findings,matchedValuesEmitted:false,execution:{command:'node .hermes/state/stage7-gen15-final-scan.mjs '+process.argv[2],mode:'READ_ONLY'},stage8Actions:0};
if(input.freezePath) {
 report.freezePath=input.freezePath;
 report.freezeSha256=hash(await readFile(input.freezePath));
 report.validationIncluded=input.files.includes(input.validationPath);
 report.freezeIncluded=input.files.includes(input.freezePath);
 report.finalFreezeEligible=scan.result==='PASS' && report.validationIncluded && report.freezeIncluded;
}
console.log(JSON.stringify(report,null,2));
process.exitCode=scan.result==='PASS'?0:1;
