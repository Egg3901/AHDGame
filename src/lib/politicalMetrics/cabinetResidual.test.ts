import { describe, it, expect } from "vitest";
import {
  CABINET_KEY_TO_POLITICAL,
  mapCabinetDeltasToPolitical,
  mapRegionalCabinetDeltasToPolitical,
  foldCabinetResiduals,
  foldCabinetResidualsBySource,
  seedBySourceFromLegacy,
  sumCabinetResiduals,
  cappedSourceCount,
  CABINET_RESIDUAL_CAP_PER_SOURCE,
  CABINET_RESIDUAL_TOTAL_CEILING,
  CABINET_SOURCE_IDS,
} from "./cabinetResidual";
import { FAMILY_SLUGS, POLITICAL_METRIC_CATEGORIES } from "./types";

const VALID_IDS = new Set(
  POLITICAL_METRIC_CATEGORIES.flatMap((c) =>
    (FAMILY_SLUGS[c.id as keyof typeof FAMILY_SLUGS] as readonly string[]).map(
      (f) => `${c.id}.${f}`
    )
  )
);

describe("CABINET_KEY_TO_POLITICAL", () => {
  it("every mapped family id is a real PoliticalMetricId", () => {
    for (const targets of Object.values(CABINET_KEY_TO_POLITICAL)) {
      for (const t of targets ?? []) expect(VALID_IDS.has(t.id)).toBe(true);
    }
  });
});

describe("mapCabinetDeltasToPolitical", () => {
  it("maps a dotted StateMetrics path to its political families by weight", () => {
    // socialCohesion → society.civicLife (0.6) + society.integration (0.4)
    const out = mapCabinetDeltasToPolitical({ "social.socialCohesion": 1 });
    expect(out["society.civicLife"]).toBeGreaterThan(0);
    expect(out["society.integration"]).toBeGreaterThan(0);
    expect(out["society.civicLife"]).toBeGreaterThan(out["society.integration"]);
  });

  it("inverts sign for bad-when-high metrics (negative weight)", () => {
    // crimeRate → order.safety (-1): reducing crime (negative delta) strengthens safety.
    const out = mapCabinetDeltasToPolitical({ "publicSafety.crimeRate": -1 });
    expect(out["order.safety"]).toBeGreaterThan(0);
  });

  it("ignores unmapped keys", () => {
    expect(mapCabinetDeltasToPolitical({ "governance.governmentApproval": 1 })).toEqual({});
  });
});

describe("mapRegionalCabinetDeltasToPolitical", () => {
  it("maps each region's deltas independently and drops empty regions", () => {
    const out = mapRegionalCabinetDeltasToPolitical({
      CA: { "publicSafety.crimeRate": -0.02 },
      TX: { "governance.governmentApproval": 1 },
    });
    expect(out.CA?.["order.safety"]).toBeGreaterThan(0);
    expect(out.TX).toBeUndefined();
    expect(out.NY).toBeUndefined();
  });
});

describe("foldCabinetResiduals", () => {
  it("accumulates with decay and stays strictly below the cap", () => {
    let r: Record<string, number> = {};
    for (let i = 0; i < 100; i++) r = foldCabinetResiduals(r, { "order.safety": 5 });
    expect(r["order.safety"]).toBeLessThan(CABINET_RESIDUAL_CAP_PER_SOURCE);
    expect(r["order.safety"]).toBeGreaterThan(7.5);
  });

  it("decays toward zero when contribution stops", () => {
    let r = foldCabinetResiduals({ "order.safety": 8 }, {});
    // A legacy hard-pinned 8 drains, it does not collapse: still near the cap.
    expect(r["order.safety"]).toBeGreaterThan(7.9);
    // Small residuals fade on the old ~20-turn schedule; the drained latent
    // from a pinned start takes longer to wash out, so allow more turns.
    for (let i = 0; i < 70; i++) r = foldCabinetResiduals(r, {});
    expect(Math.abs(r["order.safety"] ?? 0)).toBeLessThan(0.1);
  });
});

/**
 * Ticket #1129 regression suite. Two players reported that building estates did
 * nothing. The cause was a SINGLE global cap on the whole cabinet channel: on
 * prod, 321 of 1522 US regional entries sat exactly at 8, and for
 * society.civicLife and economy.competition all 51 states did, so the marginal
 * estate contributed exactly zero. The cap is now per channel.
 */
