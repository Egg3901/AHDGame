import { describe, it, expect } from "vitest";
import { evaluateLaunchGuard, guardRevertTarget, DEFAULT_GUARD_DROP_PCT } from "./launchGuard";

describe("evaluateLaunchGuard", () => {
  const armed = { mode: "capital", guardEnabled: true as const };

  it("is inert when the guard is disabled", () => {
    expect(
      evaluateLaunchGuard({
        mode: "capital",
        guardEnabled: false,
        currentMcap: 100,
        currentTurn: 10,
      })
    ).toEqual({});
  });

  it("is inert when the mode is not clearing/capital", () => {
    expect(
      evaluateLaunchGuard({ mode: "ledger", guardEnabled: true, currentMcap: 100, currentTurn: 10 })
    ).toEqual({});
  });

  it("stamps a reference on the first armed turn", () => {
    expect(
      evaluateLaunchGuard({ ...armed, referenceMcap: null, currentMcap: 100, currentTurn: 5 })
    ).toEqual({ setReference: 100 });
  });

  it("holds through the grace window even on a big drop", () => {
    expect(
      evaluateLaunchGuard({
        ...armed,
        referenceMcap: 100,
        referenceTurn: 5,
        currentMcap: 50,
        currentTurn: 8, // since = 3 < default grace 5
      })
    ).toEqual({});
  });

  it("does not trip on a drop below the threshold", () => {
    expect(
      evaluateLaunchGuard({
        ...armed,
        referenceMcap: 100,
        referenceTurn: 5,
        currentMcap: 80, // 20% drop < 25%
        currentTurn: 20,
      })
    ).toEqual({});
  });

  it("trips and reverts when the drop breaches the threshold past grace", () => {
    const d = evaluateLaunchGuard({
      ...armed,
      referenceMcap: 100,
      referenceTurn: 5,
      currentMcap: 70, // 30% drop >= 25%
      currentTurn: 20,
    });
    expect(d.trip?.dropPct).toBeCloseTo(0.3, 6);
    expect(d.trip?.referenceMcap).toBe(100);
  });

  it("honors a custom drop threshold", () => {
    const d = evaluateLaunchGuard({
      ...armed,
      referenceMcap: 100,
      referenceTurn: 5,
      currentMcap: 88, // 12% drop
      currentTurn: 20,
      dropPct: 0.1,
    });
    expect(d.trip?.dropPct).toBeCloseTo(0.12, 6);
  });

  it("uses the documented default threshold", () => {
    expect(DEFAULT_GUARD_DROP_PCT).toBe(0.25);
  });

  describe("fundamentals-relative drawdown", () => {
    const base = { ...armed, referenceMcap: 100, referenceTurn: 5, currentTurn: 20 };

    it("does not trip when price and fundamentals fall together (rate repricing)", () => {
      // Prime rate rises, sectorNPV is discounted harder: mcap AND fundamentals
      // both fall ~38%. The market is repricing correctly, not breaking.
      const d = evaluateLaunchGuard({
        ...base,
        currentMcap: 62,
        referenceFundamentalMcap: 100,
        currentFundamentalMcap: 62,
        fundamentalCoverage: 1,
      });
      expect(d.trip).toBeUndefined();
    });

    it("still trips when price decouples downward from fundamentals", () => {
      // Fundamentals held; price alone collapsed. This is the break the guard exists for.
      const d = evaluateLaunchGuard({
        ...base,
        currentMcap: 60,
        referenceFundamentalMcap: 100,
        currentFundamentalMcap: 98,
        fundamentalCoverage: 1,
      });
      expect(d.trip?.fundamentalsAdjusted).toBe(true);
      expect(d.trip?.dropPct).toBeCloseTo(1 - 60 / 98, 6);
    });

    it("trips when price falls further than fundamentals justify", () => {
      // Fundamentals down 20%, price down 50% — the extra 37.5% is unexplained.
      const d = evaluateLaunchGuard({
        ...base,
        currentMcap: 50,
        referenceFundamentalMcap: 100,
        currentFundamentalMcap: 80,
        fundamentalCoverage: 1,
      });
      expect(d.trip?.dropPct).toBeCloseTo(1 - 50 / 80, 6);
    });

    it("falls back to the raw drawdown when fundamental coverage is thin", () => {
      const d = evaluateLaunchGuard({
        ...base,
        currentMcap: 62,
        referenceFundamentalMcap: 100,
        currentFundamentalMcap: 62,
        fundamentalCoverage: 0.5, // below FUNDAMENTAL_COVERAGE_FLOOR
      });
      expect(d.trip?.fundamentalsAdjusted).toBe(false);
      expect(d.trip?.dropPct).toBeCloseTo(0.38, 6);
    });

    it("never stamps the fundamental reference alongside the mcap reference", () => {
      // The fundamental reading available at turn T describes turn T-1, so
      // pairing it with mcap(T) would bake in a one-turn skew — catastrophic on
      // the flip turn itself, where that skew IS the revaluation.
      const d = evaluateLaunchGuard({
        ...armed,
        referenceMcap: null,
        currentMcap: 100,
        currentTurn: 3,
        currentFundamentalMcap: 95,
        fundamentalCoverage: 1,
      });
      expect(d.setReference).toBe(100);
      expect(d.setReferenceFundamental).toBeUndefined();
    });
  });

  describe("fundamental reference back-fill", () => {
    it("fills in the fundamental twin without moving the mcap reference", () => {
      // Reference mcap was stamped at turn 2; this turn's fundamental reading
      // finally describes turn 2, so it is the correct same-vintage twin.
      const d = evaluateLaunchGuard({
        ...armed,
        referenceMcap: 100,
        referenceTurn: 2,
        currentMcap: 98,
        currentTurn: 3,
        currentFundamentalMcap: 98,
        fundamentalCoverage: 1,
      });
      expect(d.setReference).toBeUndefined();
      expect(d.setReferenceFundamental).toBe(98);
    });

    // Regression: the ab7 200-turn plants A/B. The plants flip roughly doubled
    // aggregate sectorNPV, so mcap stepped 4.09B -> 5.71B on the flip turn while
    // the fundamental reading still showed the pre-flip 4.09B. Stamping that
    // pair inflated every later curFund/refFund ratio by the flip factor, the
    // `min` clamped it to 1, and the guard silently degraded to a raw drawdown
    // from the post-flip peak — tripping at turn 158 on a market that was still
    // 35% ABOVE the capital control and above its own pre-flip level.
    it("does not trip on a post-flip drift back toward pre-flip valuation", () => {
      // Turn 3: flip turn. Only the mcap is stamped.
      const stamp = evaluateLaunchGuard({
        ...armed,
        referenceMcap: null,
        currentMcap: 5_709_600_000,
        currentTurn: 3,
        currentFundamentalMcap: 4_094_976_081, // stale: pre-flip
        fundamentalCoverage: 1,
      });
      expect(stamp.setReference).toBe(5_709_600_000);
      expect(stamp.setReferenceFundamental).toBeUndefined();

      // Turn 4: the reading now describes turn 3 — the correct twin.
      const backfill = evaluateLaunchGuard({
        ...armed,
        referenceMcap: 5_709_600_000,
        referenceTurn: 3,
        currentMcap: 6_040_600_000,
        currentTurn: 4,
        currentFundamentalMcap: 5_699_000_000,
        fundamentalCoverage: 1,
      });
      expect(backfill.setReferenceFundamental).toBe(5_699_000_000);
      expect(backfill.setReference).toBeUndefined();

      // Turn 158: price and fundamentals have fallen together (-25% raw).
      const d = evaluateLaunchGuard({
        ...armed,
        referenceMcap: 5_709_600_000,
        referenceTurn: 3,
        referenceFundamentalMcap: 5_699_000_000,
        currentMcap: 4_281_600_000,
        currentTurn: 158,
        currentFundamentalMcap: 4_335_000_000,
        fundamentalCoverage: 1,
      });
      expect(d.trip).toBeUndefined();
    });

    // The fundamentals leg must still only EXCUSE, never rescue: if price falls
    // and fundamentals hold, the trip stands.
    it("still trips when price decouples from a flat fundamental", () => {
      const d = evaluateLaunchGuard({
        ...armed,
        referenceMcap: 5_709_600_000,
        referenceTurn: 3,
        referenceFundamentalMcap: 5_699_000_000,
        currentMcap: 4_281_600_000,
        currentTurn: 158,
        currentFundamentalMcap: 5_699_000_000,
        fundamentalCoverage: 1,
      });
      expect(d.trip?.dropPct).toBeGreaterThanOrEqual(0.25);
    });

    it("refuses to re-baseline a market already breaching the raw threshold", () => {
      // A genuinely broken flip must not be rescued by a fresh baseline.
      const d = evaluateLaunchGuard({
        ...armed,
        referenceMcap: 100,
        referenceTurn: 2,
        currentMcap: 60, // 40% down already
        currentTurn: 12,
        currentFundamentalMcap: 60,
        fundamentalCoverage: 1,
      });
      expect(d.setReference).toBeUndefined();
      expect(d.trip?.dropPct).toBeCloseTo(0.4, 6);
    });

    it("does not re-baseline when coverage is thin", () => {
      const d = evaluateLaunchGuard({
        ...armed,
        referenceMcap: 100,
        referenceTurn: 2,
        currentMcap: 98,
        currentTurn: 3,
        currentFundamentalMcap: 98,
        fundamentalCoverage: 0.4,
      });
      expect(d.setReference).toBeUndefined();
    });
  });
});

