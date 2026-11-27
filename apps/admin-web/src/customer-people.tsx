import { Button, EmptyState, StatusPill, Table } from "@travelos/design-system";
import type { TableColumn } from "@travelos/design-system";
import { useState } from "react";

import { ROLE_LABELS, countryName } from "./crm-shared.js";
import { formatDate } from "./format.js";
import { PersonFormDialog, SENSITIVE_HIDDEN_NOTE } from "./person-form-dialog.js";
import type { CustomerPerson } from "./person-form-dialog.js";
import { PersonRolesDialog } from "./person-roles-dialog.js";

type Dialogs =
  | { readonly kind: "none" }
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly person: CustomerPerson }
  | { readonly kind: "roles"; readonly person: CustomerPerson };

/** Sensitive fields come back null when redacted; any value present means the viewer may see them. */
export const hasSensitiveAccess = (people: readonly CustomerPerson[]): boolean =>
  people.some(
    (person) =>
      person.birthDate !== null || person.passportNumber !== null || person.passportExpiry !== null,
  );

export function CustomerPeople({
  customerId,
  people,
  onChanged,
  onAuthenticationRequired,
}: {
  readonly customerId: string;
  readonly people: readonly CustomerPerson[];
  readonly onChanged: () => void;
  readonly onAuthenticationRequired: () => void;
}) {
  const [dialog, setDialog] = useState<Dialogs>({ kind: "none" });
  const sensitive = hasSensitiveAccess(people);
  const close = (): void => setDialog({ kind: "none" });
  const saved = (): void => {
    close();
    onChanged();
  };

  const columns: readonly TableColumn<CustomerPerson>[] = [
    {
      key: "name",
      header: "Pessoa",
      cell: (person) => (
        <span className="crm-stack">
          <span>
            {person.givenName} {person.familyName}
          </span>
          {person.isPrimary ? <StatusPill tone="info">Principal</StatusPill> : null}
        </span>
      ),
    },
    {
      key: "roles",
      header: "Papéis",
      cell: (person) => (
        <span className="crm-pills">
          {person.roles.map((role) => (
            <StatusPill key={role} tone={role === "PRIMARY_CONTACT" ? "info" : "neutral"}>
              {ROLE_LABELS[role]}
            </StatusPill>
          ))}
        </span>
      ),
    },
    {
      key: "reach",
      header: "Email / telefone",
      cell: (person) =>
        person.email || person.phone ? (
          <span className="crm-stack">
            {person.email ? <span>{person.email}</span> : null}
            {person.phone ? <span className="crm-muted">{person.phone}</span> : null}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "details",
      header: "Detalhes",
      cell: (person) => {
        const parts = [
          countryName(person.nationality),
          sensitive && person.birthDate ? `Nasc. ${formatDate(person.birthDate)}` : null,
          sensitive && person.passportNumber
            ? `Passaporte ${person.passportNumber}${
                person.passportExpiry ? ` (até ${formatDate(person.passportExpiry)})` : ""
              }`
            : null,
        ].filter((part): part is string => part !== null);
        return parts.length > 0 ? (
          <span className="crm-stack">
            {parts.map((p) => (
              <span key={p}>{p}</span>
            ))}
          </span>
        ) : (
          "—"
        );
      },
    },
    {
      key: "actions",
      header: <span className="sr-only">Ações</span>,
      align: "right",
      cell: (person) => (
        <span className="crm-row-actions">
          <Button
            variant="ghost"
            aria-label={`Editar ${person.givenName} ${person.familyName}`}
            onClick={() => setDialog({ kind: "edit", person })}
          >
            Editar
          </Button>
          <Button
            variant="ghost"
            aria-label={`Papéis de ${person.givenName} ${person.familyName}`}
            onClick={() => setDialog({ kind: "roles", person })}
          >
            Papéis
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="crm-tab-actions">
        <Button onClick={() => setDialog({ kind: "add" })}>Adicionar pessoa</Button>
      </div>
      <Table
        caption="Pessoas do cliente"
        columns={columns}
        rows={people}
        getRowKey={(person) => person.id}
        empty={
          <EmptyState
            title="Sem pessoas"
            description="Adicione a pessoa de contacto deste cliente."
            action={<Button onClick={() => setDialog({ kind: "add" })}>Adicionar pessoa</Button>}
          />
        }
      />
      {!sensitive && people.length > 0 ? (
        <p className="crm-muted crm-note">{SENSITIVE_HIDDEN_NOTE}</p>
      ) : null}
      {dialog.kind === "add" || dialog.kind === "edit" ? (
        <PersonFormDialog
          customerId={customerId}
          person={dialog.kind === "edit" ? dialog.person : null}
          showSensitive={sensitive}
          onClose={close}
          onSaved={saved}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : null}
      {dialog.kind === "roles" ? (
        <PersonRolesDialog
          customerId={customerId}
          person={dialog.person}
          onClose={close}
          onSaved={saved}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : null}
    </>
  );
}
