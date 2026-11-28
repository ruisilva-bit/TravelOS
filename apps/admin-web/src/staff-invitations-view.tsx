import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  Button,
  ButtonLink,
  PageHeader,
  SectionHeading,
  StateMessage,
  StatusPill,
  Table,
  TextArea,
  TextField,
  TravelOSMark,
} from "@travelos/design-system";
import type { StatusTone, TableColumn, TableProps } from "@travelos/design-system";

import { AdminApiError } from "./api.js";
import {
  acceptAdminStaffInvitation,
  issueAdminStaffInvitation,
  listAdminStaffInvitations,
  revokeAdminStaffInvitation,
  reissueAdminStaffInvitation,
} from "./staff-invitation-api.js";
import type { AdminStaffInvitationMetadataV1 } from "@travelos/contracts/admin";
import { formatDateTimeMedium } from "./format.js";

type InvitationPageState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly items: readonly AdminStaffInvitationMetadataV1[];
      readonly nextCursor: string | null;
      readonly loadingMore: boolean;
      readonly loadMoreError: string | null;
    };

type InvitationHandoff = Awaited<ReturnType<typeof issueAdminStaffInvitation>>;

const invitationStatusLabel: Record<AdminStaffInvitationMetadataV1["status"], string> = {
  PENDING: "Por aceitar",
  CONSUMED: "Aceite",
  REVOKED: "Revogado",
  EXPIRED: "Expirado",
};

const invitationStatusTone = (status: AdminStaffInvitationMetadataV1["status"]): StatusTone => {
  if (status === "CONSUMED") return "success";
  if (status === "REVOKED") return "danger";
  if (status === "PENDING" || status === "EXPIRED") return "warning";
  return "neutral";
};

const formatInvitationDate = (value: string): string => formatDateTimeMedium(value);

const isAuthenticationRequired = (error: unknown): boolean =>
  error instanceof AdminApiError && error.code === "AUTHENTICATION_REQUIRED";

const invitationErrorMessage = (error: unknown, loading = false): string => {
  if (error instanceof AdminApiError && error.code === "ACCESS_DENIED") {
    return "Não tem autorização para gerir convites de Staff.";
  }
  return loading
    ? "Não foi possível carregar os convites. Tente novamente."
    : "Não foi possível concluir a operação do convite. Tente novamente.";
};

