import { act, fireEvent } from "@testing-library/react";

/** Minimal stand-in for user-event (not a dependency): synchronous, event-level helpers. */
const userEvent = {
  async click(element: Element): Promise<void> {
    await act(async () => {
      fireEvent.click(element);
    });
  },
  async type(element: Element, text: string): Promise<void> {
    const input = element as HTMLInputElement;
    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value: input.value + text } });
    });
  },
  async clear(element: Element): Promise<void> {
    await act(async () => {
      fireEvent.change(element, { target: { value: "" } });
    });
  },
  async selectOptions(element: Element, value: string): Promise<void> {
    await act(async () => {
      fireEvent.change(element, { target: { value } });
    });
  },
  /** Supports plain `{Key}` tokens sent to the focused element. */
  async keyboard(sequence: string): Promise<void> {
    for (const match of sequence.matchAll(/\{(\w+)\}/gu)) {
      const key = match[1] ?? "";
      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key });
      });
    }
  },
};

export default userEvent;
