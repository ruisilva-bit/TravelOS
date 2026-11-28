import { SHARE_NOT_FOUND_HTML } from "./share-page-renderer.js";
import type { QuoteProposalV1 } from "@travelos/contracts/share";

import { escapeHtml } from "./share-page-renderer.js";
import { PROPOSAL_STYLE } from "./proposal-page-style.js";

export interface ProposalPageView {
  payload: QuoteProposalV1;
  token: string;
  isLatest: boolean;
  /** Quote state of the sent version: SENT, ACCEPTED, DECLINED, EXPIRED, or PREVIEW for a staff draft. */
  state: string;
  accepted: { name: string; at: string } | null;
  flash: "accepted" | "error" | null;
  /** Today in ISO date form (YYYY-MM-DD), supplied by the caller so rendering stays pure. */
  today: string;
}

type Money = QuoteProposalV1["totals"]["pvpFinal"];
type Flight = QuoteProposalV1["flights"][number];

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
const NBSP = " ";
const e = escapeHtml;

const parseIso = (iso: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(iso);
  if (match === null) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** 14 de junho de 2027 */
export const formatLongDate = (iso: string): string => {
  const d = parseIso(iso);
  return d === null
    ? iso
    : `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()] ?? ""} de ${d.getUTCFullYear()}`;
};
/** 14 jun */
const shortDate = (iso: string): string => {
  const d = parseIso(iso);
  return d === null ? iso : `${d.getUTCDate()} ${(MONTHS[d.getUTCMonth()] ?? "").slice(0, 3)}`;
};
const weekday = (iso: string): string => {
  const d = parseIso(iso);
  return d === null ? "" : (WEEKDAYS[d.getUTCDay()] ?? "");
};

/** "1 234,56 €" from integer minor units; BigInt only, never floats. */
export const formatMoney = (money: Money): string => {
  const digits = money.minorUnits.padStart(money.scale + 1, "0");
  const whole = digits.slice(0, digits.length - money.scale);
  const fraction = digits.slice(digits.length - money.scale);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, NBSP);
  const symbol = money.currency === "EUR" ? "€" : money.currency;
  return `${grouped}${fraction === "" ? "" : `,${fraction}`}${NBSP}${symbol}`;
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const dayIso = `${get("year")}-${get("month").padStart(2, "0")}-${get("day").padStart(2, "0")}`;
  return `${formatLongDate(dayIso)}, ${get("hour")}:${get("minute")}`;
};

const safeImage = (url: string | null): string | null =>
  url !== null && /^https:\/\//iu.test(url) ? url : null;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const p = (text: string | null, cls = "desc"): string =>
  text === null || text === "" ? "" : `<p class="${cls}">${e(text)}</p>`;

const sectionHead = (eyebrow: string, title: string): string =>
  `<div class="sec-head"><p class="eyebrow">${e(eyebrow)}</p><h2>${e(title)}</h2></div>`;

const renderFlight = (f: Flight): string => {
  const label =
    f.direction === "OUTBOUND"
      ? "Voo de ida"
      : f.direction === "RETURN"
        ? "Voo de regresso"
        : "Voo";
  const code = (iata: string | null): string => (iata === null ? "&nbsp;" : e(iata));
  const time = (t: string | null): string => (t === null ? "&ndash;" : e(t));
  const info = [
    f.carrier !== null || f.flightNumber !== null
      ? `<span>Voo <b>${e([f.carrier, f.flightNumber].filter((x) => x !== null).join(" "))}</b></span>`
      : "",
    f.baggage === null ? "" : `<span>Bagagem <b>${e(f.baggage)}</b></span>`,
  ].join("");
  return `<article class="card flight"><p class="dir"><span>${label}</span>${
    f.date === null ? "" : `<span>${e(weekday(f.date))}, ${e(shortDate(f.date))}</span>`
  }</p><div class="route"><div><div class="t">${time(f.departTime)}</div><div class="c">${code(f.fromIata)}</div></div><div class="line" aria-hidden="true"></div><div class="r"><div class="t">${time(f.arriveTime)}</div><div class="c">${code(f.toIata)}</div></div></div>${
    info === "" ? "" : `<div class="info">${info}</div>`
  }</article>`;
};

