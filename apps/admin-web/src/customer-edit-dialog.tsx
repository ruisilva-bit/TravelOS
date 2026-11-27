import { TextArea, TextField } from "@travelos/design-system";
import { useState } from "react";

import { updateAdminCustomer } from "./api.js";
import type { AdminCustomerDetailV1Response } from "@travelos/contracts/admin";
import { FormDialog } from "./crm-form-dialog.js";
import {
  crmErrorMessage,
  isAuthenticationRequired,
  nullable,
  validateEmail,
  validatePhone,
} from "./crm-shared.js";

export function CustomerEditDialog({
  customer,
  onClose,
  onSaved,
  onAuthenticationRequired,
}: {
  readonly customer: AdminCustomerDetailV1Response;
  readonly onClose: () => void;
  readonly onSaved: (customer: AdminCustomerDetailV1Response) => void;
  readonly onAuthenticationRequired: () => void;
}) {
  const [displayName, setDisplayName] = useState(customer.displayName);
  const [email, setEmail] = useState(customer.email ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const next: Record<string, string> = {};
    if (displayName.trim() === "") next["displayName"] = "Indique o nome do cliente.";
    const emailError = validateEmail(email.trim());
    if (emailError) next["email"] = emailError;
    const phoneError = validatePhone(phone.trim());
    if (phoneError) next["phone"] = phoneError;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setFormError(null);
    try {
      const updated = await updateAdminCustomer(customer.id, {
        expectedLockVersion: customer.lockVersion,
        displayName: displayName.trim(),
        email: nullable(email),
        phone: nullable(phone),
        notes: nullable(notes),
      });
      onSaved(updated);
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
      title="Editar cliente"
      confirmLabel={busy ? "A guardar…" : "Guardar cliente"}
      busy={busy}
      error={formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <TextField
        label="Nome do cliente"
        value={displayName}
        error={errors["displayName"]}
        onChange={(event) => setDisplayName(event.target.value)}
      />
      <div className="crm-form__row">
        <TextField
          label="Email"
          type="email"
          value={email}
          autoComplete="off"
          error={errors["email"]}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Telefone"
          type="tel"
          value={phone}
          autoComplete="off"
          error={errors["phone"]}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
      <TextArea
        label="Notas"
        rows={4}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
    </FormDialog>
  );
}
