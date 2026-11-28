/**
 * Synthetic, stateful stand-in for the quote API, shared by the jsdom tests and the browser
 * screenshots. Money is minor-unit strings. No real people or data.
 */
export const QUOTE_ID = "019b0301-0000-7000-8000-000000000001";
export const CUSTOMER_ID = "019b0301-0000-7000-8000-000000000002";
export const LEAD_ID = "019b0301-0000-7000-8000-000000000003";

type Json = Record<string, unknown>;
type Line = Json & { id: string; section: "BASE" | "OPTION"; position: number; quantity: number };

const lineId = (n: number): string =>
  `019b0301-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`;

const blankLine = (n: number, over: Json): Line =>
  ({
    id: lineId(n),
    quoteId: QUOTE_ID,
    section: "BASE",
    position: n,
    category: "OTHER",
    service: "Serviço",
    supplier: "Fornecedor Exemplo",
    description: null,
    startDate: "2027-05-01",
    endDate: "2027-05-08",
    quantity: 1,
    netSupplierMinor: "0",
    recommendedMinor: "0",
    pvpMinor: "0",
    customerVisible: true,
    imageUrl: null,
    internalNote: null,
    fromIata: null,
    toIata: null,
    departTime: null,
    arriveTime: null,
    carrier: null,
    flightNumber: null,
    baggage: null,
    roomType: null,
    boardBasis: null,
    location: null,
    lockVersion: "1",
    ...over,
  }) as Line;

export const sampleLines = (): Line[] => [
  blankLine(1, {
    position: 0,
    category: "FLIGHT",
    service: "Voo Lisboa – Funchal",
    supplier: "TAP",
    description: "Ida",
    startDate: "2027-05-01",
    endDate: "2027-05-01",
    quantity: 2,
    netSupplierMinor: "11000",
    recommendedMinor: "13000",
    pvpMinor: "15000",
    fromIata: "LIS",
    toIata: "FNC",
    departTime: "09:10",
    arriveTime: "11:00",
    carrier: "TAP Air Portugal",
    flightNumber: "TP1691",
    baggage: "1 mala de porão",
  }),
  blankLine(2, {
    position: 1,
    category: "FLIGHT",
    service: "Voo Funchal – Lisboa",
    supplier: "TAP",
    description: "Regresso",
    startDate: "2027-05-08",
    endDate: "2027-05-08",
    quantity: 2,
    netSupplierMinor: "10000",
    recommendedMinor: "12000",
    pvpMinor: "14000",
    fromIata: "FNC",
    toIata: "LIS",
  }),
  blankLine(3, {
    position: 2,
    category: "ACCOMMODATION",
    service: "Hotel Atlântico, Funchal",
    supplier: "Madeira Hotels",
    description: "Quarto duplo vista mar",
    netSupplierMinor: "52000",
    recommendedMinor: "60000",
    pvpMinor: "70000",
    roomType: "Duplo vista mar",
    boardBasis: "Pequeno-almoço",
    location: "Zona Velha",
  }),
  blankLine(4, {
    position: 3,
    category: "TRANSFER",
    service: "Transfer aeroporto – hotel",
    supplier: "Madeira Transfers",
    startDate: "2027-05-01",
    endDate: "2027-05-01",
    netSupplierMinor: "3500",
    recommendedMinor: "4500",
    pvpMinor: "5500",
  }),
  blankLine(5, {
    position: 4,
    category: "ACTIVITY",
    service: "Passeio de levada",
    supplier: "",
    startDate: "2027-05-04",
    endDate: "2027-05-04",
    quantity: 2,
    netSupplierMinor: "4500",
    recommendedMinor: "5500",
    pvpMinor: "6500",
  }),
  blankLine(6, {
    position: 5,
    category: "INSURANCE",
    service: "Seguro de viagem",
    supplier: "Seguros Exemplo",
    netSupplierMinor: "2400",
    recommendedMinor: "3000",
    pvpMinor: "3900",
  }),
  blankLine(7, {
    position: 6,
    category: "CAR",
    service: "Aluguer de carro 7 dias",
    supplier: "Rent Exemplo",
    netSupplierMinor: "21000",
    recommendedMinor: "25000",
    pvpMinor: "30000",
  }),
  blankLine(8, {
    section: "OPTION",
    position: 0,
    category: "ACTIVITY",
    service: "Jantar com espetáculo",
    supplier: "Casa Exemplo",
    startDate: "2027-05-05",
    endDate: "2027-05-05",
    quantity: 2,
    netSupplierMinor: "3800",
    recommendedMinor: "4600",
    pvpMinor: "5500",
  }),
  blankLine(9, {
    section: "OPTION",
    position: 1,
    category: "TRANSFER",
    service: "Upgrade para viatura executiva",
    supplier: "Madeira Transfers",
    netSupplierMinor: "1500",
    recommendedMinor: "2000",
    pvpMinor: "2800",
  }),
];