describe("ticket #1129 — the cap is per source, not global", () => {
  const saturate = (source: string, metricId: string) => {
    let r: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 200; i++) {
      r = foldCabinetResidualsBySource(r, { [source]: { [metricId]: 5 } });
    }
    return r;
  };

  it("a new estate still contributes when another channel is saturated", () => {
    const saturated = saturate("orders", "society.civicLife");
    // Near the cap, never at it (issue #703): strictly below, effectively maxed.
    expect(saturated.orders["society.civicLife"]).toBeLessThan(CABINET_RESIDUAL_CAP_PER_SOURCE);
    expect(saturated.orders["society.civicLife"]).toBeGreaterThan(7.5);
    const before = sumCabinetResiduals(saturated)["society.civicLife"];

    // The estate lands in its own channel, so it buys real movement. The
    // saturated channel keeps its standing contribution, so it holds near the
    // cap rather than decaying.
    const after = foldCabinetResidualsBySource(saturated, {
      orders: { "society.civicLife": 5 },
      estates: { "society.civicLife": 1.5 },
    });
    const total = sumCabinetResiduals(after)["society.civicLife"];
    expect(total).toBeGreaterThan(before);
    // A fresh push lands just under its face value: the curve compresses a
    // little even on the first turn, and never lands above it.
    expect(after.estates["society.civicLife"]).toBeLessThan(1.5);
    expect(after.estates["society.civicLife"]).toBeGreaterThan(1.4);
    // The saturated channel still grows when pushed harder, only ever more
    // slowly: strictly more than before, still strictly below the cap. (Holding
    // the SAME push at steady state correctly changes nothing: that is
    // equilibrium, not saturation.)
    const pushed = foldCabinetResidualsBySource(saturated, {
      orders: { "society.civicLife": 6 },
    });
    expect(pushed.orders["society.civicLife"]).toBeGreaterThan(
      saturated.orders["society.civicLife"]
    );
    expect(pushed.orders["society.civicLife"]).toBeLessThan(CABINET_RESIDUAL_CAP_PER_SOURCE);
  });

  it("pushing an ALREADY saturated channel harder still buys a little more", () => {
    const saturated = saturate("estates", "economy.competition");
    // Same push at steady state is equilibrium: unchanged, not collapsed.
    const held = foldCabinetResidualsBySource(saturated, {
      estates: { "economy.competition": 5 },
    });
    expect(held.estates["economy.competition"]).toBe(saturated.estates["economy.competition"]);
    // A harder push buys strictly more, still strictly below the cap. Under
    // the old hard clamp both of these read exactly 8.0.
    const pushed = foldCabinetResidualsBySource(saturated, {
      estates: { "economy.competition": 8 },
    });
    expect(pushed.estates["economy.competition"]).toBeGreaterThan(
      saturated.estates["economy.competition"]
    );
    expect(pushed.estates["economy.competition"]).toBeLessThan(CABINET_RESIDUAL_CAP_PER_SOURCE);
  });

  it("holds the total ceiling at cap × channel count", () => {
    let r: Record<string, Record<string, number>> = {};
    const everyChannel = Object.fromEntries(
      CABINET_SOURCE_IDS.map((s) => [s, { "order.safety": 50 }])
    );
    for (let i = 0; i < 200; i++) r = foldCabinetResidualsBySource(r, everyChannel);
    // The ceiling is now a supremum: approached with every channel driven
    // absurdly hard, but never reached.
    expect(sumCabinetResiduals(r)["order.safety"]).toBeLessThan(CABINET_RESIDUAL_TOTAL_CEILING);
    expect(sumCabinetResiduals(r)["order.safety"]).toBeGreaterThan(47.5);
    expect(CABINET_RESIDUAL_TOTAL_CEILING).toBe(48);
    // Still under the ~62 points a fully stacked law book commands, so laws
    // remain the dominant channel.
    expect(CABINET_RESIDUAL_TOTAL_CEILING).toBeLessThan(62);
  });

  it("saturates negative pushes per channel symmetrically", () => {
    let r: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 200; i++) {
      r = foldCabinetResidualsBySource(r, { orders: { "order.safety": -5 } });
    }
    expect(r.orders["order.safety"]).toBeGreaterThan(-CABINET_RESIDUAL_CAP_PER_SOURCE);
    expect(r.orders["order.safety"]).toBeLessThan(-7.5);
  });

  it("cappedSourceCount counts only pinned channels", () => {
    const state = { orders: { "order.safety": 8 }, estates: { "order.safety": 3 } };
    expect(cappedSourceCount(state, "order.safety")).toBe(1);
    expect(cappedSourceCount(state, "economy.fiscal")).toBe(0);
  });
});

