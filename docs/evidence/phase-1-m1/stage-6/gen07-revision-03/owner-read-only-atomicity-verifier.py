#!/usr/bin/env python3
"""Bounded, read-only owner-side verification of Stage 6 audit/outbox atomicity."""
from __future__ import annotations

import json
import re
import shlex
import subprocess
import sys

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def main() -> None:
    if len(sys.argv) != 3 or not all(UUID_RE.fullmatch(v) for v in sys.argv[1:]):
        raise RuntimeError("expected_valid_trip_and_agency_uuid")
    trip_id, agency_id = sys.argv[1:]
    sql = f"""
BEGIN READ ONLY;
SET ROLE travelos_owner;
SELECT jsonb_build_object(
 'identity', jsonb_build_object('sessionUser', session_user, 'currentUser', current_user),
 'entityIds', jsonb_build_object(
   'travellerId', (SELECT tt.\"id\"::text FROM \"trip_ops\".\"trip_traveller\" tt WHERE tt.\"agencyId\"='{agency_id}'::uuid AND tt.\"tripId\"='{trip_id}'::uuid ORDER BY tt.\"id\" LIMIT 1),
   'personId', (SELECT tt.\"personId\"::text FROM \"trip_ops\".\"trip_traveller\" tt WHERE tt.\"agencyId\"='{agency_id}'::uuid AND tt.\"tripId\"='{trip_id}'::uuid ORDER BY tt.\"id\" LIMIT 1),
   'customerId', (SELECT cp.\"customerId\"::text FROM \"trip_ops\".\"trip_traveller\" tt JOIN \"crm\".\"customer_person\" cp ON cp.\"agencyId\"=tt.\"agencyId\" AND cp.\"personId\"=tt.\"personId\" AND cp.\"isPrimary\" WHERE tt.\"agencyId\"='{agency_id}'::uuid AND tt.\"tripId\"='{trip_id}'::uuid ORDER BY cp.\"customerId\" LIMIT 1),
   'flightItemId', (SELECT i.\"id\"::text FROM \"trip_ops\".\"itinerary_item\" i WHERE i.\"agencyId\"='{agency_id}'::uuid AND i.\"tripId\"='{trip_id}'::uuid AND i.\"family\"='FLIGHT'),
   'accommodationItemId', (SELECT i.\"id\"::text FROM \"trip_ops\".\"itinerary_item\" i WHERE i.\"agencyId\"='{agency_id}'::uuid AND i.\"tripId\"='{trip_id}'::uuid AND i.\"family\"='ACCOMMODATION'),
   'reservationId', (SELECT r.\"id\"::text FROM \"trip_ops\".\"reservation\" r WHERE r.\"agencyId\"='{agency_id}'::uuid AND r.\"tripId\"='{trip_id}'::uuid),
   'supplierCostId', (SELECT c.\"id\"::text FROM \"finance\".\"supplier_cost_line\" c WHERE c.\"agencyId\"='{agency_id}'::uuid AND c.\"tripId\"='{trip_id}'::uuid)
 ),
 'relationshipCounts', jsonb_build_object(
   'travellers', (SELECT count(*) FROM \"trip_ops\".\"trip_traveller\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid),
   'customerLinks', (SELECT count(*) FROM \"trip_ops\".\"trip_traveller\" tt JOIN \"crm\".\"customer_person\" cp ON cp.\"agencyId\"=tt.\"agencyId\" AND cp.\"personId\"=tt.\"personId\" WHERE tt.\"agencyId\"='{agency_id}'::uuid AND tt.\"tripId\"='{trip_id}'::uuid),
   'flightItems', (SELECT count(*) FROM \"trip_ops\".\"itinerary_item\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid AND \"family\"='FLIGHT'),
   'accommodationItems', (SELECT count(*) FROM \"trip_ops\".\"itinerary_item\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid AND \"family\"='ACCOMMODATION'),
   'reservations', (SELECT count(*) FROM \"trip_ops\".\"reservation\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid),
   'reservationItemLinks', (SELECT count(*) FROM \"trip_ops\".\"reservation_item_link\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid),
   'supplierCosts', (SELECT count(*) FROM \"finance\".\"supplier_cost_line\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid)
 ),
 'counts', jsonb_build_object(
   'versions', (SELECT count(*) FROM \"trip_ops\".\"publication_version\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid),
   'snapshots', (SELECT count(*) FROM \"trip_ops\".\"publication_snapshot\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid),
   'pointers', (SELECT count(*) FROM \"trip_ops\".\"publication_pointer\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid),
   'idempotency', (SELECT count(*) FROM \"trip_ops\".\"publication_idempotency\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid),
   'events', (SELECT count(*) FROM \"trip_ops\".\"publication_event\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid),
   'audit', (SELECT count(*) FROM \"audit\".\"trip_publication_event\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid),
   'outbox', (SELECT count(*) FROM \"integration\".\"trip_publication_outbox\" WHERE \"agencyId\"='{agency_id}'::uuid AND \"tripId\"='{trip_id}'::uuid)
 ),
 'perPublication', (SELECT jsonb_agg(jsonb_build_object(
   'publicationId', v.\"publicationId\"::text, 'version', v.\"version\", 'projectionHash', btrim(v.\"projectionHash\"),
   'eventCount', (SELECT count(*) FROM \"trip_ops\".\"publication_event\" e WHERE e.\"publicationId\"=v.\"publicationId\" AND e.\"agencyId\"=v.\"agencyId\" AND e.\"tripId\"=v.\"tripId\" AND e.\"eventType\"='TRIP_PUBLICATION_PUBLISHED'),
   'auditCount', (SELECT count(*) FROM \"audit\".\"trip_publication_event\" a WHERE a.\"publicationId\"=v.\"publicationId\" AND a.\"agencyId\"=v.\"agencyId\" AND a.\"tripId\"=v.\"tripId\" AND a.\"action\"='TRIP_PUBLISHED' AND a.\"schemaVersion\"=v.\"schemaVersion\" AND btrim(a.\"projectionHash\")=btrim(v.\"projectionHash\")),
   'outboxCount', (SELECT count(*) FROM \"integration\".\"trip_publication_outbox\" o WHERE o.\"publicationId\"=v.\"publicationId\" AND o.\"agencyId\"=v.\"agencyId\" AND o.\"tripId\"=v.\"tripId\" AND o.\"version\"=v.\"version\" AND o.\"eventType\"='TRIP_PUBLICATION_PUBLISHED'),
   'outboxEventLinked', EXISTS (SELECT 1 FROM \"integration\".\"trip_publication_outbox\" o JOIN \"trip_ops\".\"publication_event\" e ON e.\"eventId\"=o.\"eventId\" WHERE o.\"publicationId\"=v.\"publicationId\" AND e.\"publicationId\"=v.\"publicationId\" AND e.\"version\"=v.\"version\"),
   'eventActorMatchesPublisher', EXISTS (SELECT 1 FROM \"trip_ops\".\"publication_event\" e WHERE e.\"publicationId\"=v.\"publicationId\" AND e.\"actorStaffPrincipalId\"=v.\"publisherStaffPrincipalId\")
 ) ORDER BY v.\"version\") FROM \"trip_ops\".\"publication_version\" v WHERE v.\"agencyId\"='{agency_id}'::uuid AND v.\"tripId\"='{trip_id}'::uuid),
 'orphanCounts', jsonb_build_object(
   'eventsWithoutVersion', (SELECT count(*) FROM \"trip_ops\".\"publication_event\" e LEFT JOIN \"trip_ops\".\"publication_version\" v ON v.\"publicationId\"=e.\"publicationId\" AND v.\"agencyId\"=e.\"agencyId\" AND v.\"tripId\"=e.\"tripId\" AND v.\"version\"=e.\"version\" WHERE e.\"agencyId\"='{agency_id}'::uuid AND e.\"tripId\"='{trip_id}'::uuid AND v.\"publicationId\" IS NULL),
   'auditsWithoutVersion', (SELECT count(*) FROM \"audit\".\"trip_publication_event\" a LEFT JOIN \"trip_ops\".\"publication_version\" v ON v.\"publicationId\"=a.\"publicationId\" AND v.\"agencyId\"=a.\"agencyId\" AND v.\"tripId\"=a.\"tripId\" WHERE a.\"agencyId\"='{agency_id}'::uuid AND a.\"tripId\"='{trip_id}'::uuid AND v.\"publicationId\" IS NULL),
   'outboxesWithoutEvent', (SELECT count(*) FROM \"integration\".\"trip_publication_outbox\" o LEFT JOIN \"trip_ops\".\"publication_event\" e ON e.\"eventId\"=o.\"eventId\" WHERE o.\"agencyId\"='{agency_id}'::uuid AND o.\"tripId\"='{trip_id}'::uuid AND e.\"eventId\" IS NULL),
   'outboxesWithoutVersion', (SELECT count(*) FROM \"integration\".\"trip_publication_outbox\" o LEFT JOIN \"trip_ops\".\"publication_version\" v ON v.\"publicationId\"=o.\"publicationId\" AND v.\"agencyId\"=o.\"agencyId\" AND v.\"tripId\"=o.\"tripId\" AND v.\"version\"=o.\"version\" WHERE o.\"agencyId\"='{agency_id}'::uuid AND o.\"tripId\"='{trip_id}'::uuid AND v.\"publicationId\" IS NULL)
 ),
 'immutability', jsonb_build_object(
   'triggerNames', (SELECT jsonb_agg(t.tgname ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgname IN ('publication_version_immutable_trigger','publication_snapshot_immutable_trigger','publication_event_immutable_trigger','publication_audit_immutable_trigger','publication_outbox_immutable_trigger') AND NOT t.tgisinternal),
   'adminUpdateDeleteDenied', jsonb_build_object(
     'version', NOT has_table_privilege('travelos_admin_api','trip_ops.publication_version','UPDATE') AND NOT has_table_privilege('travelos_admin_api','trip_ops.publication_version','DELETE'),
     'snapshot', NOT has_table_privilege('travelos_admin_api','trip_ops.publication_snapshot','UPDATE') AND NOT has_table_privilege('travelos_admin_api','trip_ops.publication_snapshot','DELETE'),
     'event', NOT has_table_privilege('travelos_admin_api','trip_ops.publication_event','UPDATE') AND NOT has_table_privilege('travelos_admin_api','trip_ops.publication_event','DELETE'),
     'audit', NOT has_table_privilege('travelos_admin_api','audit.trip_publication_event','UPDATE') AND NOT has_table_privilege('travelos_admin_api','audit.trip_publication_event','DELETE'),
     'outbox', NOT has_table_privilege('travelos_admin_api','integration.trip_publication_outbox','UPDATE') AND NOT has_table_privilege('travelos_admin_api','integration.trip_publication_outbox','DELETE')
   ),
   'portalWorkspaceSelectDenied', NOT has_table_privilege('travelos_portal_api','trip_ops.trip','SELECT')
 )
)::text;
ROLLBACK;
"""
    remote = "sudo -n travelos-migrator-exec /usr/bin/psql -X -qAt -v ON_ERROR_STOP=1 -d travelos_development -c " + shlex.quote(sql)
    result = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "travelos-dev", remote], capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"read_only_owner_verification_failed_{result.returncode}")
    data = json.loads(result.stdout.strip())
    checks = {
        "identity": data.get("identity") == {"sessionUser": "travelos_migrator", "currentUser": "travelos_owner"},
        "counts": data.get("counts") == {"versions": 2, "snapshots": 2, "pointers": 1, "idempotency": 2, "events": 2, "audit": 2, "outbox": 2},
        "perPublication": len(data.get("perPublication") or []) == 2 and all(row.get("eventCount") == row.get("auditCount") == row.get("outboxCount") == 1 and row.get("outboxEventLinked") and row.get("eventActorMatchesPublisher") for row in data["perPublication"]),
        "orphans": data.get("orphanCounts") == {"eventsWithoutVersion": 0, "auditsWithoutVersion": 0, "outboxesWithoutEvent": 0, "outboxesWithoutVersion": 0},
        "immutability": len(data.get("immutability", {}).get("triggerNames") or []) == 5 and all(data["immutability"].get("adminUpdateDeleteDenied", {}).values()) and data["immutability"].get("portalWorkspaceSelectDenied") is True,
        "entityCounts": data.get("relationshipCounts") == {"travellers": 1, "customerLinks": 1, "flightItems": 1, "accommodationItems": 1, "reservations": 1, "reservationItemLinks": 2, "supplierCosts": 1},
        "entityIdsComplete": all(data.get("entityIds", {}).get(key) for key in ("travellerId", "personId", "customerId", "flightItemId", "accommodationItemId", "reservationId", "supplierCostId")),
    }
    data["checks"] = checks
    data["result"] = "PASS" if all(checks.values()) else "FAIL"
    print(json.dumps(data, sort_keys=True))
    if not all(checks.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
