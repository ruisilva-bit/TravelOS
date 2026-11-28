import { Button, ButtonLink } from "@travelos/design-system";
import { useEffect, useRef, useState } from "react";

export const PREVIEW_DEBOUNCE_MS = 600;

/**
 * Live preview of the customer page. `version` changes after each successful save; the frame
 * is reloaded once typing and saving have settled for 600 ms.
 */
export function ProposalPreview({
  quoteId,
  version,
}: {
  readonly quoteId: string;
  readonly version: string;
}) {
  const src = `/api/admin/quotes/${encodeURIComponent(quoteId)}/preview`;
  const [phone, setPhone] = useState(false);
  const [reload, setReload] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => setReload((n) => n + 1), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [version]);
  return (
    <aside className="pe-preview" aria-label="Pré-visualização da proposta">
      <div className="pe-preview__bar">
        <strong>Pré-visualização</strong>
        <span className="pe-preview__modes">
          <Button aria-pressed={!phone} onClick={() => setPhone(false)}>
            Computador
          </Button>
          <Button aria-pressed={phone} onClick={() => setPhone(true)}>
            Telemóvel
          </Button>
        </span>
      </div>
      <div className="pe-preview__stage">
        <iframe
          key={reload}
          title="Pré-visualização da proposta ao cliente"
          src={src}
          sandbox="allow-same-origin"
          className={phone ? "pe-preview__frame pe-preview__frame--phone" : "pe-preview__frame"}
        />
      </div>
    </aside>
  );
}

/** Mobile: the preview opens in its own tab. */
export function ProposalPreviewLink({ quoteId }: { readonly quoteId: string }) {
  return (
    <ButtonLink
      className="pe-preview-link"
      href={`/api/admin/quotes/${encodeURIComponent(quoteId)}/preview`}
      target="_blank"
      rel="noopener noreferrer"
    >
      Ver pré-visualização
    </ButtonLink>
  );
}
