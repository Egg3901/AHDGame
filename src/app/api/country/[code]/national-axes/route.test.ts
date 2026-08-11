import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");

const TEST_TYPE = {
  _id: "axes_test_wage_policy",
  countryScope: "us",
  name: "Wage Policy",
  policyDomain: "economic",
  nationalOnly: true,
  policyOptions: [
    { id: "opt0", name: "Low", stance: "right", effectDirection: 1, economic: 3, social: 0 },
    { id: "opt1", name: "High", stance: "left", effectDirection: -1, economic: -2, social: 0 },
  ],
};

const SOCIAL_TYPE = {
  _id: "axes_test_media_policy",
  countryScope: "us",
  name: "Media Standards",
  policyDomain: "mediaInformation",
  nationalOnly: true,
  policyOptions: [
    { id: "opt0", name: "Open", stance: "left", effectDirection: -1, economic: 0, social: -3 },
    { id: "opt1", name: "Strict", stance: "right", effectDirection: 1, economic: 0, social: 3 },
  ],
};

function mockFind(rows: unknown[]) {
  return {
    sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows) }),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

describe("GET /api/country/[code]/national-axes", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("legislationTypes");
    db.collectionMocks.legislationTypes.find.mockReturnValue(mockFind([TEST_TYPE, SOCIAL_TYPE]));

    db.collection("statePolicies");
    db.collectionMocks.statePolicies.find.mockReturnValue(
      mockFind([
        {
          scope: "national",
          stateId: "national",
          legislationTypeId: "axes_test_wage_policy",
          economic: -2,
          social: 0,
          updatedAt: new Date("2026-05-01"),
        },
        {
          scope: "national",
          stateId: "national",
          legislationTypeId: "axes_test_media_policy",
          economic: 0,
          social: -3,
          updatedAt: new Date("2026-05-02"),
        },
      ])
    );

    db.collection("federalBudget");
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(null);

    db.collection("governorExecutiveOrders");
    db.collectionMocks.governorExecutiveOrders.find.mockReturnValue(mockFind([]));

    db.collection("enactedLaws");
    db.collectionMocks.enactedLaws.find.mockReturnValue(
      mockFind([
        {
          title: "Minimum Wage Act",
          legislationTypeId: "axes_test_wage_policy",
          policyOptionIndex: 1,
          scope: "national",
          enactedAt: new Date("2026-01-10"),
          enactedYear: 2026,
        },
        {
          title: "Media Standards Act",
          legislationTypeId: "axes_test_media_policy",
          policyOptionIndex: 0,
          scope: "national",
          enactedAt: new Date("2026-03-15"),
          enactedYear: 2026,
        },
      ])
    );
  });

  async function call(code = "us") {
    const { GET } = await import("@/app/api/country/[code]/national-axes/route");
    const response = await GET(new Request(`http://localhost/api/country/${code}/national-axes`), {
      params: Promise.resolve({ code }),
    });
    return { response, body: await response.json() };
  }

  it("rejects invalid country codes", async () => {
    const { response } = await call("zz");
    expect(response.status).toBe(400);
  });

  it("returns equal-weight axes over the country's national policy records", async () => {
    const { response, body } = await call();
    expect(response.status).toBe(200);
    expect(body.axes.economic).toBeCloseTo(-2);
    expect(body.axes.social).toBeCloseTo(-3);
    expect(body.axes.lawCount).toBe(2);
  });

  it("returns recent movers newest-first with running-average pulls", async () => {
    const { body } = await call();
    expect(body.movers).toHaveLength(2);
    expect(body.movers[0].title).toBe("Media Standards Act");
    expect(body.movers[0].socialBefore).toBeNull();
    expect(body.movers[0].socialAfter).toBeCloseTo(-3);
    expect(body.movers[1].title).toBe("Minimum Wage Act");
    expect(body.movers[1].economicAfter).toBeCloseTo(-2);
  });

  it("returns the drift series in enactment order", async () => {
    const { body } = await call();
    expect(body.drift.points).toHaveLength(2);
    expect(body.drift.points[0].economicAvg).toBeCloseTo(-2);
    expect(body.drift.points[1].socialAvg).toBeCloseTo(-3);
  });

  it("returns empty movers/drift and null axes when nothing is recorded", async () => {
    db.collectionMocks.statePolicies.find.mockReturnValue(mockFind([]));
    db.collectionMocks.enactedLaws.find.mockReturnValue(mockFind([]));
    const { body } = await call();
    expect(body.axes.economic).toBeNull();
    expect(body.axes.lawCount).toBe(0);
    expect(body.movers).toEqual([]);
    expect(body.drift.points).toEqual([]);
  });
});
