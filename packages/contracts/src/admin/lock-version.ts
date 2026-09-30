import { z } from "zod";

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export const AdminLockVersionSchema = z
  .string()
  .max(19)
  .regex(/^(?:0|[1-9]\d*)$/u)
  .refine(
    (value) => BigInt(value) <= POSTGRES_BIGINT_MAX,
    "Lock version exceeds PostgreSQL bigint range",
  );
