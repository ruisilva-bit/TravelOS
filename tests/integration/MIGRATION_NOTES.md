# Integration test migration notes

Mapping from every test title in the deleted stage suites to its new home (Phase 2, Step 1).
"dropped: stage-process" = asserted stage/migration-head/artifact/rehearsal scaffolding.
"dropped: portal (Step 2)" = customer-portal behaviour, removed with the portal in Step 2.

Follow-ups for later steps: the role-topology and USAGE assertions in `database-roles.test.ts`,
`helpers/role-graph.ts`, the Portal-schema entries in `staff-auth.test.ts` and the
`@travelos/*portal*` aliases in `tooling/testing/vitest.postgres.config.ts` still describe the portal
roles and schemas that exist today; Step 2 removes them together with the portal. The publication
and worker suites assert the publication/outbox tables that Step 3 turns into share links.

## stage-3-postgresql.test.ts
- bootstraps an empty cluster and migrates the authoritative chain from zero → database-roles.test.ts
- establishes deliberate schema ownership and role membership topology → database-roles.test.ts
- proves the executable runtime privilege matrix and Portal isolation → database-roles.test.ts (Admin/Worker; Portal probes dropped: portal (Step 2))
- commits, rolls back, releases the pool connection, and rejects nesting explicitly → database-roles.test.ts
- serializes migration authority with fail-fast advisory locking → database-roles.test.ts
- rolls back a deliberately failing migration and releases its lock → database-roles.test.ts
- dumps and restores database-local state after cluster-global role bootstrap dropped: stage-process (dump-restore rehearsal)

## stage-4-postgresql.test.ts
- migrates the full controlled chain and enforces Staff/Portal SQL isolation dropped: portal (Step 2) (Staff/Portal SQL isolation; chain head check is stage-process)
- serializes one root Agency and stores only the first Owner invitation digest → staff-auth.test.ts
- enrolls the invited Owner through Better Auth, verifies the account and disables public Staff signup → staff-auth.test.ts
- performs real TOTP enrollment, recovery-code login and records recent MFA server-side → staff-auth.test.ts
- rejects stale authorization epochs, missing/inactive memberships and wrong Agency proofs → staff-auth.test.ts
- protects the last Owner and rejects wrong cookies, hosts, origins and token URLs → staff-auth.test.ts (cross-realm Portal cookie assertion dropped: portal (Step 2))

## stage-5-postgresql.test.ts
- applies the new migration head and preserves the predecessor isolation boundary → staff-auth.test.ts (bootstrap idempotence only; head/predecessor/Portal isolation dropped: stage-process, portal)
- converts populated Stage 5 roots to zero-based PostgreSQL bigint lock versions → trips.test.ts (bigint column check only; predecessor conversion dropped: stage-process)
- creates the complete scoped continuity, itinerary, reservation/link and internal Money slice → trips.test.ts
- keeps authorization snapshots and Trip reads Agency-isolated with two disposable Agency fixtures → trips.test.ts
- rechecks current Staff authorization inside the mutation transaction → trips.test.ts
- rejects fabricated Staff session metadata at the database boundary before creating rows → trips.test.ts
- rejects caller-selected weak permissions at the repository boundary before mutation → trips.test.ts
- increments once per committed relevant transaction and returns typed conflicts for stale and racing writes → trips.test.ts
- round-trips and compare-and-swaps bigint lock versions beyond JavaScript safe integer → trips.test.ts
- rolls back both workspace revision and deduplication state with a failed transaction → trips.test.ts
- enforces exactly one primary traveller at commit and during replacement → crm.test.ts
- enforces primary traveller CustomerPerson continuity and permits child-before-parent repair → crm.test.ts
- qualifies deferred primary reparenting for rejection and repaired commit → crm.test.ts
- keeps the designated primary continuity rows when valid secondary rows exist → crm.test.ts
- increments workspace revision for projected Person, Customer and CustomerPerson changes → trips.test.ts
- rejects direct workspace revision and lockVersion writes through the actual Admin login role → trips.test.ts (Portal role dropped from the SECURITY DEFINER probe loop: portal (Step 2))
- ignores a forged transaction-local marker while deduplicating multiple relevant edits → trips.test.ts
- increments an Admin-created Trip despite a forged transaction-local revision marker → trips.test.ts
- serializes continuity writes under READ COMMITTED and REPEATABLE READ → trips.test.ts
- increments both workspace revisions when a child moves between trips → trips.test.ts
- maps a real repeatable-read SQLSTATE 40001 to an M1 optimistic conflict → trips.test.ts
- maps a real repository PostgreSQL deadlock SQLSTATE 40P01 through the registered Admin HTTP route → trips.test.ts
- maps a real stale supplier-cost compare-and-swap through the registered Admin HTTP route → trips.test.ts
- increments both workspace revisions when a dependency-free reservation moves between trips → trips.test.ts
- serializes concurrent opposite-direction child moves without a revision deadlock → trips.test.ts
- persists and reads plural typed itinerary items, reservations and many-to-many links → trips.test.ts
- enforces the four-digit temporal contract at the PostgreSQL boundary → trips.test.ts
- proves Agency and same-Trip constraints, wrong-family rejection and no float columns → trips.test.ts (no-float-columns check moved to database-roles.test.ts)
- denies reads without a current Agency membership → trips.test.ts

