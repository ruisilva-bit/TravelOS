import { Button, ButtonLink, StateMessage } from "@travelos/design-system";

import { formatDate } from "./format.js";
import type { QuoteDetail } from "./quote-format.js";

/** The one-line explanation (and next step) for every state other than an editable draft. */
export function QuoteStateBanner({
  detail,
  stateLabel,
  onConvert,
}: {
  readonly detail: QuoteDetail;
  readonly stateLabel: string;
  readonly onConvert: () => void;
}) {
  const { quote } = detail;
  const accepted =
    detail.versions.find((version) => version.acceptance !== null)?.acceptance ?? null;
  if (quote.state === "DRAFT") return null;
  if (quote.state === "ACCEPTED") {
    return (
      <StateMessage
        tone="success"
        role="status"
        action={
          quote.convertedTripId === null ? (
            <Button variant="primary" onClick={onConvert}>
              Converter em viagem
            </Button>
          ) : (
            <ButtonLink href={`#/viagens/${encodeURIComponent(quote.convertedTripId)}`}>
              Abrir viagem
            </ButtonLink>
          )
        }
      >
        {accepted === null
          ? "Proposta aceite."
          : `Aceite por ${accepted.acceptedName} em ${formatDate(accepted.acceptedAt)}.`}
      </StateMessage>
    );
  }
  if (quote.state === "SENT") {
    return (
      <StateMessage role="status">
        Orçamento enviado ao cliente. Para alterar, crie uma nova versão com “Editar (nova versão)”.
      </StateMessage>
    );
  }
  return (
    <StateMessage role="status">
      Este orçamento está {stateLabel.toLowerCase()} e já não pode ser alterado.
    </StateMessage>
  );
}
