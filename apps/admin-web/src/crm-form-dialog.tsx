import { Dialog, StateMessage } from "@travelos/design-system";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/** Dialog around a form: Enter submits, the first field is focused, errors stay visible. */
export function FormDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  error,
  onSubmit,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      {...(description === undefined ? {} : { description })}
      confirmLabel={confirmLabel}
      busy={busy}
      onConfirm={onSubmit}
      onClose={onClose}
    >
      <DialogForm onSubmit={onSubmit}>
        {error ? (
          <StateMessage tone="error" role="alert">
            {error}
          </StateMessage>
        ) : null}
        {children}
      </DialogForm>
    </Dialog>
  );
}

function DialogForm({
  onSubmit,
  children,
}: {
  readonly onSubmit: () => void;
  readonly children: ReactNode;
}) {
  const form = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    // The dialog focuses Cancel after mount; move to the first field afterwards.
    const timer = setTimeout(() => {
      form.current
        ?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select")
        ?.focus({ preventScroll: true });
      form.current?.closest(".ds-dialog")?.scrollTo?.(0, 0);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <form
      ref={form}
      className="crm-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <button type="submit" hidden />
    </form>
  );
}
