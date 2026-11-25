"""Synthetic format exercises only. No authentication, signing or real authorization."""
import datetime as dt
import json
import re

LIMIT = 65536
HASH = re.compile(r'[0-9a-f]{64}\Z')
IDENT = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z')
TIME = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\Z')
POLICY = 'schemaVersion environment instance policyVersion keySha256 signerToolSha256 qualificationAuthorityId status validFrom validUntil'.split()
REQUEST = 'schemaVersion environment instance requestId artifactId artifactSha256 sourceInputSha256 qualificationReceiptSha256 policyVersion keySha256 notBefore expiresAt'.split()
APPOINTMENT = 'schemaVersion appointmentId role subjectId human appointingCustodianId scope independenceAssessmentRef authenticationMethodRef validFrom validUntil revocationSourceRef acceptedAt acceptanceEvidenceRef'.split()
COMMON = 'schemaVersion decisionId appointmentSha256 environment instance candidateId sourceInputSha256 artifactSha256 decision issuedAt expiresAt revocationSourceRef'.split()
RECEIPT = COMMON + 'authorityId receiptSha256 replayId'.split()
PRIVACY = COMMON + 'reviewerId payloadManifestSha256 publicationMetadataSha256 classification retentionPolicyRef accessPolicyRef'.split()

def reject(message):
    raise ValueError(message)

def pairs(items):
    result = {}
    for key, value in items:
        if key in result: reject('duplicate field')
        result[key] = value
    return result

def parse(raw, fields):
    if not isinstance(raw, bytes) or len(raw) > LIMIT: reject('invalid input size')
    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=lambda _: reject('invalid constant'))
    except (UnicodeError, json.JSONDecodeError, RecursionError): reject('invalid JSON')
    if not isinstance(value, dict) or set(value) != set(fields): reject('invalid fields')
    if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1: reject('invalid version')
    for key, v in value.items():
        if key == 'schemaVersion' or key in ('scope', 'human'): continue
        if not isinstance(v, str): reject('invalid type')
        if key.endswith('Sha256'):
            if not HASH.fullmatch(v): reject('invalid digest')
        elif key in ('validFrom','validUntil','acceptedAt','issuedAt','expiresAt','notBefore','completedAt'):
            timestamp(v)
        elif not IDENT.fullmatch(v): reject('invalid identifier')
    return value

def timestamp(s):
    if not isinstance(s, str) or not TIME.fullmatch(s): reject('invalid time')
    try: return dt.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)
    except ValueError: reject('invalid time')

def window(start, end, now):
    if not timestamp(start) <= timestamp(now) < timestamp(end): reject('outside validity')

def scope(obj):
    if obj.get('environment') != 'DEVELOPMENT' or obj.get('instance') != 'CT200': reject('wrong scope')

def validate_policy(raw, now):
    p = parse(raw, POLICY); scope(p)
    if p['status'] != 'ACTIVE': reject('inactive policy')
    window(p['validFrom'], p['validUntil'], now)
    return p

def validate_appointment(raw, now, revoked):
    if not isinstance(revoked, set): reject('revocation unavailable')
    a = parse(raw, APPOINTMENT)
    if type(a['human']) is not bool or a['role'] not in ('RECEIPT_VERIFICATION_AUTHORITY','PRIVACY_REVIEW_AUTHORITY'): reject('invalid role')
    if a['role'] == 'PRIVACY_REVIEW_AUTHORITY' and not a['human']: reject('privacy reviewer must be human')
    s = a['scope']
    if not isinstance(s, dict) or set(s) != {'environment','instance','permittedDecisions'}: reject('invalid appointment scope')
    scope(s)
    decisions = s['permittedDecisions']
    if not isinstance(decisions, list) or not decisions or any(x not in ('ACCEPT','REJECT') for x in decisions) or len(set(decisions)) != len(decisions): reject('invalid scope decisions')
    window(a['validFrom'], a['validUntil'], now)
    if not timestamp(a['validFrom']) <= timestamp(a['acceptedAt']) <= timestamp(now): reject('invalid acceptance time')
    if a['appointmentId'] in revoked: reject('revoked appointment')
    return a

