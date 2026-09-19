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
  it("accumulates with decay and clamps to the cap", () => {
    let r: Record<string, number> = {};
    for (let i = 0; i < 100; i++) r = foldCabinetResiduals(r, { "order.safety": 5 });
    expect(r["order.safety"]).toBeLessThanOrEqual(CABINET_RESIDUAL_CAP_PER_SOURCE);
    expect(r["order.safety"]).toBeGreaterThan(0);
  });

  it("decays toward zero when contribution stops", () => {
    let r = foldCabinetResiduals({ "order.safety": 8 }, {});
    for (let i = 0; i < 50; i++) r = foldCabinetResiduals(r, {});
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
    expect(saturated.orders["society.civicLife"]).toBe(CABINET_RESIDUAL_CAP_PER_SOURCE);
    const before = sumCabinetResiduals(saturated)["society.civicLife"];

    // The estate lands in its own channel, so it buys real movement. The
    // saturated channel keeps its standing contribution, so it holds at the cap
    // rather than decaying.
    const after = foldCabinetResidualsBySource(saturated, {
      orders: { "society.civicLife": 5 },
      estates: { "society.civicLife": 1.5 },
    });
    const total = sumCabinetResiduals(after)["society.civicLife"];
    expect(total).toBeGreaterThan(before);
    expect(after.estates["society.civicLife"]).toBeCloseTo(1.5, 6);
    // The saturated channel is unchanged, not reduced to make room.
    expect(after.orders["society.civicLife"]).toBe(CABINET_RESIDUAL_CAP_PER_SOURCE);
  });

  it("adding to an ALREADY saturated channel still buys nothing", () => {
    const saturated = saturate("estates", "economy.competition");
    const after = foldCabinetResidualsBySource(saturated, {
      estates: { "economy.competition": 5 },
    });
    expect(after.estates["economy.competition"]).toBe(CABINET_RESIDUAL_CAP_PER_SOURCE);
  });

  it("holds the total ceiling at cap × channel count", () => {
    let r: Record<string, Record<string, number>> = {};
    const everyChannel = Object.fromEntries(
      CABINET_SOURCE_IDS.map((s) => [s, { "order.safety": 50 }])
    );
    for (let i = 0; i < 200; i++) r = foldCabinetResidualsBySource(r, everyChannel);
    expect(sumCabinetResiduals(r)["order.safety"]).toBe(CABINET_RESIDUAL_TOTAL_CEILING);
    expect(CABINET_RESIDUAL_TOTAL_CEILING).toBe(48);
    // Still under the ~62 points a fully stacked law book commands, so laws
    // remain the dominant channel.
    expect(CABINET_RESIDUAL_TOTAL_CEILING).toBeLessThan(62);
  });

  it("clamps negative pushes per channel too", () => {
    let r: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 200; i++) {
      r = foldCabinetResidualsBySource(r, { orders: { "order.safety": -5 } });
    }
    expect(r.orders["order.safety"]).toBe(-CABINET_RESIDUAL_CAP_PER_SOURCE);
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
    // 8 × 0.9 + 0.8 = 8, the same steady state the flat fold produced.
    expect(sumCabinetResiduals(next)["economy.competition"]).toBeCloseTo(8, 4);
  });
});
