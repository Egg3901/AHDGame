import { describe, it, expect } from "vitest";
import { ownerIdleUnits, idleUpkeepUnitPrice, IDLE_UPKEEP_BASIS_MAX } from "./physicalPnl";
import { IDLE_UPKEEP_FRACTION } from "@/lib/constants/capacityEconomy";

/**
 * Idle-capacity upkeep, after the live-sandbox measurement at turn 293.
 *
 * Two defects, both pinned here:
 *
 *  1. The BASE was `capacity − producedUnits`, i.e. every reason a plant ran
 *     short. On the live world all 675 sectors sat at `throughputFactor` 0.85
 *     exactly — the launch governor's floor — so the whole charge was billing a
 *     world-wide input shortage as if 675 owners had each over-built, on top of
 *     the 15% those sectors had already lost off their top line.
 *
 *  2. The PRICE was `mixPrice × (1 − margin_now)`, which GROWS as the margin
 *     falls. The deepest loss-makers paid the most per idle unit.
 */
describe("ownerIdleUnits", () => {
  it("charges nothing for capacity idled purely by input throughput", () => {
    // The live case: throughput floors output at 0.85 of capacity, nothing else
    // throttles, the owner chose to build exactly what they run.
    const capacity = 1000;
    const throttle = 0.85;
    const produced = capacity * throttle;
    expect(
      ownerIdleUnits({ capacity, producedUnits: produced, involuntaryThrottle: throttle })
    ).toBe(0);
    // The pre-fix base billed 15% of the plant.
    expect(capacity - produced).toBeCloseTo(150, 8);
  });

  it("still charges capacity the OWNER idled, and only that", () => {
    // Owner throttles the production policy to 60%; the world separately
    // throttles throughput to 0.85. Only the 40% the owner chose is idle.
    const capacity = 1000;
    const ownerFactor = 0.6;
    const throttle = 0.85;
    const produced = capacity * ownerFactor * throttle;
    expect(
      ownerIdleUnits({ capacity, producedUnits: produced, involuntaryThrottle: throttle })
    ).toBeCloseTo(400, 6);
  });

  it("does not bill a plant the world switched off entirely", () => {
    // A total embargo / full disaster stop is not an overbuild. Mothballing is
    // the deliberate path that does carry a charge.
    expect(ownerIdleUnits({ capacity: 1000, producedUnits: 0, involuntaryThrottle: 0 })).toBe(0);
  });

  it("never returns negative or non-finite units", () => {
    // Tech output multipliers can push produced ÷ throttle above capacity.
    expect(ownerIdleUnits({ capacity: 1000, producedUnits: 950, involuntaryThrottle: 0.85 })).toBe(
      0
    );
    expect(ownerIdleUnits({ capacity: 0, producedUnits: 0, involuntaryThrottle: 1 })).toBe(0);
    expect(
      ownerIdleUnits({ capacity: Number.NaN, producedUnits: 10, involuntaryThrottle: 1 })
    ).toBe(0);
    expect(
      ownerIdleUnits({ capacity: 100, producedUnits: 10, involuntaryThrottle: Number.NaN })
    ).toBe(0);
  });

  it("never manufactures idle units out of a throttle above 1", () => {
    // A productivity BOOST must not widen the base by division.
    expect(ownerIdleUnits({ capacity: 1000, producedUnits: 400, involuntaryThrottle: 1.5 })).toBe(
      600
    );
  });

  it("reduces to the old base when nothing involuntary is throttling", () => {
    // Backstop: with throttle 1 the narrowing is a no-op, so a genuinely
    // over-built plant is billed exactly as before.
    const capacity = 1000;
    const produced = 400;
    expect(ownerIdleUnits({ capacity, producedUnits: produced, involuntaryThrottle: 1 })).toBe(
      capacity - produced
    );
  });
});

describe("idleUpkeepUnitPrice", () => {
  it("does not grow as the live margin falls once anchored", () => {
    // THE PERVERSE TERM. Anchored at a 45% margin, the sector's margin then
    // collapses to 12% and finally goes negative. The unit price must not move.
    const anchored = 1 - 45 / 100;
    const base = { mixPrice: 240, turnsPerDay: 24, anchoredMarginBasis: anchored };
    const healthy = idleUpkeepUnitPrice({ ...base, liveMarginBasis: 1 - 45 / 100 });
    const distressed = idleUpkeepUnitPrice({ ...base, liveMarginBasis: 1 - 12 / 100 });
    const insolvent = idleUpkeepUnitPrice({ ...base, liveMarginBasis: 1 - -300 / 100 });
    expect(distressed).toBe(healthy);
    expect(insolvent).toBe(healthy);
    // And it is the value the pre-fix formula charged at the anchoring moment.
    expect(healthy).toBeCloseTo((240 / 24) * 0.55, 10);
  });

  it("is bounded above by the default cost share, however bad the margin gets", () => {
    // Unanchored fallback: a sector at −300% derived margin would have had a
    // live basis of 4.0, i.e. an idle unit costing 4x a running one.
    const price = idleUpkeepUnitPrice({
      mixPrice: 240,
      turnsPerDay: 24,
      anchoredMarginBasis: null,
      liveMarginBasis: 4.0,
    });
    expect(IDLE_UPKEEP_BASIS_MAX).toBeCloseTo(0.65, 10);
    expect(price).toBeCloseTo((240 / 24) * IDLE_UPKEEP_BASIS_MAX, 10);
    expect(price * IDLE_UPKEEP_FRACTION).toBeLessThan(240 / 24);
  });

  it("caps a basis stamped on a starved first turn instead of holding it at the full unit cost", () => {
    // Live regression: 937 sectors held an anchor at or above 0.9 because their
    // first plants turn ran at a zero or negative margin. That anchor priced
    // every idle unit at a running unit's full cost for the life of the sector.
    const starved = idleUpkeepUnitPrice({
      mixPrice: 240,
      turnsPerDay: 24,
      anchoredMarginBasis: 1.0092,
      liveMarginBasis: 0.3,
    });
    const healthy = idleUpkeepUnitPrice({
      mixPrice: 240,
      turnsPerDay: 24,
      anchoredMarginBasis: 0.55,
      liveMarginBasis: 0.3,
    });
    expect(starved).toBeCloseTo((240 / 24) * IDLE_UPKEEP_BASIS_MAX, 10);
    expect(healthy).toBeCloseTo((240 / 24) * 0.55, 10);
  });

  it("never pays the owner to hold idle plant", () => {
    expect(
      idleUpkeepUnitPrice({
        mixPrice: 240,
        turnsPerDay: 24,
        anchoredMarginBasis: -0.5,
        liveMarginBasis: 0.5,
      })
    ).toBe(0);
  });

  it("falls back to the live basis for an unanchored (legacy) sector", () => {
    expect(
      idleUpkeepUnitPrice({
        mixPrice: 240,
        turnsPerDay: 24,
        anchoredMarginBasis: undefined,
        liveMarginBasis: 0.65,
      })
    ).toBeCloseTo((240 / 24) * 0.65, 10);
  });

  it("returns 0 for a sector with no priced output", () => {
    expect(
      idleUpkeepUnitPrice({
        mixPrice: 0,
        turnsPerDay: 24,
        anchoredMarginBasis: 0.5,
        liveMarginBasis: 0.5,
      })
    ).toBe(0);
    expect(
      idleUpkeepUnitPrice({
        mixPrice: 240,
        turnsPerDay: 0,
        anchoredMarginBasis: 0.5,
        liveMarginBasis: 0.5,
      })
    ).toBe(0);
  });
});
