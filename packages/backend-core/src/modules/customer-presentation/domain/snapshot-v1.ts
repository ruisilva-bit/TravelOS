export type ScheduledTimeV1 = {
  readonly localDate: string;
  readonly localTime: string;
  readonly timeZone: string;
  readonly instant: string;
};

export type TripSnapshotV1 = {
  readonly schemaVersion: 1;
  readonly trip: { readonly title: string; readonly startDate: string; readonly endDate: string };
  readonly items: readonly (FlightSnapshotV1 | AccommodationSnapshotV1)[];
};

export type FlightSnapshotV1 = {
  readonly kind: "FLIGHT";
  readonly title: string;
  readonly description: string | null;
  readonly carrier: string;
  readonly flightNumber: string;
  readonly departureAirport: string;
  readonly arrivalAirport: string;
  readonly departure: ScheduledTimeV1;
  readonly arrival: ScheduledTimeV1;
  readonly terminal: string | null;
  readonly cabin: string | null;
  readonly baggage: string | null;
  readonly seat: string | null;
  readonly customerBookingReference: string | null;
};

export type AccommodationSnapshotV1 = {
  readonly kind: "ACCOMMODATION";
  readonly title: string;
  readonly description: string | null;
  readonly propertyName: string;
  readonly checkIn: ScheduledTimeV1;
  readonly checkOut: ScheduledTimeV1;
  readonly roomDescription: string | null;
  readonly boardType: string | null;
  readonly customerBookingReference: string | null;
};

export type ConfigurablePublicationField =
  | "flight.description"
  | "flight.terminal"
  | "flight.cabin"
  | "flight.baggage"
  | "flight.seat"
  | "flight.customerBookingReference"
  | "accommodation.description"
  | "accommodation.roomDescription"
  | "accommodation.boardType"
  | "accommodation.customerBookingReference";

export type VisibilityChoice = "INHERIT" | "SHOW" | "HIDE";
export type PublicationFieldClassification = "ALWAYS_CUSTOMER" | "CONFIGURABLE" | "INTERNAL_ONLY";

export interface PublicationFieldVisibility {
  readonly classification: PublicationFieldClassification;
  readonly platformDefault: boolean;
  readonly agencyDefault: VisibilityChoice;
  readonly itemOverride: VisibilityChoice;
}

export interface PublicationVisibilityPolicy {
  readonly fieldsByItemSourceId: Readonly<
    Record<
      string,
      Readonly<Partial<Record<ConfigurablePublicationField, PublicationFieldVisibility>>>
    >
  >;
}

export interface PublicationSafeTripSource {
  readonly title: string;
  readonly startDate: string;
  readonly endDate: string;
}

export interface PublicationSafeFlightSource {
  /** Internal ordering key; never copied to the customer snapshot. */
  readonly sourceId: string;
  readonly sortOrder: number;
  readonly title: string;
  readonly description: string;
  readonly carrier: string;
  readonly flightNumber: string;
  readonly departureAirport: string;
  readonly arrivalAirport: string;
  readonly departure: ScheduledTimeV1;
  readonly arrival: ScheduledTimeV1;
  readonly terminal: string | null;
  readonly cabin: string | null;
  readonly baggage: string | null;
  readonly seat: string | null;
  readonly customerBookingReference: string | null;
}

export interface PublicationSafeAccommodationSource {
  /** Internal ordering key; never copied to the customer snapshot. */
  readonly sourceId: string;
  readonly sortOrder: number;
  readonly title: string;
  readonly description: string;
  readonly propertyName: string;
  readonly checkIn: ScheduledTimeV1;
  readonly checkOut: ScheduledTimeV1;
  readonly roomDescription: string | null;
  readonly boardType: string | null;
  readonly customerBookingReference: string | null;
}

export interface PublicationSafeTripInput {
  readonly trip: PublicationSafeTripSource;
  readonly flights: readonly PublicationSafeFlightSource[];
  readonly accommodations: readonly PublicationSafeAccommodationSource[];
  readonly visibility: PublicationVisibilityPolicy;
}

const selectedVisibility = (choice: VisibilityChoice, inherited: boolean): boolean =>
  choice === "SHOW" ? true : choice === "HIDE" ? false : inherited;

export const resolvePublicationFieldVisibility = ({
  classification,
  platformDefault,
  agencyDefault,
  itemOverride,
}: PublicationFieldVisibility): boolean => {
  if (classification === "INTERNAL_ONLY") return false;
  if (classification === "ALWAYS_CUSTOMER") return true;
  return selectedVisibility(itemOverride, selectedVisibility(agencyDefault, platformDefault));
};

