import { Button, SectionNav, StateMessage } from "@travelos/design-system";
import { useState } from "react";

import { resetAdminQuoteDays, upsertAdminQuoteDay } from "./api.js";
import { ProposalCover } from "./proposal-cover.js";
import { ProposalDays } from "./proposal-days.js";
import { ProposalIncluded } from "./proposal-excluded.js";
import { ProposalConditions, ProposalImages } from "./proposal-images-conditions.js";
import { ProposalPreview, ProposalPreviewLink } from "./proposal-preview.js";
import type { HeaderPatch, QuoteDetail, QuoteLine } from "./quote-format.js";
import type { useQuoteEditor } from "./use-quote-editor.js";

const SECTIONS = [
  { id: "capa", label: "Capa" },
  { id: "programa", label: "Programa" },
  { id: "incluido", label: "Incluído / Não incluído" },
  { id: "imagens", label: "Imagens" },
  { id: "condicoes", label: "Condições" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** "Proposta ao cliente": content forms on the left, live preview on the right. */
export function ProposalEditor({
  detail,
  editable,
  run,
  onPatchHeader,
  onPatchLine,
  onRevise,
}: {
  readonly detail: QuoteDetail;
  readonly editable: boolean;
  readonly run: ReturnType<typeof useQuoteEditor>["run"];
  readonly onPatchHeader: (patch: HeaderPatch) => void;
  readonly onPatchLine: (line: QuoteLine, patch: Partial<QuoteLine>) => void;
  readonly onRevise: () => void;
}) {
  const [section, setSection] = useState<SectionId>("capa");
  const id = detail.quote.id;
  return (
    <div className="pe-layout">
      <div className="pe-edit">
        {editable ? null : (
          <StateMessage
            action={
              detail.quote.state === "SENT" ? (
                <Button variant="primary" onClick={onRevise}>
                  Editar (nova versão)
                </Button>
              ) : undefined
            }
          >
            {detail.quote.state === "SENT"
              ? "Esta proposta já foi enviada e está só para leitura."
              : "Este orçamento já não é um rascunho e está só para leitura."}
          </StateMessage>
        )}
        <div className="pe-body">
          <SectionNav
            label="Secções da proposta"
            items={SECTIONS}
            value={section}
            onChange={(next) => setSection(next as SectionId)}
          />
          <div className="pe-panel">
            {section === "capa" ? (
              <ProposalCover detail={detail} editable={editable} onPatchHeader={onPatchHeader} />
            ) : null}
            {section === "programa" ? (
              <ProposalDays
                detail={detail}
                editable={editable}
                onSaveDay={(day, title, description) =>
                  void run((current) =>
                    upsertAdminQuoteDay(id, day.dayIndex, {
                      expectedLockVersion: current.quote.lockVersion,
                      title,
                      description,
                    }),
                  )
                }
                onReset={() =>
                  void run((current) => resetAdminQuoteDays(id, current.quote.lockVersion))
                }
              />
            ) : null}
            {section === "incluido" ? (
              <ProposalIncluded
                detail={detail}
                editable={editable}
                onChangeExcluded={(excludedItems) => onPatchHeader({ excludedItems })}
              />
            ) : null}
            {section === "imagens" ? (
              <ProposalImages detail={detail} editable={editable} onPatchLine={onPatchLine} />
            ) : null}
            {section === "condicoes" ? (
              <ProposalConditions
                detail={detail}
                editable={editable}
                onPatchHeader={onPatchHeader}
              />
            ) : null}
          </div>
        </div>
        <ProposalPreviewLink quoteId={id} />
      </div>
      <ProposalPreview quoteId={id} version={detail.quote.lockVersion} />
    </div>
  );
}