// The revert target was a hardcoded "ledger". From plants that is a TWO-tier
// drop onto a tier with no growth mechanism at all: capacity-derived revenue is
// gone and the compounding nameplate plants removed is not coming back, so a
// trip would leave the economy flat until a human noticed. capital is the
// nearest tier below plants that still grows.
describe("guardRevertTarget", () => {
  it("reverts plants to capital, not two tiers down to ledger", () => {
    expect(guardRevertTarget("plants")).toBe("capital");
  });

  it("preserves the historical ledger target for clearing and capital", () => {
    expect(guardRevertTarget("clearing")).toBe("ledger");
    expect(guardRevertTarget("capital")).toBe("ledger");
  });
});

describe("evaluateLaunchGuard revert target", () => {
  const tripArgs = {
    guardEnabled: true as const,
    referenceMcap: 1000,
    referenceTurn: 0,
    currentMcap: 500, // a 50% drop, well past the 25% default threshold
    currentTurn: 100, // well past the grace window
  };

  it("carries revertTo=capital on a plants trip", () => {
    const decision = evaluateLaunchGuard({ ...tripArgs, mode: "plants" });
    expect(decision.trip?.revertTo).toBe("capital");
    expect(decision.trip?.dropPct).toBeGreaterThanOrEqual(DEFAULT_GUARD_DROP_PCT);
  });

  it("carries revertTo=ledger on a capital trip", () => {
    expect(evaluateLaunchGuard({ ...tripArgs, mode: "capital" }).trip?.revertTo).toBe("ledger");
  });

  // Regression on the bug the arming check already fixed: a new top tier must
  // not silently disarm the guard.
  it("is still armed on plants", () => {
    const decision = evaluateLaunchGuard({
      mode: "plants",
      guardEnabled: true,
      currentMcap: 100,
      currentTurn: 10,
    });
    expect(decision.setReference).toBe(100);
  });
});
