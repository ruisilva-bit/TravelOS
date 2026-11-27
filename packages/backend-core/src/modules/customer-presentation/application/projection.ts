import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import { canonicalTripSnapshotV1Json } from "../domain/canonical-json.js";
import {
  assembleTripSnapshotV1,
  type TripSnapshotV1,
  type PublicationSafeTripInput,
} from "../domain/snapshot-v1.js";
import type {
  TripSnapshotHashPort,
  TripSnapshotValidatorPort,
  TripPublicationRevisionSource,
  TripPublicationSourceReadPort,
  TripPublicationSourceUnit,
} from "./publication-source.js";

export interface TripPublicationCandidate {
  readonly tripId: OpaqueId;
  readonly workspaceRevision: bigint;
  readonly projectionHash: string;
  readonly schemaVersion: 1;
  readonly projection: TripSnapshotV1;
  readonly canonicalJson: string;
}

export class TripPublicationNotFoundError extends Error {
  readonly code = "TRIP_NOT_FOUND" as const;

  constructor() {
    super("Trip was not found");
    this.name = "TripPublicationNotFoundError";
  }
}

const loadPublicationInput = async (
  sources: TripPublicationSourceUnit,
  agencyId: OpaqueId,
  tripId: OpaqueId,
): Promise<{
  readonly trip: TripPublicationRevisionSource;
  readonly input: PublicationSafeTripInput;
}> => {
  const trip = await sources.readTrip(agencyId, tripId);
  if (trip === null) throw new TripPublicationNotFoundError();
  const flights = await sources.listFlights(agencyId, tripId);
  const accommodations = await sources.listAccommodations(agencyId, tripId);
  const visibility = await sources.readVisibilityPolicy(agencyId, tripId);
  return {
    trip,
    input: {
      trip: {
        title: trip.title,
        startDate: trip.startDate,
        endDate: trip.endDate,
      },
      flights,
      accommodations,
      visibility,
    },
  };
};

/** Shared builder used inside both Preview reads and Publish transactions. */
export const buildTripPublicationCandidateFromSources = async (
  sources: TripPublicationSourceUnit,
  hasher: TripSnapshotHashPort,
  validator: TripSnapshotValidatorPort,
  agencyId: OpaqueId,
  tripId: OpaqueId,
): Promise<TripPublicationCandidate> => {
  const { trip, input } = await loadPublicationInput(sources, agencyId, tripId);
  const projection = assembleTripSnapshotV1(input);
  validator.validate(projection);
  const canonicalJson = canonicalTripSnapshotV1Json(projection);
  const projectionHash = await hasher.sha256(canonicalJson);
  if (!/^[0-9a-f]{64}$/u.test(projectionHash)) {
    throw new Error("Snapshot hasher returned a non-canonical SHA-256 digest");
  }
  return {
    tripId: asOpaqueId(trip.tripId),
    workspaceRevision: trip.workspaceRevision,
    projectionHash,
    schemaVersion: 1,
    projection,
    canonicalJson,
  };
};

/** Preview wrapper: every family query is enclosed in the same consistent read. */
export const buildTripPublicationCandidate = async (
  sources: TripPublicationSourceReadPort,
  hasher: TripSnapshotHashPort,
  validator: TripSnapshotValidatorPort,
  agencyId: OpaqueId,
  tripId: OpaqueId,
): Promise<TripPublicationCandidate> =>
  sources.withConsistentRead(agencyId, tripId, (consistentSources) =>
    buildTripPublicationCandidateFromSources(
      consistentSources,
      hasher,
      validator,
      agencyId,
      tripId,
    ),
  );
