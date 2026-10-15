import { PortalTripSnapshotV1Schema, type PortalTripSnapshotV1 } from "@travelos/contracts/portal";

import {
  portalPrincipalIdentityFromSession,
  type PortalPrincipalIdentity,
} from "../portal-access/identity.js";

export interface CurrentPublishedPortalTripSnapshotQuery {
  readonly agencyId: string;
  readonly portalPrincipalId: string;
  readonly portalSessionId: string;
  readonly authorizationEpoch: bigint;
  readonly tripId: string;
}

export interface CurrentPublishedPortalTripSnapshotReader {
  readCurrentPublishedTripSnapshot(
    query: CurrentPublishedPortalTripSnapshotQuery,
  ): Promise<unknown | null>;
}

export interface ReadCurrentPortalTripSnapshotInput {
  readonly session: unknown;
  readonly tripId: unknown;
  readonly nowEpochMs: number;
  readonly reader: CurrentPublishedPortalTripSnapshotReader;
}

export class PortalSnapshotContractViolation extends Error {
  constructor() {
    super("Portal published snapshot failed strict contract validation");
    this.name = "PortalSnapshotContractViolation";
  }
}

const TRIP_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

const identityFromCurrentSession = (
  session: unknown,
  nowEpochMs: number,
): PortalPrincipalIdentity | null => {
  const identity = portalPrincipalIdentityFromSession(session);
  if (identity === null || identity.expiresAtEpochMs <= nowEpochMs) return null;
  return identity;
};

/**
 * Resolves the current explicitly granted Portal Trip projection on every call.
 * The reader must use only current access state and immutable publication storage.
 */
export const readCurrentPortalTripSnapshot = async ({
  session,
  tripId,
  nowEpochMs,
  reader,
}: ReadCurrentPortalTripSnapshotInput): Promise<PortalTripSnapshotV1 | null> => {
  if (
    !Number.isSafeInteger(nowEpochMs) ||
    nowEpochMs < 0 ||
    typeof tripId !== "string" ||
    !TRIP_ID_PATTERN.test(tripId)
  ) {
    return null;
  }

  const identity = identityFromCurrentSession(session, nowEpochMs);
  if (identity === null) return null;

  const candidate = await reader.readCurrentPublishedTripSnapshot({
    agencyId: identity.agencyId,
    portalPrincipalId: identity.portalPrincipalId,
    portalSessionId: identity.portalSessionId,
    authorizationEpoch: identity.authorizationEpoch,
    tripId,
  });
  if (candidate === null) return null;

  const parsed = PortalTripSnapshotV1Schema.safeParse(candidate);
  if (!parsed.success) throw new PortalSnapshotContractViolation();
  return parsed.data;
};