describe("seedBySourceFromLegacy — reinterpreting pre-split docs without a migration", () => {
  it("preserves the stored total, split by this turn's contribution shares", () => {
    const seeded = seedBySourceFromLegacy(
      { "society.civicLife": 8 },
      {
        settings: { "society.civicLife": 1.5 },
        estates: { "society.civicLife": 0.5 },
      }
    );
    expect(seeded.settings["society.civicLife"]).toBeCloseTo(6, 6);
    expect(seeded.estates["society.civicLife"]).toBeCloseTo(2, 6);
    expect(sumCabinetResiduals(seeded)["society.civicLife"]).toBeCloseTo(8, 4);
  });

  it("parks residual with no current contribution in the legacy channel, where it decays", () => {
    let seeded = seedBySourceFromLegacy({ "order.safety": 4 }, {});
    expect(seeded.legacy["order.safety"]).toBe(4);
    for (let i = 0; i < 60; i++) seeded = foldCabinetResidualsBySource(seeded, {});
    expect(sumCabinetResiduals(seeded)["order.safety"] ?? 0).toBeLessThan(0.1);
  });

  it("a seeded doc does not lurch on the first turn after the split", () => {
    const legacy = { "economy.competition": 8 };
    const contribution = { settings: { "economy.competition": 0.8 } };
    const seeded = seedBySourceFromLegacy(legacy, contribution);
    const next = foldCabinetResidualsBySource(seeded, contribution);
    // The old flat fold held exactly 8 here (8 × 0.9 + 0.8, clamped). The soft
    // fold drains a touch of latent instead, but stays within 0.02 of it.
    expect(sumCabinetResiduals(next)["economy.competition"]).toBeLessThanOrEqual(8);
    expect(sumCabinetResiduals(next)["economy.competition"]).toBeGreaterThan(7.9);
  });

  it("a seeded doc keeps decaying toward the new curve, not the old pin", () => {
    const seeded = seedBySourceFromLegacy(
      { "economy.competition": 8 },
      { settings: { "economy.competition": 0.8 } }
    );
    let r = seeded;
    const contribution = { settings: { "economy.competition": 0.8 } };
    for (let i = 0; i < 500; i++) r = foldCabinetResidualsBySource(r, contribution);
    // Settles at the soft steady state for 0.8/turn (~6.1), well below the old
    // pin, and strictly increasing if the push grows from there.
    const settled = sumCabinetResiduals(r)["economy.competition"];
    expect(settled).toBeGreaterThan(5.5);
    expect(settled).toBeLessThan(7);
    const raised = foldCabinetResidualsBySource(r, {
      settings: { "economy.competition": 0.9 },
    });
    expect(sumCabinetResiduals(raised)["economy.competition"]).toBeGreaterThan(settled);
  });
});

/**
 * Issue #703 regression suite. The hard clamp gave a steady state of
 * 10 × contribution, pinned at 8: any channel at or above 0.8/turn saturated
 * and further investment bought exactly zero, so pinned regions collapsed onto
 * the same rendered value ("all states are extremely similar"). The fold is
 * now a monotonic saturating curve with the cap as its asymptote.
 */
