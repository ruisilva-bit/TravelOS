import { Button, CheckboxField, Drawer, TextArea, TextField } from "@travelos/design-system";
import { useState } from "react";

import type { QuoteLine } from "./quote-format.js";

const IATA = /^[A-Z]{3}$/u;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

type Draft = Pick<
  QuoteLine,
  | "fromIata"
  | "toIata"
  | "departTime"
  | "arriveTime"
  | "carrier"
  | "flightNumber"
  | "baggage"
  | "roomType"
  | "boardBasis"
  | "location"
  | "imageUrl"
  | "customerVisible"
  | "internalNote"
>;

const nullIfEmpty = (value: string | null): string | null =>
  value === null || value.trim() === "" ? null : value.trim();

const validate = (draft: Draft, line: QuoteLine): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (line.category === "FLIGHT") {
    for (const key of ["fromIata", "toIata"] as const) {
      const value = nullIfEmpty(draft[key]);
      if (value !== null && !IATA.test(value))
        errors[key] = "Use 3 letras maiúsculas, por exemplo LIS.";
    }
    for (const key of ["departTime", "arriveTime"] as const) {
      const value = nullIfEmpty(draft[key]);
      if (value !== null && !TIME.test(value)) errors[key] = "Use o formato 14:30.";
    }
  }
  const image = nullIfEmpty(draft.imageUrl);
  if (image !== null && !image.startsWith("https://")) {
    errors["imageUrl"] = "O endereço da imagem tem de começar por https://.";
  }
  return errors;
};

export interface QuoteLineDrawerProps {
  readonly line: QuoteLine;
  readonly editable: boolean;
  readonly onSave: (patch: Partial<QuoteLine>) => void;
  readonly onClose: () => void;
}

/** Category-specific details: flight or accommodation fields, image, visibility and internal note. */
export function QuoteLineDrawer({ line, editable, onSave, onClose }: QuoteLineDrawerProps) {
  const [draft, setDraft] = useState<Draft>({
    fromIata: line.fromIata,
    toIata: line.toIata,
    departTime: line.departTime,
    arriveTime: line.arriveTime,
    carrier: line.carrier,
    flightNumber: line.flightNumber,
    baggage: line.baggage,
    roomType: line.roomType,
    boardBasis: line.boardBasis,
    location: line.location,
    imageUrl: line.imageUrl,
    customerVisible: line.customerVisible,
    internalNote: line.internalNote,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const text = (key: keyof Draft): string => String(draft[key] ?? "");
  const set = (key: keyof Draft, value: string | boolean): void =>
    setDraft((current) => ({ ...current, [key]: value }));
  const field = (
    key: keyof Draft,
    label: string,
    extra: { type?: string; upper?: boolean } = {},
  ) => (
    <TextField
      label={label}
      type={extra.type ?? "text"}
      value={text(key)}
      disabled={!editable}
      error={errors[key]}
      onChange={(event) =>
        set(key, extra.upper ? event.target.value.toUpperCase() : event.target.value)
      }
    />
  );

  const save = (): void => {
    const found = validate(draft, line);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSave({
      fromIata: nullIfEmpty(draft.fromIata),
      toIata: nullIfEmpty(draft.toIata),
      departTime: nullIfEmpty(draft.departTime),
      arriveTime: nullIfEmpty(draft.arriveTime),
      carrier: nullIfEmpty(draft.carrier),
      flightNumber: nullIfEmpty(draft.flightNumber),
      baggage: nullIfEmpty(draft.baggage),
      roomType: nullIfEmpty(draft.roomType),
      boardBasis: nullIfEmpty(draft.boardBasis),
      location: nullIfEmpty(draft.location),
      imageUrl: nullIfEmpty(draft.imageUrl),
      customerVisible: draft.customerVisible,
      internalNote: nullIfEmpty(draft.internalNote),
    });
    onClose();
  };

  return (
    <Drawer
      open
      title={`Detalhes: ${line.service}`}
      description="Os campos de voo e alojamento aparecem na proposta do cliente."
      onClose={onClose}
      footer={
        editable ? (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={save}>
              Guardar detalhes
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Fechar</Button>
        )
      }
    >
      {line.category === "FLIGHT" ? (
        <fieldset className="q-drawer-group">
          <legend>Voo</legend>
          <div className="q-drawer-grid">
            {field("fromIata", "De (IATA)", { upper: true })}
            {field("toIata", "Para (IATA)", { upper: true })}
            {field("departTime", "Hora de partida", { type: "time" })}
            {field("arriveTime", "Hora de chegada", { type: "time" })}
            {field("carrier", "Companhia")}
            {field("flightNumber", "Voo")}
          </div>
          {field("baggage", "Bagagem")}
        </fieldset>
      ) : null}
      {line.category === "ACCOMMODATION" ? (
        <fieldset className="q-drawer-group">
          <legend>Alojamento</legend>
          {field("roomType", "Quarto")}
          {field("boardBasis", "Regime")}
          {field("location", "Localização")}
        </fieldset>
      ) : null}
      {field("imageUrl", "Imagem (endereço https)")}
      <CheckboxField
        label="Visível ao cliente"
        hint="Desligue para uma linha que só conta para o preço interno."
        checked={draft.customerVisible}
        disabled={!editable}
        onChange={(event) => set("customerVisible", event.target.checked)}
      />
      <TextArea
        label="Nota interna"
        hint="Visível apenas à agência."
        value={text("internalNote")}
        disabled={!editable}
        onChange={(event) => set("internalNote", event.target.value)}
      />
    </Drawer>
  );
}
