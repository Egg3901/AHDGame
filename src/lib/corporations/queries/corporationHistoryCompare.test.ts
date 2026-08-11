import { describe, expect, it } from "vitest";
import {
  computeSnapshotDeltas,
  toAnchorMetricMap,
  SNAPSHOT_COMPARE_METRICS,
  type CorpHistoryComparePoint,
  type SnapshotMetricKey,
} from "./corporationHistoryCompare";

function metricMap(
  overrides: Partial<Record<SnapshotMetricKey, number>>
): Record<SnapshotMetricKey, number> {
  return {
    revenue: 0,
    income: 0,
    marketCap: 0,
    sharePrice: 0,
    liquidCapital: 0,
    ...overrides,
  };
}

describe("computeSnapshotDeltas", () => {
  it("returns one delta per compare metric, in config order", () => {
    const deltas = computeSnapshotDeltas(metricMap({}), metricMap({}));
    expect(deltas.map((d) => d.key)).toEqual(SNAPSHOT_COMPARE_METRICS.map((m) => m.key));
  });

  it("computes absolute and percent change relative to the earlier ('then') value", () => {
    const from = metricMap({ revenue: 100, marketCap: 200 });
    const to = metricMap({ revenue: 150, marketCap: 100 });
    const byKey = Object.fromEntries(computeSnapshotDeltas(from, to).map((d) => [d.key, d]));
    expect(byKey.revenue.delta).toBe(50);
    expect(byKey.revenue.pctDelta).toBeCloseTo(50);
    expect(byKey.marketCap.delta).toBe(-100);
    expect(byKey.marketCap.pctDelta).toBeCloseTo(-50);
  });

  it("returns a null pctDelta when the baseline is zero (no divide-by-zero)", () => {
    const [rev] = computeSnapshotDeltas(metricMap({ revenue: 0 }), metricMap({ revenue: 25 }));
    expect(rev.delta).toBe(25);
    expect(rev.pctDelta).toBeNull();
  });

  it("keeps percent sign correct when the baseline is negative (recovering losses)", () => {
    // income improves from -100 to -40 → +60 change, and pct is positive (better).
    const from = metricMap({ income: -100 });
    const to = metricMap({ income: -40 });
    const [, income] = computeSnapshotDeltas(from, to);
    expect(income.key).toBe("income");
    expect(income.delta).toBe(60);
    expect(income.pctDelta).toBeCloseTo(60); // 60 / |−100| * 100
  });
});

describe("toAnchorMetricMap", () => {
  const point: CorpHistoryComparePoint = {
    turn: 10,
    revenue: 200,
    income: 50,
    marketCap: 1000,
    sharePrice: 20,
    liquidCapital: 500,
    currencyCode: "GBP",
    fxRateAtWrite: 2,
  };

  it("divides money fields by the write-time FX rate to reach ₳", () => {
    const map = toAnchorMetricMap(point, (val, code, fx) =>
      code && typeof fx === "number" && fx > 0 ? val / fx : val
    );
    expect(map.revenue).toBe(100);
    expect(map.marketCap).toBe(500);
    expect(map.sharePrice).toBe(10);
  });

  it("passes values through unchanged when the point carries no currency code (legacy ₳)", () => {
    const anchorPoint: CorpHistoryComparePoint = { ...point, currencyCode: undefined };
    const map = toAnchorMetricMap(anchorPoint, (val, code, fx) =>
      code && typeof fx === "number" && fx > 0 ? val / fx : val
    );
    expect(map.revenue).toBe(200);
    expect(map.liquidCapital).toBe(500);
  });
});
