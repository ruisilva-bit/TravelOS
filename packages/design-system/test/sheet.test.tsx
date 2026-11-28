// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CategoryChip,
  Drawer,
  MenuButton,
  NumberStepper,
  SheetCellInput,
  SheetCellSelect,
} from "../src/index.js";

afterEach(cleanup);

describe("SheetCellInput", () => {
  it("commits once on blur and only when the value changed", () => {
    const onCommit = vi.fn();
    render(<SheetCellInput label="Serviço" value="Voo" onCommit={onCommit} />);
    const input = screen.getByLabelText("Serviço");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Voo Lisboa" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Voo Lisboa");
  });

  it("keeps money as a normalised decimal string and pads the cents", () => {
    const onCommit = vi.fn();
    render(<SheetCellInput label="NET" kind="money" value="0.00" onCommit={onCommit} />);
    const input = screen.getByLabelText("NET");
    fireEvent.change(input, { target: { value: "1 234,5" } });
    expect(input).toHaveValue("1234.5");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("1234.50");
  });

  it("Escape reverts the draft and Enter commits and moves down the same column", () => {
    const onCommit = vi.fn();
    render(
      <table>
        <tbody>
          <tr data-sheet-row>
            <td>
              <SheetCellInput label="A1" column="a" value="x" onCommit={onCommit} />
            </td>
          </tr>
          <tr data-sheet-row>
            <td>
              <SheetCellInput label="A2" column="a" value="y" onCommit={vi.fn()} />
            </td>
          </tr>
        </tbody>
      </table>,
    );
    const first = screen.getByLabelText("A1");
    fireEvent.change(first, { target: { value: "z" } });
    fireEvent.keyDown(first, { key: "Escape" });
    expect(first).toHaveValue("x");
    fireEvent.change(first, { target: { value: "z" } });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("z");
    expect(screen.getByLabelText("A2")).toHaveFocus();
  });

  it("integer cells drop non-digits", () => {
    render(<SheetCellInput label="Qtd" kind="integer" value="1" onCommit={vi.fn()} />);
    const input = screen.getByLabelText("Qtd");
    fireEvent.change(input, { target: { value: "2a3" } });
    expect(input).toHaveValue("23");
  });
});

describe("SheetCellSelect, CategoryChip", () => {
  it("reports the chosen option and carries the category tone", () => {
    const onChange = vi.fn();
    render(
      <SheetCellSelect
        label="Categoria"
        tone="flight"
        value="a"
        options={[
          { value: "a", label: "Voos" },
          { value: "b", label: "Carro" },
        ]}
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText("Categoria");
    expect(select).toHaveAttribute("data-category", "flight");
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
    render(<CategoryChip tone="car">Aluguer</CategoryChip>);
    expect(screen.getByText("Aluguer")).toHaveAttribute("data-category", "car");
  });
});

describe("Drawer", () => {
  it("is a labelled modal, closes on Escape and hides when closed", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Drawer open title="Detalhes" onClose={onClose}>
        <input aria-label="Campo" />
      </Drawer>,
    );
    const dialog = screen.getByRole("dialog", { name: "Detalhes" });
    expect(screen.getByLabelText("Campo")).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(
      <Drawer open={false} title="Detalhes" onClose={onClose}>
        x
      </Drawer>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("MenuButton", () => {
  it("opens, moves with arrows, selects and closes", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <MenuButton
        label="Ações"
        items={[
          { key: "a", label: "Duplicar", onSelect: first },
          { key: "b", label: "Apagar", onSelect: second, tone: "danger" },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Ações" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    expect(screen.getByRole("menuitem", { name: "Duplicar" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Apagar" })).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: "Apagar" }));
    expect(second).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

describe("NumberStepper", () => {
  it("steps within bounds and commits typed values on blur", () => {
    const onChange = vi.fn();
    render(<NumberStepper label="Adultos" value={1} min={1} max={4} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Diminuir adultos" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Aumentar adultos" }));
    expect(onChange).toHaveBeenLastCalledWith(2);
    const input = screen.getByLabelText("Adultos");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(4);
  });
});