const renderAccommodation = (a: QuoteProposalV1["accommodations"][number]): string => {
  const img = safeImage(a.imageUrl);
  const dt = (label: string, value: string | null): string =>
    value === null || value === "" ? "" : `<div><dt>${label}</dt><dd>${e(value)}</dd></div>`;
  return `<article class="card stay${img === null ? "" : " has"}">${
    img === null
      ? ""
      : `<div class="ph"><img src="${e(img)}" alt="${e(a.service)}" loading="lazy" referrerpolicy="no-referrer"></div>`
  }<div class="body"><p class="eyebrow">Alojamento</p><h3>${e(a.service)}</h3>${p(a.description)}<dl class="grid">${[
    dt("Localização", a.location),
    dt("Quarto", a.roomType),
    dt("Regime", a.boardBasis),
    dt("Entrada", a.startDate === null ? null : formatLongDate(a.startDate)),
    dt("Saída", a.endDate === null ? null : formatLongDate(a.endDate)),
    dt("Noites", a.nights === null ? null : String(a.nights)),
  ].join("")}</dl></div></article>`;
};

const renderGroupList = (items: readonly string[], cls: string): string =>
  items.length === 0
    ? ""
    : `<ul class="${cls}">${items.map((i) => `<li>${e(i)}</li>`).join("")}</ul>`;

const renderAccept = (view: ProposalPageView): string => {
  const { quote } = view.payload;
  return `<section class="sec" id="aceitar"><div class="accept act"><div><p class="eyebrow">Aceitar proposta</p><h2>Está pronto para avançar?</h2><p>Confirme o seu nome para aceitar a proposta ${e(quote.number)}. A agência entrará em contacto para os próximos passos e para o pagamento do sinal.</p></div><form method="post" action="/v/${e(encodeURIComponent(view.token))}/accept" autocomplete="off"><label class="f">Nome completo<input type="text" name="name" required maxlength="120" autocomplete="name"></label><label class="ck"><input type="checkbox" name="confirm" required><span>Li e aceito a proposta e as condições.</span></label><button type="submit">Aceitar proposta</button></form></div></section>`;
};

/** Banner and whether the accept form is available, derived from the view. */
const resolveStatus = (view: ProposalPageView): { banner: string; canAccept: boolean } => {
  const banner = (cls: string, text: string): string =>
    `<div class="banner ${cls}" role="${cls === "bad" ? "alert" : "status"}">${e(text)}</div>`;
  if (view.state === "PREVIEW") {
    return {
      banner: banner(
        "info",
        "Pré-visualização do rascunho, visível apenas à equipa. O cliente ainda não a recebeu.",
      ),
      canAccept: false,
    };
  }
  if (view.accepted !== null || view.state === "ACCEPTED") {
    const who =
      view.accepted === null
        ? ""
        : ` por ${view.accepted.name} em ${formatDateTime(view.accepted.at)}`;
    return { banner: banner("ok", `Proposta aceite${who} — obrigado!`), canAccept: false };
  }
  if (!view.isLatest) {
    return {
      banner: banner("info", "Esta proposta foi atualizada. Peça o link mais recente à agência."),
      canAccept: false,
    };
  }
  const expired = view.state === "EXPIRED" || view.payload.quote.validUntil < view.today;
  if (expired || view.state !== "SENT") {
    const text =
      view.state === "DECLINED"
        ? "Esta proposta já não está disponível. Contacte a agência."
        : `Esta proposta expirou em ${formatLongDate(view.payload.quote.validUntil)}. Contacte a agência para uma nova validade.`;
    return { banner: banner("info", text), canAccept: false };
  }
  if (view.flash === "error") {
    return {
      banner: banner(
        "bad",
        "Não foi possível registar a aceitação. Indique o seu nome completo e confirme que aceita as condições.",
      ),
      canAccept: true,
    };
  }
  return { banner: "", canAccept: true };
};

