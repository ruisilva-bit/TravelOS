import { useState } from "react";
import type { FormEvent } from "react";

import { TravelOSMark } from "@travelos/design-system";

interface PortalLoginViewProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (email: string, password: string) => Promise<void>;
}

export function PortalLoginView({ busy, error, onSubmit }: PortalLoginViewProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await onSubmit(email, password);
    setPassword("");
  };

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="portal-login-title">
        <a className="auth-card__brand" href="#/" aria-label="TravelOS, início">
          <TravelOSMark />
          <span>TravelOS</span>
          <span className="workspace-brand__realm">Portal</span>
        </a>
        <h1 id="portal-login-title">Entrar no Portal</h1>
        <p className="auth-card__intro">
          Consulte os itinerários publicados e autorizados para si.
        </p>
        <form
          className="auth-form"
          method="post"
          action="/api/auth/portal/sign-in/email"
          aria-labelledby="portal-login-title"
          aria-busy={busy}
          onSubmit={(event) => void submit(event)}
        >
          <div className="field">
            <label htmlFor="portal-email">Email</label>
            <input
              id="portal-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              disabled={busy}
            />
          </div>
          <div className="field">
            <label htmlFor="portal-password">Palavra-passe</label>
            <input
              id="portal-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              disabled={busy}
            />
          </div>
          <button className="button button--primary" type="submit" disabled={busy}>
            {busy ? "A autenticar…" : "Entrar"}
          </button>
        </form>
        <p className="auth-message" role="alert">
          {error}
        </p>
      </section>
    </main>
  );
}

interface PortalAccessGateProps {
  readonly title: string;
  readonly message: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

export function PortalAccessGate({ title, message, action }: PortalAccessGateProps) {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="portal-gate-title">
        <a className="auth-card__brand" href="#/" aria-label="TravelOS, início">
          <TravelOSMark />
          <span>TravelOS</span>
          <span className="workspace-brand__realm">Portal</span>
        </a>
        <h1 id="portal-gate-title">{title}</h1>
        <p className="auth-card__intro">{message}</p>
        {action ? (
          <button className="button button--secondary" type="button" onClick={action.onClick}>
            {action.label}
          </button>
        ) : null}
      </section>
    </main>
  );
}
