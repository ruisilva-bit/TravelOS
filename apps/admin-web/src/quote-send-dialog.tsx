import {
  Button,
  ButtonLink,
  Dialog,
  StateMessage,
  TextArea,
  TextField,
  useToast,
} from "@travelos/design-system";
import type { AdminQuoteSentV1Response } from "@travelos/contracts/admin";
import { useState } from "react";

import { AdminApiError, sendAdminQuote } from "./api.js";
import { formatDate } from "./format.js";
import { withMessageText } from "./quote-format.js";
import type { QuoteDetail } from "./quote-format.js";

export const SEND_RECENT_MFA_MESSAGE =
  "Para enviar é preciso uma verificação recente em dois fatores (nos últimos 5 minutos) e permissão de envio. Termine sessão, inicie sessão de novo com o código e tente outra vez.";

export interface QuoteSendDialogProps {
  readonly detail: QuoteDetail;
  /** Called once the version exists, so the editor can reload the sent state. */
  readonly onSent: () => void;
  readonly onClose: () => void;
  readonly onAuthenticationRequired: () => void;
}

const failureMessage = (error: unknown): string => {
  if (error instanceof AdminApiError) {
    if (error.code === "ACCESS_DENIED") return SEND_RECENT_MFA_MESSAGE;
    if (error.code === "CONFLICT") {
      return "Não foi possível enviar: o orçamento mudou ou tem a validade ultrapassada. Atualize a validade, recarregue e tente novamente.";
    }
    if (error.code === "NETWORK_FAILURE" || error.code === "UNAVAILABLE") return error.message;
  }
  return "Não foi possível enviar o orçamento. Tente novamente.";
};

export function QuoteSendDialog({
  detail,
  onSent,
  onClose,
  onAuthenticationRequired,
}: QuoteSendDialogProps) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<AdminQuoteSentV1Response | null>(null);
  const [message, setMessage] = useState("");

  const send = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await sendAdminQuote(detail.quote.id, {
        expectedLockVersion: detail.quote.lockVersion,
        expiresAt: null,
      });
      setSent(result);
      setMessage(result.messageText);
      onSent();
    } catch (failure) {
      if (failure instanceof AdminApiError && failure.code === "AUTHENTICATION_REQUIRED") {
        onAuthenticationRequired();
        return;
      }
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, done: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      notify(done, "success");
    } catch {
      notify("Não foi possível copiar. Selecione o texto e copie manualmente.", "danger");
    }
  };

  return (
    <Dialog
      open
      title={sent === null ? "Enviar ao cliente" : "Proposta pronta a enviar"}
      description={
        sent === null
          ? `Vai ser criada uma versão congelada da proposta, com um link válido até ${formatDate(detail.quote.validUntil)}. Depois do envio, o orçamento fica só de leitura.`
          : `Versão ${sent.versionNumber} criada. O link é válido até ${formatDate(sent.expiresAt)}.`
      }
      confirmLabel={sent === null ? "Criar link e mensagem" : "Concluir"}
      cancelLabel={sent === null ? "Cancelar" : "Fechar"}
      busy={busy}
      onClose={onClose}
      onConfirm={() => (sent === null ? void send() : onClose())}
    >
      {error === null ? null : (
        <StateMessage tone="error" role="alert">
          {error}
        </StateMessage>
      )}
      {sent === null ? null : (
        <div className="q-send">
          <TextField
            label="Link da proposta"
            readOnly
            value={sent.url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <TextArea
            label="Mensagem"
            hint="Pode editar o texto antes de copiar ou abrir o email."
            rows={6}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <div className="q-send__actions">
            <Button onClick={() => void copy(sent.url, "Link copiado.")}>Copiar link</Button>
            <Button onClick={() => void copy(message, "Mensagem copiada.")}>Copiar mensagem</Button>
            <ButtonLink href={withMessageText(sent.mailtoUrl, "body", message)}>
              Abrir email
            </ButtonLink>
            <ButtonLink
              href={withMessageText(sent.whatsappUrl, "text", message)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir WhatsApp
            </ButtonLink>
          </div>
        </div>
      )}
    </Dialog>
  );
}
