import { describe, expect, it } from "vitest";
import type { TripSnapshotV1 } from "@travelos/backend-core";

import { escapeHtml, renderSharePage } from "../src/share-page-renderer.js";

const time = (localDate: string, localTime: string) => ({
  localDate,
  localTime,
  timeZone: "Europe/Lisbon",
  instant: `${localDate}T${localTime}:00Z`,
});

export const sampleSnapshot = (title = "Portugal"): TripSnapshotV1 => ({
  schemaVersion: 1,
  trip: { title, startDate: "2026-10-12", endDate: "2026-10-15" },
  items: [
    {
      kind: "FLIGHT",
      title: "Voo de ida",
      description: null,
      carrier: "Example Air",
      flightNumber: "EA100",
      departureAirport: "LIS",
      arrivalAirport: "OPO",
      departure: time("2026-10-12", "09:00"),
      arrival: time("2026-10-12", "10:00"),
      terminal: null,
      cabin: "ECONOMY",
      baggage: null,
      seat: null,
      customerBookingReference: "REF1",
    },
    {
      kind: "ACCOMMODATION",
      title: "Hotel",
      description: "Perto do rio",
      propertyName: "Example Hotel",
      checkIn: time("2026-10-12", "15:00"),
      checkOut: time("2026-10-15", "11:00"),
      roomDescription: null,
      boardType: null,
      customerBookingReference: null,
    },
  ],
});

describe("renderSharePage", () => {
  it("renders a script-free Portuguese page with local times and labels", () => {
    const html = renderSharePage(sampleSnapshot());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('lang="pt-PT"');
    expect(html).toContain('name="viewport"');
    for (const label of ["Viagem", "Datas", "Voo", "Alojamento", "Partida", "Chegada"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("12/10/2026 09:00 (Europe/Lisbon)");
    expect(html).not.toMatch(/<script|<link|<img|<iframe|src=|href=|javascript:/iu);
    expect(html.match(/<style>/gu)).toHaveLength(1);
  });

  it("escapes every interpolated value", () => {
    const evil = `<script>alert(1)</script>"'&`;
    const snapshot = sampleSnapshot(evil);
    const flight = snapshot.items[0];
    const items =
      flight?.kind === "FLIGHT"
        ? [
            { ...flight, title: evil, carrier: evil, customerBookingReference: evil },
            ...snapshot.items.slice(1),
          ]
        : snapshot.items;
    const html = renderSharePage({ ...snapshot, items });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;");
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
