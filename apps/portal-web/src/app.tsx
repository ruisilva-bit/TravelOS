import { useCallback, useEffect, useState } from "react";

import { PortalAccessGate, PortalLoginView } from "./auth-view.js";
import {
  PortalApiError,
  getPortalSession,
  listPortalTrips,
  readPortalTripSnapshot,
} from "./api.js";
import { portalAuthClient } from "./auth-client.js";
import { PortalWorkspaceView } from "./workspace-view.js";
import type { PortalSnapshotState, PortalTripsState } from "./workspace-view.js";

type PortalRoute =
  | { readonly kind: "trips" }
  | { readonly kind: "detail"; readonly tripId: string }
  | { readonly kind: "invalid" };

type SessionState = "checking" | "anonymous" | "authenticated" | "denied" | "error";

const TRIP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const readRoute = (): PortalRoute => {
  const rawPath = window.location.hash.slice(1).split("?", 1)[0] || "/trips";
  if (rawPath === "/" || rawPath === "/trips") return { kind: "trips" };

  const match = /^\/trips\/([^/]+)$/u.exec(rawPath);
  if (!match?.[1]) return { kind: "invalid" };
  try {
    const tripId = decodeURIComponent(match[1]);
    return TRIP_ID.test(tripId) ? { kind: "detail", tripId } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
};

const safeErrorMessage = (error: unknown): string =>
  error instanceof PortalApiError ? error.message : "Ocorreu um erro. Tente novamente.";

export function PortalRoot() {
  const [route, setRoute] = useState<PortalRoute>(readRoute);
  const [session, setSession] = useState<SessionState>("checking");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [trips, setTrips] = useState<PortalTripsState>({ kind: "loading" });
  const [snapshot, setSnapshot] = useState<PortalSnapshotState>({ kind: "loading" });
  const [tripsReloadKey, setTripsReloadKey] = useState(0);
  const [snapshotReloadKey, setSnapshotReloadKey] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const refreshSession = useCallback(async (): Promise<void> => {
    setSession("checking");
    try {
      await getPortalSession();
      setSession("authenticated");
      setAuthError(null);
    } catch (error) {
      if (error instanceof PortalApiError && error.code === "AUTHENTICATION_REQUIRED") {
        setSession("anonymous");
        return;
      }
      if (error instanceof PortalApiError && error.code === "ACCESS_DENIED") {
        setSession("denied");
        return;
      }
      setSession("error");
    }
  }, []);

  useEffect(() => {
    const onHashChange = (): void => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    void refreshSession();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [refreshSession]);

  useEffect(() => {
    if (session !== "authenticated" || route.kind !== "trips") return;

    let current = true;
    setTrips({ kind: "loading" });
    void listPortalTrips({ limit: 25, cursor: null }).then(
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
        if (error instanceof PortalApiError && error.code === "AUTHENTICATION_REQUIRED") {
          setSession("anonymous");
          return;
        }
        setTrips(
          error instanceof PortalApiError && error.code === "ACCESS_DENIED"
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
    setSnapshot({ kind: "loading" });
    void readPortalTripSnapshot(route.tripId).then(
      (result) => {
        if (current) setSnapshot({ kind: "ready", snapshot: result });
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof PortalApiError && error.code === "AUTHENTICATION_REQUIRED") {
          setSession("anonymous");
          return;
        }
        if (
          error instanceof PortalApiError &&
          (error.code === "ACCESS_DENIED" || error.code === "NOT_AVAILABLE")
        ) {
          setSnapshot({ kind: "not-available" });
          return;
        }
        setSnapshot({ kind: "error", message: safeErrorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [route, session, snapshotReloadKey]);

  const submitCredentials = async (email: string, password: string): Promise<void> => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await portalAuthClient.signIn.email({ email, password });
      if (result.error) {
        setAuthError("Não foi possível iniciar sessão. Verifique os dados e tente novamente.");
        return;
      }
      await refreshSession();
    } catch {
      setAuthError("Não foi possível iniciar sessão. Tente novamente.");
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await portalAuthClient.signOut();
      if (result.error) {
        setSignOutError("Não foi possível terminar sessão. Tente novamente.");
        return;
      }
      try {
        await getPortalSession();
        setSignOutError("Não foi possível confirmar o fim da sessão. Tente novamente.");
      } catch (error) {
        if (error instanceof PortalApiError && error.code === "AUTHENTICATION_REQUIRED") {
          setSession("anonymous");
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
      const nextPage = await listPortalTrips({ limit: 25, cursor });
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
      if (error instanceof PortalApiError && error.code === "AUTHENTICATION_REQUIRED") {
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

  if (session === "checking") {
    return (
      <main className="auth-page">
        <p role="status" aria-live="polite">
          A validar a sessão do Portal…
        </p>
      </main>
    );
  }
  if (session === "anonymous") {
    return <PortalLoginView busy={authBusy} error={authError} onSubmit={submitCredentials} />;
  }
  if (session === "denied") {
    return (
      <PortalAccessGate
        title="Acesso não autorizado"
        message="Esta sessão não tem acesso ao Portal."
        action={{ label: "Tentar novamente", onClick: () => void refreshSession() }}
      />
    );
  }
  if (session === "error") {
    return (
      <PortalAccessGate
        title="Não foi possível validar a sessão"
        message="O serviço está temporariamente indisponível."
        action={{ label: "Tentar novamente", onClick: () => void refreshSession() }}
      />
    );
  }
  if (route.kind === "invalid") {
    return (
      <PortalAccessGate
        title="Endereço inválido"
        message="O endereço pedido não corresponde a um itinerário disponível."
        action={{
          label: "Ver viagens",
          onClick: () => {
            window.location.hash = "#/trips";
          },
        }}
      />
    );
  }

  return (
    <PortalWorkspaceView
      page={route.kind === "detail" ? "detail" : "trips"}
      trips={trips}
      snapshot={snapshot}
      onRetryTrips={() => setTripsReloadKey((key) => key + 1)}
      onLoadMore={() => void loadMoreTrips()}
      onRetrySnapshot={() => setSnapshotReloadKey((key) => key + 1)}
      onSignOut={() => void signOut()}
      signingOut={signingOut}
      signOutError={signOutError}
    />
  );
}
