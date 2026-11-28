import { TextField } from "@travelos/design-system";
import { useState } from "react";

import { validateImageUrl } from "./proposal-content.js";

/**
 * https image address with a thumbnail. Typing is validated at once; a valid (or empty) address
 * is saved when focus leaves the field, an invalid one stays on screen with its error.
 */
export function ImageUrlField({
  label,
  value,
  disabled,
  onCommit,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly disabled: boolean;
  readonly onCommit: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? "";
  const error = draft === null ? null : validateImageUrl(draft);
  const preview = error === null && shown.trim() !== "" ? shown.trim() : null;
  const finish = (): void => {
    if (draft === null || error !== null) return;
    const next = draft.trim() === "" ? null : draft.trim();
    if (next !== value) onCommit(next);
    setDraft(null);
  };
  return (
    <div className="pe-image">
      <div className="pe-image__thumb" aria-hidden={preview === null ? true : undefined}>
        {preview === null ? (
          <span>Sem imagem</span>
        ) : (
          <img src={preview} alt="" loading="lazy" referrerPolicy="no-referrer" />
        )}
      </div>
      <TextField
        className="pe-image__field"
        label={label}
        type="url"
        inputMode="url"
        placeholder="https://…"
        value={shown}
        disabled={disabled}
        error={error ?? undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") finish();
        }}
      />
    </div>
  );
}
