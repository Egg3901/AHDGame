import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const ages = { male: Array(101).fill(5), female: Array(101).fill(5) };

async function call(code: string, id: string) {
  const { GET } = await import("./route");
  return GET(new Request("http://t"), { params: Promise.resolve({ code, id }) });
}

describe("GET region population route", () => {
  let db: MockDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    // Instantiate the lazily-created collection mocks we assert on.
    ["states", "regionDemographics", "macroMetrics", "gameState"].forEach((c) => db.collection(c));
  });

  it("400s on an invalid country code", async () => {
    const res = await call("zz", "PA");
    expect(res.status).toBe(400);
  });

  it("404s when the state is missing", async () => {
    db.collectionMocks.states!.findOne.mockResolvedValue(null);
    const res = await call("us", "PA");
    expect(res.status).toBe(404);
  });

  it("returns ages, population metrics, and seat context", async () => {
    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "PA",
      countryId: "US",
      name: "Pennsylvania",
      population: 13000000,
      houseDistricts: 17,
    });
    db.collectionMocks.regionDemographics!.findOne.mockResolvedValue({ _id: "PA", ages });
    db.collectionMocks.macroMetrics!.findOne.mockResolvedValue({
      _id: "PA",
      population: {
        populationGrowth: { value: 0.4 },
        medianAge: { value: 39 },
        sexRatio: { value: 49 },
        dependencyRatio: { value: 0.6 },
        realizedMigrationRate: { value: 0.3 },
      },
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      lastCensus: { year: 2020, deltas: [{ state: "PA", from: 18, to: 17, delta: -1 }] },
    });

    const res = await call("us", "PA");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ages.male).toHaveLength(101);
    expect(body.population).toBe(13000000);
    expect(body.populationMetrics.medianAge).toBe(39);
    expect(body.houseDistricts).toBe(17);
    expect(body.censusSeatChange).toEqual({ year: 2020, from: 18, to: 17, delta: -1 });
  });
});
