import { describe, expect, it } from "vitest";
import {
  DEFENSE_BOARDS_1953,
  DEFENSE_FAMILY_IDS,
  defenseBoardFor,
  getDefenseEraSubstitutions,
  resetDefenseEraSubstitutions,
} from "./defenseBoards1953";
import { FAMILY_SLUGS } from "../types";

const EXPECTED_COUNTRIES = [
  // dedicated seed dirs
  "AT",
  "BR",
  "CN",
  "DE",
  "ES",
  "FI",
  "FR",
  "GR",
  "IE",
  "IT",
  "JP",
  "NG",
  "SE",
  "TR",
  // eastern bloc (shared builder)
  "BG",
  "UKR",
  "BLR",
  "BAL",
  "CS",
  "HU",
  "PL",
  "RO",
  "YU",
];

describe("DEFENSE_FAMILY_IDS", () => {
  it("is exactly the 7 defense families from the catalog", () => {
    expect([...DEFENSE_FAMILY_IDS].sort()).toEqual(
      FAMILY_SLUGS.defense.map((s) => `defense.${s}`).sort()
    );
  });
});

describe("DEFENSE_BOARDS_1953", () => {
  it("covers every non-playable country", () => {
    expect(Object.keys(DEFENSE_BOARDS_1953).sort()).toEqual([...EXPECTED_COUNTRIES].sort());
  });

  it("gives each country all 7 families, finite and within 0-100", () => {
    for (const [countryId, board] of Object.entries(DEFENSE_BOARDS_1953)) {
      expect(Object.keys(board).sort(), countryId).toEqual([...DEFENSE_FAMILY_IDS].sort());
      for (const [familyId, v] of Object.entries(board)) {
        expect(Number.isFinite(v), `${countryId} ${familyId}`).toBe(true);
        expect(v, `${countryId} ${familyId}`).toBeGreaterThanOrEqual(0);
        expect(v, `${countryId} ${familyId}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("never contains playable countries — they have authored anchors already", () => {
    for (const playable of ["US", "UK", "RU", "DD"]) {
      expect(DEFENSE_BOARDS_1953[playable], playable).toBeUndefined();
    }
  });

  // ── anti-uniformity: these are what actually catch lazy authoring ──

  it("uses the full range rather than clustering at the neutral", () => {
    const all = Object.values(DEFENSE_BOARDS_1953).flatMap((b) => Object.values(b));
    expect(Math.min(...all), "nothing near the floor").toBeLessThan(15);
    expect(Math.max(...all), "nothing near the ceiling").toBeGreaterThan(75);
    const nearNeutral = all.filter((v) => v >= 45 && v <= 55).length;
    expect(nearNeutral / all.length, "over half the table is neutral filler").toBeLessThan(0.35);
  });

  it("differentiates countries — no two share an identical board", () => {
    const seen = new Map<string, string>();
    for (const [countryId, board] of Object.entries(DEFENSE_BOARDS_1953)) {
      const key = DEFENSE_FAMILY_IDS.map((f) => board[f]).join("|");
      const twin = seen.get(key);
      expect(twin, `${countryId} has the same board as ${twin}`).toBeUndefined();
      seen.set(key, countryId);
    }
  });

  it("reflects the 1953 postures the authoring rules call out", () => {
    // West Germany has no army — the Bundeswehr is founded in 1955.
    expect(DEFENSE_BOARDS_1953.DE["defense.armedForces"]).toBeLessThan(20);
    // Japan under Article 9, SDF barely forming.
    expect(DEFENSE_BOARDS_1953.JP["defense.projection"]).toBeLessThan(15);
    // Nigeria is still a British colony — no independent defense at all.
    expect(DEFENSE_BOARDS_1953.NG["defense.projection"]).toBeLessThan(10);
    // Spain is excluded from the UN until 1955 despite Western alignment.
    expect(DEFENSE_BOARDS_1953.ES["defense.institutions"]).toBeLessThan(30);
    // Sweden's armed neutrality: strong industry and forces, no projection.
    expect(DEFENSE_BOARDS_1953.SE["defense.defenseIndustry"]).toBeGreaterThan(65);
    expect(DEFENSE_BOARDS_1953.SE["defense.projection"]).toBeLessThan(25);
    // The PLA after Korea is enormous; the PRC holds no UN seat in 1953.
    expect(DEFENSE_BOARDS_1953.CN["defense.armedForces"]).toBeGreaterThan(75);
    expect(DEFENSE_BOARDS_1953.CN["defense.institutions"]).toBeLessThan(25);
    // Tito split with Stalin in 1948 — Yugoslavia must not read as a satellite.
    expect(DEFENSE_BOARDS_1953.YU["defense.diplomacy"]).toBeGreaterThan(
      DEFENSE_BOARDS_1953.BG["defense.diplomacy"]
    );
    expect(DEFENSE_BOARDS_1953.YU["defense.security"]).toBeGreaterThan(
      DEFENSE_BOARDS_1953.HU["defense.security"]
    );
  });
});

describe("defenseBoardFor", () => {
  it("returns a board for a known country and null otherwise", () => {
    expect(defenseBoardFor("JP")).toBeTruthy();
    expect(defenseBoardFor("US")).toBeNull();
    expect(defenseBoardFor("ZZ")).toBeNull();
  });

  it("records a substitution when the requested era is unauthored", () => {
    resetDefenseEraSubstitutions();
    expect(getDefenseEraSubstitutions()).toEqual([]);

    // 1953 is authored, so asking for it must NOT count as a substitution.
    expect(defenseBoardFor("JP", 1953)).toEqual(DEFENSE_BOARDS_1953.JP);
    expect(getDefenseEraSubstitutions()).toEqual([]);

    // Every other era falls back AND says so. This is the whole point: a 2019
    // board carrying occupied-Germany defense values must not look authored.
    expect(defenseBoardFor("DE", 2019)).toEqual(DEFENSE_BOARDS_1953.DE);
    expect(getDefenseEraSubstitutions()).toEqual([
      { countryId: "DE", requestedYear: 2019, usedYear: 1953 },
    ]);
  });

  it("does not record a substitution for a country that has no board at all", () => {
    resetDefenseEraSubstitutions();
    expect(defenseBoardFor("US", 2019)).toBeNull();
    expect(getDefenseEraSubstitutions()).toEqual([]);
  });

  it("omitting the year keeps the pre-era behaviour and records nothing", () => {
    resetDefenseEraSubstitutions();
    expect(defenseBoardFor("FR")).toEqual(DEFENSE_BOARDS_1953.FR);
    expect(defenseBoardFor("FR", null)).toEqual(DEFENSE_BOARDS_1953.FR);
    expect(getDefenseEraSubstitutions()).toEqual([]);
  });

  it("falls back to the earliest authored era for a year before it", () => {
    resetDefenseEraSubstitutions();
    expect(defenseBoardFor("PL", 1900)).toEqual(DEFENSE_BOARDS_1953.PL);
    expect(getDefenseEraSubstitutions()).toEqual([
      { countryId: "PL", requestedYear: 1900, usedYear: 1953 },
    ]);
  });
});
