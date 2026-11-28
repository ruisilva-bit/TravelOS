import type { QuoteProposalV1 } from "@travelos/contracts/admin";

import { escapeHtml, SHARE_NOT_FOUND_HTML } from "./share-page-renderer.js";

/** Placeholder until the customer proposal design lands; every interpolation is escaped. */
export interface ProposalPageView {
  readonly payload: QuoteProposalV1;
  readonly token: string;
  readonly isLatest: boolean;
  readonly state: string;
  readonly accepted: { readonly name: string; readonly at: string } | null;
  readonly flash: "accepted" | "error" | null;
  readonly today: string;
}

/** Same bytes as every other public-link failure, so quote and trip 404s cannot be told apart. */
export const PROPOSAL_NOT_FOUND_HTML: string = SHARE_NOT_FOUND_HTML;

const flashText = (flash: ProposalPageView["flash"]): string =>
  flash === "accepted"
    ? "Proposta aceite. Obrigado!"
    : flash === "error"
      ? "Não foi possível registar o aceite. Verifique o nome e tente novamente."
      : "";

export const renderProposalPage = (view: ProposalPageView): string => {
  const { payload, token, isLatest, state, accepted, flash } = view;
  const canAccept = isLatest && state === "SENT" && accepted === null;
  const notice = accepted
    ? `<p>Proposta aceite por ${escapeHtml(accepted.name)} em ${escapeHtml(accepted.at)}.</p>`
    : !isLatest
      ? "<p>Esta proposta foi atualizada. Peça o link mais recente à agência.</p>"
      : state !== "SENT"
        ? "<p>Esta proposta já não está disponível para aceitação.</p>"
        : "";
  const form = canAccept
    ? `<form method="post" action="/v/${escapeHtml(token)}/accept"><label>Nome completo <input name="name" required maxlength="120"></label><label><input type="checkbox" name="confirm" required> Li e aceito a proposta e as condições</label><button type="submit">Aceitar proposta</button></form>`
    : "";
  return `<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escapeHtml(payload.quote.title)}</title></head><body><main><p>${escapeHtml(payload.agency.displayName)} · Proposta ${escapeHtml(payload.quote.number)}</p><h1>${escapeHtml(payload.quote.title)}</h1>${payload.quote.intro === null ? "" : `<p>${escapeHtml(payload.quote.intro)}</p>`}${flash === null ? "" : `<p role="status">${escapeHtml(flashText(flash))}</p>`}${notice}${form}</main></body></html>`;
};
