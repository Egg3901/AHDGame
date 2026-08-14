import { describe, it, expect } from "vitest";
import {
  CREDIT_BANDS,
  CREDIT_BAND_IDS,
  LENDING_PROFILES,
  STRESS_LOSS_FRACTION,
  bandRatePercent,
  bandsForProfile,
  demandShareForProfile,
  getCreditBand,
  getLendingProfile,
  stressLossFraction,
} from "./creditBands";

describe("credit bands", () => {
  it("covers the whole of household demand exactly once", () => {
    const total = CREDIT_BANDS.reduce((sum, band) => sum + band.demandShare, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it("orders bands by worsening credit", () => {
    for (let i = 1; i < CREDIT_BANDS.length; i += 1) {
      expect(CREDIT_BANDS[i].defaultRatePercent).toBeGreaterThan(
        CREDIT_BANDS[i - 1].defaultRatePercent
      );
      expect(CREDIT_BANDS[i].ratePremiumPp).toBeGreaterThan(CREDIT_BANDS[i - 1].ratePremiumPp);
    }
  });

  it("keeps a band rate non-negative even below a zero prime", () => {
    expect(bandRatePercent(getCreditBand("AAA"), 0.5)).toBe(0);
  });

  it("falls back to the reference band for an unrated tranche", () => {
    expect(getCreditBand(undefined).id).toBe("A");
    expect(getCreditBand(undefined).ratePremiumPp).toBe(0);
  });
});

describe("lending profiles", () => {
  it("opens strictly more of the book as the stance loosens", () => {
    const shares = LENDING_PROFILES.map((p) => demandShareForProfile(p.id));
    expect(shares).toEqual([...shares].sort((a, b) => a - b));
    expect(demandShareForProfile("aggressive")).toBeCloseTo(1, 9);
  });

  it("includes every band down to the floor and none below it", () => {
    const bands = bandsForProfile("balanced").map((b) => b.id);
    expect(bands).toEqual(["AAA", "AA", "A", "BBB"]);
    expect(bands).not.toContain("BB");
  });

  it("names a floor band that exists", () => {
    for (const profile of LENDING_PROFILES) {
      expect(CREDIT_BAND_IDS).toContain(profile.floorBand);
    }
  });

  it("buys volume at a worse margin, so aggressive is a trade and not a free win", () => {
    // The design claim the blurbs make. If this inverts, aggressive becomes
    // strictly dominant and the stance stops being a decision.
    const netMargin = (profileId: "conservative" | "balanced" | "aggressive") => {
      const bands = bandsForProfile(profileId);
      const weight = bands.reduce((s, b) => s + b.demandShare, 0);
      const rate = bands.reduce((s, b) => s + b.demandShare * bandRatePercent(b, 8), 0) / weight;
      const loss = bands.reduce((s, b) => s + b.demandShare * b.defaultRatePercent, 0) / weight;
      return rate - loss;
    };
    expect(netMargin("aggressive")).toBeLessThan(netMargin("conservative"));
    expect(demandShareForProfile("aggressive")).toBeGreaterThan(
      demandShareForProfile("conservative")
    );
  });

  it("resolves an unknown stance to the default rather than throwing", () => {
    expect(getLendingProfile(undefined).id).toBe("balanced");
  });
});

describe("stressLossFraction", () => {
  it("shocks a prime book far less than a junk book", () => {
    const prime = stressLossFraction([{ creditBand: "AAA", outstanding: 100 }]);
    const junk = stressLossFraction([{ creditBand: "CCC", outstanding: 100 }]);
    expect(prime).toBeLessThan(0.05);
    expect(junk).toBeGreaterThan(0.5);
  });

  it("lands an all-in aggressive book near the flat rate it replaced", () => {
    // The multiplier is calibrated so aggressive banks see no change in how
    // hard the supervisor hits them; conservative ones stop being punished for
    // a book they never held.
    const aggressive = stressLossFraction(
      bandsForProfile("aggressive").map((b) => ({
        creditBand: b.id,
        outstanding: b.demandShare * 1000,
      }))
    );
    expect(aggressive).toBeGreaterThan(0.1);
    expect(aggressive).toBeLessThan(0.2);
  });

  it("uses the flat fraction for an empty or wholly unrated book", () => {
    expect(stressLossFraction([])).toBe(STRESS_LOSS_FRACTION);
    expect(stressLossFraction([{ outstanding: 500 }])).toBe(STRESS_LOSS_FRACTION);
  });

  it("ignores negative and non-finite balances instead of propagating them", () => {
    const fraction = stressLossFraction([
      { creditBand: "AAA", outstanding: 100 },
      { creditBand: "CCC", outstanding: Number.NaN },
      { creditBand: "CCC", outstanding: -1000 },
    ]);
    expect(Number.isFinite(fraction)).toBe(true);
    expect(fraction).toBeLessThan(0.05);
  });
});
