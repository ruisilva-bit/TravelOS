import {
  PortalAuthorizedTripListV1ResponseSchema,
  type PortalAuthorizedTripListV1Response,
} from "@travelos/contracts/portal";

import {
  portalPrincipalIdentityFromSession,
  type PortalPrincipalIdentity,
} from "../portal-access/identity.js";

export interface CurrentAuthorizedPortalTripListQuery {
  readonly agencyId: string;
  readonly portalPrincipalId: string;
  readonly portalSessionId: string;
  readonly authorizationEpoch: bigint;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface CurrentAuthorizedPortalTripListReader {
  listCurrentAuthorizedTrips(query: CurrentAuthorizedPortalTripListQuery): Promise<unknown>;
}

export interface ListAuthorizedPortalTripsInput {
  readonly session: unknown;
  readonly nowEpochMs: number;
  readonly limit: number;
  readonly cursor: string | null;
  readonly reader: CurrentAuthorizedPortalTripListReader;
}

export class PortalTripListContractViolation extends Error {
  constructor() {
    super("Portal authorized Trip list failed strict contract validation");
    this.name = "PortalTripListContractViolation";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

const identityFromCurrentSession = (
  session: unknown,
  nowEpochMs: number,
): PortalPrincipalIdentity | null => {
  const identity = portalPrincipalIdentityFromSession(session);
  if (identity === null || identity.expiresAtEpochMs <= nowEpochMs) return null;
  return identity;
};

/** Lists only current grant-authorized snapshots and explicit no-publication markers. */
export const listAuthorizedPortalTrips = async ({
  session,
  nowEpochMs,
  limit,
  cursor,
  reader,
}: ListAuthorizedPortalTripsInput): Promise<PortalAuthorizedTripListV1Response | null> => {
  if (
    !Number.isSafeInteger(nowEpochMs) ||
    nowEpochMs < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    (cursor !== null && (typeof cursor !== "string" || !UUID_PATTERN.test(cursor)))
  ) {
    return null;
  }

  const identity = identityFromCurrentSession(session, nowEpochMs);
  if (identity === null) return null;

  const candidate = await reader.listCurrentAuthorizedTrips({
    agencyId: identity.agencyId,
    portalPrincipalId: identity.portalPrincipalId,
    portalSessionId: identity.portalSessionId,
    authorizationEpoch: identity.authorizationEpoch,
    limit,
    cursor,
  });
  const parsed = PortalAuthorizedTripListV1ResponseSchema.safeParse(candidate);
  if (
    !parsed.success ||
    parsed.data.items.length > limit ||
    (parsed.data.items.length === 0 && parsed.data.nextCursor !== null) ||
    (parsed.data.nextCursor !== null &&
      (parsed.data.items.length !== limit ||
        parsed.data.items[parsed.data.items.length - 1]?.tripId !== parsed.data.nextCursor))
  ) {
    throw new PortalTripListContractViolation();
  }

  return parsed.data;
};
