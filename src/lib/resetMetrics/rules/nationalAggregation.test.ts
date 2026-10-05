import { describe, expect, it } from "vitest";
import { primaryMetricById } from "../catalog";
import type { OpeningMetricObservation } from "./openingObservation";
import {
  aggregateNationalMetricHistory,
  aggregateNationalMetricObservations,
} from "./nationalAggregation";

function observation(metricId: string, value: number, status: "derived" | "proxy" = "derived") {
  const metric = primaryMetricById(metricId)!;
  return {
    metricId,
    path: metric.path,
    value,
    status,
    source: "regional owner",
    owner: metric.owner,
    note: "Regional observation.",
  } satisfies OpeningMetricObservation;
}

function completeRegionalObservations(value: (metricId: string) => number) {
  return Object.fromEntries(
    Array.from({ length: 58 }, (_, index) => String(index + 1).padStart(2, "0"))
      .filter((id) => !["07", "09", "10", "57", "58"].includes(id))
      .map((id) => [id, observation(id, value(id))])
  );
}

describe("national v2 metric aggregation", () => {
  it("rolls all 53 region-owned metrics into a national read model", () => {
    const result = aggregateNationalMetricObservations([
      {
        regionId: "A",
        population: 100,
        workingAgePopulation: 60,
        votingEligiblePopulation: 70,
        gdp: 200,
        observations: completeRegionalObservations(() => 10),
      },
      {
        regionId: "B",
        population: 300,
        workingAgePopulation: 240,
        votingEligiblePopulation: 210,
        gdp: 800,
        observations: completeRegionalObservations(() => 30),
      },
    ]);

    expect(Object.keys(result)).toHaveLength(53);
    expect(result["02"]!.value).toBe(25);
    expect(result["05"]!.value).toBe(26);
    expect(result["51"]!.value).toBe(25);
    expect(result["07"]).toBeUndefined();
  });

  it("keeps a national result provisional when a regional source is provisional", () => {
    const first = completeRegionalObservations(() => 10);
    first["43"] = observation("43", 10, "proxy");
    const result = aggregateNationalMetricObservations([
      { regionId: "A", population: 100, observations: first },
      { regionId: "B", population: 100, observations: completeRegionalObservations(() => 20) },
    ]);
    expect(result["43"]!.status).toBe("proxy");
  });

  it("rejects an incomplete regional board", () => {
    expect(() =>
      aggregateNationalMetricObservations([
        { regionId: "A", population: 100, observations: { "01": observation("01", 5) } },
      ])
    ).toThrow(/missing A\/02/);
  });

  it("uses the same weights for every aligned history point", () => {
    const observationsA = completeRegionalObservations(() => 10);
    const observationsB = completeRegionalObservations(() => 30);
    const result = aggregateNationalMetricHistory("02", [
      {
        regionId: "A",
        population: 100,
        observations: observationsA,
        history: {
          "02": [
            { turn: 1, value: 10 },
            { turn: 13, value: 12 },
          ],
        },
      },
      {
        regionId: "B",
        population: 300,
        observations: observationsB,
        history: {
          "02": [
            { turn: 1, value: 30 },
            { turn: 13, value: 34 },
          ],
        },
      },
    ]);
    expect(result).toEqual([
      { turn: 1, value: 25 },
      { turn: 13, value: 28.5 },
    ]);
  });
});
