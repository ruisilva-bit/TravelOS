import copy
import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('custody', Path(__file__).with_name('stage10-custody.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
H = 'a' * 64
NOW = '2026-01-01T00:00:00Z'
START = '2025-01-01T00:00:00Z'
END = '2027-01-01T00:00:00Z'

def encoded(v): return json.dumps(v, separators=(',', ':')).encode()
def fixture():
    policy = dict(schemaVersion=1, environment='DEVELOPMENT', instance='CT200', policyVersion='p1', keySha256=H, signerToolSha256=H, qualificationAuthorityId='fixture-qualifier', status='ACTIVE', validFrom=START, validUntil=END)
    request = dict(schemaVersion=1, environment='DEVELOPMENT', instance='CT200', requestId='req1', artifactId='artifact1', artifactSha256=H, sourceInputSha256=H, qualificationReceiptSha256=H, policyVersion='p1', keySha256=H, notBefore=START, expiresAt=END)
    appointment = dict(schemaVersion=1, appointmentId='a1', role='PRIVACY_REVIEW_AUTHORITY', subjectId='fixture-human', human=True, appointingCustodianId='fixture-po', scope=dict(environment='DEVELOPMENT', instance='CT200', permittedDecisions=['ACCEPT', 'REJECT']), independenceAssessmentRef='fixture-assessment', authenticationMethodRef='fixture-method', validFrom=START, validUntil=END, revocationSourceRef='fixture-revocations', acceptedAt=START, acceptanceEvidenceRef='fixture-acceptance')
    common = dict(schemaVersion=1, decisionId='d1', appointmentSha256=H, environment='DEVELOPMENT', instance='CT200', candidateId='candidate1', sourceInputSha256=H, artifactSha256=H, decision='ACCEPT', issuedAt=START, expiresAt=END, revocationSourceRef='fixture-revocations')
    receipt = dict(common, authorityId='fixture-authority', receiptSha256=H, replayId='replay1')
    privacy = dict(common, reviewerId='fixture-human', payloadManifestSha256=H, publicationMetadataSha256=H, classification='INTERNAL', retentionPolicyRef='retention1', accessPolicyRef='access1')
    return policy, request, appointment, receipt, privacy

class CustodyTests(unittest.TestCase):
    def test_valid_synthetic_formats_and_one_shot(self):
        p,r,a,rd,pd = fixture()
        self.assertEqual(c.validate_policy(encoded(p), NOW)['policyVersion'], 'p1')
        self.assertEqual(c.validate_appointment(encoded(a), NOW, set())['subjectId'], 'fixture-human')
        self.assertEqual(c.validate_decision(encoded(pd), 'privacy', a, H, NOW, set(), pd)['decision'], 'ACCEPT')
        a['role']='RECEIPT_VERIFICATION_AUTHORITY'; a['subjectId']='fixture-authority'
        self.assertEqual(c.validate_decision(encoded(rd), 'receipt', a, H, NOW, set(), rd)['decision'], 'ACCEPT')
        self.assertEqual(c.synthetic_one_shot(encoded(p), encoded(r), r, NOW, set())['status'], 'SYNTHETIC_ONLY_NO_SIGNATURE')
    def test_pending_revoked_expired_and_mismatch(self):
        p,r,a,rd,pd = fixture()
        for mutation in ('pending','revoked','expired','mismatch','human'):
            x=copy.deepcopy(a); rev=set(); expected=copy.deepcopy(pd)
            if mutation=='pending': x=None
            if mutation=='revoked': rev.add('a1')
            if mutation=='expired': x['validUntil']=START
            if mutation=='mismatch': expected['payloadManifestSha256']='b'*64
            if mutation=='human': x['human']=False
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): c.validate_decision(encoded(pd), 'privacy', x, H, NOW, rev, expected)
    def test_request_rejects_bad_inputs(self):
        p,r,*_=fixture()
        for field,value in [('environment','PRODUCTION'),('keySha256','b'*64),('expiresAt',START),('artifactSha256','A'*64),('requestId','../x'),('notBefore',END)]:
            x=copy.deepcopy(r); x[field]=value
            with self.subTest(field=field), self.assertRaises(ValueError): c.synthetic_one_shot(encoded(p),encoded(x),r,NOW,set())
        with self.assertRaises(ValueError): c.synthetic_one_shot(encoded(p),encoded(r),r,NOW,{'req1'})
        with self.assertRaises(ValueError): c.synthetic_one_shot(encoded(p),encoded(r),None,NOW,set())
    def test_signing_operation_receipt_binding(self):
        p,r,*_=fixture()
        receipt = {k:r[k] for k in ('schemaVersion','requestId','environment','instance','artifactId','artifactSha256','sourceInputSha256','qualificationReceiptSha256','policyVersion','keySha256')}
        receipt.update(policySha256=H, bundleSha256=H, signerToolSha256=H, verificationResult='VERIFIED', transparencyStatus='OFFLINE_NO_TRANSPARENCY_PROOF', completedAt=NOW)
        self.assertEqual(c.validate_signing_receipt(encoded(receipt), r, p, H, NOW)['requestId'], 'req1')
        for key,value in [('artifactSha256','b'*64),('transparencyStatus','OIDC'),('verificationResult','FAILED'),('completedAt',END)]:
            bad=copy.deepcopy(receipt);bad[key]=value
            with self.subTest(key=key), self.assertRaises(ValueError): c.validate_signing_receipt(encoded(bad),r,p,H,NOW)

    def test_signing_receipt_rejects_request_policy_mismatch(self):
        p,r,*_=fixture()
        for key,value in [('policyVersion','p2'),('keySha256','b'*64)]:
            request=copy.deepcopy(r); request[key]=value
            receipt = {k:request[k] for k in ('schemaVersion','requestId','environment','instance','artifactId','artifactSha256','sourceInputSha256','qualificationReceiptSha256','policyVersion','keySha256')}
            receipt.update(policySha256=H, bundleSha256=H, signerToolSha256=H, verificationResult='VERIFIED', transparencyStatus='OFFLINE_NO_TRANSPARENCY_PROOF', completedAt=NOW)
            with self.subTest(key=key), self.assertRaises(ValueError): c.validate_signing_receipt(encoded(receipt),request,p,H,NOW)

    def test_strict_json_and_policy(self):
        p,*_=fixture()
        for raw in [b'{"schemaVersion":1,"schemaVersion":1}', encoded(dict(p, extra=True)), b'{}', b'{' , b' '*65537]:
            with self.subTest(raw=raw[:40]), self.assertRaises(ValueError): c.validate_policy(raw,NOW)
        for field,value in [('status','REVOKED'),('validUntil',START),('keySha256','x'),('instance','CT201')]:
            x=copy.deepcopy(p);x[field]=value
            with self.subTest(field=field), self.assertRaises(ValueError): c.validate_policy(encoded(x),NOW)

if __name__ == '__main__': unittest.main()
