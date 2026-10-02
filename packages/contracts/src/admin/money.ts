import { z } from "zod";

const INTEGER_TEXT = /^(?:0|[1-9]\d*|-[1-9]\d*)(?![\s\S])/u;
const UUID_V7_TEXT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/u;
const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = 2n ** 63n - 1n;

export const AdminOpaqueIdSchema = z
  .string()
  .length(36)
  .regex(UUID_V7_TEXT, "Expected canonical lowercase UUIDv7");
export const AdminMoneySchema = z
  .object({
    minorUnits: z.string().regex(INTEGER_TEXT, "Money minorUnits must be an integer string"),
    currency: z.enum(["EUR", "USD", "GBP", "JPY"]),
    scale: z.number().int().min(0).max(4),
  })
  .strict()
  .superRefine((value, context) => {
    if (!INTEGER_TEXT.test(value.minorUnits)) return;
    const minorUnits = BigInt(value.minorUnits);
    if (minorUnits < MIN_INT64 || minorUnits > MAX_INT64) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minorUnits"],
        message: "Money minorUnits must fit PostgreSQL signed bigint",
      });
    }
    const expectedScale = value.currency === "JPY" ? 0 : 2;
    if (value.scale !== expectedScale) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scale"],
        message: `Currency ${value.currency} requires pinned scale ${expectedScale}`,
      });
    }
  });

export type AdminMoney = z.infer<typeof AdminMoneySchema>;

export const AdminInternalOnlyClassificationSchema = z.literal("INTERNAL_ONLY");
