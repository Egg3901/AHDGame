import { describe, expect, it } from "vitest";
import {
  isPreHKHandover,
  COUNTRY_MAP_CONFIGS,
  isParliamentaryMapCountry,
} from "./countryMapConfigs";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

// Turn 1 of a game corresponds to month 1 of `startingYear`. Each year holds
// TURNS_PER_YEAR turns; 4 turns per game month.
function turnForGameDate(startingYear: number, year: number, month: number): number {
  return (year - startingYear) * TURNS_PER_YEAR + (month - 1) * 4 + 1;
}

describe("isPreHKHandover", () => {
  it("returns false when game time is missing", () => {
    expect(isPreHKHandover(undefined)).toBe(false);
    expect(isPreHKHandover({})).toBe(false);
    expect(isPreHKHandover({ currentTurn: 1 })).toBe(false);
    expect(isPreHKHandover({ startingYear: 1991 })).toBe(false);
  });

  it("returns true throughout a 1991 game in years before 1997", () => {
    for (const year of [1991, 1993, 1995, 1996]) {
      const turn = turnForGameDate(1991, year, 1);
      expect(isPreHKHandover({ currentTurn: turn, startingYear: 1991 })).toBe(true);
    }
  });

  it("returns true for January through June 1997 in a 1991 game", () => {
    for (const month of [1, 2, 3, 4, 5, 6]) {
      const turn = turnForGameDate(1991, 1997, month);
      expect(isPreHKHandover({ currentTurn: turn, startingYear: 1991 })).toBe(true);
    }
  });

  it("returns false starting July 1997 in a 1991 game", () => {
    for (const month of [7, 8, 9, 10, 11, 12]) {
      const turn = turnForGameDate(1991, 1997, month);
      expect(isPreHKHandover({ currentTurn: turn, startingYear: 1991 })).toBe(false);
    }
  });

  it("returns false throughout a 1991 game in years after 1997", () => {
    for (const year of [1998, 2000, 2005]) {
      const turn = turnForGameDate(1991, year, 1);
      expect(isPreHKHandover({ currentTurn: turn, startingYear: 1991 })).toBe(false);
    }
  });

  it("returns false for the 2019 preset at turn 1", () => {
    expect(isPreHKHandover({ currentTurn: 1, startingYear: 2019 })).toBe(false);
  });
});

describe("DE map config (ownership-driven, no preset branch)", () => {
  const de = COUNTRY_MAP_CONFIGS.DE;
  const WESTERN = ["BW", "BY", "NW", "HE", "RP", "SL", "NI", "SH", "HH", "BRE", "BE"];

  it("carries all 16 Länder as fixed metadata (the live roster decides which render)", () => {
    expect(de.regions).toHaveLength(16);
    const codes = de.regions.map((r) => r.id);
    for (const c of [...WESTERN, "BB", "MV", "SN", "ST", "TH"]) {
      expect(codes).toContain(c);
    }
  });

  it("formatSubtitle sums only the shown set: West Germany's 11 reads '11 Länder'", () => {
    const western = de.regions.filter((r) => WESTERN.includes(r.id));
    expect(western).toHaveLength(11);
    expect(de.formatSubtitle?.(western)).toMatch(/^11 Länder · \d+ direct mandates$/);
  });

  it("formatSubtitle of the full set reads '16 Länder' and matches the static fallback", () => {
    expect(de.formatSubtitle?.(de.regions)).toMatch(/^16 Länder · \d+ direct mandates$/);
    // The static headerSubtitle is the full-set fallback, so it must equal the
    // live subtitle when every Land is shown.
    expect(de.formatSubtitle?.(de.regions)).toBe(de.headerSubtitle);
  });
});

describe("NG map config", () => {
  it("registers NG as a parliamentary map country", () => {
    expect(isParliamentaryMapCountry("NG")).toBe(true);
    expect(COUNTRY_MAP_CONFIGS.NG).toBeDefined();
  });

  it("exposes the JP-style mode set with English chamber labels", () => {
    const ids = COUNTRY_MAP_CONFIGS.NG!.modes.map((m) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining(["partyOrg", "house", "senate", "governor", "approval", "lean"])
    );
    const labels = COUNTRY_MAP_CONFIGS.NG!.modes.map((m) => m.label);
    expect(labels).toContain("House of Reps");
    expect(labels).toContain("Senate");
    expect(labels).not.toContain("Shugiin");
  });

  it("buildRegionData colours a zone by leading party in partyOrg mode", () => {
    const cells = COUNTRY_MAP_CONFIGS.NG!.buildRegionData({
      mode: "partyOrg",
      leanAxis: "display",
      resourceData: {},
      resourceToggle: "capacity",

      mapData: { partyOrg: { NORTH_WEST: { leadColor: "#abc", tooltip: ["APC"] } } } as any,
    });
    expect(cells.NORTH_WEST.color).toBe("#abc");
  });
});
