import { describe, it, expect } from "vitest";
import {
  CABINET_KEY_TO_POLITICAL,
  mapCabinetDeltasToPolitical,
  mapRegionalCabinetDeltasToPolitical,
  foldCabinetResiduals,
  CABINET_RESIDUAL_CAP,
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
    expect(r["order.safety"]).toBeLessThanOrEqual(CABINET_RESIDUAL_CAP);
    expect(r["order.safety"]).toBeGreaterThan(0);
  });

  it("decays toward zero when contribution stops", () => {
    let r = foldCabinetResiduals({ "order.safety": 8 }, {});
    for (let i = 0; i < 50; i++) r = foldCabinetResiduals(r, {});
    expect(Math.abs(r["order.safety"] ?? 0)).toBeLessThan(0.1);
  });
});
