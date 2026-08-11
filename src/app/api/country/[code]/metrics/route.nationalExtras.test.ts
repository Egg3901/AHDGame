import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/stateTickRates", () => ({
  computeAllNationalMetricTickRates: vi.fn().mockResolvedValue({
    economic: { unemploymentRate: 0.01 },
  }),
}));

const states = [
  { _id: "CA", countryId: "US", name: "California", population: 39_000_000, gdp: 3_000_000 },
  { _id: "TX", countryId: "US", name: "Texas", population: 30_000_000, gdp: 2_000_000 },
];
const macroMetrics = [
  { _id: "CA", economic: { unemploymentRate: { value: 4, trend: -2 } } },
  { _id: "TX", economic: { unemploymentRate: { value: 5, trend: 1 } } },
];

function cursorOf<T>(data: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(data),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("national metrics route — GDP + trend + tick rates", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    // Materialize the lazily-created collection mocks before overriding find().
    db.collection("states");
    db.collection("macroMetrics");
    db.collectionMocks.states!.find.mockReturnValue(cursorOf(states) as never);
    db.collectionMocks.macroMetrics!.find.mockReturnValue(cursorOf(macroMetrics) as never);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  async function callRoute() {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/country/us/metrics"), {
      params: Promise.resolve({ code: "us" }),
    });
    return res.json();
  }

  it("returns population-weighted national trend per metric", async () => {
    const json = await callRoute();
    // (-2*39 + 1*30) / 69 = -0.6956…
    expect(json.categories.economic.unemploymentRate.trend).toBeCloseTo(-0.696, 2);
  });

  it("returns national GDP, per-capita, and currency code", async () => {
    const json = await callRoute();
    expect(json.gdpMillions).toBe(5_000_000);
    // 5e6 * 1e6 / 69e6 = 72463.77…
    expect(json.gdpPerCapita).toBeCloseTo(72463.77, 1);
    expect(json.currencyCode).toBe("USD");
  });

  it("surfaces national tick rates from the aggregator", async () => {
    const json = await callRoute();
    expect(json.tickRates.economic.unemploymentRate).toBeCloseTo(0.01, 6);
  });
});
