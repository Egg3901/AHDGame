import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { buildMapMetrics, loadMapMetrics } from "./metricsService";

describe("state map metric snapshot", () => {
  it("converts GDP stocks from millions without scaling incomes or scores", () => {
    const result = buildMapMetrics(
      [{ _id: "CA", gdp: 250, population: 1000, capitalStock: 500, outputGap: -2 }],
      [
        {
          _id: "CA",
          economic: { medianIncome: { value: 42000 }, unemploymentRate: { value: 0 } },
        } as MacroMetricsDoc,
      ],
      [
        { _id: "CA", values: { "health.outcomes": 72.5 } } as Pick<
          PoliticalMetricsDoc,
          "_id" | "values"
        >,
      ]
    );
    expect(result.states.CA).toMatchObject({
      gdp: 250_000_000,
      gdpPerCapita: 250_000,
      capitalStock: 500_000_000,
      outputGap: -2,
      "macro.economic.medianIncome": 42000,
      "macro.economic.unemploymentRate": 0,
      "score.health.outcomes": 72.5,
    });
    expect(result.definitions.find((d) => d.id === "score.health.outcomes")).toMatchObject({
      source: "score",
      suffix: " / 100",
    });
  });
  it("never invents zero data, divides by zero, or includes another state's values", () => {
    const result = buildMapMetrics(
      [{ _id: "CA", gdp: NaN, population: 0 }],
      [{ _id: "TX", economic: { gdpGrowth: { value: 5 } } } as MacroMetricsDoc],
      []
    );
    expect(result.states).toEqual({ CA: { population: 0 } });
    expect(result.definitions.map((d) => d.id)).toEqual(["population"]);
  });
  it("includes scores even when the state has no macro document", () => {
    const result = buildMapMetrics(
      [{ _id: "CA", gdp: 0, population: 20 }],
      [],
      [
        { _id: "CA", values: { "education.attainment": 65 } } as Pick<
          PoliticalMetricsDoc,
          "_id" | "values"
        >,
      ]
    );
    expect(result.states.CA["score.education.attainment"]).toBe(65);
  });
  it("batches projected country-and-roster-scoped reads", async () => {
    const find = vi.fn().mockReturnValue({ toArray: async () => [] });
    const collection = vi.fn().mockReturnValue({ find });
    await loadMapMetrics({ collection } as unknown as Db, ["CA"]);
    expect(collection.mock.calls.map((c) => c[0])).toEqual([
      "states",
      "macroMetrics",
      "politicalMetrics",
    ]);
    expect(find).toHaveBeenCalledTimes(3);
    for (const [filter, options] of find.mock.calls) {
      expect(filter).toEqual({ countryId: "US", _id: { $in: ["CA"] } });
      expect(options.projection).toBeDefined();
    }
    expect(find.mock.calls[2][1].projection).toEqual({ _id: 1, values: 1 });
  });
});
