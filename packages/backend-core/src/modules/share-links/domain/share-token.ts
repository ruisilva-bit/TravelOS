/** Entropy and hashing are injected; the domain imports no platform crypto. */
export interface ShareTokenCryptoPort {
  /** Cryptographically secure random bytes. */
  randomBytes(length: number): Uint8Array;
  /** SHA-256 digest of raw bytes (32 bytes). */
  sha256(bytes: Uint8Array): Uint8Array;
}

export const SHARE_TOKEN_BYTE_LENGTH = 32;
export const SHARE_TOKEN_ENCODED_LENGTH = 43;
export const SHARE_TOKEN_HASH_BYTE_LENGTH = 32;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/u;

/** Cheap shape gate: run before any hashing or database access. */
export const isShareTokenShape = (value: unknown): value is string =>
  typeof value === "string" && TOKEN_SHAPE.test(value);

/** base64url without padding. */
export const encodeShareToken = (bytes: Uint8Array): string => {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    output += ALPHABET[(combined >> 18) & 63];
    output += ALPHABET[(combined >> 12) & 63];
    if (index + 1 < bytes.length) output += ALPHABET[(combined >> 6) & 63];
    if (index + 2 < bytes.length) output += ALPHABET[combined & 63];
  }
  return output;
};

/**
 * Decodes a well-formed token to its 32 raw bytes, or null. Non-canonical encodings (whose final
 * character carries non-zero padding bits) are rejected so one token has exactly one spelling.
 */
export const decodeShareToken = (token: string): Uint8Array | null => {
  if (!isShareTokenShape(token)) return null;
  const bytes = new Uint8Array(SHARE_TOKEN_BYTE_LENGTH);
  let accumulator = 0;
  let bits = 0;
  let written = 0;
  for (const character of token) {
    accumulator = (accumulator << 6) | ALPHABET.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (written >= SHARE_TOKEN_BYTE_LENGTH) return null;
      bytes[written] = (accumulator >> bits) & 255;
      written += 1;
      accumulator &= (1 << bits) - 1;
    }
  }
  if (written !== SHARE_TOKEN_BYTE_LENGTH || accumulator !== 0) return null;
  return encodeShareToken(bytes) === token ? bytes : null;
};

export interface GeneratedShareToken {
  /** Shown to staff exactly once; never stored. */
  readonly token: string;
  /** SHA-256 of the raw token bytes; the only persisted form. */
  readonly tokenHash: Uint8Array;
}

export const generateShareToken = (crypto: ShareTokenCryptoPort): GeneratedShareToken => {
  const bytes = crypto.randomBytes(SHARE_TOKEN_BYTE_LENGTH);
  if (bytes.length !== SHARE_TOKEN_BYTE_LENGTH) {
    throw new Error("Share token entropy source returned an unexpected length");
  }
  const tokenHash = crypto.sha256(bytes);
  if (tokenHash.length !== SHARE_TOKEN_HASH_BYTE_LENGTH) {
    throw new Error("Share token hasher returned an unexpected length");
  }
  return { token: encodeShareToken(bytes), tokenHash };
};

/** Hash of a presented token, or null when the token is not a canonical 43-character token. */
export const hashPresentedShareToken = (
  crypto: Pick<ShareTokenCryptoPort, "sha256">,
  token: unknown,
): Uint8Array | null => {
  if (typeof token !== "string") return null;
  const bytes = decodeShareToken(token);
  return bytes === null ? null : crypto.sha256(bytes);
};
