import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/country/nationalMetrics", () => ({ loadNationalMetrics: vi.fn() }));

describe("public country metrics query", () => {
  beforeEach(() => vi.clearAllMocks());

  it("publishes aggregates and regional approval without internal modifiers", async () => {
    const { loadNationalMetrics } = await import("@/lib/country/nationalMetrics");
    vi.mocked(loadNationalMetrics).mockResolvedValue({
      categories: {
        economic: {
          unemploymentRate: {
            average: 5,
            populationWeightedAverage: 4.5,
            trend: -0.2,
            min: { value: 3, stateId: "CA", stateName: "California" },
            max: { value: 7, stateId: "TX", stateName: "Texas" },
          },
        },
      },
      stateRankings: {},
      totalPopulation: 100,
      gdpMillions: 250,
      gdpPerCapita: 2_500_000,
      currencyCode: "USD",
      tickRates: { economic: { unemploymentRate: -0.01 } },
      calculatedAt: "2026-01-01T00:00:00.000Z",
      governmentApproval: 54,
      governmentApprovalBase: 50,
      governmentApprovalModifiers: [{ id: "internal" }],
      stateApprovals: [
        {
          stateId: "CA",
          stateName: "California",
          approval: 60,
          baseApproval: 55,
          modifiers: [{ id: "private-driver" }],
        },
      ],
    } as never);

    const { queryCountryMetrics } = await import("./metrics");
    const result = await queryCountryMetrics("us", "economic");

    expect(loadNationalMetrics).toHaveBeenCalledWith("US", "economic");
    expect(result).toMatchObject({
      found: true,
      countryId: "US",
      population: 100,
      categories: { economic: { unemploymentRate: { populationWeightedAverage: 4.5 } } },
      regions: [{ id: "CA", approval: 60, baseApproval: 55 }],
    });
    expect(result).not.toHaveProperty("tickRates");
    expect(result).not.toHaveProperty("governmentApprovalModifiers");
    const regions = result && "regions" in result ? result.regions : undefined;
    expect(regions).toBeDefined();
    expect(regions?.[0]).not.toHaveProperty("modifiers");
  });

  it("rejects unknown country codes before loading metrics", async () => {
    const { loadNationalMetrics } = await import("@/lib/country/nationalMetrics");
    const { queryCountryMetrics } = await import("./metrics");

    expect(await queryCountryMetrics("XX")).toBeNull();
    expect(loadNationalMetrics).not.toHaveBeenCalled();
  });
});
