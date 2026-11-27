import { useState } from "react";

import { setAdminPersonRoles } from "./api.js";
import { FormDialog } from "./crm-form-dialog.js";
import {
  EDITABLE_ROLES,
  ROLE_LABELS,
  crmErrorMessage,
  isAuthenticationRequired,
} from "./crm-shared.js";
import type { CustomerRole } from "./crm-shared.js";
import type { CustomerPerson } from "./person-form-dialog.js";

export function PersonRolesDialog({
  customerId,
  person,
  onClose,
  onSaved,
  onAuthenticationRequired,
}: {
  readonly customerId: string;
  readonly person: CustomerPerson;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly onAuthenticationRequired: () => void;
}) {
  const [roles, setRoles] = useState<ReadonlySet<CustomerRole>>(
    () => new Set(person.roles.filter((role) => role !== "PRIMARY_CONTACT")),
  );
  const [primary, setPrimary] = useState(person.isPrimary);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (role: CustomerRole, checked: boolean): void => {
    const next = new Set(roles);
    if (checked) next.add(role);
    else next.delete(role);
    setRoles(next);
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    const selected: CustomerRole[] = [
      ...(primary ? (["PRIMARY_CONTACT"] as const) : []),
      ...EDITABLE_ROLES.filter((role) => roles.has(role)),
    ];
    if (selected.length === 0) {
      setFormError("Escolha pelo menos um papel.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await setAdminPersonRoles(customerId, person.id, { roles: selected, isPrimary: primary });
      onSaved();
    } catch (error) {
      if (isAuthenticationRequired(error)) {
        onAuthenticationRequired();
        return;
      }
      setFormError(crmErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open
      title={`Papéis de ${person.givenName} ${person.familyName}`}
      confirmLabel={busy ? "A guardar…" : "Guardar papéis"}
      busy={busy}
      error={formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <fieldset className="crm-roles">
        <legend>Papéis neste cliente</legend>
        <label className="crm-check">
          <input
            type="checkbox"
            checked={primary}
            onChange={(event) => setPrimary(event.target.checked)}
          />
          <span>{ROLE_LABELS.PRIMARY_CONTACT}</span>
        </label>
        {EDITABLE_ROLES.map((role) => (
          <label className="crm-check" key={role}>
            <input
              type="checkbox"
              checked={roles.has(role)}
              onChange={(event) => toggle(role, event.target.checked)}
            />
            <span>{ROLE_LABELS[role]}</span>
          </label>
        ))}
      </fieldset>
    </FormDialog>
  );
}
