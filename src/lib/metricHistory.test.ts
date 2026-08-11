import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { METRIC_HISTORY_CAP, snapshotMetricHistory } from "./metricHistory";

function makeDb(stateMetrics: unknown[]) {
  const bulkWrite = vi.fn().mockResolvedValue({ ok: 1 });

  return {
    collection: vi.fn((name: string) => {
      // SP5: economic fixtures live on macroMetrics; the political store is
      // empty here and both history collections share the captured bulkWrite.
      if (name === "macroMetrics") {
        return {
          find: () => ({ toArray: async () => stateMetrics }),
        };
      }
      if (name === "stateMetrics") {
        return {
          find: () => ({ toArray: async () => [] }),
        };
      }

      if (name === "stateMetricHistory" || name === "macroMetricsHistory") {
        return { bulkWrite };
      }

      throw new Error(`Unexpected collection: ${name}`);
    }),
    _bulkWrite: bulkWrite,
  };
}

describe("snapshotMetricHistory", () => {
  it("snapshots precomputed national docs once using their stored values", async () => {
    const db = makeDb([
      { _id: "TX", economic: { unemploymentRate: { value: 5 } } },
      { _id: "NY", economic: { unemploymentRate: { value: 3 } } },
      {
        _id: "federal",
        economic: {
          unemploymentRate: { value: 9.5 },
          gdpGrowth: { value: 2.7 },
        },
      },
    ]);

    await snapshotMetricHistory(db as unknown as Db, 12);

    // Two bulkWrite calls: one for states, one for nationals
    expect(db._bulkWrite).toHaveBeenCalledTimes(2);

    const [stateOps] = db._bulkWrite.mock.calls[0] as [unknown[]];
    expect(stateOps.length).toBe(2); // TX and NY

    const [nationalOps] = db._bulkWrite.mock.calls[1] as [unknown[]];
    expect(nationalOps.length).toBe(1); // federal

    const federalOp = (
      nationalOps as Array<{ updateOne: { filter: { _id: string }; update: unknown } }>
    )[0];
    expect(federalOp.updateOne.filter._id).toBe("federal");
    expect(federalOp.updateOne.update).toEqual({
      $push: {
        "economic.unemploymentRate": {
          $each: [{ turn: 12, value: 9.5 }],
          $slice: -METRIC_HISTORY_CAP,
        },
        "economic.gdpGrowth": {
          $each: [{ turn: 12, value: 2.7 }],
          $slice: -METRIC_HISTORY_CAP,
        },
      },
    });
  });
});
