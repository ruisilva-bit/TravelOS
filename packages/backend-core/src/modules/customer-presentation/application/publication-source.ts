import type { OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type {
  PublicationSafeAccommodationSource,
  PublicationSafeFlightSource,
  PublicationSafeTripSource,
  PublicationVisibilityPolicy,
} from "../domain/snapshot-v1.js";

export interface TripPublicationRevisionSource extends PublicationSafeTripSource {
  readonly tripId: OpaqueId;
  readonly workspaceRevision: bigint;
}

export interface TripPublicationSourcePort {
  readTrip(agencyId: OpaqueId, tripId: OpaqueId): Promise<TripPublicationRevisionSource | null>;
}

export interface FlightPublicationSourcePort {
  listFlights(
    agencyId: OpaqueId,
    tripId: OpaqueId,
  ): Promise<readonly PublicationSafeFlightSource[]>;
}

export interface AccommodationPublicationSourcePort {
  listAccommodations(
    agencyId: OpaqueId,
    tripId: OpaqueId,
  ): Promise<readonly PublicationSafeAccommodationSource[]>;
}

export interface PublicationVisibilitySourcePort {
  readVisibilityPolicy(agencyId: OpaqueId, tripId: OpaqueId): Promise<PublicationVisibilityPolicy>;
}

/**
 * The adapter implements these family-specific ports in one consistent PostgreSQL read
 * transaction. It deliberately exposes no operational, finance, auth, or provider repository.
 */
export interface TripPublicationSourceUnit
  extends
    TripPublicationSourcePort,
    FlightPublicationSourcePort,
    AccommodationPublicationSourcePort,
    PublicationVisibilitySourcePort {}

export interface TripPublicationSourceReadPort extends TripPublicationSourceUnit {
  withConsistentRead<Result>(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    read: (sources: TripPublicationSourceUnit) => Promise<Result>,
  ): Promise<Result>;
}

export interface TripSnapshotHashPort {
  sha256(canonicalJson: string): Promise<string>;
}

export interface TripSnapshotValidatorPort {
  validate(value: unknown): void;
}
