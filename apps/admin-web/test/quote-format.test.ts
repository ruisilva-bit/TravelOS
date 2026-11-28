import { describe, expect, it } from "vitest";

import {
  agencyNetMinor,
  bpToPercentText,
  decimalToMinor,
  formatBp,
  minorToDecimal,
  nightsBetween,
  percentToBp,
  sumMinor,
  withMessageText,
} from "../src/quote-format.js";
import {
  applyOrder,
  currentOrder,
  orderAfterKeyboardMove,
  orderAfterMove,
} from "../src/quote-order.js";
import { MockQuoteApi } from "./quote-fixtures.js";

describe("money helpers use string maths only", () => {
  it("converts between minor units and decimal strings", () => {
    expect(minorToDecimal("12345", "EUR")).toBe("123.45");
    expect(minorToDecimal("5", "EUR")).toBe("0.05");
    expect(minorToDecimal("500", "JPY")).toBe("500");
    expect(decimalToMinor("123.4", "EUR")).toBe("12340");
    expect(decimalToMinor("0.05", "EUR")).toBe("5");
    expect(decimalToMinor("", "EUR")).toBe("0");
    expect(decimalToMinor("92233720368547758.07", "EUR")).toBe("9223372036854775807");
  });

  it("computes agency net like the server: NET plus the agency share of the difference", () => {
    expect(agencyNetMinor("11000", "13000", 2000)).toBe("11400");
    expect(agencyNetMinor("13000", "11000", 2000)).toBe("13000");
    expect(sumMinor(["1", "9223372036854775807"])).toBe("9223372036854775808");
  });

  it("parses and prints percentages", () => {
    expect(percentToBp("15")).toBe(1500);
    expect(percentToBp("15,5")).toBe(1550);
    expect(percentToBp("x")).toBeNull();
    expect(bpToPercentText(1550)).toBe("15,5");
    expect(bpToPercentText(1500)).toBe("15");
    expect(formatBp(1550)).toBe("15,5 %");
    expect(formatBp(null)).toBe("—");
  });

  it("counts nights from the dates and never throws", () => {
    expect(nightsBetween("2027-05-01", "2027-05-08")).toBe(7);
    expect(nightsBetween("2027-05-08", "2027-05-01")).toBeNull();
    expect(nightsBetween(null, "2027-05-01")).toBeNull();
  });

  it("replaces the message in a mailto or wa.me link", () => {
    const edited = withMessageText(
      "mailto:a%40b.test?subject=Proposta&body=old",
      "body",
      "Olá, é aqui",
    );
    expect(edited).toBe("mailto:a%40b.test?subject=Proposta&body=Ol%C3%A1%2C%20%C3%A9%20aqui");
  });
});

describe("line ordering", () => {
  const lines = () =>
    new MockQuoteApi().detail()["lines"] as never as Parameters<typeof currentOrder>[0];

  it("moves within and between sheets", () => {
    const all = lines();
    const ids = currentOrder(all).map((entry) => entry.lineId);
    const moved = orderAfterMove(all, ids[0] as string, "BASE", 2);
    expect(moved.slice(0, 3).map((entry) => entry.lineId)).toEqual([ids[1], ids[2], ids[0]]);
    const toOption = orderAfterMove(all, ids[0] as string, "OPTION", 0);
    expect(toOption.find((entry) => entry.lineId === ids[0])?.section).toBe("OPTION");
    expect(toOption).toHaveLength(ids.length);
  });

  it("keyboard moves stop at the edges and switch sheets", () => {
    const all = lines();
    const [first, second] = currentOrder(all);
    expect(orderAfterKeyboardMove(all, first?.lineId as string, "up")).toBeNull();
    expect(orderAfterKeyboardMove(all, second?.lineId as string, "up")?.[0]?.lineId).toBe(
      second?.lineId,
    );
    expect(orderAfterKeyboardMove(all, first?.lineId as string, "to-base")).toBeNull();
    const toOption = orderAfterKeyboardMove(all, first?.lineId as string, "to-option");
    expect(toOption?.find((entry) => entry.lineId === first?.lineId)?.section).toBe("OPTION");
  });

  it("applies an order locally", () => {
    const api = new MockQuoteApi();
    const detail = api.detail() as never as Parameters<typeof applyOrder>[0];
    const order = orderAfterMove(detail.lines, detail.lines[0]?.id as string, "OPTION", 0);
    const next = applyOrder(detail, order);
    expect(next.lines.find((line) => line.id === detail.lines[0]?.id)?.section).toBe("OPTION");
  });
});
