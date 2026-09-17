import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { loadDemocraticHealth } from "./loadDemocraticHealth";

function values(overrides: Partial<Record<PoliticalMetricId, number>> = {}) {
  return Object.fromEntries(
    POLITICAL_METRIC_FAMILIES.map((family) => [family.id, overrides[family.id] ?? 70])
  ) as Record<PoliticalMetricId, number>;
}

describe("loadDemocraticHealth", () => {
  it("returns the population-weighted Governance Style health score", async () => {
    const db: MockDb = createMockDb();
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([
        { _id: "A", countryId: "US", values: values() },
        { _id: "B", countryId: "US", values: values({ "order.courts": 50 }) },
      ]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        { _id: "A", population: 3_000_000 },
        { _id: "B", population: 1_000_000 },
      ]);

    const health = await loadDemocraticHealth(db as unknown as Db, "US", {
      preset: "1953-default",
      presidentialTenureByCountry: {},
    });

    expect(health).toBeCloseTo(69.5, 1);
  });

  it("returns null when no political-metrics board exists", async () => {
    const db: MockDb = createMockDb();
    const health = await loadDemocraticHealth(db as unknown as Db, "US", null);
    expect(health).toBeNull();
  });
});
