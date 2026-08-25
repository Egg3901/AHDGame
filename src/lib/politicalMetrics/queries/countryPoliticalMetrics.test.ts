import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { NATIONAL_BASELINES_1953 } from "../seeds/nationalBaselines1953";
import { POLITICAL_METRIC_FAMILIES } from "../families";
import type { PoliticalMetricId } from "../types";
import { loadCountryPoliticalMetrics } from "./countryPoliticalMetrics";

/** Region values = US national baselines, with an optional per-metric override. */
function regionValues(overrides: Partial<Record<PoliticalMetricId, number>> = {}) {
  const values = {} as Record<PoliticalMetricId, number>;
  for (const f of POLITICAL_METRIC_FAMILIES) {
    values[f.id] = overrides[f.id] ?? NATIONAL_BASELINES_1953.US[f.id].value;
  }
  return values;
}

const DOCS = [
  { _id: "MI", countryId: "US", values: regionValues({ "economy.workerSecurity": 69 }) },
  { _id: "AL", countryId: "US", values: regionValues({ "economy.workerSecurity": 55 }) },
];
const STATES = [
  { _id: "MI", name: "Michigan", population: 6_500_000 },
  { _id: "AL", name: "Alabama", population: 3_000_000 },
];

describe("loadCountryPoliticalMetrics", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("politicalMetrics").find().toArray.mockResolvedValue(DOCS);
    db.collection("states").find().toArray.mockResolvedValue(STATES);
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 212,
      currentYear: 1953,
      preset: "1953-default",
    });
  });

  it("returns 9 categories × 7 lean-ordered metrics with national + per-region values", async () => {
    const res = await loadCountryPoliticalMetrics("US", db as unknown as Db);
    expect(res).not.toBeNull();
    expect(res!.countryId).toBe("US");
    expect(res!.categories).toHaveLength(9);
    for (const cat of res!.categories) {
      expect(cat.metrics).toHaveLength(7);
      expect(cat.metrics.map((m) => m.lean)).toEqual([-5, -3, -1, 0, 1, 3, 5]);
      for (const m of cat.metrics) {
        expect(m.displayName.length).toBeGreaterThan(3);
        expect(m.nationalValue).toBeGreaterThanOrEqual(0);
        expect(m.nationalValue).toBeLessThanOrEqual(100);
        expect(m.regions.map((r) => r.regionId).sort()).toEqual(["AL", "MI"]);
        expect(m.indicators.length).toBeGreaterThan(0);
      }
    }
    // Population-weighted national for the overridden metric: (69·6.5M + 55·3M) / 9.5M ≈ 64.6
    const worker = res!.categories[0].metrics[0];
    expect(worker.id).toBe("economy.workerSecurity");
    expect(worker.nationalValue).toBeCloseTo(64.6, 1);
    // Regions sorted by value, names resolved.
    expect(worker.regions[0]).toMatchObject({ regionId: "MI", name: "Michigan", value: 69 });
    expect(res!.overall).toBeGreaterThan(0);
    expect(res!.governanceStyle.name).toBe("Governance Style");
    expect(res!.governanceStyle.leftRight.value).toBeGreaterThanOrEqual(0);
    expect(res!.governanceStyle.leftRight.value).toBeLessThanOrEqual(100);
    expect(res!.governanceStyle.democraticHealth.value).toBeGreaterThanOrEqual(0);
    expect(res!.governanceStyle.democraticHealth.value).toBeLessThanOrEqual(100);
    expect(res!.turn).toBe(212);
  });

  it("uses early-era indicators for a campaign-start world", async () => {
    const res = await loadCountryPoliticalMetrics("US", db as unknown as Db);
    const worker = res!.categories[0].metrics[0];
    expect(worker.indicators).toContain("Strike settlement rate"); // early list
    expect(worker.indicators).not.toContain("Gig-work coverage"); // modern list
  });

  it("subtracts lopsided party control from health without moving political direction", async () => {
    const balanced = await loadCountryPoliticalMetrics("US", db as unknown as Db);
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { party: "dem", seatsHeld: 75 },
        { party: "rep", seatsHeld: 25 },
      ]);

    const lopsided = await loadCountryPoliticalMetrics("US", db as unknown as Db);

    expect(lopsided!.governanceStyle.leftRight.value).toBe(
      balanced!.governanceStyle.leftRight.value
    );
    expect(lopsided!.governanceStyle.democraticHealth.value).toBe(
      balanced!.governanceStyle.democraticHealth.value - 12
    );
    expect(lopsided!.governanceStyle.competition).toMatchObject({
      dominantPartyId: "dem",
      dominantSeatShare: 75,
      penalty: 12,
    });
  });

  it("returns null when the country has no political metrics docs", async () => {
    db.collection("politicalMetrics").find().toArray.mockResolvedValue([]);
    const res = await loadCountryPoliticalMetrics("UK", db as unknown as Db);
    expect(res).toBeNull();
  });

  it("attaches underlying-statistics evidence for mapped families only (SP6 §D)", async () => {
    db.collection("macroMetrics").findOne.mockResolvedValue({
      _id: "federal",
      economic: { medianIncome: { value: 3714, trend: 1.2 } },
    });
    const res = await loadCountryPoliticalMetrics("US", db as unknown as Db);
    const income = res!.categories[0].metrics.find((m) => m.id === "economy.householdIncome")!;
    expect(income.evidence.find((r) => r.id === "medianIncome")).toMatchObject({
      value: 3714,
      trend: 1.2,
    });
    const participation = res!.categories
      .find((c) => c.id === "governance")!
      .metrics.find((m) => m.id === "governance.participation")!;
    expect(participation.evidence).toEqual([]);
  });
});
