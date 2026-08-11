import { describe, it, expect } from "vitest";
import {
  MODERN_MIN_UNOWNED_SECTOR_REVENUE,
  SECTOR_SEED_ERA_FLOORS,
  US_NATIONAL_SEED_GDP_BY_ERA,
  getEraNominalScale,
  getMinUnownedSectorRevenue,
  getSectorSeedScale,
} from "./sectorSeedEra";
import { SECTOR_SEED_SCALE } from "./corporations";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";

/**
 * Presets that MUST resolve the unmodified modern constants. Includes the two
 * 2019 aliases, an unknown string, and (separately) the no-argument call — the
 * seeder's own default parameter path.
 */
const UNCHANGED_PRESETS = [
  "1979-default",
  "1991-default",
  "1999-default",
  "2007-default",
  "2019-default",
  "2023-default",
  "empty",
  "2019-no-parties",
  "some-preset-that-does-not-exist",
];

describe("sector seed era calibration", () => {
  it("deflates the unowned-sector floor for 1953 only", () => {
    expect(getMinUnownedSectorRevenue("1953-default")).toBe(SECTOR_SEED_ERA_FLOORS["1953"]);
    expect(getMinUnownedSectorRevenue("1953-default")).toBeLessThan(
      MODERN_MIN_UNOWNED_SECTOR_REVENUE
    );
  });

  it("is a no-op for every other preset, and with no preset at all", () => {
    for (const preset of UNCHANGED_PRESETS) {
      expect(getMinUnownedSectorRevenue(preset)).toBe(MODERN_MIN_UNOWNED_SECTOR_REVENUE);
      expect(getSectorSeedScale(preset)).toBe(SECTOR_SEED_SCALE);
    }
    expect(getMinUnownedSectorRevenue()).toBe(MODERN_MIN_UNOWNED_SECTOR_REVENUE);
    expect(getSectorSeedScale()).toBe(SECTOR_SEED_SCALE);
  });

  it("leaves the seed scale era-neutral (it is a GDP multiple)", () => {
    expect(getSectorSeedScale("1953-default")).toBe(SECTOR_SEED_SCALE);
  });

  it("keeps the 1953 floor proportional to the era's nominal economy", () => {
    // The floor is an absolute ₳ amount calibrated on 2019 magnitudes, so it is
    // deflated by the eras' nominal-money ratio (same reasoning as
    // getGdpIndexedCostScale's pre-1991 branch in budget/costs.ts).
    const derived =
      MODERN_MIN_UNOWNED_SECTOR_REVENUE *
      (US_NATIONAL_SEED_GDP_BY_ERA["1953"]! / US_NATIONAL_SEED_GDP_BY_ERA["2019"]!);
    const authored = SECTOR_SEED_ERA_FLOORS["1953"]!;
    expect(authored / derived).toBeGreaterThan(0.8);
    expect(authored / derived).toBeLessThan(1.2);
  });

  it("keeps US_NATIONAL_SEED_GDP_BY_ERA in sync with the national budget seeds", () => {
    for (const [era, expected] of Object.entries(US_NATIONAL_SEED_GDP_BY_ERA)) {
      const config = getNationalBudgetSeedConfigsForPreset(`${era}-default`).find(
        (c) => c.countryId === "US"
      );
      expect(config?.gdp).toBe(expected);
    }
  });
});

describe("getEraNominalScale", () => {
  it("returns exactly 1 for every era without a nominal-GDP entry, and no preset", () => {
    for (const preset of UNCHANGED_PRESETS) {
      expect(getEraNominalScale(preset), preset).toBe(1);
    }
    expect(getEraNominalScale()).toBe(1);
    expect(getEraNominalScale("2019-default")).toBe(1);
  });

  it("deflates 1953 by the US nominal-GDP ratio the floor is derived from", () => {
    const expected = US_NATIONAL_SEED_GDP_BY_ERA["1953"]! / US_NATIONAL_SEED_GDP_BY_ERA["2019"]!;
    expect(getEraNominalScale("1953-default")).toBe(expected);
    // ~1/70th of modern nominal money — the same order the floor was cut by.
    expect(getEraNominalScale("1953-default")).toBeGreaterThan(0.01);
    expect(getEraNominalScale("1953-default")).toBeLessThan(0.02);
  });

  it("scales the NPP default founding book to roughly the 1953 sector floor", () => {
    // The modern default is ₳2,000,000 against a ₳1,000,000 unowned floor — 2x.
    // The deflated 1953 default must keep that ratio against the 1953 floor
    // instead of handing a fresh corp ~70 whole regional sector markets.
    const modernRatio = 2_000_000 / MODERN_MIN_UNOWNED_SECTOR_REVENUE;
    const eraRatio =
      (2_000_000 * getEraNominalScale("1953-default")) / getMinUnownedSectorRevenue("1953-default");
    expect(eraRatio).toBeGreaterThan(modernRatio * 0.8);
    expect(eraRatio).toBeLessThan(modernRatio * 1.2);
  });
});
