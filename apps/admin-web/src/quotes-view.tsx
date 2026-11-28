import { QuoteEditor } from "./quote-editor.js";
import { QuotesList } from "./quotes-list.js";

export function QuotesView({
  quoteId,
  onAuthenticationRequired,
}: {
  readonly quoteId: string | null;
  readonly onAuthenticationRequired: () => void;
}) {
  return quoteId === null ? (
    <QuotesList onAuthenticationRequired={onAuthenticationRequired} />
  ) : (
    <QuoteEditor quoteId={quoteId} onAuthenticationRequired={onAuthenticationRequired} />
  );
}
