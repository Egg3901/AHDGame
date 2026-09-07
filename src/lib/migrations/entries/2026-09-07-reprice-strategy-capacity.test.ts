import { describe, expect, it } from "vitest";
import {
  computeRepricedStock,
  DEFECTIVE_PAIRS,
  isDefectivePair,
} from "./2026-09-07-reprice-strategy-capacity";
import {
  CAPACITY_ANCHOR_YEAR,
  capacityPricePerUnit,
  revenuePerCapacityUnitForStrategy,
} from "@/lib/constants/capacityEconomy";
import { GROWTH_COST_MULTIPLIER, TURNS_PER_DAY } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";

const YEAR = 1966;
const SCALE = 70;

describe("DEFECTIVE_PAIRS scope", () => {
  it("matches on the pair, not the strategy name alone", () => {
    expect(isDefectivePair("extraction", "rare_earth_mining")).toBe(true);
    expect(isDefectivePair("defense", "heavy_armor")).toBe(true);
    // Same strategy id under a sector type that is not registered.
    expect(isDefectivePair("manufacturing", "heavy_armor")).toBe(false);
    expect(isDefectivePair("extraction", "coal_mining")).toBe(false);
    expect(isDefectivePair("extraction", null)).toBe(false);
  });

  it("only lists pairs whose payback is under a fifth of the intended 72 turns", () => {
    // The threshold that produced this list. If a constant moves so that a
    // listed pair is no longer extreme, or an unlisted one becomes extreme,
    // this fails and the list needs re-deriving from the sim report.
    const intended = GROWTH_COST_MULTIPLIER * TURNS_PER_DAY;
    for (const pair of DEFECTIVE_PAIRS) {
      const [type, strategy] = pair.split("/");
      const rpu = revenuePerCapacityUnitForStrategy(type as CorporationType, strategy, 1);
      // Pre-fix price: always the sector-type default mix.
      const before = capacityPricePerUnit(type as CorporationType, CAPACITY_ANCHOR_YEAR, 1, null);
      const paybackTurns = (before / rpu) * TURNS_PER_DAY;
      expect(
        paybackTurns,
        `${pair} is no longer extreme (${paybackTurns.toFixed(2)} turns)`
      ).toBeLessThan(intended / 5);
    }
  });
});

describe("computeRepricedStock", () => {
  it("re-prices corp 738's AZ rare-earth capacity down to its paid basis", () => {
    // Observed live at turn 694.
    const out = computeRepricedStock({
      sectorType: "extraction",
      strategyId: "rare_earth_mining",
      capitalStock: 408_242,
      capacityBookAnchor: 2_553_827,
      year: YEAR,
      eraUnitScale: SCALE,
    });
    // Derivation, pinned rather than approximated:
    //   RPU(extraction, rare_earth_mining) = 1 / (0.72 / 21_000) = 29_166.67
    //   era unit scale 70                  => 416.667 per era unit
    //   x GROWTH_COST_MULTIPLIER 3.0       => 1_250.00
    //   x capacityEraPriceIndex(1966) 1.0  => 1_250.00 per unit
    //   2_553_827 / 1_250.00               => 2_043.06 units
    const unitPrice = capacityPricePerUnit("extraction", YEAR, SCALE, "rare_earth_mining");
    expect(unitPrice).toBeCloseTo(1_250, 6);
    expect(out.unitsCorrect).toBeCloseTo(2_553_827 / 1_250, 4);
    // A 99.5% cut: the sector held 200x the capacity its paid basis bought.
    expect(out.unitsRemoved / 408_242).toBeGreaterThan(0.994);
    expect(out.unitsRemoved).toBeCloseTo(408_242 - out.unitsCorrect, 6);
    // Variant A: the paid basis is fully preserved as capacity, so nothing the
    // corp actually paid for is destroyed and no refund is owed.
    expect(out.refundAnchor).toBe(0);
  });

  it("leaves a correctly priced sector untouched", () => {
    const price = capacityPricePerUnit("extraction", YEAR, SCALE, "coal_mining");
    const out = computeRepricedStock({
      sectorType: "extraction",
      strategyId: "coal_mining",
      capitalStock: 1_000,
      capacityBookAnchor: 1_000 * price,
      year: YEAR,
      eraUnitScale: SCALE,
    });
    expect(out.unitsCorrect).toBeCloseTo(1_000, 6);
    expect(out.unitsRemoved).toBeCloseTo(0, 6);
  });

  it("never writes capacity UP for a sector that overpaid", () => {
    const price = capacityPricePerUnit("extraction", YEAR, SCALE, "coal_mining");
    const out = computeRepricedStock({
      sectorType: "extraction",
      strategyId: "coal_mining",
      capitalStock: 1_000,
      // Paid double the list price.
      capacityBookAnchor: 2_000 * price,
      year: YEAR,
      eraUnitScale: SCALE,
    });
    expect(out.unitsCorrect).toBe(1_000);
    expect(out.unitsRemoved).toBe(0);
  });

  it("is idempotent: re-running on the output changes nothing further", () => {
    const first = computeRepricedStock({
      sectorType: "extraction",
      strategyId: "rare_earth_mining",
      capitalStock: 408_242,
      capacityBookAnchor: 2_553_827,
      year: YEAR,
      eraUnitScale: SCALE,
    });
    const second = computeRepricedStock({
      sectorType: "extraction",
      strategyId: "rare_earth_mining",
      capitalStock: first.unitsCorrect,
      capacityBookAnchor: 2_553_827,
      year: YEAR,
      eraUnitScale: SCALE,
    });
    expect(second.unitsCorrect).toBeCloseTo(first.unitsCorrect, 6);
    expect(second.unitsRemoved).toBe(0);
  });

  it("leaves a sector with no recorded basis alone", () => {
    // No `capacityBookAnchor` means no evidence of what was paid. Re-pricing
    // off a fallback list value would be circular, so the row is skipped.
    const out = computeRepricedStock({
      sectorType: "extraction",
      strategyId: "rare_earth_mining",
      capitalStock: 408_242,
      capacityBookAnchor: null,
      year: YEAR,
      eraUnitScale: SCALE,
    });
    expect(out.unitsCorrect).toBe(408_242);
    expect(out.unitsRemoved).toBe(0);
    expect(out.skipped).toBe("no-recorded-basis");
  });

  it("leaves a zero-stock or unpriceable sector alone", () => {
    expect(
      computeRepricedStock({
        sectorType: "extraction",
        strategyId: "rare_earth_mining",
        capitalStock: 0,
        capacityBookAnchor: 1_000,
        year: YEAR,
        eraUnitScale: SCALE,
      }).unitsRemoved
    ).toBe(0);
  });

  it("does not touch a default-strategy sector, whose price never changed", () => {
    const price = capacityPricePerUnit("extraction", YEAR, SCALE, null);
    const out = computeRepricedStock({
      sectorType: "extraction",
      strategyId: null,
      capitalStock: 5_000,
      capacityBookAnchor: 5_000 * price,
      year: YEAR,
      eraUnitScale: SCALE,
    });
    expect(out.unitsRemoved).toBeCloseTo(0, 6);
  });
});
