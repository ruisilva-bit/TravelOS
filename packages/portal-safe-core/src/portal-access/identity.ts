/**
 * The Portal has an identity-only boundary in Stage 4. Explicit Trip access arrives in Stage 7.
 */
export interface PortalPrincipalIdentity {
  readonly portalPrincipalId: string;
}

export const portalPrincipalIdentityFromSession = (
  session: { readonly principalId: string } | null,
): PortalPrincipalIdentity | null =>
  session === null || session.principalId.length === 0
    ? null
    : { portalPrincipalId: session.principalId };