export const renderProposalPage = (view: ProposalPageView): string => {
  const { payload } = view;
  const { quote, totals, agency } = payload;
  const heroImg = safeImage(quote.heroImageUrl);
  const status = resolveStatus(view);
  const travellers = [
    plural(quote.adults, "adulto", "adultos"),
    quote.children > 0 ? plural(quote.children, "criança", "crianças") : "",
  ]
    .filter((x) => x !== "")
    .join(" + ");
  const total = quote.adults + quote.children;
  const outbound = payload.flights.find((f) => f.direction === "OUTBOUND");
  const origin = outbound?.fromIata ?? null;
  const dest = outbound?.toIata ?? null;
  const route = origin !== null && dest !== null ? `${origin} → ${dest}` : quote.destination;
  const dates =
    quote.startDate !== null && quote.endDate !== null
      ? `${shortDate(quote.startDate)} – ${formatLongDate(quote.endDate)}`
      : quote.startDate !== null
        ? formatLongDate(quote.startDate)
        : null;
  const fact = (label: string, value: string | null): string =>
    value === null ? "" : `<div><dt>${label}</dt><dd>${e(value)}</dd></div>`;

  const nav = [
    ["resumo", "Resumo", true],
    ["voos", "Voos", payload.flights.length > 0],
    ["alojamento", "Alojamento", payload.accommodations.length > 0],
    ["programa", "Programa", payload.days.length > 0],
    ["informacoes", "Informações", true],
  ]
    .filter((x) => x[2])
    .map((x) => `<a href="#${String(x[0])}">${String(x[1])}</a>`)
    .join("");

  const flights =
    payload.flights.length === 0
      ? ""
      : `<section class="sec" id="voos">${sectionHead("Transportes", "O caminho até ao destino")}<div class="cards2">${payload.flights.map(renderFlight).join("")}</div></section>`;
  const stays =
    payload.accommodations.length === 0
      ? ""
      : `<section class="sec" id="alojamento">${sectionHead("Estadia", "Um lugar para chamar de casa")}<div class="stays">${payload.accommodations.map(renderAccommodation).join("")}</div></section>`;
  const days =
    payload.days.length === 0
      ? ""
      : `<section class="sec" id="programa">${sectionHead("Programa", "Dia após dia")}<ol class="timeline">${payload.days
          .map(
            (d, i) =>
              `<li><span class="n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><div class="card"><p class="eyebrow">${e(weekday(d.date))}, ${e(shortDate(d.date))}</p><h3>${e(d.title)}</h3>${p(d.description)}</div></li>`,
          )
          .join("")}</ol></section>`;
  const services =
    payload.otherServices.length === 0
      ? ""
      : `<section class="sec" id="servicos">${sectionHead("Complementos", "Outros serviços incluídos")}<div class="svc">${payload.otherServices
          .map((s) => {
            const img = safeImage(s.imageUrl);
            return `<article class="card">${
              img === null
                ? ""
                : `<img src="${e(img)}" alt="${e(s.service)}" loading="lazy" referrerpolicy="no-referrer">`
            }<div class="b"><p class="eyebrow">${e(s.category)}${s.startDate === null ? "" : ` · ${e(shortDate(s.startDate))}`}</p><h3>${e(s.service)}</h3>${p(s.description)}</div></article>`;
          })
          .join("")}</div></section>`;
  const options =
    payload.options.length === 0
      ? ""
      : `<section class="sec" id="opcoes">${sectionHead("Opções adicionais", "Para tornar a viagem ainda mais sua")}<div class="opts">${payload.options
          .map(
            (o) =>
              `<article class="card"><div class="opt"><h3>${e(o.service)}</h3><span class="p">+${NBSP}${e(formatMoney(o.pvp))}</span></div>${p(o.description)}</article>`,
          )
          .join(
            "",
          )}</div><p class="hint">As opções não estão incluídas no preço total acima.</p></section>`;
  const hasIncl = payload.included.length > 0 || payload.excluded.length > 0;
  const inex = !hasIncl
    ? ""
    : `<div class="inex">${
        payload.included.length === 0
          ? ""
          : `<div class="card yes"><h3>Incluído</h3>${payload.included
              .map((g) => `<h4>${e(g.label)}</h4>${renderGroupList(g.items, "yes")}`)
              .join("")}</div>`
      }${
        payload.excluded.length === 0
          ? ""
          : `<div class="card no"><h3>Não incluído</h3>${renderGroupList(payload.excluded, "no")}</div>`
      }</div>`;
  const conditions = `<div class="card cond" style="margin-top:1rem"><h3 style="font-size:1.3rem;margin-bottom:.6rem">Condições</h3><ul><li>Proposta válida até ${e(formatLongDate(quote.validUntil))}.</li><li>Sinal de ${e(formatMoney(totals.deposit))} para confirmar a reserva${totals.balanceDueDate === null ? "" : `; saldo de ${e(formatMoney(totals.balance))} até ${e(formatLongDate(totals.balanceDueDate))}`}.</li><li>Preços e serviços sujeitos a disponibilidade no momento da reserva.</li></ul></div>`;

  const body = `<header class="top"><div class="wrap"><span class="brand">${e(agency.displayName)}</span><nav aria-label="Secções">${nav}</nav></div></header>
