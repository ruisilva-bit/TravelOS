import { Button, CategoryChip, Dialog, TextArea, TextField } from "@travelos/design-system";
import { useState } from "react";

import { formatDate } from "./format.js";
import { linesOnDay } from "./proposal-content.js";
import { categoryTone } from "./quote-format.js";
import type { QuoteDetail } from "./quote-format.js";

type Day = QuoteDetail["days"][number];

function DayRow({
  day,
  detail,
  editable,
  onSave,
}: {
  readonly day: Day;
  readonly detail: QuoteDetail;
  readonly editable: boolean;
  readonly onSave: (day: Day, title: string, description: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(day.title);
  const [description, setDescription] = useState(day.description ?? "");
  const chips = linesOnDay(detail.lines, day.date);
  const valid = title.trim() !== "";
  return (
    <li className="pe-day">
      <div className="pe-day__head">
        <span className="pe-day__date">
          <span className="pe-day__index">Dia {day.dayIndex + 1}</span>
          <time dateTime={day.date}>{formatDate(day.date)}</time>
        </span>
        {editing ? null : (
          <div className="pe-day__body">
            <strong>{day.title}</strong>
            {day.description === null || day.description === "" ? null : <p>{day.description}</p>}
          </div>
        )}
        {editable && !editing ? (
          <Button
            variant="ghost"
            aria-label={`Editar dia ${String(day.dayIndex + 1)}`}
            onClick={() => setEditing(true)}
          >
            Editar
          </Button>
        ) : null}
      </div>
      {chips.length > 0 ? (
        <ul className="pe-day__chips" aria-label="Serviços deste dia">
          {chips.map((line) => (
            <li key={line.id}>
              <CategoryChip tone={categoryTone(line.category)}>{line.service}</CategoryChip>
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? (
        <form
          className="pe-day__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            onSave(day, title.trim(), description.trim() === "" ? null : description.trim());
            setEditing(false);
          }}
        >
          <TextField
            label={`Título do dia ${String(day.dayIndex + 1)}`}
            value={title}
            maxLength={120}
            error={valid ? undefined : "Indique um título."}
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextArea
            label={`Descrição do dia ${String(day.dayIndex + 1)}`}
            value={description}
            maxLength={2000}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="pe-actions">
            <Button type="submit" variant="primary" disabled={!valid}>
              Guardar dia
            </Button>
            <Button
              onClick={() => {
                setTitle(day.title);
                setDescription(day.description ?? "");
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** Programa dia-a-dia: generated days merged with the person's edits. */
export function ProposalDays({
  detail,
  editable,
  onSaveDay,
  onReset,
}: {
  readonly detail: QuoteDetail;
  readonly editable: boolean;
  readonly onSaveDay: (day: Day, title: string, description: string | null) => void;
  readonly onReset: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="pe-form">
      <p className="pe-hint">
        O programa é gerado das datas das linhas. Edite o título ou a descrição de qualquer dia.
      </p>
      {detail.days.length === 0 ? (
        <p className="pe-hint">Defina as datas da viagem para gerar o programa.</p>
      ) : (
        <ol className="pe-days">
          {detail.days.map((day) => (
            <DayRow
              key={`${String(day.dayIndex)}-${day.title}-${day.description ?? ""}`}
              day={day}
              detail={detail}
              editable={editable}
              onSave={onSaveDay}
            />
          ))}
        </ol>
      )}
      {editable ? (
        <div>
          <Button onClick={() => setConfirming(true)}>Repor sugestões</Button>
        </div>
      ) : null}
      <Dialog
        open={confirming}
        tone="danger"
        title="Repor sugestões do programa?"
        description="Os títulos e descrições que editou voltam às sugestões automáticas."
        confirmLabel="Repor sugestões"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onReset();
        }}
      />
    </div>
  );
}
