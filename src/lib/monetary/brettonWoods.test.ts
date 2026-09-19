import { describe, it, expect } from "vitest";
import {
  stepGoldCover,
  shouldSuspendConvertibility,
  bandMultiplierFor,
  shouldFloat,
  participatesInFloat,
  moneyGrowthCoefficient,
  BW_EARLIEST_EXIT_YEAR,
  BW_COVER_SUSPENSION_THRESHOLD,
  BW_SUSPENSION_TURNS,
  BW_PEGGED_BAND,
  BW_FLOATING_BAND,
  BW_POST_EXIT_MONEY_COEFF,
} from "./brettonWoods";

describe("gold cover drain", () => {
  it("holds steady while gold covers foreign claims", () => {
    const next = stepGoldCover({ cover: 1, foreignClaims: 50, goldValue: 100, inflationGap: 0 });
    expect(next).toBe(1);
  });

  it("drains only on claims IN EXCESS of cover", () => {
    const covered = stepGoldCover({
      cover: 1,
      foreignClaims: 100,
      goldValue: 100,
      inflationGap: 0,
    });
    const over = stepGoldCover({ cover: 1, foreignClaims: 500, goldValue: 100, inflationGap: 0 });
    expect(covered).toBe(1);
    expect(over).toBeLessThan(1);
  });

  it("drains faster when domestic inflation undermines the parity", () => {
    const calm = stepGoldCover({ cover: 1, foreignClaims: 300, goldValue: 100, inflationGap: 0 });
    const hot = stepGoldCover({ cover: 1, foreignClaims: 300, goldValue: 100, inflationGap: 5 });
    expect(hot).toBeLessThan(calm);
  });

  it("clamps to [0,1] and never returns NaN for hostile input", () => {
    expect(stepGoldCover({ cover: 0.01, foreignClaims: 1e9, goldValue: 1, inflationGap: 99 })).toBe(
      0
    );
    const fromNaN = stepGoldCover({
      cover: Number.NaN,
      foreignClaims: 0,
      goldValue: 0,
      inflationGap: Number.NaN,
    });
    expect(Number.isFinite(fromNaN)).toBe(true);
    expect(fromNaN).toBe(1);
  });
});

describe("suspension decision", () => {
  const armed = { goldCover: BW_COVER_SUSPENSION_THRESHOLD - 0.01, regime: "pegged" as const };

  it("does not fire before the era window even with cover exhausted", () => {
    expect(shouldSuspendConvertibility({ ...armed, currentYear: BW_EARLIEST_EXIT_YEAR - 1 })).toBe(
      false
    );
  });

  it("fires once eligible and cover is exhausted", () => {
    expect(shouldSuspendConvertibility({ ...armed, currentYear: BW_EARLIEST_EXIT_YEAR })).toBe(
      true
    );
  });

  it("does not fire while cover holds", () => {
    expect(
      shouldSuspendConvertibility({ currentYear: 1971, goldCover: 0.9, regime: "pegged" })
    ).toBe(false);
  });

  it("never re-fires once the peg is already gone", () => {
    expect(
      shouldSuspendConvertibility({ currentYear: 1972, goldCover: 0, regime: "suspended" })
    ).toBe(false);
    expect(
      shouldSuspendConvertibility({ currentYear: 1972, goldCover: 0, regime: "floating" })
    ).toBe(false);
  });

  it("tolerates a missing year", () => {
    expect(shouldSuspendConvertibility({ ...armed, currentYear: null })).toBe(false);
  });
});

describe("band widening", () => {
  it("keeps the pegged band while pegged", () => {
    expect(bandMultiplierFor({ regime: "pegged", turnsSinceRegimeChange: 999 })).toBe(
      BW_PEGGED_BAND
    );
  });

  it("widens gradually across the suspension rather than snapping", () => {
    const start = bandMultiplierFor({ regime: "suspended", turnsSinceRegimeChange: 0 });
    const mid = bandMultiplierFor({
      regime: "suspended",
      turnsSinceRegimeChange: BW_SUSPENSION_TURNS / 2,
    });
    const end = bandMultiplierFor({
      regime: "suspended",
      turnsSinceRegimeChange: BW_SUSPENSION_TURNS,
    });
    expect(start).toBe(BW_PEGGED_BAND);
    expect(mid).toBeGreaterThan(start);
    expect(mid).toBeLessThan(end);
    expect(end).toBe(BW_FLOATING_BAND);
  });

  it("never exceeds the floating band, however long the suspension runs", () => {
    expect(
      bandMultiplierFor({ regime: "suspended", turnsSinceRegimeChange: BW_SUSPENSION_TURNS * 10 })
    ).toBe(BW_FLOATING_BAND);
  });
});

describe("float transition", () => {
  it("floats only after serving the full suspension", () => {
    expect(
      shouldFloat({ regime: "suspended", turnsSinceRegimeChange: BW_SUSPENSION_TURNS - 1 })
    ).toBe(false);
    expect(shouldFloat({ regime: "suspended", turnsSinceRegimeChange: BW_SUSPENSION_TURNS })).toBe(
      true
    );
  });

  it("does not re-float an already floating currency", () => {
    expect(shouldFloat({ regime: "floating", turnsSinceRegimeChange: 9999 })).toBe(false);
  });
});

describe("command economies are excluded", () => {
  it("never participates while the command regime is active", () => {
    expect(participatesInFloat("RU", true)).toBe(false);
    expect(participatesInFloat("DD", true)).toBe(false);
  });

  it("participates once the country is no longer command-run", () => {
    expect(participatesInFloat("RU", false)).toBe(true);
  });
});

describe("money-growth coefficient", () => {
  it("keeps the pegged coefficient while convertibility holds", () => {
    expect(moneyGrowthCoefficient("pegged", 0.08)).toBe(0.08);
  });

  it("loosens once the peg is gone", () => {
    expect(moneyGrowthCoefficient("suspended", 0.08)).toBe(BW_POST_EXIT_MONEY_COEFF);
    expect(moneyGrowthCoefficient("floating", 0.08)).toBe(BW_POST_EXIT_MONEY_COEFF);
    expect(BW_POST_EXIT_MONEY_COEFF).toBeGreaterThan(0.08);
  });
});
