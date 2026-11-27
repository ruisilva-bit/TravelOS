import type { TripSnapshotV1 } from "@travelos/backend-core";

/** Every interpolated value goes through this; there is no raw-HTML path. */
export const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

type Item = TripSnapshotV1["items"][number];
type ScheduledTime = Extract<Item, { kind: "FLIGHT" }>["departure"];

const STYLE = `
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d2433;background:#f5f6f8}
main{max-width:40rem;margin:0 auto;padding:1rem}
h1{font-size:1.5rem;margin:.5rem 0}h2{font-size:1.1rem;margin:0 0 .5rem}
.dates{color:#5a6478;margin:0 0 1rem}
.card{background:#fff;border:1px solid #dde1e8;border-radius:.5rem;padding:1rem;margin:0 0 1rem}
.kind{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:#5a6478;margin:0}
dl{margin:.5rem 0 0;display:grid;grid-template-columns:max-content 1fr;gap:.25rem .75rem}
dt{color:#5a6478}dd{margin:0;overflow-wrap:anywhere}
.note{margin:.5rem 0 0;overflow-wrap:anywhere}
@media (prefers-color-scheme:dark){body{background:#12151c;color:#e6e9f0}.card{background:#1b202b;border-color:#2c3342}.dates,dt,.kind{color:#9aa3b5}}
`;

const formatDate = (iso: string): string => {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
};

const formatTime = (time: ScheduledTime): string =>
  `${formatDate(time.localDate)} ${time.localTime.slice(0, 5)} (${time.timeZone})`;

const row = (label: string, value: string | null): string =>
  value === null || value === ""
    ? ""
    : `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;

const renderItem = (item: Item): string => {
  if (item.kind === "FLIGHT") {
    return `<section class="card"><p class="kind">Voo</p><h2>${escapeHtml(item.title)}</h2>${
      item.description === null ? "" : `<p class="note">${escapeHtml(item.description)}</p>`
    }<dl>${[
      row("Voo", `${item.carrier} ${item.flightNumber}`),
      row("Partida", `${item.departureAirport} · ${formatTime(item.departure)}`),
      row("Chegada", `${item.arrivalAirport} · ${formatTime(item.arrival)}`),
      row("Terminal", item.terminal),
      row("Classe", item.cabin),
      row("Bagagem", item.baggage),
      row("Lugar", item.seat),
      row("Referência", item.customerBookingReference),
    ].join("")}</dl></section>`;
  }
  return `<section class="card"><p class="kind">Alojamento</p><h2>${escapeHtml(item.title)}</h2>${
    item.description === null ? "" : `<p class="note">${escapeHtml(item.description)}</p>`
  }<dl>${[
    row("Alojamento", item.propertyName),
    row("Check-in", formatTime(item.checkIn)),
    row("Check-out", formatTime(item.checkOut)),
    row("Quarto", item.roomDescription),
    row("Regime", item.boardType),
    row("Referência", item.customerBookingReference),
  ].join("")}</dl></section>`;
};

/** Pure, script-free, resource-free customer page for one frozen snapshot. */
export const renderSharePage = (snapshot: TripSnapshotV1): string =>
  `<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escapeHtml(snapshot.trip.title)}</title><style>${STYLE}</style></head><body><main><p class="kind">Viagem</p><h1>${escapeHtml(snapshot.trip.title)}</h1><p class="dates">Datas: ${escapeHtml(formatDate(snapshot.trip.startDate))} a ${escapeHtml(formatDate(snapshot.trip.endDate))}</p>${snapshot.items.map(renderItem).join("")}</main></body></html>`;

export const SHARE_NOT_FOUND_HTML = `<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Ligação indisponível</title></head><body><main><h1>Ligação indisponível</h1><p>Esta ligação não existe, expirou ou foi revogada.</p></main></body></html>`;