def validate_decision(raw, kind, appointment, appointment_hash, now, revoked, expected):
    if kind not in ('receipt','privacy') or appointment is None or not isinstance(expected, dict): reject('authority pending')
    if not isinstance(appointment, dict): reject('invalid appointment')
    a = validate_appointment(json.dumps(appointment).encode(), now, revoked)
    d = parse(raw, RECEIPT if kind == 'receipt' else PRIVACY); scope(d)
    role = 'RECEIPT_VERIFICATION_AUTHORITY' if kind == 'receipt' else 'PRIVACY_REVIEW_AUTHORITY'
    principal = 'authorityId' if kind == 'receipt' else 'reviewerId'
    if a['role'] != role or d[principal] != a['subjectId'] or d['appointmentSha256'] != appointment_hash or not HASH.fullmatch(appointment_hash): reject('authority mismatch')
    if d['decision'] not in a['scope']['permittedDecisions'] or d['decisionId'] in revoked: reject('decision denied or revoked')
    window(d['issuedAt'], d['expiresAt'], now)
    if timestamp(d['issuedAt']) < timestamp(a['validFrom']) or timestamp(d['expiresAt']) > timestamp(a['validUntil']): reject('decision outside appointment')
    if any(expected.get(k) != v for k,v in d.items()) or set(expected) != set(d): reject('binding mismatch')
    return d

def validate_signing_receipt(raw, request, policy, policy_hash, now):
    fields = 'schemaVersion requestId environment instance artifactId artifactSha256 sourceInputSha256 qualificationReceiptSha256 policyVersion policySha256 keySha256 bundleSha256 signerToolSha256 verificationResult transparencyStatus completedAt'.split()
    d = parse(raw, fields); scope(d)
    if not isinstance(request, dict) or not isinstance(policy, dict) or not isinstance(policy_hash, str) or not HASH.fullmatch(policy_hash): reject('missing bindings')
    for key in ('schemaVersion','requestId','environment','instance','artifactId','artifactSha256','sourceInputSha256','qualificationReceiptSha256','policyVersion','keySha256'):
        if d[key] != request.get(key): reject('request mismatch')
    if any(request.get(key) != policy.get(key) for key in ('policyVersion','keySha256')): reject('policy mismatch')
    if d['policySha256'] != policy_hash or d['signerToolSha256'] != policy.get('signerToolSha256'): reject('policy mismatch')
    if d['verificationResult'] != 'VERIFIED' or d['transparencyStatus'] != 'OFFLINE_NO_TRANSPARENCY_PROOF': reject('invalid verification')
    if not timestamp(request.get('notBefore')) <= timestamp(d['completedAt']) <= timestamp(now) or timestamp(d['completedAt']) >= timestamp(request.get('expiresAt')): reject('invalid completion time')
    return d

def synthetic_one_shot(policy_raw, request_raw, qualification, now, revoked):
    if not isinstance(revoked, set) or not isinstance(qualification, dict): reject('qualification or revocation pending')
    p = validate_policy(policy_raw, now); r = parse(request_raw, REQUEST); scope(r)
    window(r['notBefore'], r['expiresAt'], now)
    if timestamp(r['notBefore']) < timestamp(p['validFrom']) or timestamp(r['expiresAt']) > timestamp(p['validUntil']): reject('request exceeds policy')
    if r['policyVersion'] != p['policyVersion'] or r['keySha256'] != p['keySha256'] or r['requestId'] in revoked: reject('policy mismatch or revoked')
    if qualification != r: reject('qualification mismatch')
    return {'status':'SYNTHETIC_ONLY_NO_SIGNATURE', 'requestId':r['requestId']}
