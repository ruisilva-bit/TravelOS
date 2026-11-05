import { useCallback, useEffect, useState } from "react";

import { StaffAccessGate, StaffLoginView, StaffMfaSetupView, StaffMfaView } from "./auth-view.js";
import type { StaffMfaEnrollment, StaffMfaMethod } from "./auth-view.js";
import {
  AdminApiError,
  getAdminSessionContext,
  getAdminTripWorkspace,
  listAdminTrips,
} from "./api.js";
import {
  consumeStaffTwoFactorChallenge,
  resetStaffTwoFactorChallenge,
  staffAuthClient,
} from "./auth-client.js";
import { StaffInvitationAcceptView } from "./staff-invitations-view.js";
import { AdminWorkspaceView } from "./workspace-view.js";
import type { AdminTripsState, AdminWorkspaceState } from "./workspace-view.js";

type AdminRoute =
  | { readonly kind: "overview" }
  | { readonly kind: "trips" }
  | { readonly kind: "staff-invitations" }
  | { readonly kind: "staff-invitation-accept" }
  | { readonly kind: "detail"; readonly tripId: string }
  | { readonly kind: "invalid" };

type SessionState = "checking" | "anonymous" | "authenticated" | "denied" | "error";
type AuthenticationStage = "password" | "mfa" | "mfa-setup";

const readRoute = (): AdminRoute => {
  const rawPath = window.location.hash.slice(1).split("?", 1)[0] || "/";
  if (rawPath === "/") return { kind: "overview" };
  if (rawPath === "/trips") return { kind: "trips" };
  if (rawPath === "/staff/invitations") return { kind: "staff-invitations" };
  if (rawPath === "/staff/invitations/accept") return { kind: "staff-invitation-accept" };

  const match = /^\/trips\/([^/]+)$/u.exec(rawPath);
  if (!match?.[1]) return { kind: "invalid" };
  try {
    const tripId = decodeURIComponent(match[1]);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      tripId,
    )
      ? { kind: "detail", tripId }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
};

const safeErrorMessage = (error: unknown): string =>
  error instanceof AdminApiError ? error.message : "Ocorreu um erro. Tente novamente.";

