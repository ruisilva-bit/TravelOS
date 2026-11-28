import { describe, expect, it } from "vitest";

import {
  PROPOSAL_NOT_FOUND_HTML,
  formatMoney,
  renderProposalPage,
  type ProposalPageView,
} from "../src/proposal-page-renderer.js";
import { sampleProposal } from "./proposal-fixture.js";

const TOKEN = "a".repeat(43);
const view = (over: Partial<ProposalPageView> = {}): ProposalPageView => ({
  payload: sampleProposal({ withImages: true }),
  token: TOKEN,
  isLatest: true,
  state: "SENT",
  accepted: null,
  flash: null,
  today: "2027-02-01",
  ...over,
});

describe("renderProposalPage", () => {
  it("escapes every interpolated string", () => {
    const payload = sampleProposal();
    payload.quote.title = "<script>alert(1)</script>";
    payload.quote.intro = "<img src=x onerror=alert(2)>";
    payload.accommodations[0]!.service = '"><script>alert(3)</script>';
    payload.options[0]!.service = "<script>alert(4)</script>";
    payload.agency.displayName = "<b>Agência</b>";
    const html = renderProposalPage(view({ payload }));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Agência</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes the accepted name", () => {
    const html = renderProposalPage(
      view({ state: "ACCEPTED", accepted: { name: "<i>Ana</i>", at: "2027-02-02T10:30:00Z" } }),
    );
    expect(html).not.toContain("<i>Ana</i>");
    expect(html).toContain("&lt;i&gt;Ana&lt;/i&gt;");
  });

  it("uses only https images and falls back otherwise", () => {
    const withImages = renderProposalPage(view());
    expect(withImages).toContain('src="https://images.example.test/hero.jpg"');
    const payload = sampleProposal({ withImages: true });
    payload.quote.heroImageUrl = "javascript:alert(1)";
    payload.accommodations[0]!.imageUrl = "http://insecure.example.test/a.jpg";
    payload.otherServices[0]!.imageUrl = "data:image/png;base64,AAAA";
    const html = renderProposalPage(view({ payload }));
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("http://insecure");
    expect(html).not.toContain("data:image");
    expect(html).toContain("hero noimg");
    const none = renderProposalPage(view({ payload: sampleProposal() }));
    expect(none).not.toContain("<img");
  });

  it("has no script, external resources or inline handlers", () => {
    const html = renderProposalPage(view());
    expect(html).not.toMatch(/<script|javascript:|\son[a-z]+=|<link|@import|<iframe/iu);
    expect(html.match(/(?:src|href|action)="https?:[^"]*"/gu)).toEqual(
      expect.arrayContaining(['src="https://images.example.test/hero.jpg"']),
    );
    expect(html.match(/href="https?:/gu)).toBeNull();
  });

  it("shows the form for a latest, valid, sent proposal and posts to the token path", () => {
    const html = renderProposalPage(view());
    expect(html).toContain(`<form method="post" action="/v/${TOKEN}/accept"`);
    expect(html).toContain('name="name"');
    expect(html).toContain('name="confirm"');
    expect(html).toContain("Li e aceito a proposta e as condições");
  });

  it("accepted state: banner, no form", () => {
    const html = renderProposalPage(
      view({
        state: "ACCEPTED",
        accepted: { name: "Maria Silva", at: "2027-02-02T10:30:00Z" },
        flash: "accepted",
      }),
    );
    expect(html).toContain(
      "Proposta aceite por Maria Silva em 2 de fevereiro de 2027, 10:30 — obrigado!",
    );
    expect(html).not.toContain("<form");
  });

  it("updated state: banner, no form", () => {
    const html = renderProposalPage(view({ isLatest: false }));
    expect(html).toContain("Esta proposta foi atualizada. Peça o link mais recente à agência.");
    expect(html).not.toContain("<form");
  });

  it("expired state by state or by date: message, no form", () => {
    for (const html of [
      renderProposalPage(view({ state: "EXPIRED" })),
      renderProposalPage(view({ today: "2027-03-16" })),
    ]) {
      expect(html).toContain("Esta proposta expirou em 15 de março de 2027");
      expect(html).not.toContain("<form");
    }
    const unavailable = renderProposalPage(view({ state: "DECLINED" }));
    expect(unavailable).toContain("já não está disponível");
    expect(unavailable).not.toContain("<form");
  });

  it("error flash shows a message and keeps the form", () => {
    const html = renderProposalPage(view({ flash: "error" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Não foi possível registar a aceitação");
    expect(html).toContain("<form");
  });

  it("formats money and dates in pt-PT", () => {
    expect(formatMoney({ minorUnits: "123456", currency: "EUR", scale: 2 })).toBe("1 234,56 €");
    expect(formatMoney({ minorUnits: "5", currency: "EUR", scale: 2 })).toBe("0,05 €");
    expect(formatMoney({ minorUnits: "1200", currency: "USD", scale: 0 })).toBe("1 200 USD");
    const html = renderProposalPage(view());
    expect(html).toContain("3 450,00 €");
    expect(html).toContain("1 725,00 €");
    expect(html).toContain("14 de maio de 2027");
    expect(html).toContain("14 jun – 20 de junho de 2027");
    expect(html).toContain("+ 120,00 €");
  });

  it("renders sections, flight data and the print hint", () => {
    const html = renderProposalPage(view());
    for (const anchor of ["resumo", "voos", "alojamento", "programa", "informacoes"]) {
      expect(html).toContain(`href="#${anchor}"`);
      expect(html).toContain(`id="${anchor}"`);
    }
    expect(html).toContain("09:20");
    expect(html).toContain("OPO");
    expect(html).toContain("EA1234");
    expect(html).toContain("Preço total para 2 viajantes");
    expect(html).toContain("Para guardar em PDF use Imprimir &gt; Guardar como PDF.");
    expect(html).toContain("@media print");
    expect(html).toContain("sujeito");
  });

  it("omits empty sections", () => {
    const payload = sampleProposal();
    payload.flights = [];
    payload.days = [];
    payload.options = [];
    const html = renderProposalPage(view({ payload }));
    expect(html).not.toContain('id="voos"');
    expect(html).not.toContain('id="programa"');
    expect(html).not.toContain('id="opcoes"');
  });

  it("does not leak internal words even if the view object is poisoned", () => {
    const poisoned = {
      ...view(),
      supplier: "SECRET-SUPPLIER",
      netCost: "SECRET-NET",
      margin: "SECRET-MARGIN",
      internalNotes: "SECRET-NOTES",
    } as ProposalPageView;
    const html = renderProposalPage(poisoned);
    expect(html).not.toMatch(/SECRET-|fornecedor|margem|net agência|nota interna/iu);
  });

  it("serves a constant not-found page", () => {
    expect(PROPOSAL_NOT_FOUND_HTML).toContain("Ligação indisponível");
    expect(PROPOSAL_NOT_FOUND_HTML).not.toContain("<script");
  });
});