const canShow = (
  sourceId: string,
  field: ConfigurablePublicationField,
  policy: PublicationVisibilityPolicy,
): boolean => {
  const configuration = policy.fieldsByItemSourceId[sourceId]?.[field];
  if (configuration === undefined) return false;
  return resolvePublicationFieldVisibility(configuration);
};

const visibleValue = <Value>(
  sourceId: string,
  field: ConfigurablePublicationField,
  value: Value,
  policy: PublicationVisibilityPolicy,
): Value | null => (canShow(sourceId, field, policy) ? value : null);

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareItems = (
  left: { readonly sortOrder: number; readonly sourceId: string; readonly kind: string },
  right: { readonly sortOrder: number; readonly sourceId: string; readonly kind: string },
): number =>
  left.sortOrder - right.sortOrder ||
  compareCodeUnits(left.sourceId, right.sourceId) ||
  compareCodeUnits(left.kind, right.kind);

/** Pure allowlist assembler. It accepts only publication-safe source fields and explicit policy. */
export const assembleTripSnapshotV1 = (input: PublicationSafeTripInput): TripSnapshotV1 => {
  const ordered = [
    ...input.flights.map((source) => ({
      source,
      kind: "FLIGHT" as const,
      sortOrder: source.sortOrder,
      sourceId: source.sourceId,
    })),
    ...input.accommodations.map((source) => ({
      source,
      kind: "ACCOMMODATION" as const,
      sortOrder: source.sortOrder,
      sourceId: source.sourceId,
    })),
  ].toSorted(compareItems);
  return {
    schemaVersion: 1,
    trip: {
      title: input.trip.title,
      startDate: input.trip.startDate,
      endDate: input.trip.endDate,
    },
    items: ordered.map((entry) => {
      if (entry.kind === "FLIGHT") {
        const flight = entry.source as PublicationSafeFlightSource;
        return {
          kind: "FLIGHT" as const,
          title: flight.title,
          description: visibleValue(
            flight.sourceId,
            "flight.description",
            flight.description,
            input.visibility,
          ),
          carrier: flight.carrier,
          flightNumber: flight.flightNumber,
          departureAirport: flight.departureAirport,
          arrivalAirport: flight.arrivalAirport,
          departure: {
            localDate: flight.departure.localDate,
            localTime: flight.departure.localTime,
            timeZone: flight.departure.timeZone,
            instant: flight.departure.instant,
          },
          arrival: {
            localDate: flight.arrival.localDate,
            localTime: flight.arrival.localTime,
            timeZone: flight.arrival.timeZone,
            instant: flight.arrival.instant,
          },
          terminal: visibleValue(
            flight.sourceId,
            "flight.terminal",
            flight.terminal,
            input.visibility,
          ),
          cabin: visibleValue(flight.sourceId, "flight.cabin", flight.cabin, input.visibility),
          baggage: visibleValue(
            flight.sourceId,
            "flight.baggage",
            flight.baggage,
            input.visibility,
          ),
          seat: visibleValue(flight.sourceId, "flight.seat", flight.seat, input.visibility),
          customerBookingReference: visibleValue(
            flight.sourceId,
            "flight.customerBookingReference",
            flight.customerBookingReference,
            input.visibility,
          ),
        };
      }
      const accommodation = entry.source as PublicationSafeAccommodationSource;
      return {
        kind: "ACCOMMODATION" as const,
        title: accommodation.title,
        description: visibleValue(
          accommodation.sourceId,
          "accommodation.description",
          accommodation.description,
          input.visibility,
        ),
        propertyName: accommodation.propertyName,
        checkIn: {
          localDate: accommodation.checkIn.localDate,
          localTime: accommodation.checkIn.localTime,
          timeZone: accommodation.checkIn.timeZone,
          instant: accommodation.checkIn.instant,
        },
        checkOut: {
          localDate: accommodation.checkOut.localDate,
          localTime: accommodation.checkOut.localTime,
          timeZone: accommodation.checkOut.timeZone,
          instant: accommodation.checkOut.instant,
        },
        roomDescription: visibleValue(
          accommodation.sourceId,
          "accommodation.roomDescription",
          accommodation.roomDescription,
          input.visibility,
        ),
        boardType: visibleValue(
          accommodation.sourceId,
          "accommodation.boardType",
          accommodation.boardType,
          input.visibility,
        ),
        customerBookingReference: visibleValue(
          accommodation.sourceId,
          "accommodation.customerBookingReference",
          accommodation.customerBookingReference,
          input.visibility,
        ),
      };
    }),
  };
};
