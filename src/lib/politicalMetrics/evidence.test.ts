import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import type { MetricCategoryId } from "@/lib/db/types";
import { EVIDENCE_SERIES, loadEvidence } from "./evidence";

describe("EVIDENCE_SERIES (spec §D)", () => {
  it("references only real macro metric definitions", () => {
    for (const sources of Object.values(EVIDENCE_SERIES)) {
      for (const s of sources!) {
        if (s.kind !== "macro") continue;
        expect(
          getMetricDefinition(s.category as MetricCategoryId, s.metricId),
          `${s.category}.${s.metricId}`
        ).toBeTruthy();
      }
    }
  });
});

describe("loadEvidence", () => {
  it("resolves macro, bank, and budget rows for mapped families and omits unmapped", async () => {
    const db = createMockDb();
    db.collection("macroMetrics").findOne.mockResolvedValue({
      _id: "federal",
      economic: { medianIncome: { value: 3714, trend: 1.2 }, unemploymentRate: { value: 3.1 } },
      population: { birthRate: { value: 50 } },
    });
    db.collection("centralBanks").findOne.mockResolvedValue({ primeRate: 3 });
    db.collection("federalBudget").findOne.mockResolvedValue({
      debtToGdpRatio: 42.5,
      surplus: -1200,
      economicFactors: { inflationRate: 0.75 },
    });
    const map = await loadEvidence(db as unknown as Db, "US");

    const income = map.get("economy.householdIncome")!;
    expect(income.find((r) => r.id === "medianIncome")).toMatchObject({ value: 3714, trend: 1.2 });
    const stability = map.get("economy.stability")!;
    expect(stability.find((r) => r.id === "inflationRate")).toMatchObject({ value: 0.75 });
    expect(stability.find((r) => r.id === "primeRate")).toMatchObject({ value: 3 });
    const fiscal = map.get("economy.fiscal")!;
    expect(fiscal.find((r) => r.id === "debtToGdpRatio")).toMatchObject({ value: 42.5 });
    expect(map.get("governance.participation")).toBeUndefined();
    // Series with no stored value are skipped, not emitted as NaN rows.
    expect(income.some((r) => r.id === "wageGrowth")).toBe(false);
  });

  it("falls back to population-weighted regional aggregation before the first turn", async () => {
    const db = createMockDb();
    db.collection("macroMetrics").findOne.mockResolvedValue(null); // no national rollup yet
    db.collection("macroMetrics")
      .find()
      .toArray.mockResolvedValue([
        { _id: "MI", countryId: "US", economic: { medianIncome: { value: 3000, trend: 1 } } },
        { _id: "AL", countryId: "US", economic: { medianIncome: { value: 2000, trend: 0 } } },
      ]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        { _id: "MI", population: 3_000_000 },
        { _id: "AL", population: 1_000_000 },
      ]);
    db.collection("centralBanks").findOne.mockResolvedValue(null);
    db.collection("federalBudget").findOne.mockResolvedValue(null);
    const map = await loadEvidence(db as unknown as Db, "US");
    // (3000·3M + 2000·1M) / 4M = 2750; trend (1·3M + 0·1M)/4M = 0.75
    expect(map.get("economy.householdIncome")!.find((r) => r.id === "medianIncome")).toMatchObject({
      value: 2750,
      trend: 0.75,
    });
  });

  it("reads the region's own macro doc when a regionId is given", async () => {
    const db = createMockDb();
    db.collection("macroMetrics").findOne.mockResolvedValue({
      _id: "federal",
      economic: { unemploymentRate: { value: 5, trend: 0 } },
    });
    db.collection("macroMetrics")
      .find()
      .toArray.mockResolvedValue([
        { _id: "GA", countryId: "US", economic: { unemploymentRate: { value: 9, trend: 1 } } },
        { _id: "NY", countryId: "US", economic: { unemploymentRate: { value: 3, trend: 0 } } },
      ]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        { _id: "GA", population: 1_000_000 },
        { _id: "NY", population: 1_000_000 },
      ]);
    db.collection("centralBanks").findOne.mockResolvedValue(null);
    db.collection("federalBudget").findOne.mockResolvedValue(null);

    const map = await loadEvidence(db as unknown as Db, "US", null, "GA");
    // The national rollup says 5 and the two-region mean says 6. Neither is
    // Georgia's number, and Georgia's number is the whole point of a region view.
    const row = map.get("economy.workerSecurity")!.find((r) => r.id === "unemploymentRate")!;
    expect(row).toMatchObject({ value: 9, trend: 1, scope: "region" });
  });

  it("keeps bank and budget rows national in a region view", async () => {
    const db = createMockDb();
    db.collection("macroMetrics").findOne.mockResolvedValue(null);
    db.collection("macroMetrics").find().toArray.mockResolvedValue([]);
    db.collection("states").find().toArray.mockResolvedValue([]);
    db.collection("centralBanks").findOne.mockResolvedValue({ primeRate: 4 });
    db.collection("federalBudget").findOne.mockResolvedValue(null);

    const map = await loadEvidence(db as unknown as Db, "US", null, "GA");
    const row = map.get("economy.stability")!.find((r) => r.id === "primeRate")!;
    // The prime rate is set by the central bank for the whole country; labelling
    // it as Georgia's would be a fiction.
    expect(row).toMatchObject({ value: 4, scope: "national" });
  });

  it("emits no region row when that region has no macro doc", async () => {
    const db = createMockDb();
    db.collection("macroMetrics").findOne.mockResolvedValue({
      _id: "federal",
      economic: { unemploymentRate: { value: 5 } },
    });
    db.collection("macroMetrics").find().toArray.mockResolvedValue([]);
    db.collection("states").find().toArray.mockResolvedValue([]);
    db.collection("centralBanks").findOne.mockResolvedValue(null);
    db.collection("federalBudget").findOne.mockResolvedValue(null);

    const map = await loadEvidence(db as unknown as Db, "US", null, "GA");
    // Falling back to the national figure here would silently label a country
    // number as the region's own.
    expect(map.get("economy.workerSecurity")).toBeUndefined();
  });

  it("marks every row national when no regionId is given", async () => {
    const db = createMockDb();
    db.collection("macroMetrics").findOne.mockResolvedValue({
      _id: "federal",
      economic: { medianIncome: { value: 3714 } },
    });
    db.collection("centralBanks").findOne.mockResolvedValue(null);
    db.collection("federalBudget").findOne.mockResolvedValue(null);
    const map = await loadEvidence(db as unknown as Db, "US");
    expect(map.get("economy.householdIncome")!.every((r) => r.scope === "national")).toBe(true);
  });

  it("returns an empty map when no source docs exist", async () => {
    const db = createMockDb();
    db.collection("macroMetrics").findOne.mockResolvedValue(null);
    db.collection("centralBanks").findOne.mockResolvedValue(null);
    db.collection("federalBudget").findOne.mockResolvedValue(null);
    const map = await loadEvidence(db as unknown as Db, "US");
    expect(map.size).toBe(0);
  });
});
