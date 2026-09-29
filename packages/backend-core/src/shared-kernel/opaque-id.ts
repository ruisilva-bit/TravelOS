export type OpaqueId = string & { readonly __travelosOpaqueId: unique symbol };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const isOpaqueUuid = (value: string): boolean => UUID_PATTERN.test(value);

export const isUuidV7 = (value: string): boolean => UUID_V7_PATTERN.test(value);

export const asOpaqueId = (value: string): OpaqueId => {
  const normalized = value.trim().toLowerCase();
  if (!isOpaqueUuid(normalized)) throw new Error("TravelOS identifiers must be canonical UUIDs");
  return normalized as OpaqueId;
};

const byteToHex = (value: number): string => value.toString(16).padStart(2, "0");

const assertEntropy = (entropy: Uint8Array): void => {
  if (entropy.length !== 10) throw new Error("UUIDv7 entropy must contain exactly 10 bytes");
};

/** Builds a UUIDv7 from an explicit millisecond timestamp and entropy supplied by an adapter. */
export const uuidV7FromEntropy = (epochMilliseconds: number, entropy: Uint8Array): OpaqueId => {
  if (
    !Number.isSafeInteger(epochMilliseconds) ||
    epochMilliseconds < 0 ||
    epochMilliseconds >= 2 ** 48
  ) {
    throw new Error("UUIDv7 timestamp is outside the 48-bit millisecond range");
  }
  assertEntropy(entropy);
  const bytes = new Uint8Array(16);
  let timestamp = epochMilliseconds;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = 0x70 | (entropy[0]! & 0x0f);
  bytes[7] = entropy[1]!;
  bytes[8] = 0x80 | (entropy[2]! & 0x3f);
  bytes.set(entropy.subarray(3), 9);
  const text = [
    [...bytes.subarray(0, 4)].map(byteToHex).join(""),
    [...bytes.subarray(4, 6)].map(byteToHex).join(""),
    [...bytes.subarray(6, 8)].map(byteToHex).join(""),
    [...bytes.subarray(8, 10)].map(byteToHex).join(""),
    [...bytes.subarray(10)].map(byteToHex).join(""),
  ].join("-");
  if (!isUuidV7(text)) throw new Error("UUIDv7 construction produced an invalid identifier");
  return text as OpaqueId;
};
