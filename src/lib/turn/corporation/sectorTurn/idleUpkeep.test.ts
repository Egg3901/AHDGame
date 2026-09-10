import { describe, it, expect } from "vitest";
import { computeIdleUpkeep, type IdleUpkeepInput } from "./idleUpkeep";
import { IDLE_UPKEEP_FRACTION, MOTHBALL_UPKEEP_FRACTION } from "@/lib/constants/capacityEconomy";

function input(over: Partial<IdleUpkeepInput> = {}): IdleUpkeepInput {
  return {
    sector: { plantsUpkeepMarginBasisAnchor: undefined } as never,
    plantsEnabled: true,
    mothballed: false,
    effectiveMargin: 20,
    plantsMixPrice: 480,
    plantsCapacity: 1000,
    producedUnits: 500,
    plantsRampLambda: 1,
    disasterOutputFactor: 1,
    nationalizationTransition: 1,
    plantsExtractionHardMin: 1,
    throughputFactor: 1,
    labourOutputFactor: 1,
    ...over,
  };
}

describe("computeIdleUpkeep — P3a idle/mothball upkeep (#588)", () => {
  it("charges nothing when plants are off", () => {
    const r = computeIdleUpkeep(input({ plantsEnabled: false }));
    expect(r.plantsUpkeepCost).toBe(0);
  });

  it("charges idle capacity when plants are on", () => {
    expect(computeIdleUpkeep(input()).plantsUpkeepCost).toBeGreaterThan(0);
  });

  // The flip-identity guarantee: the flip turn must be an exact no-op, or a
  // tier whose promise is "the flip changes nothing" shows a profit step.
  it("is an exact no-op on the flip turn", () => {
    expect(computeIdleUpkeep(input({ plantsRampLambda: 0 })).plantsUpkeepCost).toBe(0);
  });

  it("scales linearly with the governor ramp", () => {
    const full = computeIdleUpkeep(input({ plantsRampLambda: 1 })).plantsUpkeepCost;
    const half = computeIdleUpkeep(input({ plantsRampLambda: 0.5 })).plantsUpkeepCost;
    expect(half).toBeCloseTo(full / 2, 10);
  });

  // Correction 1: pricing a fixed cost off the LIVE margin made it grow as the
  // margin fell, so the most distressed sectors paid the most per idle unit.
  it("holds the anchored unit price regardless of where the live margin goes", () => {
    // The anchor sits BELOW IDLE_UPKEEP_BASIS_MAX and both live bases sit below
    // it too, so the cap cannot mask the difference: if the anchor were ignored
    // these two would diverge.
    const anchored = { plantsUpkeepMarginBasisAnchor: 0.3 } as never;
    const healthy = computeIdleUpkeep(input({ sector: anchored, effectiveMargin: 60 }));
    const distressed = computeIdleUpkeep(input({ sector: anchored, effectiveMargin: 25 }));
    expect(distressed.plantsUpkeepCost).toBeCloseTo(healthy.plantsUpkeepCost, 10);

    const unanchored = computeIdleUpkeep(input({ effectiveMargin: 60 }));
    expect(unanchored.plantsUpkeepCost).not.toBeCloseTo(healthy.plantsUpkeepCost, 6);
  });

  it("ignores a non-finite anchor and falls back to the live basis", () => {
    const bad = { plantsUpkeepMarginBasisAnchor: Number.NaN } as never;
    const r = computeIdleUpkeep(input({ sector: bad, effectiveMargin: 60 }));
    expect(r.plantsUpkeepMarginBasisAnchor).toBeNull();
    expect(r.plantsUpkeepCost).toBeCloseTo(
      computeIdleUpkeep(input({ effectiveMargin: 60 })).plantsUpkeepCost,
      10
    );
  });

  it("reports the live basis and a null anchor before one is stamped", () => {
    const r = computeIdleUpkeep(input({ effectiveMargin: 20 }));
    expect(r.plantsUpkeepMarginBasisAnchor).toBeNull();
    expect(r.plantsUpkeepMarginBasisLive).toBeCloseTo(0.8, 10);
  });

  // A second, independent guard against the same distress spiral correction 1
  // fixed: even with no anchor yet, the basis is clamped to
  // IDLE_UPKEEP_BASIS_MAX, so a collapsing margin cannot inflate the unit price
  // without bound in the window before the anchor is stamped.
  it("caps the unit price even with no anchor and a deeply negative margin", () => {
    const healthy = computeIdleUpkeep(input({ effectiveMargin: 20 }));
    const distressed = computeIdleUpkeep(input({ effectiveMargin: -50 }));
    expect(distressed.plantsUpkeepCost).toBeLessThanOrEqual(healthy.plantsUpkeepCost);
    // The live basis still REPORTS the uncapped value; only the price is capped.
    expect(distressed.plantsUpkeepMarginBasisLive).toBeCloseTo(1.5, 10);
  });

  it("charges less per idle unit as the margin improves", () => {
    const thin = computeIdleUpkeep(input({ effectiveMargin: 30 })).plantsUpkeepCost;
    const fat = computeIdleUpkeep(input({ effectiveMargin: 60 })).plantsUpkeepCost;
    expect(fat).toBeLessThan(thin);
  });

  it("floors the live margin basis at zero for a margin above 100%", () => {
    expect(computeIdleUpkeep(input({ effectiveMargin: 140 })).plantsUpkeepMarginBasisLive).toBe(0);
  });

  // Correction 2: the base is OWNER-idle capacity. Every live sector sat at the
  // 0.85 throughput floor — input-starved, not over-built — and was already
  // losing that 15% off its top line before being billed for it again.
  it("does not bill capacity idled by an involuntary throttle", () => {
    const owned = computeIdleUpkeep(input({ throughputFactor: 1 }));
    const starved = computeIdleUpkeep(input({ throughputFactor: 0.85 }));
    expect(starved.plantsUpkeepCost).toBeLessThan(owned.plantsUpkeepCost);
  });

  it.each([
    ["disaster", { disasterOutputFactor: 0.5 }],
    ["nationalization transition", { nationalizationTransition: 0.5 }],
    ["extraction hard floor", { plantsExtractionHardMin: 0.5 }],
    ["labour shortfall", { labourOutputFactor: 0.5 }],
  ])("treats %s as involuntary, not owner-idle", (_label, over) => {
    const base = computeIdleUpkeep(input()).plantsUpkeepCost;
    expect(computeIdleUpkeep(input(over)).plantsUpkeepCost).toBeLessThan(base);
  });

  describe("mothballed", () => {
    // Mothballing is a deliberate act taken after the flip, so there is no
    // continuity to protect and the ramp must not apply.
    it("still charges on the flip turn", () => {
      const r = computeIdleUpkeep(input({ mothballed: true, plantsRampLambda: 0 }));
      expect(r.plantsUpkeepCost).toBeGreaterThan(0);
    });

    it("bills the whole capacity at the mothball fraction", () => {
      const r = computeIdleUpkeep(input({ mothballed: true, producedUnits: 0 }));
      const running = computeIdleUpkeep(input({ producedUnits: 0 }));
      // Same capacity, same unit price; only the fraction differs.
      expect(r.plantsUpkeepCost / running.plantsUpkeepCost).toBeCloseTo(
        MOTHBALL_UPKEEP_FRACTION / IDLE_UPKEEP_FRACTION,
        10
      );
    });

    it("ignores production, since a mothballed sector produces nothing", () => {
      const a = computeIdleUpkeep(input({ mothballed: true, producedUnits: 0 }));
      const b = computeIdleUpkeep(input({ mothballed: true, producedUnits: 900 }));
      expect(a.plantsUpkeepCost).toBeCloseTo(b.plantsUpkeepCost, 10);
    });
  });
});
