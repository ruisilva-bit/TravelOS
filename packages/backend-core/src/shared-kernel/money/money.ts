export type CurrencyCode = "EUR" | "USD" | "GBP" | "JPY";

export const CURRENCY_SCALES: Readonly<Record<CurrencyCode, number>> = Object.freeze({
  EUR: 2,
  USD: 2,
  GBP: 2,
  JPY: 0,
});

export type RoundingPolicyId = "COMMERCIAL_HALF_UP_V1";

export const ROUNDING_POLICY_REGISTRY: Readonly<
  Record<RoundingPolicyId, { readonly context: "COMMERCIAL"; readonly mode: "HALF_UP" }>
> = Object.freeze({
  COMMERCIAL_HALF_UP_V1: { context: "COMMERCIAL", mode: "HALF_UP" },
});

export interface Money {
  readonly minorUnits: bigint;
  readonly currency: CurrencyCode;
  readonly scale: number;
}

export interface MoneyJson {
  readonly minorUnits: string;
  readonly currency: CurrencyCode;
  readonly scale: number;
}

const INTEGER_PATTERN = /^(?:0|[1-9]\d*|-[1-9]\d*)(?![\s\S])/u;
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/u;
const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = 2n ** 63n - 1n;

const assertIntegerText = (value: string): void => {
  if (!INTEGER_PATTERN.test(value)) throw new Error("Money minor units must be an integer string");
};

const assertCurrency = (currency: string, scale: number | undefined): CurrencyCode => {
  if (!Object.hasOwn(CURRENCY_SCALES, currency)) {
    throw new Error(`Unsupported ISO currency: ${currency}`);
  }
  const code = currency as CurrencyCode;
  const expectedScale = CURRENCY_SCALES[code];
  if (!Number.isInteger(expectedScale) || expectedScale < 0) {
    throw new Error(`Currency ${code} has an invalid registry scale`);
  }
  if (scale !== undefined && scale !== expectedScale) {
    throw new Error(`Currency ${code} requires pinned scale ${expectedScale}`);
  }
  return code;
};

export const createMoney = (
  minorUnits: bigint | string,
  currency: string,
  scale?: number,
): Money => {
  const code = assertCurrency(currency, scale);
  const amount =
    typeof minorUnits === "bigint"
      ? minorUnits
      : (assertIntegerText(minorUnits), BigInt(minorUnits));
  if (amount < MIN_INT64 || amount > MAX_INT64) {
    throw new Error("Money minor units must fit PostgreSQL signed bigint");
  }
  return { minorUnits: amount, currency: code, scale: CURRENCY_SCALES[code] };
};

export const addMoney = (left: Money, right: Money): Money => {
  assertSameCurrency(left, right);
  return createMoney(left.minorUnits + right.minorUnits, left.currency, left.scale);
};

export const subtractMoney = (left: Money, right: Money): Money => {
  assertSameCurrency(left, right);
  return createMoney(left.minorUnits - right.minorUnits, left.currency, left.scale);
};

export const assertSameCurrency = (left: Money, right: Money): void => {
  if (left.currency !== right.currency || left.scale !== right.scale) {
    throw new Error("Money operations require the same currency and pinned scale");
  }
};

const rationalFromDecimal = (
  value: string,
): { readonly numerator: bigint; readonly denominator: bigint } => {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (match === null) throw new Error("Exact decimal factors must use a plain decimal string");
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2]!;
  const fraction = match[3] ?? "";
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = sign * (BigInt(`${whole}${fraction}`) || 0n);
  return { numerator, denominator };
};

const roundHalfUp = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new Error("Rounding denominator must be positive");
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let rounded = absolute / denominator;
  if ((absolute % denominator) * 2n >= denominator) rounded += 1n;
  return negative ? -rounded : rounded;
};

export const roundingPolicyFor = (policyId: string) => {
  const policy = ROUNDING_POLICY_REGISTRY[policyId as RoundingPolicyId];
  if (policy === undefined) throw new Error(`Unknown required rounding policy: ${policyId}`);
  return policy;
};

export const multiplyMoney = (money: Money, exactFactor: string, policyId: string): Money => {
  const policy = roundingPolicyFor(policyId);
  if (policy.mode !== "HALF_UP") throw new Error("Unsupported commercial rounding mode");
  const rational = rationalFromDecimal(exactFactor);
  return createMoney(
    roundHalfUp(money.minorUnits * rational.numerator, rational.denominator),
    money.currency,
    money.scale,
  );
};

export const moneyToJson = (money: Money): MoneyJson => ({
  minorUnits: money.minorUnits.toString(),
  currency: money.currency,
  scale: money.scale,
});

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string")) {
    return false;
  }
  const descriptors = ownKeys.map((key) => Object.getOwnPropertyDescriptor(value, key));
  if (
    descriptors.some(
      (descriptor) =>
        descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value"),
    )
  ) {
    return false;
  }
  return (ownKeys as string[]).toSorted().join("\u0000") === [...keys].toSorted().join("\u0000");
};

export const moneyFromJson = (value: unknown): Money => {
  if (typeof value !== "object" || value === null) throw new Error("Money JSON must be an object");
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, ["currency", "minorUnits", "scale"])) {
    throw new Error("Money JSON contains an unknown or missing field");
  }
  if (
    typeof record.minorUnits !== "string" ||
    typeof record.currency !== "string" ||
    typeof record.scale !== "number" ||
    !Number.isInteger(record.scale)
  ) {
    throw new Error("Money JSON has invalid primitive types");
  }
  return createMoney(record.minorUnits, record.currency, record.scale);
};

export const moneyEquals = (left: Money, right: Money): boolean =>
  left.currency === right.currency &&
  left.scale === right.scale &&
  left.minorUnits === right.minorUnits;