export function AdminRoot() {
  const [route, setRoute] = useState<AdminRoute>(readRoute);
  const [session, setSession] = useState<SessionState>("checking");
  const [staffContext, setStaffContext] = useState<Awaited<
    ReturnType<typeof getAdminSessionContext>
  > | null>(null);
  const [authenticationStage, setAuthenticationStage] = useState<AuthenticationStage>("password");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [trips, setTrips] = useState<AdminTripsState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<AdminWorkspaceState>({ kind: "loading" });
  const [tripsReloadKey, setTripsReloadKey] = useState(0);
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const refreshSession = useCallback(async (): Promise<void> => {
    setSession("checking");
    setStaffContext(null);
    try {
      const context = await getAdminSessionContext();
      setStaffContext(context);
      setSession("authenticated");
      setAuthenticationStage("password");
      setAuthError(null);
    } catch (error) {
      if (error instanceof AdminApiError && error.code === "AUTHENTICATION_REQUIRED") {
        setAuthenticationStage("password");
        setSession("anonymous");
        return;
      }
      if (error instanceof AdminApiError && error.code === "ACCESS_DENIED") {
        setAuthenticationStage("password");
        setSession("denied");
        return;
      }
      setSession("error");
    }
  }, []);

  useEffect(() => {
    const onHashChange = (): void => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    if (route.kind !== "staff-invitation-accept") void refreshSession();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [refreshSession, route.kind]);

  useEffect(() => {
    if (
      session !== "authenticated" ||
      route.kind === "detail" ||
      route.kind === "invalid" ||
      route.kind === "staff-invitations" ||
      route.kind === "staff-invitation-accept"
    )
      return;

    let current = true;
    setTrips({ kind: "loading" });
    void listAdminTrips({ limit: 25, cursor: null }).then(
      (page) => {
        if (current) {
          setTrips({
            kind: "ready",
            items: page.items,
            nextCursor: page.nextCursor,
            loadingMore: false,
            loadMoreError: null,
          });
        }
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof AdminApiError && error.code === "AUTHENTICATION_REQUIRED") {
          setSession("anonymous");
          return;
        }
        setTrips(
          error instanceof AdminApiError && error.code === "ACCESS_DENIED"
            ? { kind: "denied" }
            : { kind: "error", message: safeErrorMessage(error) },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [route.kind, session, tripsReloadKey]);

  useEffect(() => {
    if (session !== "authenticated" || route.kind !== "detail") return;

    let current = true;
    setWorkspace({ kind: "loading" });
    void getAdminTripWorkspace(route.tripId).then(
      (result) => {
        if (current) setWorkspace({ kind: "ready", workspace: result });
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof AdminApiError && error.code === "AUTHENTICATION_REQUIRED") {
          setSession("anonymous");
          return;
        }
        if (error instanceof AdminApiError && error.code === "ACCESS_DENIED") {
          setWorkspace({ kind: "denied" });
          return;
        }
        if (error instanceof AdminApiError && error.code === "NOT_FOUND") {
          setWorkspace({ kind: "not-found" });
          return;
        }
        setWorkspace({ kind: "error", message: safeErrorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [route, session, workspaceReloadKey]);

  const submitCredentials = async (email: string, password: string): Promise<void> => {
    setAuthBusy(true);
    setAuthError(null);
    resetStaffTwoFactorChallenge();
    try {
      const result = await staffAuthClient.signIn.email({ email, password });
      if (result.error) {
        setAuthError("Não foi possível iniciar sessão. Verifique os dados e tente novamente.");
        return;
      }
      if (consumeStaffTwoFactorChallenge() !== null) {
        setAuthenticationStage("mfa");
        return;
      }
      const sessionResult = await staffAuthClient.getSession();
      if (sessionResult.error || !sessionResult.data?.user) {
        setAuthError("Não foi possível validar a sessão de equipa. Tente novamente.");
        return;
      }
      if (sessionResult.data.user.twoFactorEnabled !== true) {
        setAuthenticationStage("mfa-setup");
        return;
      }
      await refreshSession();
    } catch {
      setAuthError("Não foi possível iniciar sessão. Tente novamente.");
    } finally {
      setAuthBusy(false);
    }
  };

  const verifyMfa = async (method: StaffMfaMethod, code: string): Promise<void> => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result =
        method === "totp"
          ? await staffAuthClient.twoFactor.verifyTotp({ code })
          : await staffAuthClient.twoFactor.verifyBackupCode({ code });
      if (result.error) {
        setAuthError("Não foi possível validar o código. Tente novamente.");
        return;
      }
      await refreshSession();
    } catch {
      setAuthError("Não foi possível validar o código. Tente novamente.");
    } finally {
      setAuthBusy(false);
    }
  };

  const enableFirstMfa = async (password: string): Promise<StaffMfaEnrollment | null> => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await staffAuthClient.twoFactor.enable({
        password,
        issuer: "TravelOS Staff",
      });
      const data = result.data;
      if (
        result.error ||
        !data ||
        typeof data.totpURI !== "string" ||
        data.totpURI.length === 0 ||
        !Array.isArray(data.backupCodes) ||
        data.backupCodes.length === 0 ||
        !data.backupCodes.every((recoveryCode) => typeof recoveryCode === "string")
      ) {
        setAuthError("Não foi possível preparar a autenticação de dois fatores.");
        return null;
      }
      return { totpURI: data.totpURI, backupCodes: data.backupCodes };
    } catch {
      setAuthError("Não foi possível preparar a autenticação de dois fatores.");
      return null;
    } finally {
      setAuthBusy(false);
    }
  };

  const verifyFirstMfa = async (code: string): Promise<boolean> => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await staffAuthClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setAuthError("Não foi possível validar o código. Tente novamente.");
        setAuthBusy(false);
        return false;
      }
      return true;
    } catch {
      setAuthError("Não foi possível validar o código. Tente novamente.");
      setAuthBusy(false);
      return false;
    }
  };

  const completeFirstMfa = async (): Promise<void> => {
    try {
      await refreshSession();
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await staffAuthClient.signOut();
      if (result.error) {
        setSignOutError("Não foi possível terminar sessão. Tente novamente.");
        return;
      }
      try {
        await getAdminSessionContext();
        setSignOutError("Não foi possível confirmar o fim da sessão. Tente novamente.");
      } catch (error) {
        if (error instanceof AdminApiError && error.code === "AUTHENTICATION_REQUIRED") {
          setSession("anonymous");
          setAuthenticationStage("password");
          setAuthError(null);
        } else {
          setSignOutError("Não foi possível confirmar o fim da sessão. Tente novamente.");
        }
      }
    } catch {
      setSignOutError("Não foi possível terminar sessão. Tente novamente.");
    } finally {
      setSigningOut(false);
    }
  };

  const loadMoreTrips = async (): Promise<void> => {
    if (trips.kind !== "ready" || trips.nextCursor === null || trips.loadingMore) return;
    const cursor = trips.nextCursor;
    setTrips({ ...trips, loadingMore: true, loadMoreError: null });
    try {
      const nextPage = await listAdminTrips({ limit: 25, cursor });
      setTrips((current) =>
        current.kind === "ready"
          ? {
              ...current,
              items: [...current.items, ...nextPage.items],
              nextCursor: nextPage.nextCursor,
              loadingMore: false,
              loadMoreError: null,
            }
          : current,
      );
    } catch (error) {
      if (error instanceof AdminApiError && error.code === "AUTHENTICATION_REQUIRED") {
        setSession("anonymous");
        return;
      }
      setTrips((current) =>
        current.kind === "ready"
          ? { ...current, loadingMore: false, loadMoreError: safeErrorMessage(error) }
          : current,
      );
    }
  };

  const handleAuthenticationRequired = useCallback((): void => {
    void refreshSession();
  }, [refreshSession]);

  const handleTripCreated = (
    createdWorkspace: Awaited<ReturnType<typeof getAdminTripWorkspace>>,
  ): void => {
    setWorkspace({ kind: "ready", workspace: createdWorkspace });
    window.location.hash = `#/trips/${encodeURIComponent(createdWorkspace.trip.id)}`;
  };

  const handleWorkspaceUpdated = (
    updatedWorkspace: Awaited<ReturnType<typeof getAdminTripWorkspace>>,
  ): void => {
    setWorkspace({ kind: "ready", workspace: updatedWorkspace });
  };

  if (route.kind === "staff-invitation-accept") {
    return <StaffInvitationAcceptView />;
  }

  if (session === "checking") {
    return (
      <main className="auth-page">
        <p role="status" aria-live="polite">
          A validar a sessão de equipa…
        </p>
      </main>
    );
  }
  if (session === "anonymous") {
    if (authenticationStage === "mfa") {
      return <StaffMfaView busy={authBusy} error={authError} onVerify={verifyMfa} />;
    }
    if (authenticationStage === "mfa-setup") {
      return (
        <StaffMfaSetupView
          busy={authBusy}
          error={authError}
          onEnable={enableFirstMfa}
          onVerifyTotp={verifyFirstMfa}
          onVerified={completeFirstMfa}
        />
      );
    }
    return <StaffLoginView busy={authBusy} error={authError} onSubmit={submitCredentials} />;
  }
  if (session === "denied") {
    return (
      <StaffAccessGate
        title="Acesso não autorizado"
        message="Esta sessão não tem acesso ao espaço de operações."
        action={{ label: "Tentar novamente", onClick: () => void refreshSession() }}
      />
    );
  }
  if (session === "error") {
    return (
      <StaffAccessGate
        title="Não foi possível validar a sessão"
        message="O serviço está temporariamente indisponível."
        action={{ label: "Tentar novamente", onClick: () => void refreshSession() }}
      />
    );
  }
  if (route.kind === "invalid") {
    return (
      <StaffAccessGate
        title="Endereço inválido"
        message="O endereço pedido não corresponde a uma página disponível."
        action={{
          label: "Ver viagens",
          onClick: () => {
            window.location.hash = "#/trips";
          },
        }}
      />
    );
  }

  if (route.kind === "staff-invitations" && staffContext?.canInviteStaff !== true) {
    return (
      <StaffAccessGate
        title="Acesso não autorizado"
        message="A sua sessão não tem autorização para gerir convites de Staff."
      />
    );
  }

  const page = route.kind === "detail" ? "detail" : route.kind;
  return (
    <AdminWorkspaceView
      page={page}
      canInviteStaff={staffContext?.canInviteStaff === true}
      trips={trips}
      workspace={workspace}
      onRetryTrips={() => setTripsReloadKey((key) => key + 1)}
      onLoadMore={() => void loadMoreTrips()}
      onRetryWorkspace={() => setWorkspaceReloadKey((key) => key + 1)}
      onTripCreated={handleTripCreated}
      onWorkspaceUpdated={handleWorkspaceUpdated}
      onAuthenticationRequired={handleAuthenticationRequired}
      onSignOut={() => void signOut()}
      signingOut={signingOut}
      signOutError={signOutError}
    />
  );
}
