import { AdminApiError } from "./api.js";

export type CustomerRole = "PRIMARY_CONTACT" | "TRAVELLER" | "PAYER" | "GUARDIAN";

export const ROLE_LABELS: Record<CustomerRole, string> = {
  PRIMARY_CONTACT: "Contacto principal",
  TRAVELLER: "Viajante",
  PAYER: "Pagador",
  GUARDIAN: "Responsável",
};

/** Roles that can be ticked in the editor; "Contacto principal" is the separate primary flag. */
export const EDITABLE_ROLES: readonly CustomerRole[] = ["TRAVELLER", "PAYER", "GUARDIAN"];

export const COUNTRIES: readonly (readonly [string, string])[] = [
  ["PT", "Portugal"],
  ["ES", "Espanha"],
  ["FR", "França"],
  ["GB", "Reino Unido"],
  ["DE", "Alemanha"],
  ["IT", "Itália"],
  ["BR", "Brasil"],
  ["US", "Estados Unidos"],
  ["NL", "Países Baixos"],
  ["BE", "Bélgica"],
  ["CH", "Suíça"],
  ["IE", "Irlanda"],
  ["AO", "Angola"],
  ["MZ", "Moçambique"],
  ["CV", "Cabo Verde"],
  ["CA", "Canadá"],
];

export const countryName = (code: string | null): string | null => {
  if (code === null) return null;
  return COUNTRIES.find(([value]) => value === code.toUpperCase())?.[1] ?? code.toUpperCase();
};

export const CUSTOMER_CONFLICT_MESSAGE =
  "Este registo foi alterado por outra pessoa. Atualize a página para ver a versão mais recente antes de guardar.";

export const isAuthenticationRequired = (error: unknown): boolean =>
  error instanceof AdminApiError && error.code === "AUTHENTICATION_REQUIRED";

export const isConflict = (error: unknown): boolean =>
  error instanceof AdminApiError && error.code === "CONFLICT";

/** A network or availability failure may have been processed; the same idempotency key is retried. */
export const isRetryableFailure = (error: unknown): boolean =>
  error instanceof AdminApiError &&
  (error.code === "NETWORK_FAILURE" || error.code === "UNAVAILABLE");

export const crmErrorMessage = (error: unknown): string => {
  if (!(error instanceof AdminApiError)) return "Ocorreu um erro. Tente novamente.";
  switch (error.code) {
    case "AUTHENTICATION_REQUIRED":
      return error.message;
    case "ACCESS_DENIED":
      return "Não tem permissão para esta operação.";
    case "NOT_FOUND":
      return "Este registo não está disponível nesta agência.";
    case "CONFLICT":
      return CUSTOMER_CONFLICT_MESSAGE;
    case "INVALID_REQUEST":
      return "Verifique os dados indicados e tente novamente.";
    case "UNAVAILABLE":
      return "O serviço está temporariamente indisponível.";
    case "NETWORK_FAILURE":
      return "Não foi possível contactar o serviço.";
    default:
      return "Não foi possível validar os dados recebidos.";
  }
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PHONE = /^[+0-9 ()-]+$/u;

export const validateEmail = (value: string): string | null =>
  value === "" || EMAIL.test(value) ? null : "Indique um email válido.";

export const validatePhone = (value: string): string | null =>
  value === "" || (PHONE.test(value) && /[0-9]/u.test(value))
    ? null
    : "Use apenas números, espaços e + ( ) -.";

export const nullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export const fullName = (givenName: string, familyName: string): string =>
  `${givenName.trim()} ${familyName.trim()}`.trim();
