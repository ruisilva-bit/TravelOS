import { Button, CategoryChip, TextField } from "@travelos/design-system";
import { useState } from "react";

import { EXCLUDED_ITEM_MAX_LENGTH, EXCLUDED_MAX_COUNT } from "./proposal-content.js";
import { CATEGORY_LABELS, CATEGORY_ORDER, categoryTone } from "./quote-format.js";
import type { QuoteDetail } from "./quote-format.js";

/** Incluído (automatic, read-only) and Não incluído (editable list). */
export function ProposalIncluded({
  detail,
  editable,
  onChangeExcluded,
}: {
  readonly detail: QuoteDetail;
  readonly editable: boolean;
  readonly onChangeExcluded: (items: string[]) => void;
}) {
  const [text, setText] = useState("");
  const items =
    detail.quote.excludedItems.length > 0 ? detail.quote.excludedItems : detail.excluded;
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    entries: detail.included.filter((entry) => entry.category === category),
  })).filter((group) => group.entries.length > 0);

  const add = (): void => {
    const value = text.trim();
    if (value === "" || items.length >= EXCLUDED_MAX_COUNT) return;
    setText("");
    onChangeExcluded([...items, value]);
  };
  const move = (index: number, by: -1 | 1): void => {
    const next = [...items];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(index + by, 0, moved);
    onChangeExcluded(next);
  };

  return (
    <div className="pe-form">
      <section aria-labelledby="pe-included">
        <h3 className="pe-subtitle" id="pe-included">
          Incluído
        </h3>
        <p className="pe-hint">Gerado das linhas visíveis do orçamento. Não se edita aqui.</p>
        {groups.length === 0 ? (
          <p className="pe-hint">Ainda não há linhas visíveis no orçamento.</p>
        ) : (
          <ul className="pe-included">
            {groups.map((group) => (
              <li key={group.category}>
                <CategoryChip tone={categoryTone(group.category)}>
                  {CATEGORY_LABELS[group.category]}
                </CategoryChip>
                <span>{group.entries.map((entry) => entry.label).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="pe-excluded">
        <h3 className="pe-subtitle" id="pe-excluded">
          Não incluído
        </h3>
        <p className="pe-hint">Uma lista vazia volta à lista padrão da agência.</p>
        <ul className="pe-excluded" aria-label="Itens não incluídos">
          {items.map((item, index) => (
            <li key={`${String(index)}-${item}`} className="pe-excluded__row">
              <span className="pe-excluded__text">{item}</span>
              {editable ? (
                <span className="pe-excluded__actions">
                  <Button
                    variant="ghost"
                    aria-label={`Subir: ${item}`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Descer: ${item}`}
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Remover: ${item}`}
                    onClick={() => onChangeExcluded(items.filter((_, i) => i !== index))}
                  >
                    Remover
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <form
            className="pe-add"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <TextField
              label="Novo item não incluído"
              value={text}
              maxLength={EXCLUDED_ITEM_MAX_LENGTH}
              onChange={(event) => setText(event.target.value)}
            />
            <Button
              type="submit"
              disabled={text.trim() === "" || items.length >= EXCLUDED_MAX_COUNT}
            >
              Adicionar
            </Button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