const shareBp = 2000;
const agencyNet = (net: bigint, rec: bigint): bigint =>
  rec <= net ? net : net + ((rec - net) * BigInt(shareBp) + 5000n) / 10_000n;

export class MockQuoteApi {
  readonly calls: { method: string; path: string; body: unknown }[] = [];
  quote: Json;
  lines: Line[];
  versions: Json[] = [];
  dayOverrides = new Map<number, { title: string; description: string | null }>();
  private next = 50;
  private lock = 5;

  constructor(
    options: {
      state?: string;
      lines?: Line[];
      versions?: Json[];
      pvpOverrideMinor?: string | null;
    } = {},
  ) {
    this.lines = options.lines ?? sampleLines();
    this.versions = options.versions ?? [];
    this.quote = {
      id: QUOTE_ID,
      number: "ORC-2027-0007",
      customerId: CUSTOMER_ID,
      customerDisplayName: "Marta Quintela",
      leadId: LEAD_ID,
      title: "Madeira à vossa maneira",
      destination: "Funchal, Madeira",
      startDate: "2027-05-01",
      endDate: "2027-05-08",
      adults: 2,
      children: 0,
      state: options.state ?? "DRAFT",
      validUntil: "2026-12-12",
      currencyCode: "EUR",
      pvpOverrideMinor: options.pvpOverrideMinor ?? null,
      targetMarginBp: 1500,
      agencyNetShareBp: shareBp,
      depositBp: 3000,
      balanceDueDays: 45,
      heroImageUrl: null,
      intro: null,
      internalNotes: "Cliente prefere hotéis no centro. Pagamento por transferência.",
      excludedItems: [],
      convertedTripId: null,
      lockVersion: String(this.lock),
      createdAt: "2026-11-20T10:00:00.000Z",
      updatedAt: "2026-11-27T16:30:00.000Z",
    };
  }

  private sorted(section: "BASE" | "OPTION"): Line[] {
    return this.lines.filter((l) => l.section === section).sort((a, b) => a.position - b.position);
  }

  detail(): Json {
    const base = this.sorted("BASE");
    const sum = (pick: (l: Line) => bigint): bigint =>
      base.reduce((t, l) => t + pick(l) * BigInt(l.quantity), 0n);
    const net = sum((l) => BigInt(l.netSupplierMinor as string));
    const rec = sum((l) => BigInt(l.recommendedMinor as string));
    const agency = sum((l) =>
      agencyNet(BigInt(l.netSupplierMinor as string), BigInt(l.recommendedMinor as string)),
    );
    const linesPvp = sum((l) => BigInt(l.pvpMinor as string));
    const override = this.quote["pvpOverrideMinor"] as string | null;
    const pvp = override === null ? linesPvp : BigInt(override);
    const profit = pvp - agency;
    const people = BigInt((this.quote["adults"] as number) + (this.quote["children"] as number));
    const deposit = (pvp * BigInt(this.quote["depositBp"] as number)) / 10_000n;
    const warnings: Json[] = [];
    if (profit * 10_000n < BigInt(this.quote["targetMarginBp"] as number) * pvp)
      warnings.push({ code: "MARGIN_BELOW_TARGET" });
    if (!base.some((l) => l.category === "FLIGHT")) warnings.push({ code: "NO_FLIGHT" });
    for (const l of this.lines) {
      if (!l["supplier"]) warnings.push({ code: "LINE_WITHOUT_SUPPLIER", lineId: l.id });
    }
    return {
      quote: { ...this.quote, lockVersion: String(this.lock) },
      lines: this.lines.map((l) => ({ ...l })),
      days: this.days(),
      totals: {
        baseNetSupplierMinor: net.toString(),
        baseRecommendedMinor: rec.toString(),
        baseAgencyNetMinor: agency.toString(),
        baseLinesPvpMinor: linesPvp.toString(),
        pvpFinalMinor: pvp.toString(),
        profitMinor: (profit < 0n ? 0n : profit).toString(),
        profitBp: pvp === 0n ? null : Number((profit * 10_000n) / pvp),
        recommendedMarginMinor: (rec - net).toString(),
        recommendedMarginBp: pvp === 0n ? null : Number(((rec - net) * 10_000n) / pvp),
        perPersonMinor: (pvp / people).toString(),
        depositMinor: deposit.toString(),
        balanceMinor: (pvp - deposit).toString(),
        balanceDueDate: "2027-03-17",
        balanceDueNow: false,
        optionsPvp: this.sorted("OPTION").map((l) => ({
          lineId: l.id,
          pvpMinor: (BigInt(l["pvpMinor"] as string) * BigInt(l.quantity)).toString(),
        })),
      },
      warnings,
      included: this.included(),
      excluded: (this.quote["excludedItems"] as string[]).length
        ? this.quote["excludedItems"]
        : ["Refeições não mencionadas", "Despesas pessoais", "Gorjetas"],
      versions: this.versions,
      today: "2026-11-28",
    };
  }

