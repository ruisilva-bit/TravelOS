import { useState } from "react";
import type { FormEvent } from "react";

import { TravelOSMark } from "@travelos/design-system";

export type StaffMfaMethod = "totp" | "backup";

interface StaffLoginViewProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (email: string, password: string) => Promise<void>;
}

export function StaffLoginView({ busy, error, onSubmit }: StaffLoginViewProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await onSubmit(email, password);
    setPassword("");
  };

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="staff-login-title">
        <a className="auth-card__brand" href="#/" aria-label="TravelOS, início">
          <TravelOSMark />
          <span>TravelOS</span>
          <span className="workspace-brand__realm">Staff</span>
        </a>
        <h1 id="staff-login-title">Entrar na equipa</h1>
        <p className="auth-card__intro">Aceda ao espaço de operações da sua agência.</p>
        <form
          className="auth-form"
          method="post"
          action="/api/auth/staff/sign-in/email"
          aria-labelledby="staff-login-title"
          aria-busy={busy}
          onSubmit={(event) => void submit(event)}
        >
          <div className="field">
            <label htmlFor="staff-email">Email profissional</label>
            <input
              id="staff-email"
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
            <label htmlFor="staff-password">Palavra-passe</label>
            <input
              id="staff-password"
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

interface StaffMfaViewProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onVerify: (method: StaffMfaMethod, code: string) => Promise<void>;
}

export function StaffMfaView({ busy, error, onVerify }: StaffMfaViewProps) {
  const [method, setMethod] = useState<StaffMfaMethod>("totp");
  const [code, setCode] = useState("");
  const action =
    method === "totp"
      ? "/api/auth/staff/two-factor/verify-totp"
      : "/api/auth/staff/two-factor/verify-backup-code";

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await onVerify(method, code);
    setCode("");
  };

  const switchMethod = (): void => {
    setMethod((current) => (current === "totp" ? "backup" : "totp"));
    setCode("");
  };

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="staff-mfa-title">
        <a className="auth-card__brand" href="#/" aria-label="TravelOS, início">
          <TravelOSMark />
          <span>TravelOS</span>
          <span className="workspace-brand__realm">Staff</span>
        </a>
        <h1 id="staff-mfa-title">Confirmar identidade</h1>
        <p className="auth-card__intro">Introduza um código da sua aplicação de autenticação.</p>
        <form
          className="auth-form"
          method="post"
          action={action}
          aria-labelledby="staff-mfa-title"
          aria-busy={busy}
          onSubmit={(event) => void submit(event)}
        >
          <div className="field">
            <label htmlFor="staff-mfa-code">
              {method === "totp" ? "Código de autenticação" : "Código de recuperação"}
            </label>
            <input
              id="staff-mfa-code"
              name="code"
              type="text"
              inputMode={method === "totp" ? "numeric" : "text"}
              autoComplete={method === "totp" ? "one-time-code" : "off"}
              required
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
              disabled={busy}
            />
          </div>
          <button className="button button--primary" type="submit" disabled={busy}>
            {busy ? "A validar…" : "Confirmar"}
          </button>
          <button
            className="auth-form__switch"
            type="button"
            onClick={switchMethod}
            disabled={busy}
          >
            {method === "totp" ? "Usar código de recuperação" : "Usar aplicação de autenticação"}
          </button>
        </form>
        <p className="auth-message" role="alert">
          {error}
        </p>
      </section>
    </main>
  );
}

export interface StaffMfaEnrollment {
  readonly totpURI: string;
  readonly backupCodes: readonly string[];
}

interface StaffMfaSetupViewProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onEnable: (password: string) => Promise<StaffMfaEnrollment | null>;
  readonly onVerifyTotp: (code: string) => Promise<boolean>;
  readonly onVerified: () => Promise<void>;
}

type StaffMfaSetupStage = "password" | "recovery" | "verify";

