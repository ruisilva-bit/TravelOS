import { Button, Dialog, TextArea } from "@travelos/design-system";
import { useRef, useState } from "react";

import { INTRO_MAX_LENGTH, suggestIntro } from "./proposal-content.js";
import { ImageUrlField } from "./proposal-image-field.js";
import { DraftField } from "./quote-fields.js";
import type { HeaderPatch, QuoteDetail } from "./quote-format.js";

/** Capa: title, destination, cover sentence (with a suggestion) and cover image. */
export function ProposalCover({
  detail,
  editable,
  onPatchHeader,
}: {
  readonly detail: QuoteDetail;
  readonly editable: boolean;
  readonly onPatchHeader: (patch: HeaderPatch) => void;
}) {
  const { quote } = detail;
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const current = quote.intro ?? "";
  const shown = draft ?? current;

  const commit = (value: string): void => {
    setDraft(null);
    const next = value.trim() === "" ? null : value.trim();
    if (next !== quote.intro) onPatchHeader({ intro: next });
  };
  const applySuggestion = (): void => {
    setConfirming(false);
    commit(suggestIntro(detail));
    area.current?.querySelector("textarea")?.focus();
  };

  return (
    <div className="pe-form">
      <DraftField
        label="Título da proposta"
        hint="O mesmo título do orçamento."
        disabled={!editable}
        value={quote.title}
        maxLength={200}
        onCommit={(value) => value.trim() !== "" && onPatchHeader({ title: value.trim() })}
      />
      <DraftField
        label="Destino"
        disabled={!editable}
        value={quote.destination ?? ""}
        maxLength={200}
        onCommit={(value) =>
          onPatchHeader({ destination: value.trim() === "" ? null : value.trim() })
        }
      />
      <div ref={area} className="pe-intro">
        <TextArea
          label="Frase de introdução"
          hint={`Aparece no topo da proposta. ${String(shown.length)}/${String(INTRO_MAX_LENGTH)}`}
          value={shown}
          disabled={!editable}
          maxLength={INTRO_MAX_LENGTH}
          rows={7}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft !== null) commit(draft);
          }}
        />
        {editable ? (
          <Button onClick={() => (current.trim() === "" ? applySuggestion() : setConfirming(true))}>
            Gerar sugestão
          </Button>
        ) : null}
      </div>
      <ImageUrlField
        label="Imagem de capa (endereço https)"
        value={quote.heroImageUrl}
        disabled={!editable}
        onCommit={(heroImageUrl) => onPatchHeader({ heroImageUrl })}
      />
      <p className="pe-hint">Use imagens com direitos de utilização.</p>
      <Dialog
        open={confirming}
        title="Substituir a frase de introdução?"
        description="A frase atual será substituída por uma sugestão gerada a partir do orçamento. Pode editá-la depois."
        confirmLabel="Substituir"
        onClose={() => setConfirming(false)}
        onConfirm={applySuggestion}
      />
    </div>
  );
}
