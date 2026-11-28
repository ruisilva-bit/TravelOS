import { useCallback, useEffect, useRef, useState } from "react";

import { AdminApiError, getAdminQuote } from "./api.js";
import { crmErrorMessage, isAuthenticationRequired, isConflict } from "./crm-shared.js";
import type { QuoteDetail } from "./quote-format.js";

export type EditorLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "not-found" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready" };

export const QUOTE_CONFLICT_MESSAGE =
  "Este orçamento foi alterado por outra pessoa ou já não permite esta operação. Recarregue o orçamento para ver a versão mais recente.";

/**
 * Holds the quote detail and serialises every write: each request is built from the latest
 * server answer (fresh lock versions), so quick consecutive edits never conflict with themselves.
 */
export function useQuoteEditor(quoteId: string, onAuthenticationRequired: () => void) {
  const [load, setLoad] = useState<EditorLoad>({ kind: "loading" });
  const [detail, setDetailState] = useState<QuoteDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailRef = useRef<QuoteDetail | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const conflictRef = useRef(false);

  const setDetail = useCallback((next: QuoteDetail | null): void => {
    detailRef.current = next;
    setDetailState(next);
  }, []);

  const fetchDetail = useCallback(async (): Promise<void> => {
    try {
      setDetail(await getAdminQuote(quoteId));
      setLoad({ kind: "ready" });
    } catch (failure) {
      if (isAuthenticationRequired(failure)) {
        onAuthenticationRequired();
      } else if (failure instanceof AdminApiError && failure.code === "ACCESS_DENIED") {
        setLoad({ kind: "denied" });
      } else if (failure instanceof AdminApiError && failure.code === "NOT_FOUND") {
        setLoad({ kind: "not-found" });
      } else if (detailRef.current === null) {
        setLoad({ kind: "error", message: crmErrorMessage(failure) });
      } else {
        setError(crmErrorMessage(failure));
      }
    }
  }, [quoteId, onAuthenticationRequired, setDetail]);

  useEffect(() => {
    setLoad({ kind: "loading" });
    setDetail(null);
    void fetchDetail();
  }, [fetchDetail, setDetail]);

  const reload = useCallback(async (): Promise<void> => {
    conflictRef.current = false;
    setConflict(false);
    setError(null);
    await fetchDetail();
  }, [fetchDetail]);

  /**
   * Runs one write. `optimistic` updates the screen at once; the server answer then replaces it.
   * Resolves to the new detail, or null when the write failed (the screen is re-synced).
   */
  const run = useCallback(
    (
      work: (current: QuoteDetail) => Promise<QuoteDetail>,
      optimistic?: (current: QuoteDetail) => QuoteDetail,
    ): Promise<QuoteDetail | null> => {
      if (conflictRef.current) return Promise.resolve(null);
      if (optimistic !== undefined && detailRef.current !== null) {
        setDetail(optimistic(detailRef.current));
      }
      pending.current += 1;
      setSaving(true);
      const job = queue.current.then(async (): Promise<QuoteDetail | null> => {
        const current = detailRef.current;
        if (current === null || conflictRef.current) return null;
        try {
          const next = await work(current);
          setDetail(next);
          setError(null);
          return next;
        } catch (failure) {
          if (isAuthenticationRequired(failure)) {
            onAuthenticationRequired();
          } else if (isConflict(failure)) {
            conflictRef.current = true;
            setConflict(true);
          } else {
            setError(crmErrorMessage(failure));
            await fetchDetail();
          }
          return null;
        } finally {
          pending.current -= 1;
          if (pending.current === 0) setSaving(false);
        }
      });
      queue.current = job;
      return job;
    },
    [fetchDetail, onAuthenticationRequired, setDetail],
  );

  return {
    load,
    detail,
    saving,
    conflict,
    error,
    setError,
    reload,
    run,
    replace: setDetail,
  };
}