## stage-6-publication-postgresql.test.ts
- upgrades the Stage 5 schema and proves Preview is read-only → publication.test.ts (preview read-only only; Stage 5 upgrade and packaged migrator dropped: stage-process)
- publishes immutable v1/v2, replays idempotency, rejects stale candidates and keeps records atomic → publication.test.ts
- rejects unauthenticated and unauthorized direct use-case invocation → publication.test.ts

## stage-7-postgresql.test.ts
- authenticates the acceptance runner against a real DEVELOPMENT Staff MFA realm dropped: stage-process
- applies the ordered Stage 7 migration to an empty supported database dropped: stage-process
- upgrades the accepted Stage 6 head through the canonical migrator dropped: stage-process
- verifies the exact checksummed chain and performs deterministic no-op reruns dropped: stage-process
- fixtureRunAndFirstTripAssociationAreAtomic dropped: stage-process
- fixtureRunAndFirstTripAreAtomic dropped: stage-process
- timeoutAfterTripCommitIsRecoverableByRunId dropped: stage-process
- noNewRunStartsWhileCleanupIsPending dropped: stage-process
- limitsCleanupAuditReadsToScopeAndEventMetadata dropped: stage-process
- cleanupRepositoryAuditsPendingAndCompletedTransitions dropped: stage-process
- fixtureRunRejectsCrossAgencyAndExcessResources dropped: stage-process
- onlyOneUnresolvedFixtureRunExistsPerAgency dropped: stage-process
- portalRuntimeCannotReadFixtureRegistry dropped: portal (Step 2) (portal access grants / Portal principals)
- associates only an OPEN fixture with an active verified synthetic Portal Principal dropped: portal (Step 2) (portal access grants / Portal principals)
- retiredPrincipalHasNoPortalSessionContext dropped: portal (Step 2) (portal access grants / Portal principals)
- backfills a preexisting Portal principal and session with authorization epoch one dropped: portal (Step 2) (portal access grants / Portal principals)
- keeps realm sessions separate when the email fields share one opaque marker dropped: portal (Step 2) (portal access grants / Portal principals)
- creates Portal principal and session context on Portal-realm registration dropped: portal (Step 2) (portal access grants / Portal principals)
- limits Portal enrollment to local operators and authenticates via the normal Portal realm dropped: portal (Step 2) (portal access grants / Portal principals)
- rolls back a synthetic Portal enrollment when native verification fails dropped: portal (Step 2) (portal access grants / Portal principals)
- portalEnrollmentAssociationRollsBackOnInvalidRun dropped: portal (Step 2) (portal access grants / Portal principals)
- keeps concurrent local Portal enrollment for one normalized address to one verified identity dropped: portal (Step 2) (portal access grants / Portal principals)
- gives existing Agency Owner templates the Stage 7 grant-management permission dropped: stage-process (permission-template upgrade)
- allows the Portal role only scoped grant, epoch/session, and immutable snapshot reads dropped: portal (Step 2) (portal access grants / Portal principals)
- owns Stage 7 grant and event tables by travelos_owner without PUBLIC ACLs dropped: portal (Step 2) (portal access grants / Portal principals)
- rejects expired, stale, wrong-scope, and wrong-Agency issue attempts without mutation dropped: portal (Step 2) (portal access grants / Portal principals)
- issues one same-Agency grant with atomic immutable event and outbox records dropped: portal (Step 2) (portal access grants / Portal principals)
- rejects idempotency-key reuse with a different request and duplicate active grants dropped: portal (Step 2) (portal access grants / Portal principals)
- allows Portal runtime to read an issued grant through its explicit columns dropped: portal (Step 2) (portal access grants / Portal principals)
- serves only the current immutable snapshot through the Portal HTTP route dropped: portal (Step 2) (portal access grants / Portal principals)
- prevents mutation and deletion of grant, audit, and outbox history dropped: portal (Step 2) (portal access grants / Portal principals)
- revokes atomically, increments the Portal authorization epoch, and replays idempotently dropped: portal (Step 2) (portal access grants / Portal principals)
- expires stale active grants before issuing a new grant dropped: portal (Step 2) (portal access grants / Portal principals)
- rejects commands after the Staff membership is revoked dropped: portal (Step 2) (portal access grants / Portal principals)
- withdraws the active snapshot, cancels the registered Trip, and retires only its Portal principal dropped: portal (Step 2) (portal access grants / Portal principals)
- cleans registered Trips and an enrolled Portal principal through the real Admin HTTP route dropped: portal (Step 2) (portal access grants / Portal principals)
- denies a same-Agency non-creator both cleanup repository paths without changing the fixture dropped: portal (Step 2) (portal access grants / Portal principals)
- exports the PostgreSQL Staff Trip access repository dropped: stage-process
- creates_an_authorized_minimal_trip_workspace_with_an_empty_itinerary → trips.test.ts
- persists Flight, Accommodation and Trip edits with workspace revision and item lock CAS → trips.test.ts
- does not update an itinerary item through a different Trip scope → trips.test.ts
- rolls back a Flight itinerary row when detail insertion fails → trips.test.ts
- rolls_back_customer_person_and_trip_when_primary_traveller_creation_fails → trips.test.ts
- workspace_list_and_detail_recheck_trip_view_and_agency_without_customer_or_cost_reads → trips.test.ts (seeded Stage 7 Trip replaced by a created one)
- lists only active grant-authorized snapshots through the least-privilege Portal role dropped: portal (Step 2) (portal access grants / Portal principals)
- exercises the built Admin and Portal journeys against isolated real APIs dropped: stage-process (browser acceptance, skipped unless env set)