<main class="wrap">${status.banner}
<section class="hero ${heroImg === null ? "noimg" : "img"}">${
    heroImg === null
      ? ""
      : `<img src="${e(heroImg)}" alt="${e(quote.destination ?? quote.title)}" referrerpolicy="no-referrer">`
  }<div class="in"><p class="eyebrow">${e(quote.destination ?? "A sua viagem")} · Proposta ${e(quote.number)}</p><h1>${e(quote.title)}</h1>${p(quote.intro, "lead")}</div></section>
<dl class="facts">${fact("Datas", dates)}${fact("Duração", quote.nights === null ? null : plural(quote.nights, "noite", "noites"))}${fact("Viajantes", travellers)}${fact("Percurso", route)}</dl>
<section class="sec" id="resumo">${sectionHead("Resumo e preço", "O essencial, num relance")}<div class="price"><div class="total"><p class="eyebrow">Preço total</p><p class="big">${e(formatMoney(totals.pvpFinal))}</p><p>Preço total para ${plural(total, "viajante", "viajantes")}.</p></div><div class="card"><dl class="kv"><dt>Por pessoa</dt><dd>${e(formatMoney(totals.perPerson))}</dd><dt>Sinal<span class="sub">Para confirmar a reserva</span></dt><dd>${e(formatMoney(totals.deposit))}</dd><dt>Saldo${totals.balanceDueDate === null ? "" : `<span class="sub">Até ${e(formatLongDate(totals.balanceDueDate))}</span>`}</dt><dd>${e(formatMoney(totals.balance))}</dd></dl></div></div></section>
${flights}${stays}${days}${services}${options}
<section class="sec" id="informacoes">${sectionHead("Informações", "O que está e não está incluído")}${inex}${conditions}</section>
${status.canAccept ? renderAccept(view) : ""}
<p class="hint">Para guardar em PDF use Imprimir &gt; Guardar como PDF.</p>
</main>
<footer class="foot"><div class="wrap"><strong>${e(agency.displayName)}</strong><span>Proposta ${e(quote.number)} · válida até ${e(formatLongDate(quote.validUntil))}</span></div></footer>`;

  return `<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>${e(quote.title)} · ${e(agency.displayName)}</title><style>${PROPOSAL_STYLE}</style></head><body>${body}</body></html>`;
};

// Unknown, expired and contract-violating links must be indistinguishable from a missing trip link.
export const PROPOSAL_NOT_FOUND_HTML = SHARE_NOT_FOUND_HTML;