describe("issue #703 — the curve saturates without ever pinning", () => {
  const METRIC = "order.safety";
  const steady = (contribution: number, turns = 2000): number => {
    let r: Record<string, number> = {};
    for (let i = 0; i < turns; i++) r = foldCabinetResiduals(r, { [METRIC]: contribution });
    return r[METRIC] ?? 0;
  };

  it("matches the target shape from the issue", () => {
    // Old hard clamp gave 4.0, 8.0, 8.0, 8.0, 8.0 for these contributions.
    const targets: Array<[number, number]> = [
      [0.4, 3.6],
      [0.8, 6.0],
      [0.9, 6.4],
      [1.8, 7.6],
      [3.6, 7.9],
    ];
    for (const [contribution, target] of targets) {
      expect(steady(contribution)).toBeCloseTo(target, 0);
    }
  });

  it("is strictly monotonic across the full range, past the old saturation point", () => {
    const contributions = [0.05, 0.1, 0.4, 0.79, 0.8, 0.81, 0.9, 1.8, 3.6, 8, 20];
    const residuals = contributions.map((c) => steady(c));
    for (const r of residuals) {
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(CABINET_RESIDUAL_CAP_PER_SOURCE);
    }
    for (let i = 1; i < residuals.length; i++) {
      expect(residuals[i]).toBeGreaterThan(residuals[i - 1]);
    }
  });

  it("holds the asymptote even for an enormous contribution", () => {
    expect(steady(1000)).toBeLessThan(CABINET_RESIDUAL_CAP_PER_SOURCE);
    expect(steady(1000)).toBeGreaterThan(7.9);
    expect(steady(10000)).toBeLessThan(CABINET_RESIDUAL_CAP_PER_SOURCE);
  });

  it("two different large contributions produce two DIFFERENT residuals", () => {
    // This is the "all states look the same" symptom: under the hard clamp
    // both of these pinned at exactly 8.0.
    const moderate = steady(1.8);
    const heavy = steady(3.6);
    expect(moderate).toBeLessThan(CABINET_RESIDUAL_CAP_PER_SOURCE);
    expect(heavy).toBeLessThan(CABINET_RESIDUAL_CAP_PER_SOURCE);
    expect(heavy).toBeGreaterThan(moderate);
    expect(heavy - moderate).toBeGreaterThan(0.1);
  });

  it("is symmetric for negative contributions", () => {
    for (const c of [0.4, 0.9, 1.8, 5]) {
      expect(steady(-c)).toBeCloseTo(-steady(c), 6);
    }
    // One step is already odd: flipping every sign flips the result exactly.
    const up = foldCabinetResiduals({ [METRIC]: 2 }, { [METRIC]: 1 });
    const down = foldCabinetResiduals({ [METRIC]: -2 }, { [METRIC]: -1 });
    expect(down[METRIC]).toBeCloseTo(-(up[METRIC] ?? 0), 10);
  });

  it("keeps near-identity for small residuals", () => {
    // Unsaturated channels must behave as before: a tiny first push lands at
    // just under face value, and decay alone is within half a percent of 0.9x.
    const first = foldCabinetResiduals({}, { [METRIC]: 0.05 });
    expect(first[METRIC]).toBeCloseTo(0.05, 3);
    const decayed = foldCabinetResiduals({ [METRIC]: 1 }, {});
    expect(decayed[METRIC]).toBeCloseTo(0.9, 2);
  });

  it("gives a strictly positive but diminishing marginal gain at every level", () => {
    // More investment always buys more residual, but less the higher you are.
    // The gain is measured against decay alone so the decay term cancels out.
    const gains = [0, 1, 3, 5, 7].map((level) => {
      const pushed = foldCabinetResiduals({ [METRIC]: level }, { [METRIC]: 0.5 })[METRIC] ?? 0;
      const decayed = foldCabinetResiduals({ [METRIC]: level }, {})[METRIC] ?? 0;
      return pushed - decayed;
    });
    for (const gain of gains) expect(gain).toBeGreaterThan(0);
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeLessThan(gains[i - 1]);
    }
    // Even high on the curve a real push still buys a real gain.
    expect(gains[gains.length - 1]).toBeGreaterThan(0.05);
  });

  it("converges monotonically after a step-down, without oscillation", () => {
    // From the 1.8/turn steady state, cut the push to 0.4/turn: every turn
    // must move down toward the new steady state, never up, never past it.
    const target = steady(0.4);
    let r: Record<string, number> = { [METRIC]: steady(1.8) };
    let prev = r[METRIC] ?? 0;
    for (let i = 0; i < 400; i++) {
      r = foldCabinetResiduals(r, { [METRIC]: 0.4 });
      const v = r[METRIC] ?? 0;
      // Strictly down while far from the target; within 4dp quantization of
      // it the stored value may rest on the same rounded step.
      if (prev - target > 0.01) expect(v).toBeLessThan(prev);
      else expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(target - 0.001);
      prev = v;
    }
    expect(prev).toBeCloseTo(target, 1);
  });

  it("eases a legacy hard pin onto the curve from above", () => {
    // A doc pinned at exactly 8 by the old clamp, with a standing 0.9/turn
    // push: the first turn must not lurch (within 0.1 of the pin), then the
    // value drains monotonically down toward the soft steady state.
    const target = steady(0.9);
    let r: Record<string, number> = { [METRIC]: 8 };
    r = foldCabinetResiduals(r, { [METRIC]: 0.9 });
    const first = r[METRIC] ?? 0;
    expect(first).toBeLessThanOrEqual(8);
    expect(first).toBeGreaterThan(7.9);
    let prev = first;
    for (let i = 0; i < 500; i++) {
      r = foldCabinetResiduals(r, { [METRIC]: 0.9 });
      const v = r[METRIC] ?? 0;
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBeCloseTo(target, 1);
  });
});