## stage-8-postgresql.test.ts
- applies the additive Stage 8 migration and makes canonical rerun a no-op → worker.test.ts (rerun no-op + job table exists; head name dropped: stage-process)
- reports not-ready when $capability is missing → worker.test.ts
- requires a real same-Agency source for every delivery → worker.test.ts
- dispatches concurrently without duplicate jobs and commits Activity with completion → worker.test.ts
- captures request correlation atomically and uses stable context for legacy producers → worker.test.ts
- bounds task concurrency and does not hand the same job to two owners → worker.test.ts
- heartbeats with CAS and fences expired owners after restart recovery → worker.test.ts
- retries only safe temporary outcomes then dead-letters after five attempts → worker.test.ts
- quarantines ambiguous outcomes without replay and rejects invalid failure inputs → worker.test.ts
- rolls back projection and completion on database failure while Audit persists → worker.test.ts
- denies Portal job/history access and Worker workspace, credentials and Audit access → worker.test.ts (Worker half; Portal half dropped: portal (Step 2))
- executes built Worker from a release symlink, retries real SQL failures, recovers a killed claim and runs concurrently dropped: stage-process (release-symlink rehearsal)

## stage-9-staff-invitations-postgresql.test.ts
- applies migration 0016 on fresh and 0015 databases and seeds the exact fixed role → staff-auth.test.ts (fixed-role seed only; 0015→0016 upgrade dropped: stage-process)
- grants invitation data only to the Staff Admin runtime, never Portal or Worker → staff-auth.test.ts (Worker; Portal parts dropped: portal (Step 2))
- declares composite same-Agency constraints for role, issuer, consumer and audit references → staff-auth.test.ts
- issues, lists, reissues and revokes with one-use digests and atomic audit → staff-auth.test.ts
- materializes due expirations once and returns a bounded cursor page → staff-auth.test.ts
- consumes identity, membership, fixed Agency role and audit in one transaction → staff-auth.test.ts
- enrolls a verified Better Auth identity inside acceptance without creating a session → staff-auth.test.ts
- rolls back Better Auth identity and account rows when membership insertion fails → staff-auth.test.ts
- keeps the ordinary Staff sign-up endpoint disabled and session-free → staff-auth.test.ts
- rejects an existing identity without consuming the invitation or creating membership → staff-auth.test.ts
- serializes concurrent accepts so exactly one identity and consume event commit → staff-auth.test.ts
- keeps invitation audit append-only even for owner SQL and denies Admin mutation → staff-auth.test.ts
