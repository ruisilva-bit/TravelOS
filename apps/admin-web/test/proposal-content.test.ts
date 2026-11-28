import { describe, expect, it } from "vitest";

import { imageLines, linesOnDay, suggestIntro, validateImageUrl } from "../src/proposal-content.js";
import type { QuoteDetail } from "../src/quote-format.js";
import { MockQuoteApi } from "./quote-fixtures.js";

const detail = (): QuoteDetail => new MockQuoteApi().detail() as unknown as QuoteDetail;

describe("suggestIntro", () => {
  it("builds a pt-PT sentence from destination, nights, travellers and services", () => {
    const text = suggestIntro(detail());
    expect(text).toContain("sete noites a Funchal, Madeira");
    expect(text).toContain("2 adultos");
    expect(text).toContain("voos");
    expect(text).toContain("alojamento (Hotel Atlântico, Funchal)");
    expect(text).toContain("passeio de levada");
    expect(text.length).toBeLessThanOrEqual(2000);
  });

  it("copes with missing dates and destination and counts children", () => {
    const value = detail();
    const text = suggestIntro({
      ...value,
      lines: [],
      quote: { ...value.quote, destination: null, startDate: null, children: 1, adults: 1 },
    });
    expect(text).toContain("1 adulto e 1 criança");
    expect(text).not.toContain("null");
  });
});

describe("validateImageUrl", () => {
  it("accepts empty and https addresses", () => {
    expect(validateImageUrl("")).toBeNull();
    expect(validateImageUrl("https://fotos.example.test/a.jpg")).toBeNull();
  });
  it("rejects http, junk and over-long addresses", () => {
    expect(validateImageUrl("http://fotos.example.test/a.jpg")).toMatch(/https/u);
    expect(validateImageUrl("https://")).toMatch(/não é válido/u);
    expect(validateImageUrl("https://a b.test/x")).toMatch(/não é válido/u);
    expect(validateImageUrl(`https://x.test/${"a".repeat(1000)}`)).toMatch(/demasiado longo/u);
  });
});

describe("day and image helpers", () => {
  it("links lines to their days and ranks image lines", () => {
    const { lines } = detail();
    expect(linesOnDay(lines, "2027-05-01").map((l) => l.category)).toContain("FLIGHT");
    expect(linesOnDay(lines, "2027-05-04").map((l) => l.service)).toEqual(["Passeio de levada"]);
    expect(
      imageLines(lines)
        .slice(0, 2)
        .map((l) => l.category),
    ).toEqual(["ACCOMMODATION", "ACTIVITY"]);
  });
});
