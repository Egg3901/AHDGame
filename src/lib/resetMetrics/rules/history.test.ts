import { describe, expect, it } from "vitest";
import { primaryMetricById } from "../catalog";
import type { OpeningMetricObservation } from "./openingObservation";
import {
  appendMetricHistory,
  metricHistoryDue,
  openingMetricHistory,
  RESET_METRIC_HISTORY_CADENCE_TURNS,
} from "./history";

function observation(id: string, value: number): OpeningMetricObservation {
  const metric = primaryMetricById(id)!;
  return {
    metricId: id,
    path: metric.path,
    value,
    status: "derived",
    source: "test owner",
    owner: metric.owner,
    note: "Test observation.",
  };
}

describe("reset metric history", () => {
  it("opens every series at the seed turn and appends immutable snapshots", () => {
    const opening = { "01": observation("01", 5), "02": observation("02", 20_000) };
    const history = openingMetricHistory(opening, 1);
    const next = appendMetricHistory(
      history,
      { "01": observation("01", 4), "02": observation("02", 20_500) },
      13
    );
    expect(history["01"]).toEqual([{ turn: 1, value: 5 }]);
    expect(next["01"]).toEqual([
      { turn: 1, value: 5 },
      { turn: 13, value: 4 },
    ]);
    expect(next["02"]?.at(-1)).toEqual({ turn: 13, value: 20_500 });
  });

  it("uses a yearly cadence and rejects a divergent replay", () => {
    expect(metricHistoryDue(1, 1 + RESET_METRIC_HISTORY_CADENCE_TURNS)).toBe(true);
    expect(metricHistoryDue(1, 2)).toBe(false);
    const observations = { "01": observation("01", 5) };
    const history = appendMetricHistory(openingMetricHistory(observations, 1), observations, 13);
    expect(() => appendMetricHistory(history, { "01": observation("01", 6) }, 13)).toThrow(
      "replay differs"
    );
  });
});
