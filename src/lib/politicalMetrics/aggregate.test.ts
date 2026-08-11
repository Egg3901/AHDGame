import { describe, expect, it } from "vitest";
import { aggregateNationalPoliticalMetrics, categoryScore, overallScore } from "./aggregate";
import { POLITICAL_METRIC_FAMILIES } from "./families";
import type { PoliticalMetricId } from "./types";

const fill = (v: number) =>
  Object.fromEntries(POLITICAL_METRIC_FAMILIES.map((f) => [f.id, v])) as Record<
    PoliticalMetricId,
    number
  >;

describe("aggregateNationalPoliticalMetrics", () => {
  it("population-weights region values", () => {
    const docs = [
      { _id: "A", values: fill(80) },
      { _id: "B", values: fill(40) },
    ];
    const pop = new Map([
      ["A", 3_000_000],
      ["B", 1_000_000],
    ]);
    const national = aggregateNationalPoliticalMetrics(docs, pop);
    expect(national["economy.workerSecurity"]).toBeCloseTo(70, 5); // (80·3 + 40·1) / 4
  });

  it("skips regions with unknown or non-positive population and tolerates missing metric keys", () => {
    const partial = fill(60);
    delete (partial as Record<string, number>)["economy.workerSecurity"];
    const docs = [
      { _id: "A", values: fill(80) },
      { _id: "B", values: partial },
      { _id: "GHOST", values: fill(0) },
    ];
    const pop = new Map([
      ["A", 1_000_000],
      ["B", 1_000_000],
    ]);
    const national = aggregateNationalPoliticalMetrics(docs, pop);
    expect(national["economy.workerSecurity"]).toBeCloseTo(80, 5); // only A has the key
    expect(national["economy.mobility"]).toBeCloseTo(70, 5); // A 80, B 60, GHOST excluded
  });

  it("category score = mean of its 7 families; overall = mean of 9 categories", () => {
    const values = fill(50);
    values["economy.workerSecurity"] = 64; // lifts economy by 2
    expect(categoryScore(values, "economy")).toBeCloseTo(52, 5);
    expect(overallScore(values)).toBeCloseTo(50 + 2 / 9, 5);
  });
});
