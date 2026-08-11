import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");

const WAGE_TYPE = {
  _id: "record_test_wage",
  countryScope: "us",
  name: "Wage Policy",
  policyDomain: "economic",
  policyOptions: [
    { id: "o0", name: "Low", stance: "right", effectDirection: 1, economic: 3, social: 0 },
    { id: "o1", name: "High", stance: "left", effectDirection: -1, economic: -2, social: 0 },
  ],
};

function mockFind(rows: unknown[]) {
  const cursor = {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn(),
    limit: vi.fn(),
    project: vi.fn(),
  };
  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  cursor.project.mockReturnValue(cursor);
  return cursor;
}

describe("GET /api/country/[code]/policy/record", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("legislationTypes");
    db.collectionMocks.legislationTypes.find.mockReturnValue(mockFind([WAGE_TYPE]));
    db.collection("enactedLaws");
    db.collectionMocks.enactedLaws.find.mockReturnValue(
      mockFind([
        {
          title: "Minimum Wage Act",
          legislationTypeId: "record_test_wage",
          policyOptionIndex: 1,
          enactedAt: new Date("2026-01-10"),
          enactedYear: 2026,
          annualCostUsd: 1_000_000,
          budgetCost: 0,
        },
      ])
    );
    db.collection("federalBudget");
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      gdp: 1_000_000_000,
      revenue: { total: 100_000_000 },
    });
    db.collection("states");
    db.collectionMocks.states.find.mockReturnValue(mockFind([{ population: 1000 }]));
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue({
      characterId: new ObjectId(),
      electedAt: new Date("2026-01-01"),
    });
    db.collection("characters");
    db.collectionMocks.characters.findOne.mockResolvedValue({ name: "Abigail Whitmore" });
  });

  async function call(code = "us") {
    const { GET } = await import("@/app/api/country/[code]/policy/record/route");
    const response = await GET(new Request(`http://localhost/api/country/${code}/policy/record`), {
      params: Promise.resolve({ code }),
    });
    return { response, body: await response.json() };
  }

  it("rejects invalid country codes", async () => {
    const { response } = await call("zz");
    expect(response.status).toBe(400);
  });

  it("returns the replayed timeline, era, and per-type provenance with costs", async () => {
    const { response, body } = await call();
    expect(response.status).toBe(200);
    expect(body.points).toHaveLength(1);
    expect(body.events[0].economicAfter).toBeCloseTo(-2);
    expect(body.era.label).toBe("Whitmore administration");
    expect(body.era.sinceDate).toContain("2026-01-01");
    expect(body.provenance.record_test_wage.title).toBe("Minimum Wage Act");
    expect(body.provenance.record_test_wage.annualCost).toBeGreaterThan(0);
  });

  it("degrades to a null era and null costs when sources are missing", async () => {
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null);
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(null);
    const { body } = await call();
    expect(body.era).toBeNull();
    expect(body.provenance.record_test_wage.annualCost).toBeNull();
  });
});
