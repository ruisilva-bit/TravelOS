import { DateField, Select, StateMessage, TextArea, TextField } from "@travelos/design-system";
import { useState } from "react";

import { addAdminPerson, updateAdminPerson } from "./api.js";
import type { AdminCustomerPersonV1Response } from "@travelos/contracts/admin";
import { FormDialog } from "./crm-form-dialog.js";
import {
  COUNTRIES,
  crmErrorMessage,
  isAuthenticationRequired,
  nullable,
  validateEmail,
  validatePhone,
} from "./crm-shared.js";

export type CustomerPerson = AdminCustomerPersonV1Response;

export const SENSITIVE_HIDDEN_NOTE = "Sem permissão para ver dados sensíveis";

interface Props {
  readonly customerId: string;
  /** null adds a new person; a person edits that one. */
  readonly person: CustomerPerson | null;
  /** Sensitive fields are only offered when the response carried them. */
  readonly showSensitive: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly onAuthenticationRequired: () => void;
}

export function PersonFormDialog({
  customerId,
  person,
  showSensitive,
  onClose,
  onSaved,
  onAuthenticationRequired,
}: Props) {
  const [givenName, setGivenName] = useState(person?.givenName ?? "");
  const [familyName, setFamilyName] = useState(person?.familyName ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [nationality, setNationality] = useState(person?.nationality?.toUpperCase() ?? "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  const [birthDate, setBirthDate] = useState(person?.birthDate ?? "");
  const [passportNumber, setPassportNumber] = useState(person?.passportNumber ?? "");
  const [passportExpiry, setPassportExpiry] = useState(person?.passportExpiry ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const knownCountry = COUNTRIES.some(([code]) => code === nationality);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const next: Record<string, string> = {};
    if (givenName.trim() === "") next["givenName"] = "Indique o nome.";
    if (familyName.trim() === "") next["familyName"] = "Indique o apelido.";
    const emailError = validateEmail(email.trim());
    if (emailError) next["email"] = emailError;
    const phoneError = validatePhone(phone.trim());
    if (phoneError) next["phone"] = phoneError;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const base = {
      givenName: givenName.trim(),
      familyName: familyName.trim(),
      email: nullable(email),
      phone: nullable(phone),
      nationality: nullable(nationality),
      notes: nullable(notes),
    };
    setBusy(true);
    setFormError(null);
    try {
      if (person === null) {
        await addAdminPerson(customerId, { ...base, roles: ["TRAVELLER"] });
      } else {
        await updateAdminPerson(person.id, {
          expectedLockVersion: person.lockVersion,
          ...base,
          // Omitted keys keep the stored values for people whose sensitive data is hidden.
          ...(showSensitive
            ? {
                birthDate: nullable(birthDate),
                passportNumber: nullable(passportNumber),
                passportExpiry: nullable(passportExpiry),
              }
            : {}),
        });
      }
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
      title={person === null ? "Adicionar pessoa" : "Editar pessoa"}
      confirmLabel={busy ? "A guardar…" : person === null ? "Adicionar pessoa" : "Guardar pessoa"}
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
          onChange={(event) => setGivenName(event.target.value)}
        />
        <TextField
          label="Apelido"
          value={familyName}
          autoComplete="off"
          error={errors["familyName"]}
          onChange={(event) => setFamilyName(event.target.value)}
        />
      </div>
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
      <Select
        label="Nacionalidade"
        value={nationality}
        onChange={(event) => setNationality(event.target.value)}
      >
        <option value="">Não indicada</option>
        {knownCountry || nationality === "" ? null : (
          <option value={nationality}>{nationality}</option>
        )}
        {COUNTRIES.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </Select>
      {person !== null ? (
        showSensitive ? (
          <fieldset className="crm-form__sensitive">
            <legend>Dados sensíveis</legend>
            <DateField
              label="Data de nascimento"
              value={birthDate}
              onChange={(event) => setBirthDate(event.target.value)}
            />
            <div className="crm-form__row">
              <TextField
                label="Passaporte (n.º)"
                value={passportNumber}
                autoComplete="off"
                onChange={(event) => setPassportNumber(event.target.value)}
              />
              <DateField
                label="Passaporte (validade)"
                value={passportExpiry}
                onChange={(event) => setPassportExpiry(event.target.value)}
              />
            </div>
          </fieldset>
        ) : (
          <StateMessage>{SENSITIVE_HIDDEN_NOTE}</StateMessage>
        )
      ) : null}
      <TextArea
        label="Notas"
        rows={3}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
    </FormDialog>
  );
}
