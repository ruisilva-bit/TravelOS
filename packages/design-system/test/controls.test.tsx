// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Button,
  ButtonLink,
  DateField,
  MoneyField,
  Select,
  StatusPill,
  TextArea,
  TextField,
  currencyFractionDigits,
  formatMoney,
  isValidMoneyAmount,
  normalizeMoneyInput,
} from "../src/index.js";

afterEach(cleanup);

describe("Button", () => {
  it("defaults to type=button and fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies the variant class", () => {
    render(<Button variant="danger">Apagar</Button>);
    expect(screen.getByRole("button", { name: "Apagar" })).toHaveClass("ds-button--danger");
  });

  it("does not fire when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Guardar
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading disables the button and marks it busy but keeps the label", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        A guardar…
      </Button>,
    );
    const button = screen.getByRole("button", { name: "A guardar…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("ButtonLink renders an anchor with button styling", () => {
    render(
      <ButtonLink variant="primary" href="#/leads">
        Ver leads
      </ButtonLink>,
    );
    expect(screen.getByRole("link", { name: "Ver leads" })).toHaveClass("ds-button--primary");
  });
});

describe("text controls", () => {
  it("TextField labels the control, passes props through and links hint and error", () => {
    render(
      <TextField
        label="Email profissional"
        name="email"
        type="email"
        hint="Usa o email da agência"
        error="Email inválido"
        required
      />,
    );
    const input = screen.getByLabelText("Email profissional");
    expect(input).toHaveAttribute("name", "email");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Usa o email da agência Email inválido");
  });

  it("keeps an explicit id and omits aria-invalid without an error", () => {
    render(<TextField id="given-name" label="Nome" />);
    const input = screen.getByLabelText("Nome");
    expect(input).toHaveAttribute("id", "given-name");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("TextArea and Select are labelled", () => {
    render(
      <>
        <TextArea label="Nota interna" rows={3} />
        <Select label="Origem" defaultValue="PHONE">
          <option value="PHONE">Telefone</option>
          <option value="EMAIL">Email</option>
        </Select>
      </>,
    );
    expect(screen.getByLabelText("Nota interna").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Origem")).toHaveValue("PHONE");
    expect(screen.getByRole("combobox", { name: "Origem" })).toBeInTheDocument();
  });

  it("DateField is a native date input using YYYY-MM-DD", () => {
    render(<DateField label="Data de início" defaultValue="2026-11-27" />);
    const input = screen.getByLabelText("Data de início");
    expect(input).toHaveAttribute("type", "date");
    expect(input).toHaveValue("2026-11-27");
  });
});

describe("money helpers", () => {
  it("knows the minor units of each currency", () => {
    expect(currencyFractionDigits("EUR")).toBe(2);
    expect(currencyFractionDigits("usd")).toBe(2);
    expect(currencyFractionDigits("GBP")).toBe(2);
    expect(currencyFractionDigits("JPY")).toBe(0);
  });

  it("normalises typed input without using numbers", () => {
    expect(normalizeMoneyInput("1234,5", "EUR")).toBe("1234.5");
    expect(normalizeMoneyInput("12.345", "EUR")).toBe("12.34");
    expect(normalizeMoneyInput("1.2.3", "EUR")).toBe("1.23");
    expect(normalizeMoneyInput("abc12x", "EUR")).toBe("12");
    expect(normalizeMoneyInput("1500,75", "JPY")).toBe("1500");
    expect(normalizeMoneyInput("0.1", "EUR")).toBe("0.1");
    expect(normalizeMoneyInput("12345678901234567890.99", "EUR")).toBe("12345678901234567890.99");
  });

  it("validates complete amounts", () => {
    expect(isValidMoneyAmount("10", "EUR")).toBe(true);
    expect(isValidMoneyAmount("10.5", "EUR")).toBe(true);
    expect(isValidMoneyAmount("10.55", "EUR")).toBe(true);
    expect(isValidMoneyAmount("10.555", "EUR")).toBe(false);
    expect(isValidMoneyAmount("", "EUR")).toBe(false);
    expect(isValidMoneyAmount("10.", "EUR")).toBe(false);
    expect(isValidMoneyAmount("10", "JPY")).toBe(true);
    expect(isValidMoneyAmount("10.5", "JPY")).toBe(false);
  });

  it("formats for pt-PT", () => {
    expect(formatMoney("1234.56", "EUR")).toBe("1 234,56 €");
    expect(formatMoney("1234.5", "EUR")).toBe("1 234,50 €");
    expect(formatMoney("12", "EUR")).toBe("12,00 €");
    expect(formatMoney("1234567.89", "GBP")).toBe("1 234 567,89 £");
    expect(formatMoney("1500", "JPY")).toBe("1 500 JP¥");
    expect(formatMoney("-5.5", "EUR")).toBe("-5,50 €");
    expect(formatMoney("9", "CHF")).toBe("9,00 CHF");
  });
});

describe("MoneyField", () => {
  function Harness({ currency = "EUR" }: { readonly currency?: string }) {
    const [amount, setAmount] = useState("");
    return (
      <>
        <MoneyField label="Preço" value={amount} currency={currency} onValueChange={setAmount} />
        <output data-testid="value">{amount}</output>
      </>
    );
  }

  it("emits a decimal string, accepts a comma and limits decimals", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Preço");
    fireEvent.change(input, { target: { value: "1234,567" } });
    expect(screen.getByTestId("value")).toHaveTextContent("1234.56");
    expect(input).toHaveValue("1234.56");
    expect(input).toHaveAttribute("inputmode", "decimal");
  });

  it("shows the currency as a suffix that describes the input", () => {
    render(<Harness />);
    expect(screen.getByText("EUR")).toBeInTheDocument();
    expect(screen.getByLabelText("Preço")).toHaveAccessibleDescription("EUR");
  });

  it("allows no decimals for JPY", () => {
    render(<Harness currency="JPY" />);
    const input = screen.getByLabelText("Preço");
    fireEvent.change(input, { target: { value: "1500,5" } });
    expect(input).toHaveValue("1500");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });
});

describe("StatusPill", () => {
  it("renders text with a tone class", () => {
    render(<StatusPill tone="warning">Aberta</StatusPill>);
    expect(screen.getByText("Aberta")).toHaveClass("ds-pill--warning");
  });

  it("defaults to neutral", () => {
    render(<StatusPill>Concluída</StatusPill>);
    expect(screen.getByText("Concluída")).toHaveClass("ds-pill--neutral");
  });
});
