import { describe, expect, it } from "vitest";
import { seedRosterUpkeepFor, seededRosterUpkeepTable } from "./seedRosterUpkeep";
import { upkeepPerTurn, SEED_UPKEEP_TARGET_SHARE } from "./appropriation";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getBranches } from "@/lib/constants/military";
import { SEED_PRESET_IDS, getStartingYearForPreset } from "@/lib/constants/turnTime";
import { buildCountryRoster } from "@/lib/admin/seed/seedMilitaryUnits";
import { eraForPreset } from "@/lib/seeds/presetSelector";

// The invariant that makes a missing measurement loud instead of silently free.
describe("seed roster upkeep coverage", () => {
  it("resolves a positive figure for every (preset, country) that seeds units", () => {
    const missing: string[] = [];
    for (const preset of SEED_PRESET_IDS) {
      const startingYear = getStartingYearForPreset(preset);
      const era = eraForPreset(preset);
      for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
        if (getBranches(countryId, startingYear).length === 0) continue;
        if (buildCountryRoster(countryId, ["r"], 1, era, startingYear).length === 0) continue;
        // A zero here means upkeepPerTurn charges nothing and that nation's whole army
        // is free for the rest of the game.
        if (!(seedRosterUpkeepFor(preset, countryId) > 0)) missing.push(`${preset}:${countryId}`);
      }
    }
    expect(missing).toEqual([]);
  });

  // The gap that shipped a free army in the first dry run: DD/DE/AT/NG seed nothing in
  // 1953 (their forces post-date it) but can still ACQUIRE units on a 1953 world, and an
  // earlier-only fallback resolved them to 0 — i.e. upkeep-free forever.
  it("resolves in EVERY preset for any country that seeds units in ANY preset", () => {
    const table = seededRosterUpkeepTable();
    const everSeeds = new Set(SEED_PRESET_IDS.flatMap((p) => Object.keys(table[p])));
    const holes: string[] = [];
    for (const preset of SEED_PRESET_IDS) {
      for (const countryId of everSeeds) {
        if (!(seedRosterUpkeepFor(preset, countryId) > 0)) holes.push(`${preset}:${countryId}`);
      }
    }
    expect(holes).toEqual([]);
  });

  it("falls forward to a later preset when no earlier one measured the country", () => {
    // DD has no 1953 roster (the NVA is founded in 1956) but does from 1979.
    expect(seededRosterUpkeepTable()["1953-default"].DD).toBeUndefined();
    expect(seedRosterUpkeepFor("1953-default", "DD")).toBeGreaterThan(0);
  });

  it("covers every preset", () => {
    const table = seededRosterUpkeepTable();
    for (const preset of SEED_PRESET_IDS) {
      expect(Object.keys(table[preset]).length).toBeGreaterThan(0);
    }
  });

  it("returns 0 for a country that seeds no units in any preset", () => {
    expect(seedRosterUpkeepFor(SEED_PRESET_IDS[0], "ZZ")).toBe(0);
  });

  it("falls back to a known preset for an unrecognised preset id", () => {
    // Variant ids like "2019-no-parties" must not field a free army.
    expect(seedRosterUpkeepFor("2019-no-parties", "US")).toBeGreaterThan(0);
  });

  it("is memoised — repeated asks return the identical figure", () => {
    expect(seedRosterUpkeepFor("1953-default", "US")).toBe(
      seedRosterUpkeepFor("1953-default", "US")
    );
  });
});

// Spec §10 invariant 1. True by construction — at seed the live roster IS the measured
// figure, so the ratio is 1 — but this is the guard that fires if the target share is
// ever raised past 1, or if the two sides stop coming from the same source.
describe("no seeded country starts in arrears", () => {
  it("charges every seeded roster strictly less than one turn's accrual", () => {
    const offenders: string[] = [];
    for (const preset of SEED_PRESET_IDS) {
      for (const [countryId, seeded] of Object.entries(seededRosterUpkeepTable()[preset])) {
        // Any positive line works: the ratio is scale-free, and 48 makes accrual 1.
        const upkeep = upkeepPerTurn(seeded, seedRosterUpkeepFor(preset, countryId), 48);
        if (upkeep >= 1) offenders.push(`${preset}:${countryId} -> ${upkeep}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("charges exactly the target share at the seeded roster", () => {
    const us = seedRosterUpkeepFor("1953-default", "US");
    expect(upkeepPerTurn(us, us, 48)).toBeCloseTo(SEED_UPKEEP_TARGET_SHARE, 9);
  });
});