export function StaffMfaSetupView({
  busy,
  error,
  onEnable,
  onVerifyTotp,
  onVerified,
}: StaffMfaSetupViewProps) {
  const [password, setPassword] = useState("");
  const [enrollment, setEnrollment] = useState<StaffMfaEnrollment | null>(null);
  const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false);
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<StaffMfaSetupStage>("password");

  const enable = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const result = await onEnable(password);
    setPassword("");
    if (result) {
      setEnrollment(result);
      setRecoveryCodesSaved(false);
      setStage("recovery");
    }
  };

  const continueToTotp = (): void => {
    if (!recoveryCodesSaved || !enrollment) return;
    setEnrollment(null);
    setRecoveryCodesSaved(false);
    setStage("verify");
  };

  const verifyTotp = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    let verified: boolean;
    try {
      verified = await onVerifyTotp(code);
    } finally {
      setCode("");
    }
    if (verified) {
      setEnrollment(null);
      setStage("verify");
      await onVerified();
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card staff-mfa-setup" aria-labelledby="staff-mfa-setup-title">
        <a className="auth-card__brand" href="#/" aria-label="TravelOS, início">
          <TravelOSMark />
          <span>TravelOS</span>
          <span className="workspace-brand__realm">Staff</span>
        </a>
        <h1 id="staff-mfa-setup-title">Configurar autenticação de dois fatores</h1>
        <p className="auth-card__intro">
          A configuração TOTP é obrigatória antes de aceder ao espaço de operações.
        </p>
        {stage === "password" ? (
          <form
            className="auth-form"
            method="post"
            action="/api/auth/staff/two-factor/enable"
            aria-labelledby="staff-mfa-setup-title"
            aria-busy={busy}
            onSubmit={(event) => void enable(event)}
          >
            <div className="field">
              <label htmlFor="staff-mfa-setup-password">Palavra-passe atual</label>
              <input
                id="staff-mfa-setup-password"
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
              {busy ? "A preparar…" : "Ativar autenticação"}
            </button>
          </form>
        ) : null}
        {stage === "recovery" && enrollment ? (
          <div className="staff-mfa-setup__recovery">
            <h2>Guarde os códigos de recuperação</h2>
            <p className="auth-card__intro">
              Guarde estes códigos num local seguro. Cada código só pode ser utilizado uma vez.
            </p>
            <div className="field">
              <label htmlFor="staff-mfa-setup-uri">URI de configuração TOTP</label>
              <textarea
                id="staff-mfa-setup-uri"
                className="staff-mfa-setup__uri"
                rows={3}
                readOnly
                spellCheck={false}
                autoComplete="off"
                value={enrollment.totpURI}
              />
            </div>
            <ul className="staff-mfa-setup__codes" aria-label="Códigos de recuperação">
              {enrollment.backupCodes.map((recoveryCode) => (
                <li key={recoveryCode}>
                  <code>{recoveryCode}</code>
                </li>
              ))}
            </ul>
            <label className="staff-mfa-setup__confirmation">
              <input
                type="checkbox"
                checked={recoveryCodesSaved}
                onChange={(event) => setRecoveryCodesSaved(event.currentTarget.checked)}
                disabled={busy}
              />
              <span>Guardei os códigos de recuperação num local seguro</span>
            </label>
            <button
              className="button button--primary"
              type="button"
              onClick={continueToTotp}
              disabled={!recoveryCodesSaved || busy}
            >
              Continuar
            </button>
          </div>
        ) : null}
        {stage === "verify" ? (
          <form
            className="auth-form"
            method="post"
            action="/api/auth/staff/two-factor/verify-totp"
            aria-labelledby="staff-mfa-setup-title"
            aria-busy={busy}
            onSubmit={(event) => void verifyTotp(event)}
          >
            <div className="field">
              <label htmlFor="staff-mfa-setup-code">Código da aplicação de autenticação</label>
              <input
                id="staff-mfa-setup-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.currentTarget.value)}
                disabled={busy}
              />
            </div>
            <button className="button button--primary" type="submit" disabled={busy}>
              {busy ? "A validar…" : "Validar e continuar"}
            </button>
          </form>
        ) : null}
        <p className="auth-message" role="alert">
          {error}
        </p>
      </section>
    </main>
  );
}

interface StaffAccessGateProps {
  readonly title: string;
  readonly message: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

export function StaffAccessGate({ title, message, action }: StaffAccessGateProps) {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="staff-gate-title">
        <a className="auth-card__brand" href="#/" aria-label="TravelOS, início">
          <TravelOSMark />
          <span>TravelOS</span>
          <span className="workspace-brand__realm">Staff</span>
        </a>
        <h1 id="staff-gate-title">{title}</h1>
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