  private days(): Json[] {
    const start = this.quote["startDate"] as string | null;
    const end = this.quote["endDate"] as string | null;
    if (start === null || end === null) return [];
    const out: Json[] = [];
    const first = Date.parse(`${start}T00:00:00Z`);
    const count = Math.round((Date.parse(`${end}T00:00:00Z`) - first) / 86_400_000) + 1;
    for (let index = 0; index < count; index += 1) {
      const date = new Date(first + index * 86_400_000).toISOString().slice(0, 10);
      const edited = this.dayOverrides.get(index);
      const title =
        index === 0 ? "Chegada a Funchal" : index === count - 1 ? "Regresso a casa" : "Dia livre";
      out.push({
        dayIndex: index,
        date,
        title: edited?.title ?? title,
        description: edited?.description ?? null,
      });
    }
    return out;
  }

  private included(): Json[] {
    return this.sorted("BASE")
      .filter((l) => l["customerVisible"] === true)
      .map((l) => ({ category: l["category"], label: l["service"], lineIds: [l.id] }));
  }

  private bump(): Json {
    this.lock += 1;
    return this.detail();
  }

  /** Returns [status, body] or null when the route is not a quote route. */
  handle(method: string, url: string, body: unknown): [number, unknown] | null {
    const [path = "", query = ""] = url.split("?", 2);
    if (!path.startsWith("/api/admin/quote") && !path.endsWith("/quotes")) return null;
    this.calls.push({ method, path: url, body });
    const b = (body ?? {}) as Json;
    if (method === "GET" && path === "/api/admin/quotes") {
      const items =
        query.includes("state=") && !query.includes(`state=${this.quote["state"] as string}`)
          ? []
          : [this.quote];
      return [200, { items, nextCursor: null }];
    }
    if (method === "GET" && path.endsWith("/quotes")) return [200, { items: [this.quote] }];
    if (method === "POST" && path === "/api/admin/quotes") return [201, this.quote];
    const quotePath = `/api/admin/quotes/${QUOTE_ID}`;
    if (method === "GET" && path === quotePath) return [200, this.detail()];
    if (method === "PATCH" && path === quotePath) {
      const { expectedLockVersion: _ignored, ...rest } = b;
      Object.assign(this.quote, rest);
      return [200, this.bump()];
    }
    if (method === "POST" && path === `${quotePath}/lines`) {
      const { section, ...rest } = b as Json & { section: "BASE" | "OPTION" };
      const position = this.sorted(section).length;
      this.lines.push(
        blankLine(this.next++, { ...rest, section, position, supplier: null, quantity: 1 }),
      );
      return [201, this.bump()];
    }
    const lineMatch = new RegExp(`^${quotePath}/lines/([^/]+)(/duplicate)?$`, "u").exec(path);
    if (lineMatch !== null) {
      const line = this.lines.find((l) => l.id === lineMatch[1]);
      if (line === undefined) return [404, {}];
      if (method === "PATCH") {
        const { expectedLockVersion: _x, ...rest } = b;
        Object.assign(line, rest, { lockVersion: String(Number(line["lockVersion"]) + 1) });
        return [200, this.bump()];
      }
      if (method === "DELETE") {
        this.lines = this.lines.filter((l) => l !== line);
        return [200, this.bump()];
      }
      if (method === "POST") {
        this.lines.push({ ...line, id: lineId(this.next++), position: line.position + 1 } as Line);
        return [201, this.bump()];
      }
    }
    if (method === "PUT" && path === `${quotePath}/line-order`) {
      const counters = { BASE: 0, OPTION: 0 };
      for (const entry of b["order"] as { lineId: string; section: "BASE" | "OPTION" }[]) {
        const line = this.lines.find((l) => l.id === entry.lineId);
        if (line !== undefined)
          Object.assign(line, { section: entry.section, position: counters[entry.section]++ });
      }
      return [200, this.bump()];
    }
    if (method === "POST" && path === `${quotePath}/apply-margin`) {
      for (const l of this.sorted("BASE")) {
        const n = agencyNet(
          BigInt(l["netSupplierMinor"] as string),
          BigInt(l["recommendedMinor"] as string),
        );
        const raw = (n * 10_000n) / (10_000n - BigInt(this.quote["targetMarginBp"] as number));
        l["pvpMinor"] = (((raw + 99n) / 100n) * 100n).toString();
      }
      return [200, this.bump()];
    }
    const dayMatch = new RegExp(`^${quotePath}/days/(\\d+)$`, "u").exec(path);
    if (method === "PUT" && dayMatch !== null) {
      this.dayOverrides.set(Number(dayMatch[1]), {
        title: b["title"] as string,
        description: (b["description"] as string | null) ?? null,
      });
      return [200, this.bump()];
    }
    if (method === "DELETE" && path === `${quotePath}/days`) {
      this.dayOverrides.clear();
      return [200, this.bump()];
    }
    if (method === "GET" && path === `${quotePath}/preview`)
      return [200, { html: "<p>Pré-visualização</p>" }];
    if (method === "POST" && path === `${quotePath}/send`) {
      this.quote["state"] = "SENT";
      this.versions = [
        {
          id: "019b0301-0000-7000-8000-000000000501",
          quoteId: QUOTE_ID,
          versionNumber: 1,
          sentAt: "2026-11-28T09:00:00.000Z",
          pvpFinalMinor: (this.detail()["totals"] as Json)["pvpFinalMinor"],
          currencyCode: "EUR",
          payloadSha256: "ab".repeat(32),
          acceptance: null,
          isLatest: true,
          shareLinks: [
            {
              shareLinkId: "019b0301-0000-7000-8000-000000000601",
              versionId: "019b0301-0000-7000-8000-000000000501",
              versionNumber: 1,
              createdAt: "2026-11-28T09:00:00.000Z",
              expiresAt: "2026-12-12T23:59:59.000Z",
              revokedAt: null,
            },
          ],
        },
      ];
      this.bump();
      const url = `https://propostas.example.test/v/${"A".repeat(43)}`;
      const text = `Olá Marta, segue a vossa proposta para Funchal (01/05/2027 – 08/05/2027), válida até 12/12/2026: ${url}`;
      return [
        200,
        {
          versionNumber: 1,
          url,
          token: "A".repeat(43),
          messageText: text,
          mailtoUrl: `mailto:marta.quintela%40example.test?subject=Proposta&body=${encodeURIComponent(text)}`,
          whatsappUrl: `https://wa.me/351912345678?text=${encodeURIComponent(text)}`,
          expiresAt: "2026-12-12T23:59:59.000Z",
        },
      ];
    }
    if (method === "POST" && path === `${quotePath}/revise`) {
      this.quote["state"] = "DRAFT";
      return [200, this.bump()];
    }
    if (method === "POST" && path === `${quotePath}/convert-to-trip`)
      return [200, { tripId: "019b0301-0000-7000-8000-000000000701" }];
    if (method === "POST" && path.startsWith("/api/admin/quote-share-links/"))
      return [200, { revoked: true }];
    return [404, {}];
  }

  /** The set of calls whose method is not GET, in order. */
  writes(): { method: string; path: string; body: unknown }[] {
    return this.calls.filter((c) => c.method !== "GET");
  }
}
