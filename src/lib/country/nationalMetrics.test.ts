import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadNationalMetrics } from "./nationalMetrics";
import { getDb } from "@/lib/mongodb";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/macroMetrics/merge", () => ({ findMergedRegionMetricsMany: vi.fn() }));
vi.mock("@/lib/politicalLegislation/politicalApprovalProvider", () => ({
  isPoliticalApprovalCountry: () => true,
  loadPoliticalApprovalBases: async () => ({ byRegion: new Map(), national: 50 }),
}));
vi.mock("@/lib/api/stateTickRates", () => ({
  computeAllNationalMetricTickRates: async () => ({}),
}));

describe("loadNationalMetrics dictionaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue({
      collection: (name: string) => ({
        find: () => ({
          toArray: async () =>
            name === "states"
              ? [
                  { _id: "TX", countryId: "US", name: "Texas", population: 3, gdp: 0 },
                  { _id: "NY", countryId: "US", name: "New York", population: 1, gdp: 0 },
                ]
              : [],
        }),
        findOne: async () => null,
      }),
    } as never);
  });

  it("omits prototype-related metric keys while preserving weighted metrics and rankings", async () => {
    const texas = JSON.parse(
      '{"_id":"TX","countryId":"US","economic":{"unemploymentRate":{"value":4,"trend":2},"__proto__":{"value":999},"constructor":{"value":999},"prototype":{"value":999}}}'
    );
    vi.mocked(findMergedRegionMetricsMany).mockResolvedValue([
      texas,
      { _id: "NY", countryId: "US", economic: { unemploymentRate: { value: 8, trend: 6 } } },
    ] as never);
    const response = await loadNationalMetrics("US", "economic");
    expect(response).not.toBeNull();
    expect(response!.categories.economic.unemploymentRate).toMatchObject({
      average: 6,
      populationWeightedAverage: 5,
      trend: 3,
    });
    expect(response!.stateRankings.economic.unemploymentRate.map((row) => row.stateId)).toEqual([
      "TX",
      "NY",
    ]);
    expect(Object.keys(response!.categories.economic)).toEqual(["unemploymentRate"]);
    expect(Object.keys(response!.stateRankings.economic)).toEqual(["unemploymentRate"]);
    expect(Object.getPrototypeOf(response!.categories.economic)).toBeNull();
    expect(Object.getPrototypeOf(response!.stateRankings.economic)).toBeNull();
    expect(Object.hasOwn(Object.prototype, "average")).toBe(false);
    expect(
      JSON.parse(JSON.stringify(response)).categories.economic.unemploymentRate
        .populationWeightedAverage
    ).toBe(5);
  });
});
