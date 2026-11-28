import { Dialog, SectionHeading, StatusPill, formatMoney } from "@travelos/design-system";
import { useState } from "react";

import { formatDateTime } from "./format.js";
import { minorToDecimal } from "./quote-format.js";
import type { QuoteDetail } from "./quote-format.js";

type Version = QuoteDetail["versions"][number];
type ShareLink = Version["shareLinks"][number];

const linkState = (link: ShareLink): readonly [string, "success" | "danger" | "neutral"] => {
  if (link.revokedAt !== null) return ["revogado", "danger"];
  if (Date.parse(link.expiresAt) < Date.now()) return ["expirado", "neutral"];
  return ["ativo", "success"];
};

export interface QuoteVersionsProps {
  readonly versions: QuoteDetail["versions"];
  readonly onRevoke: (link: ShareLink) => Promise<void>;
}

export function QuoteVersions({ versions, onRevoke }: QuoteVersionsProps) {
  const [revoking, setRevoking] = useState<ShareLink | null>(null);
  if (versions.length === 0) return null;
  return (
    <section className="q-versions" aria-labelledby="q-versions-heading">
      <SectionHeading
        id="q-versions-heading"
        title="Versões enviadas"
        meta={`${versions.length}`}
      />
      <ul>
        {versions
          .toSorted((a, b) => b.versionNumber - a.versionNumber)
          .map((version) => (
            <li key={version.id}>
              <div className="q-versions__head">
                <strong>Versão {version.versionNumber}</strong>
                <span>
                  enviada em {formatDateTime(version.sentAt)} ·{" "}
                  {formatMoney(
                    minorToDecimal(version.pvpFinalMinor, version.currencyCode),
                    version.currencyCode,
                  )}
                </span>
                {version.acceptance === null ? null : (
                  <StatusPill tone="success">
                    Aceite por {version.acceptance.acceptedName}
                  </StatusPill>
                )}
                {version.isLatest ? <StatusPill tone="info">Mais recente</StatusPill> : null}
              </div>
              <ul className="q-versions__links">
                {version.shareLinks.map((link) => {
                  const [label, tone] = linkState(link);
                  return (
                    <li key={link.shareLinkId}>
                      <span>Link criado em {formatDateTime(link.createdAt)}</span>
                      <StatusPill tone={tone}>{label}</StatusPill>
                      {label === "ativo" ? (
                        <button
                          type="button"
                          className="q-linkbutton"
                          onClick={() => setRevoking(link)}
                        >
                          Revogar
                          <span className="sr-only"> link da versão {version.versionNumber}</span>
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
      </ul>
      <Dialog
        open={revoking !== null}
        tone="danger"
        title="Revogar link?"
        description="O cliente deixa de conseguir abrir esta proposta com este link. Pode criar uma nova versão para enviar outro."
        confirmLabel="Revogar link"
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          const link = revoking;
          setRevoking(null);
          if (link !== null) void onRevoke(link);
        }}
      />
    </section>
  );
}
