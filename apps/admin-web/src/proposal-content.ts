/** Pure helpers for the customer-proposal editor: suggested intro, image URL checks, day chips. */
import { CATEGORY_LABELS, nightsBetween } from "./quote-format.js";
import type { QuoteDetail, QuoteLine } from "./quote-format.js";

export const INTRO_MAX_LENGTH = 2000;
export const IMAGE_URL_MAX_LENGTH = 1000;
export const EXCLUDED_ITEM_MAX_LENGTH = 200;
export const EXCLUDED_MAX_COUNT = 50;

const NUMBER_WORDS = ["zero", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito"];

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

const nightsText = (nights: number | null): string | null => {
  if (nights === null || nights <= 0) return null;
  const word = nights < NUMBER_WORDS.length ? (NUMBER_WORDS[nights] ?? String(nights)) : nights;
  return `${String(word)} ${nights === 1 ? "noite" : "noites"}`;
};

const travellersText = (adults: number, children: number): string => {
  const parts = [plural(adults, "adulto", "adultos")];
  if (children > 0) parts.push(plural(children, "criança", "crianças"));
  return parts.join(" e ");
};

const joinList = (items: readonly string[]): string => {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1] ?? ""}`;
};

const shorten = (value: string, max = 60): string =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/** What the proposal includes, in the words a customer reads: only visible base lines. */
const servicePhrases = (lines: readonly QuoteLine[]): string[] => {
  const visible = lines.filter((line) => line.section === "BASE" && line.customerVisible);
  const has = (category: QuoteLine["category"]): boolean =>
    visible.some((line) => line.category === category);
  const phrases: string[] = [];
  if (has("FLIGHT")) phrases.push("voos");
  const stay = visible.find((line) => line.category === "ACCOMMODATION");
  if (stay !== undefined) phrases.push(`alojamento (${shorten(stay.service)})`);
  if (has("TRANSFER")) phrases.push("transferes");
  const activities = visible.filter((line) => line.category === "ACTIVITY");
  for (const activity of activities.slice(0, 2))
    phrases.push(shorten(activity.service).toLowerCase());
  if (activities.length > 2) phrases.push("outras experiências");
  if (has("CAR")) phrases.push("carro de aluguer");
  if (has("INSURANCE")) phrases.push("seguro de viagem");
  return phrases;
};

/** A pt-PT cover sentence from the facts already in the quote. Pure; the person edits it freely. */
export const suggestIntro = (detail: QuoteDetail): string => {
  const { quote, lines } = detail;
  const destination = quote.destination?.trim() ?? "";
  const nights = nightsText(nightsBetween(quote.startDate, quote.endDate));
  const where = destination === "" ? "esta viagem" : destination;
  const opening =
    nights === null
      ? `Preparámos esta proposta para ${where}`
      : destination === ""
        ? `Preparámos esta viagem de ${nights}`
        : `Preparámos esta viagem de ${nights} a ${destination}`;
  const people = travellersText(quote.adults, quote.children);
  const phrases = servicePhrases(lines);
  const includes = phrases.length === 0 ? "" : ` Inclui ${joinList(phrases)}.`;
  const text = `${opening}, a pensar em ${people}.${includes} Cada detalhe foi tratado para que só tenha de se preocupar em aproveitar.`;
  return text.slice(0, INTRO_MAX_LENGTH);
};

/** Null when the value is empty (clears the image) or a valid https URL; otherwise a pt-PT error. */
export const validateImageUrl = (value: string): string | null => {
  const text = value.trim();
  if (text === "") return null;
  if (text.length > IMAGE_URL_MAX_LENGTH)
    return "O endereço é demasiado longo (máximo 1000 caracteres).";
  if (!text.startsWith("https://")) return "Indique um endereço que comece por https://";
  try {
    const parsed = new URL(text);
    if (parsed.hostname === "" || /\s/u.test(text)) throw new Error("invalid");
  } catch {
    return "O endereço da imagem não é válido.";
  }
  return null;
};

/** Visible base flights, stays, transfers and activities on `date`: starts, ends, or (activities) spans it. */
export const linesOnDay = (lines: readonly QuoteLine[], date: string): QuoteLine[] =>
  lines.filter((line) => {
    if (line.section !== "BASE" || !line.customerVisible || line.startDate === null) return false;
    if (line.category === "INSURANCE" || line.category === "CAR" || line.category === "OTHER")
      return false;
    const end = line.endDate ?? line.startDate;
    if (date === line.startDate || date === end) return true;
    return line.category === "ACTIVITY" && line.startDate <= date && date <= end;
  });

/** Lines that can carry a photo, most visual first: accommodation, activities, then the rest. */
export const imageLines = (lines: readonly QuoteLine[]): QuoteLine[] => {
  const rank = (line: QuoteLine): number =>
    line.category === "ACCOMMODATION" ? 0 : line.category === "ACTIVITY" ? 1 : 2;
  return lines
    .filter((line) => line.customerVisible && line.category !== "INSURANCE")
    .map((line, index) => ({ line, index }))
    .sort((a, b) => rank(a.line) - rank(b.line) || a.index - b.index)
    .map((entry) => entry.line);
};

export const lineLabel = (line: QuoteLine): string =>
  `${CATEGORY_LABELS[line.category]}: ${line.service}`;
