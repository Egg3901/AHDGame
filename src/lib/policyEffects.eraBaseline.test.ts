import { describe, expect, it } from "vitest";
import { calculateMetricTarget } from "./policyEffects";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";

// 1991-style seed doc: broadband 0 (out-of-era), energyTransition 49 (in-band),
// roadCondition 55 (non-windowed).
const seedDoc = {
  _id: "TST",
  baselines: {
    infrastructure: { broadbandAccess: 0, roadCondition: 55 },
    environment: { energyTransitionProgress: 49 },
  },
} as unknown as StateMetricBaseline;

describe("calculateMetricTarget — era-aware decay baseline", () => {
  it("lifts an out-of-era windowed seed to the era-band best (broadband, 2010)", () => {
    const t = calculateMetricTarget(
      seedDoc,
      "infrastructure",
      "broadbandAccess",
      [],
      new Map(),
      0,
      0,
      "US",
      2010
    );
    expect(t).toBeCloseTo(67.09, 1); // band.best at 2010, not the seed 0
  });

  it("keeps an in-band windowed seed on the seed baseline (energyTransition)", () => {
    const t = calculateMetricTarget(
      seedDoc,
      "environment",
      "energyTransitionProgress",
      [],
      new Map(),
      0,
      49,
      "US",
      2010
    );
    expect(t).toBeCloseTo(49, 5); // 49 >= band.worst (~-17.9) → unchanged
  });

  it("leaves a non-windowed metric on the seed baseline (roadCondition)", () => {
    const t = calculateMetricTarget(
      seedDoc,
      "infrastructure",
      "roadCondition",
      [],
      new Map(),
      0,
      55,
      "US",
      2010
    );
    expect(t).toBeCloseTo(55, 5); // getEraBand → null → unchanged
  });

  it("is byte-identical when eraYear is null (flag off)", () => {
    const t = calculateMetricTarget(
      seedDoc,
      "infrastructure",
      "broadbandAccess",
      [],
      new Map(),
      0,
      0,
      "US",
      null
    );
    expect(t).toBeCloseTo(0, 5); // legacy: seed 0
  });

  it("lower-is-better: an era-valid seed is NOT rewritten (direction-aware, #3238)", () => {
    // 1953 US uninsuredRate band {best 13, worst 68}; seed 53 is in-band
    // (not > worst), so the direction-aware guard must leave it alone.
    // Empty policies → contribution 0; defs clamp [0,100] admits 53 → target 53.
    // (A direction-blind `baseline < band.worst` would have rewritten it to
    // band.best=13; the old era-blind maxValue=25 would have clamped to 25.)
    const doc = {
      _id: "TST",
      baselines: { healthcare: { uninsuredRate: 53 } },
    } as unknown as StateMetricBaseline;
    const t = calculateMetricTarget(
      doc,
      "healthcare",
      "uninsuredRate",
      [],
      new Map(),
      0,
      53,
      "US",
      1953
    );
    expect(t).toBeCloseTo(53, 5);
  });

  it("lower-is-better: an out-of-era seed (beyond band worst) rests at band best", () => {
    // baseline 80 > 1953 US worst 68 → anachronistically bad → rest at best 13.
    const doc = {
      _id: "TST",
      baselines: { healthcare: { uninsuredRate: 80 } },
    } as unknown as StateMetricBaseline;
    const t = calculateMetricTarget(
      doc,
      "healthcare",
      "uninsuredRate",
      [],
      new Map(),
      0,
      80,
      "US",
      1953
    );
    expect(t).toBeCloseTo(13, 5);
  });

  it("lower-is-better at 2019: decay target identical to the pre-curve behavior", () => {
    // 2019 band = static THRESHOLDS {0, 22}; a modern baseline of 9 is in-band
    // and must stay untouched — same as when uninsuredRate had no curve.
    const doc = {
      _id: "TST",
      baselines: { healthcare: { uninsuredRate: 9 } },
    } as unknown as StateMetricBaseline;
    const t = calculateMetricTarget(
      doc,
      "healthcare",
      "uninsuredRate",
      [],
      new Map(),
      0,
      9,
      "US",
      2019
    );
    expect(t).toBeCloseTo(9, 5);
  });

  it("is byte-identical when era args are omitted (legacy callers)", () => {
    const t = calculateMetricTarget(
      seedDoc,
      "infrastructure",
      "broadbandAccess",
      [],
      new Map(),
      0,
      0
    );
    expect(t).toBeCloseTo(0, 5); // legacy default eraYear = null
  });
});
