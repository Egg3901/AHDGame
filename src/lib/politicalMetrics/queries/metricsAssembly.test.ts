import { describe, expect, it } from "vitest";
import { REGIONAL_SUPPLEMENT_FACTOR } from "@/lib/politicalLegislation/dynamics";
import { CABINET_RESIDUAL_CAP_PER_SOURCE } from "../cabinetResidual";
import type { PoliticalMetricId } from "../types";
import {
  buildModifiers,
  cabinetContributionsFor,
  driftHalfLifeTurns,
  type ModifiersInput,
} from "./metricsAssembly";

const METRIC = "economy.workerSecurity" as PoliticalMetricId;

const BASE: ModifiersInput = {
  countryId: "US",
  metricId: METRIC,
  nationalLevels: new Map<string, number>(),
  regionalLevels: new Map<string, number>(),
  nationalPoints: 40,
  regionalSupplementPoints: 0,
  residual: 5,
  cabinet: 2,
  labour: 0,
  cabinetBySource: [],
  cabinetAtCap: false,
  currentValue: 40,
};

describe("buildModifiers", () => {
  it("composes the national target from points plus residual plus cabinet plus labour", () => {
    expect(buildModifiers({ ...BASE }).target).toBe(47);
  });

  it("applies the regional supplement at half strength, not full", () => {
    const out = buildModifiers({ ...BASE, regionalSupplementPoints: 10 });
    expect(out.target).toBe(40 + REGIONAL_SUPPLEMENT_FACTOR * 10 + 5 + 2);
    expect(out.target).toBe(52);
  });

  it("includes the labour channel in the target", () => {
    expect(buildModifiers({ ...BASE, labour: -3 }).target).toBe(44);
  });

  it("reports drift direction against the current value", () => {
    expect(buildModifiers({ ...BASE, currentValue: 10 }).direction).toBe("up");
    expect(buildModifiers({ ...BASE, currentValue: 90 }).direction).toBe("down");
    expect(buildModifiers({ ...BASE, currentValue: 47 }).direction).toBe("flat");
  });

  it("clamps the target into 0..100", () => {
    expect(buildModifiers({ ...BASE, residual: 900 }).target).toBe(100);
    expect(buildModifiers({ ...BASE, residual: -900 }).target).toBe(0);
  });

  it("names the per-channel cabinet cap rather than leaving the UI to hard-code it", () => {
    expect(buildModifiers({ ...BASE }).cabinetCap).toBe(CABINET_RESIDUAL_CAP_PER_SOURCE);
  });

  it("emits no regional law rows when the region carries no levels", () => {
    expect(buildModifiers({ ...BASE }).regionalLaws).toEqual([]);
  });

  it("halves the points on regional law rows so they match the composed target", () => {
    // us.infrastructure.transit.primary is a `both` law: primary, 12.5/level.
    const metricId = "infrastructure.transit" as PoliticalMetricId;
    const regionalLevels = new Map([["us.infrastructure.transit.primary", 4]]);
    const out = buildModifiers({
      ...BASE,
      metricId,
      regionalLevels,
      nationalPoints: 0,
      regionalSupplementPoints: 50,
      residual: 0,
      cabinet: 0,
    });
    const row = out.regionalLaws.find((r) => r.lawId === "us.infrastructure.transit.primary");
    expect(row?.points).toBe(12.5 * 4 * REGIONAL_SUPPLEMENT_FACTOR);
    // The row total and the composed target agree: that is the whole point of
    // halving the row rather than displaying the raw ladder points.
    expect(out.regionalLaws.reduce((s, r) => s + r.points, 0)).toBe(out.target);
  });
});

describe("cabinetContributionsFor", () => {
  it("sums the per-source split and orders it by magnitude", () => {
    const out = cabinetContributionsFor(
      {
        cabinetResiduals: { [METRIC]: 5 } as Record<PoliticalMetricId, number>,
        cabinetResidualsBySource: {
          orders: { [METRIC]: 1 },
          estates: { [METRIC]: 4 },
        } as never,
      },
      METRIC
    );
    expect(out.total).toBe(5);
    expect(out.bySource.map((r) => r.source)).toEqual(["estates", "orders"]);
    expect(out.saturated).toBe(false);
  });

  it("omits channels contributing exactly nothing", () => {
    const out = cabinetContributionsFor(
      {
        cabinetResiduals: { [METRIC]: 3 } as Record<PoliticalMetricId, number>,
        cabinetResidualsBySource: {
          orders: { [METRIC]: 3 },
          estates: { [METRIC]: 0 },
        } as never,
      },
      METRIC
    );
    expect(out.bySource).toHaveLength(1);
  });

  it("is saturated only when EVERY channel is pinned, not merely one", () => {
    const onePinned = cabinetContributionsFor(
      {
        cabinetResiduals: { [METRIC]: 8 } as Record<PoliticalMetricId, number>,
        cabinetResidualsBySource: {
          orders: { [METRIC]: CABINET_RESIDUAL_CAP_PER_SOURCE },
        } as never,
      },
      METRIC
    );
    expect(onePinned.saturated).toBe(false);
  });

  it("falls back to the total ceiling for a doc written before the per-source split", () => {
    const out = cabinetContributionsFor(
      { cabinetResiduals: { [METRIC]: 2 } as Record<PoliticalMetricId, number> },
      METRIC
    );
    expect(out.total).toBe(2);
    expect(out.bySource).toEqual([]);
    expect(out.saturated).toBe(false);
  });

  it("treats a missing cabinet map as no contribution", () => {
    expect(cabinetContributionsFor({}, METRIC)).toEqual({
      total: 0,
      saturated: false,
      bySource: [],
    });
  });
});

describe("driftHalfLifeTurns", () => {
  it("is 0 for a degenerate rate", () => {
    expect(driftHalfLifeTurns(0)).toBe(0);
    expect(driftHalfLifeTurns(1)).toBe(0);
  });

  it("is 34 turns at the shipped 0.02 rate", () => {
    expect(driftHalfLifeTurns(0.02)).toBe(34);
  });
});
