BEGIN READ ONLY;
SET LOCAL ROLE travelos_owner;
WITH runs AS (
  SELECT "agencyId", "fixtureRunId", "createdByStaffPrincipalId", "portalPrincipalId", "state"
  FROM portal_access.runtime_acceptance_fixture_run
), trips AS (
  SELECT link."agencyId", link."fixtureRunId", link."tripId", trip."state"
  FROM portal_access.runtime_acceptance_fixture_trip AS link
  JOIN trip_ops.trip AS trip ON trip."agencyId" = link."agencyId" AND trip.id = link."tripId"
), principal_ids AS (
  SELECT DISTINCT "agencyId", "portalPrincipalId" FROM runs WHERE "portalPrincipalId" IS NOT NULL
)
SELECT json_build_object(
  'sessionUser', session_user,
  'currentUser', current_user,
  'database', current_database(),
  'migrationCount', (SELECT count(*) FROM travelos_meta.schema_migrations),
  'migrationHead', (SELECT name FROM travelos_meta.schema_migrations ORDER BY id DESC LIMIT 1),
  'fixtureRuns', (SELECT count(*) FROM runs),
  'cleanedFixtureRuns', (SELECT count(*) FROM runs WHERE state = 'CLEANED'),
  'unresolvedFixtureRuns', (SELECT count(*) FROM runs WHERE state <> 'CLEANED'),
  'registeredTrips', (SELECT count(*) FROM trips),
  'cancelledTrips', (SELECT count(*) FROM trips WHERE state = 'CANCELLED'),
  'activeFixturePublications', (
    SELECT count(*) FROM trip_ops.publication_pointer AS pointer
    JOIN trips ON trips."agencyId" = pointer."agencyId" AND trips."tripId" = pointer."tripId"
  ),
  'activeFixtureGrants', (
    SELECT count(*) FROM portal_access.trip_access_grant AS access_grant
    JOIN trips ON trips."agencyId" = access_grant."agencyId" AND trips."tripId" = access_grant."tripId"
    WHERE access_grant."grantState" = 'ACTIVE'
  ),
  'retainedPublicationSnapshots', (
    SELECT count(*) FROM trip_ops.publication_snapshot AS snapshot
    JOIN trips ON trips."agencyId" = snapshot."agencyId" AND trips."tripId" = snapshot."tripId"
  ),
  'fixturePrincipals', (SELECT count(*) FROM principal_ids),
  'retiredFixturePrincipals', (
    SELECT count(*) FROM principal_ids AS fixture
    JOIN portal_access.portal_principal_context AS principal
      ON principal."agencyId" = fixture."agencyId" AND principal."portalPrincipalId" = fixture."portalPrincipalId"
    WHERE principal."retiredAt" IS NOT NULL
  ),
  'liveFixturePortalSessions', (
    SELECT count(*) FROM portal_access.portal_session AS session_row
    JOIN principal_ids AS fixture ON fixture."portalPrincipalId" = session_row."userId"
    WHERE session_row."expiresAt" > clock_timestamp()
  ),
  'liveStaffSessionsCreatedDuringAcceptance', (
    SELECT count(*) FROM staff_access.staff_session AS session_row
    WHERE session_row."userId" IN (SELECT "createdByStaffPrincipalId" FROM runs)
      AND session_row."createdAt" >= :'acceptanceStart'::timestamptz
      AND session_row."expiresAt" > clock_timestamp()
  ),
  'retainedFixtureAuditEvents', (
    SELECT count(*) FROM audit.runtime_acceptance_fixture_event AS event
    JOIN runs ON runs."agencyId" = event."agencyId" AND runs."fixtureRunId" = event."fixtureRunId"
  ),
  'portalPrivileges', json_build_object(
    'snapshotRead', has_column_privilege('travelos_portal_api', 'trip_ops.publication_snapshot', 'canonicalPayload', 'SELECT'),
    'grantRead', has_column_privilege('travelos_portal_api', 'portal_access.trip_access_grant', 'grantId', 'SELECT'),
    'workspaceRead', has_table_privilege('travelos_portal_api', 'trip_ops.trip', 'SELECT'),
    'internalCostRead', has_table_privilege('travelos_portal_api', 'finance.supplier_cost_line', 'SELECT'),
    'fixtureRegistryRead', has_table_privilege('travelos_portal_api', 'portal_access.runtime_acceptance_fixture_run', 'SELECT')
  )
);
COMMIT;