function InvitationTable({
  items,
  loading,
  busy,
  onReissue,
  onRevoke,
  pagination,
}: {
  readonly items: readonly AdminStaffInvitationMetadataV1[];
  readonly loading: boolean;
  readonly busy: boolean;
  readonly onReissue: (invitation: AdminStaffInvitationMetadataV1) => void;
  readonly onRevoke: (invitation: AdminStaffInvitationMetadataV1) => void;
  readonly pagination?: TableProps<AdminStaffInvitationMetadataV1>["pagination"];
}) {
  const columns: readonly TableColumn<AdminStaffInvitationMetadataV1>[] = [
    {
      key: "email",
      header: "Email",
      cell: (invitation) => (
        <strong className="staff-invitation-email">{invitation.targetEmail}</strong>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (invitation) => (
        <StatusPill tone={invitationStatusTone(invitation.status)}>
          {invitationStatusLabel[invitation.status]}
        </StatusPill>
      ),
    },
    {
      key: "created",
      header: "Criado",
      cell: (invitation) => (
        <time dateTime={invitation.createdAt}>{formatInvitationDate(invitation.createdAt)}</time>
      ),
    },
    {
      key: "expires",
      header: "Expira",
      cell: (invitation) => (
        <time dateTime={invitation.expiresAt}>{formatInvitationDate(invitation.expiresAt)}</time>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Ações</span>,
      align: "right",
      cell: (invitation) =>
        invitation.status === "PENDING" ? (
          <span className="staff-invitation-actions">
            <Button variant="ghost" onClick={() => onReissue(invitation)} disabled={busy}>
              Reemitir token
            </Button>
            <Button variant="ghost" onClick={() => onRevoke(invitation)} disabled={busy}>
              Revogar convite
            </Button>
          </span>
        ) : null,
    },
  ];
  return (
    <Table
      caption="Convites de equipa"
      columns={columns}
      rows={items}
      getRowKey={(invitation) => invitation.invitationId}
      loading={loading}
      loadingLabel="A carregar os convites…"
      empty={<StateMessage>Ainda não existem convites de equipa.</StateMessage>}
      pagination={pagination}
    />
  );
}

export function StaffInvitationsView({
  onAuthenticationRequired,
}: {
  readonly onAuthenticationRequired: () => void;
}) {
  const [page, setPage] = useState<InvitationPageState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [targetEmail, setTargetEmail] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [mutatingInvitationId, setMutatingInvitationId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<InvitationHandoff | null>(null);

  useEffect(() => {
    let current = true;
    setPage({ kind: "loading" });
    void listAdminStaffInvitations({ limit: 25, cursor: null }).then(
      (response) => {
        if (current) {
          setPage({
            kind: "ready",
            items: response.items,
            nextCursor: response.nextCursor,
            loadingMore: false,
            loadMoreError: null,
          });
        }
      },
      (error: unknown) => {
        if (!current) return;
        if (isAuthenticationRequired(error)) onAuthenticationRequired();
        setPage({ kind: "error", message: invitationErrorMessage(error, true) });
      },
    );
    return () => {
      current = false;
    };
  }, [onAuthenticationRequired, reloadKey]);

  const handleIssue = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setActionError(null);
    setIssuing(true);
    try {
      const result = await issueAdminStaffInvitation({ targetEmail });
      setHandoff(result);
      setTargetEmail("");
      setReloadKey((key) => key + 1);
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      setActionError(invitationErrorMessage(error));
    } finally {
      setIssuing(false);
    }
  };

  const handleReissue = async (invitation: AdminStaffInvitationMetadataV1): Promise<void> => {
    const confirmed = window.confirm(
      `Emitir um novo token para ${invitation.targetEmail}? O token anterior deixará de ser válido.`,
    );
    if (!confirmed) return;
    setActionError(null);
    setMutatingInvitationId(invitation.invitationId);
    try {
      setHandoff(await reissueAdminStaffInvitation(invitation.invitationId));
      setReloadKey((key) => key + 1);
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      setActionError(invitationErrorMessage(error));
    } finally {
      setMutatingInvitationId(null);
    }
  };

  const handleRevoke = async (invitation: AdminStaffInvitationMetadataV1): Promise<void> => {
    const confirmed = window.confirm(
      `Revogar o convite de ${invitation.targetEmail}? A pessoa deixará de poder aceitá-lo.`,
    );
    if (!confirmed) return;
    setActionError(null);
    setMutatingInvitationId(invitation.invitationId);
    try {
      const revokedInvitation = await revokeAdminStaffInvitation(invitation.invitationId);
      setPage((current) =>
        current.kind === "ready"
          ? {
              ...current,
              items: current.items.map((item) =>
                item.invitationId === revokedInvitation.invitationId ? revokedInvitation : item,
              ),
            }
          : current,
      );
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      setActionError(invitationErrorMessage(error));
    } finally {
      setMutatingInvitationId(null);
    }
  };

  const loadMore = async (): Promise<void> => {
    if (page.kind !== "ready" || page.nextCursor === null || page.loadingMore) return;
    const cursor = page.nextCursor;
    setPage({ ...page, loadingMore: true, loadMoreError: null });
    try {
      const response = await listAdminStaffInvitations({ limit: 25, cursor });
      setPage((current) => {
        if (current.kind !== "ready") return current;
        const existingIds = new Set(current.items.map((item) => item.invitationId));
        const newItems = response.items.filter((item) => !existingIds.has(item.invitationId));
        return {
          ...current,
          items: [...current.items, ...newItems],
          nextCursor: response.nextCursor,
          loadingMore: false,
          loadMoreError: null,
        };
      });
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      setPage((current) =>
        current.kind === "ready"
          ? {
              ...current,
              loadingMore: false,
              loadMoreError: invitationErrorMessage(error, true),
            }
          : current,
      );
    }
  };

  return (
    <section className="staff-invitations" aria-labelledby="staff-invitations-title">
      <PageHeader
        id="staff-invitations-title"
        title="Convites de equipa"
        description="Convide colaboradores para o espaço de operações da agência."
      />
      <p className="staff-invitations__policy">Trip Operations · utilização única · 60 minutos</p>

      {handoff ? (
        <section className="staff-invitation-handoff" aria-labelledby="staff-handoff-title">
          <div>
            <h2 id="staff-handoff-title">Entrega única do convite</h2>
            <p>
              Partilhe este token uma única vez através de um canal seguro. Não o inclua num link ou
              email.
            </p>
          </div>
          <TextArea
            id="staff-invitation-token"
            label="Token de utilização única"
            className="staff-invitation-handoff__token"
            rows={2}
            readOnly
            spellCheck={false}
            autoComplete="off"
            value={handoff.token}
          />
          <p className="staff-invitation-handoff__expiry">
            Convite para <strong>{handoff.invitation.targetEmail}</strong> · expira em{" "}
            <time dateTime={handoff.invitation.expiresAt}>
              {formatInvitationDate(handoff.invitation.expiresAt)}
            </time>
          </p>
          <div className="staff-invitation-handoff__actions">
            <ButtonLink variant="secondary" href="#/staff/invitations/accept">
              Abrir aceitação do convite
            </ButtonLink>
            <Button variant="ghost" onClick={() => setHandoff(null)}>
              Fechar e apagar o token
            </Button>
          </div>
        </section>
      ) : null}

      <form
        className="admin-form staff-invitations__form"
        aria-label="Emitir convite para Staff"
        method="post"
        action="/api/admin/staff/invitations"
        aria-busy={issuing}
        onSubmit={(event) => void handleIssue(event)}
      >
        <div>
          <h2>Emitir convite</h2>
          <p className="admin-form__hint">
            Acesso fixo Trip Operations. A função não pode ser alterada neste formulário.
          </p>
        </div>
        <div className="staff-invitations__form-controls">
          <TextField
            id="staff-invitation-email"
            label="Email profissional"
            name="targetEmail"
            type="email"
            autoComplete="email"
            required
            maxLength={320}
            value={targetEmail}
            onChange={(event) => setTargetEmail(event.currentTarget.value)}
            disabled={issuing}
          />
          <Button variant="primary" type="submit" loading={issuing}>
            {issuing ? "A emitir…" : "Emitir convite"}
          </Button>
        </div>
        {actionError ? (
          <StateMessage tone="error" role="alert">
            {actionError}
          </StateMessage>
        ) : null}
      </form>

      <section aria-labelledby="staff-invitation-list-title" aria-busy={page.kind === "loading"}>
        <SectionHeading id="staff-invitation-list-title" title="Convites" />
        {page.kind === "error" ? (
          <StateMessage
            tone="error"
            role="alert"
            action={
              <Button onClick={() => setReloadKey((key) => key + 1)}>Tentar novamente</Button>
            }
          >
            {page.message}
          </StateMessage>
        ) : (
          <>
            <InvitationTable
              items={page.kind === "ready" ? page.items : []}
              loading={page.kind === "loading"}
              busy={issuing || mutatingInvitationId !== null}
              onReissue={(invitation) => void handleReissue(invitation)}
              onRevoke={(invitation) => void handleRevoke(invitation)}
              pagination={
                page.kind === "ready"
                  ? {
                      hasMore: page.nextCursor !== null,
                      onLoadMore: () => void loadMore(),
                      loadingMore: page.loadingMore,
                      loadMoreLabel: "Carregar mais convites",
                    }
                  : undefined
              }
            />
            {page.kind === "ready" && page.items.length > 0 && actionError ? (
              <StateMessage tone="error" role="alert">
                {actionError}
              </StateMessage>
            ) : null}
            {page.kind === "ready" && page.loadMoreError ? (
              <StateMessage tone="error" role="alert">
                {page.loadMoreError}
              </StateMessage>
            ) : null}
          </>
        )}
      </section>
    </section>
  );
}

export function StaffInvitationAcceptView() {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await acceptAdminStaffInvitation({ token, name, password });
      setAccepted(true);
    } catch {
      setError("O convite não pôde ser aceite. Verifique o código ou solicite um novo convite.");
    } finally {
      setToken("");
      setPassword("");
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card staff-invitation-accept" aria-labelledby="staff-accept-title">
        <a className="auth-card__brand" href="#/" aria-label="TravelOS, início">
          <TravelOSMark />
          <span>TravelOS</span>
          <span className="workspace-brand__realm">Staff</span>
        </a>
        {accepted ? (
          <>
            <h1 id="staff-accept-title">Convite aceite</h1>
            <p className="auth-card__intro">
              A conta de equipa foi criada. Configure a autenticação de dois fatores ao iniciar
              sessão.
            </p>
            <ButtonLink variant="primary" href="#/">
              Iniciar sessão
            </ButtonLink>
          </>
        ) : (
          <>
            <h1 id="staff-accept-title">Aceitar convite de Staff</h1>
            <p className="auth-card__intro">
              Introduza o token recebido e crie as credenciais da sua conta de equipa.
            </p>
            <form
              className="auth-form"
              aria-labelledby="staff-accept-title"
              method="post"
              action="/api/staff/invitations/accept"
              aria-busy={busy}
              onSubmit={(event) => void submit(event)}
            >
              <TextField
                id="staff-invitation-accept-token"
                label="Código do convite"

                name="token"
                type="text"
                autoComplete="off"
                spellCheck={false}
                required
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
                disabled={busy}
              />
              <TextField
                id="staff-invitation-accept-name"
                label="Nome completo"

                name="name"
                type="text"
                autoComplete="name"
                maxLength={255}
                required
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                disabled={busy}
              />
              <TextField
                id="staff-invitation-accept-password"
                label="Criar palavra-passe"

                name="password"
                type="password"
                autoComplete="new-password"
                maxLength={1024}
                required
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                disabled={busy}
              />
              <Button variant="primary" type="submit" loading={busy}>
                {busy ? "A validar convite…" : "Aceitar convite"}
              </Button>
            </form>
            <p className="auth-message" role="alert">
              {error}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
