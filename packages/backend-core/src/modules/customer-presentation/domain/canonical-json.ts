const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const canonicalValue = (value: unknown, ancestors: Set<object>): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError("Canonical JSON accepts only JSON-compatible values");
  }
  if (ancestors.has(value)) throw new TypeError("Canonical JSON cannot contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalValue(entry, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only plain objects");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new TypeError("Canonical JSON cannot contain symbol keys");
    }
    const keys = (ownKeys as string[]).toSorted(compareCodeUnits);
    const fields = keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) {
        throw new TypeError("Canonical JSON accepts only enumerable data properties");
      }
      return `${JSON.stringify(key)}:${canonicalValue(descriptor.value, ancestors)}`;
    });
    return `{${fields.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
};

/** Canonical JSON: UTF-8 encoding of this key-sorted, compact JSON text. */
export const canonicalPortalTripSnapshotV1Json = (snapshot: unknown): string =>
  canonicalValue(snapshot, new Set<object>());
