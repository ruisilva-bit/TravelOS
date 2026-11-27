import { TextField } from "@travelos/design-system";
import { useRef, useState } from "react";

import { AdminApiError, createAdminCustomer } from "./api.js";
import type { AdminCustomerDetailV1Response } from "@travelos/contracts/admin";
import {
  crmErrorMessage,
  fullName,
  isAuthenticationRequired,
  isRetryableFailure,
  nullable,
  validateEmail,
  validatePhone,
} from "./crm-shared.js";
import { FormDialog } from "./crm-form-dialog.js";
import { createIdempotencyKey } from "./trip-workflows.js";

export function CustomerCreateDialog({
  open,
  onClose,
  onCreated,
  onAuthenticationRequired,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (customer: AdminCustomerDetailV1Response) => void;
  readonly onAuthenticationRequired: () => void;
}) {
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  // The display name follows "Nome Apelido" until the person types their own.
  const [displayEdited, setDisplayEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  const updateName = (nextGiven: string, nextFamily: string): void => {
    setGivenName(nextGiven);
    setFamilyName(nextFamily);
    if (!displayEdited) setDisplayName(fullName(nextGiven, nextFamily));
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    const next: Record<string, string> = {};
    if (givenName.trim() === "") next["givenName"] = "Indique o nome.";
    if (familyName.trim() === "") next["familyName"] = "Indique o apelido.";
    if (displayName.trim() === "") next["displayName"] = "Indique o nome do cliente.";
    const emailError = validateEmail(email.trim());
    if (emailError) next["email"] = emailError;
    const phoneError = validatePhone(phone.trim());
    if (phoneError) next["phone"] = phoneError;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    idempotencyKey.current ??= createIdempotencyKey();
    setBusy(true);
    setFormError(null);
    try {
      const customer = await createAdminCustomer(
        {
          displayName: displayName.trim(),
          email: nullable(email),
          phone: nullable(phone),
          notes: null,
          primaryPerson: {
            givenName: givenName.trim(),
            familyName: familyName.trim(),
            email: nullable(email),
            phone: nullable(phone),
            nationality: null,
            notes: null,
          },
        },
        idempotencyKey.current,
      );
      idempotencyKey.current = null;
      onCreated(customer);
    } catch (error) {
      if (isAuthenticationRequired(error)) {
        onAuthenticationRequired();
        return;
      }
      if (!isRetryableFailure(error)) idempotencyKey.current = null;
      setFormError(
        error instanceof AdminApiError
          ? crmErrorMessage(error)
          : "Ocorreu um erro. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title="Novo cliente"
      description="Indique a pessoa de contacto. Pode adicionar mais pessoas depois."
      confirmLabel={busy ? "A criar…" : "Criar cliente"}
      busy={busy}
      error={formError}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <div className="crm-form__row">
        <TextField
          label="Nome"
          value={givenName}
          autoComplete="off"
          error={errors["givenName"]}
          onChange={(event) => updateName(event.target.value, familyName)}
        />
        <TextField
          label="Apelido"
          value={familyName}
          autoComplete="off"
          error={errors["familyName"]}
          onChange={(event) => updateName(givenName, event.target.value)}
        />
      </div>
      <TextField
        label="Nome do cliente"
        hint="Preenchido com o nome e apelido; pode alterar."
        value={displayName}
        error={errors["displayName"]}
        onChange={(event) => {
          setDisplayName(event.target.value);
          setDisplayEdited(event.target.value !== "");
        }}
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
          placeholder="+351 912 345 678"
          error={errors["phone"]}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
    </FormDialog>
  );
}
