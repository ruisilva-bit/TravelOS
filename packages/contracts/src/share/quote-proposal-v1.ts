import { z } from "zod";

const INTEGER_TEXT = /^(?:0|[1-9]\d*)$/u;
const ISO_DATE = z.iso.date();
const TIME_TEXT = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const IATA = z.string().regex(/^[A-Z]{3}$/u);
const HTTPS_URL = z.string().max(1000).startsWith("https://");

/** Customer money: non-negative integer minor units as a string, never a float. */
const CustomerMoneyV1Schema = z
  .object({
    minorUnits: z
      .string()
      .regex(INTEGER_TEXT, "Money minorUnits must be a non-negative integer string"),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    scale: z.number().int().min(0).max(4),
  })
  .strict();

const FlightV1Schema = z
  .object({
    direction: z.enum(["OUTBOUND", "RETURN", "OTHER"]),
    date: ISO_DATE.nullable(),
    departTime: TIME_TEXT.nullable(),
    arriveTime: TIME_TEXT.nullable(),
    fromIata: IATA.nullable(),
    toIata: IATA.nullable(),
    carrier: z.string().max(80).nullable(),
    flightNumber: z.string().max(12).nullable(),
    baggage: z.string().max(120).nullable(),
  })
  .strict();

const AccommodationV1Schema = z
  .object({
    service: z.string().min(1).max(200),
    location: z.string().max(200).nullable(),
    roomType: z.string().max(120).nullable(),
    boardBasis: z.string().max(80).nullable(),
    startDate: ISO_DATE.nullable(),
    endDate: ISO_DATE.nullable(),
    nights: z.number().int().min(0).nullable(),
    imageUrl: HTTPS_URL.nullable(),
    description: z.string().max(2000).nullable(),
  })
  .strict();

const OtherServiceV1Schema = z
  .object({
    category: z.string().min(1).max(40),
    service: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    startDate: ISO_DATE.nullable(),
    imageUrl: HTTPS_URL.nullable(),
  })
  .strict();

const DayV1Schema = z
  .object({
    dayIndex: z.number().int().min(0),
    date: ISO_DATE,
    title: z.string().min(1).max(120),
    description: z.string().max(2000).nullable(),
  })
  .strict();

const OptionV1Schema = z
  .object({
    service: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    pvp: CustomerMoneyV1Schema,
  })
  .strict();

const IncludedGroupV1Schema = z
  .object({
    label: z.string().min(1).max(60),
    items: z.array(z.string().min(1).max(200)).max(200),
  })
  .strict();

/**
 * Customer-facing quote proposal, frozen with each sent version. Strict: unknown keys are rejected,
 * so supplier, net cost, recommended price, margins, internal notes and staff identities cannot be
 * smuggled in. Built by backend-core quote-proposal.ts; this schema is the independent check.
 */
export const QuoteProposalV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    agency: z
      .object({
        displayName: z.string().min(1).max(200),
        email: z.email().max(254).optional(),
        phone: z.string().min(1).max(40).optional(),
        website: HTTPS_URL.optional(),
      })
      .strict(),
    quote: z
      .object({
        number: z.string().regex(/^ORC-[0-9]{4}-[0-9]{4,}$/u),
        title: z.string().min(1).max(200),
        destination: z.string().max(200).nullable(),
        intro: z.string().max(2000).nullable(),
        heroImageUrl: HTTPS_URL.nullable(),
        startDate: ISO_DATE.nullable(),
        endDate: ISO_DATE.nullable(),
        nights: z.number().int().min(0).nullable(),
        adults: z.number().int().min(1).max(50),
        children: z.number().int().min(0).max(50),
        currency: z.string().regex(/^[A-Z]{3}$/u),
        validUntil: ISO_DATE,
      })
      .strict(),
    totals: z
      .object({
        pvpFinal: CustomerMoneyV1Schema,
        perPerson: CustomerMoneyV1Schema,
        deposit: CustomerMoneyV1Schema,
        balance: CustomerMoneyV1Schema,
        balanceDueDate: ISO_DATE.nullable(),
      })
      .strict(),
    flights: z.array(FlightV1Schema).max(50),
    accommodations: z.array(AccommodationV1Schema).max(50),
    otherServices: z.array(OtherServiceV1Schema).max(200),
    days: z.array(DayV1Schema).max(400),
    options: z.array(OptionV1Schema).max(100),
    included: z.array(IncludedGroupV1Schema).max(20),
    excluded: z.array(z.string().min(1).max(200)).max(50),
  })
  .strict()
  .superRefine((proposal, context) => {
    const { startDate, endDate } = proposal.quote;
    if (startDate !== null && endDate !== null && endDate < startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quote", "endDate"],
        message: "Quote end date must not precede its start date",
      });
    }
  });

export type QuoteProposalV1 = z.infer<typeof QuoteProposalV1Schema>;
