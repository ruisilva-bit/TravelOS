import { createMoney, moneyFromJson, type Money } from "../../../shared-kernel/money/money.js";
import type { OpaqueId } from "../../../shared-kernel/opaque-id.js";

export const INTERNAL_ONLY_FIELD_CLASSIFICATION = "INTERNAL_ONLY" as const;

export interface SupplierCostLine {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly tripId: OpaqueId;
  readonly reservationId: OpaqueId;
  readonly amount: Money;
  readonly internalNote: string;
  readonly classification: typeof INTERNAL_ONLY_FIELD_CLASSIFICATION;
  readonly lockVersion: bigint;
}

export interface SupplierCostDraft {
  readonly amount: Money;
  readonly internalNote: string;
}

const normalizeMoneyBoundary = (value: unknown): Money => {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const minorUnitsDescriptor = Object.getOwnPropertyDescriptor(record, "minorUnits");
    if (
      minorUnitsDescriptor !== undefined &&
      Object.hasOwn(minorUnitsDescriptor, "value") &&
      typeof minorUnitsDescriptor.value === "bigint"
    ) {
      const prototype = Object.getPrototypeOf(record);
      const keys = Reflect.ownKeys(record);
      const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(record, key));
      if (
        (prototype !== Object.prototype && prototype !== null) ||
        keys.length !== 3 ||
        keys.some((key) => typeof key !== "string") ||
        descriptors.some(
          (descriptor) =>
            descriptor === undefined ||
            !descriptor.enumerable ||
            !Object.hasOwn(descriptor, "value"),
        ) ||
        (keys as string[]).toSorted().join("\u0000") !== "currency\u0000minorUnits\u0000scale"
      ) {
        throw new Error("Money contains an unknown or missing field");
      }
      if (typeof record.currency !== "string" || typeof record.scale !== "number") {
        throw new Error("Money has invalid primitive types");
      }
      return createMoney(minorUnitsDescriptor.value, record.currency, record.scale);
    }
  }
  return moneyFromJson(value);
};

export const validateSupplierCostDraft = (draft: SupplierCostDraft): SupplierCostDraft => {
  const amount = normalizeMoneyBoundary(draft.amount);
  if (draft.internalNote.trim().length === 0)
    throw new Error("Internal supplier-cost note is required");
  return { ...draft, amount };
};
