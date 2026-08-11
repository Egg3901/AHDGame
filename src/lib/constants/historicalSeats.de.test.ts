/**
 * Tests for Germany historical seat data and NPP seeding integration.
 */
import { describe, it, expect } from "vitest";
import {
  DE_BUNDESTAG_2021,
  DE_MINISTERPRAESIDENTEN_2020,
  getPresetSeats,
  getHistoricalSeats,
} from "@/lib/constants/historicalSeats";

describe("DE Historical Seats", () => {
  it("DE_BUNDESTAG_2021 has seats for all 16 Länder", () => {
    const regions = new Set(DE_BUNDESTAG_2021.map((s) => s.state));
    expect(regions.size).toBe(16);
    const expected = [
      "BW",
      "BY",
      "BE",
      "BB",
      "BRE",
      "HH",
      "HE",
      "MV",
      "NI",
      "NW",
      "RP",
      "SL",
      "SN",
      "ST",
      "SH",
      "TH",
    ];
    for (const r of expected) {
      expect(regions.has(r)).toBe(true);
    }
  });

  it("Bundestag seat totals match 201 NPP-held seats", () => {
    const total = DE_BUNDESTAG_2021.reduce((sum, s) => sum + (s.seatsHeld ?? 0), 0);
    expect(total).toBe(201);
  });

  it("all 7 parties are represented in Bundestag", () => {
    const parties = new Set(DE_BUNDESTAG_2021.map((s) => s.party));
    expect(parties.size).toBe(7);
    expect(parties.has("de_spd")).toBe(true);
    expect(parties.has("de_cdu")).toBe(true);
    expect(parties.has("de_csu")).toBe(true);
    expect(parties.has("de_greens")).toBe(true);
    expect(parties.has("de_fdp")).toBe(true);
    expect(parties.has("de_linke")).toBe(true);
    expect(parties.has("de_afd")).toBe(true);
  });

  it("SPD has the most Bundestag seats", () => {
    const partyTotals: Record<string, number> = {};
    for (const s of DE_BUNDESTAG_2021) {
      partyTotals[s.party] = (partyTotals[s.party] ?? 0) + (s.seatsHeld ?? 0);
    }
    const sorted = Object.entries(partyTotals).sort((a, b) => b[1] - a[1]);
    expect(sorted[0]?.[0]).toBe("de_spd");
  });

  it("DE_MINISTERPRAESIDENTEN_2020 has 16 entries", () => {
    expect(DE_MINISTERPRAESIDENTEN_2020.length).toBe(16);
  });

  it("all Ministerpräsidenten are single-seat offices", () => {
    for (const mp of DE_MINISTERPRAESIDENTEN_2020) {
      expect(mp.officeType).toBe("ministerPresident");
      expect(mp.seatsHeld).toBeUndefined();
    }
  });

  it("getPresetSeats 2020-default includes DE", () => {
    const seats = getPresetSeats("2020-default");
    const deSeats = seats.filter((s) =>
      [
        "BW",
        "BY",
        "BE",
        "BB",
        "BRE",
        "HH",
        "HE",
        "MV",
        "NI",
        "NW",
        "RP",
        "SL",
        "SN",
        "ST",
        "SH",
        "TH",
      ].includes(s.state)
    );
    expect(deSeats.length).toBeGreaterThan(0);
    expect(deSeats.some((s) => s.officeType === "bundestag")).toBe(true);
    expect(deSeats.some((s) => s.officeType === "ministerPresident")).toBe(true);
  });

  it("getHistoricalSeats returns DE data", () => {
    const seats = getHistoricalSeats("DE");
    expect(seats.length).toBe(DE_BUNDESTAG_2021.length + DE_MINISTERPRAESIDENTEN_2020.length);
    expect(seats.some((s) => s.officeType === "bundestag")).toBe(true);
    expect(seats.some((s) => s.officeType === "ministerPresident")).toBe(true);
  });
});
