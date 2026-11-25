# Backup identity concurrency — scoped independent adjudication

Reviewer: `sa-0-b27ea9f1`, delegation `deleg_763a47ee`.
Scope: source-only host adapter; not installation, custody, or Stage 10 acceptance.

## Independent verdict

NO-GO for describing HBA publication as CAS or automatically deleting the Unix account under concurrent trusted administration. Root, the PostgreSQL administrator and base OS are trusted; the review did not demonstrate an unprivileged-operator exploit.

1. HBA content/inode verification followed by `os.replace` is conflict detection, not conditional replacement. A trusted writer can change the destination between check and rename. A private adapter flock does not serialize other writers. Require an exclusive maintenance window or a protocol used by every authorized writer; do not claim hostile-root protection.
2. `userdel` resolves a name, not the recorded UID. A pre-check cannot prevent account replacement in the check/use window. Minimum safe remedy: preserve the locked account and require identity-reviewed reconciliation rather than automatic deletion.
3. Checking role OID and executing name-resolved DROP in one DO transaction does not itself demonstrate role-DDL serialization. A proposed conflicting `pg_authid` catalog lock must be tested on pinned PostgreSQL 18 with two real sessions before adoption. The proposal is not proof that PostgreSQL permits or honors the requested locking behavior.

The reviewer executed 8 host and 11 orchestration tests. Those were mocks/in-memory fixtures, not filesystem concurrency or catalog-lock proof.

## Parent response and remaining gates

- Disabled automatic Unix-account deletion. Added matching-account preservation regression, alongside the existing replaced-account guard test. Fresh parent execution: host 9/9 and engine 11/11 passed.
- Corrected host-adapter documentation to remove the CAS and automatic-account-cleanup claims.
- HBA maintenance exclusivity remains unestablished. Do not install/provision on the basis of these local tests.
- Real two-session PostgreSQL lock qualification dispatched as `deleg_97504d3a`, owned new integration test only. Result pending; production role cleanup remains unqualified.
- Earlier comments claiming concurrency guarantees resolved are superseded by this explicit limitation, not by a Stage 10 GO.
- No CT200 changes, production operations, privilege cutover, canonical CI, candidate freeze or stage closure are established by this record.
