import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");

describe("GET /api/country/[code]/overview-counts", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  async function call(code = "us") {
    const { GET } = await import("@/app/api/country/[code]/overview-counts/route");
    const response = await GET(
      new Request(`http://localhost/api/country/${code}/overview-counts`),
      { params: Promise.resolve({ code }) }
    );
    return { response, body: await response.json() };
  }

  it("rejects invalid country codes", async () => {
    const { response } = await call("zz");
    expect(response.status).toBe(400);
  });

  it("returns batched directory figures", async () => {
    db.collection("politicalParties");
    db.collectionMocks.politicalParties.countDocuments.mockResolvedValue(6);
    db.collection("characters");
    db.collectionMocks.characters.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ count: 180 }]),
    });
    db.collection("npps");
    db.collectionMocks.npps.countDocuments.mockResolvedValue(34);
    db.collection("elections");
    db.collectionMocks.elections.countDocuments
      .mockResolvedValueOnce(2) // active
      .mockResolvedValueOnce(1); // upcoming
    db.collection("bills");
    db.collectionMocks.bills.countDocuments.mockResolvedValue(4);
    db.collection("states");
    db.collectionMocks.states.countDocuments.mockResolvedValue(50);
    db.collection("centralBanks");
    db.collectionMocks.centralBanks.findOne.mockResolvedValue({ primeRate: 4.25 });

    const { response, body } = await call();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      parties: 6,
      politicians: 214,
      activeElections: 2,
      upcomingElections: 1,
      bills: 4,
      regions: 50,
      primeRate: 4.25,
      // US is a market economy, so the command-economy dashboard link is off.
      commandEconomy: false,
      unions: 0,
      activeReferendums: 0,
      totalReferendums: 0,
      // No budget document in this fixture, so the fiscal figures stay absent
      // rather than reading as a balanced budget on a zero economy.
      gdpMillions: null,
      budgetBalancePctGdp: null,
      // Conflicts is off in this fixture, so no Cold War row is offered.
      coldWarDefcon: null,
    });
  });

  it("serves a DEFCON only for a principal in a conflicts-enabled world", async () => {
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: true });
    const { body } = await call();
    // Vietnam has not started in this fixture, so the ladder is at peacetime.
    expect(body.coldWarDefcon).toBe(5);

    const uk = await call("uk");
    expect(uk.body.coldWarDefcon).toBeNull();
  });

  it("excludes defunct parties and resolved bills from the counts", async () => {
    await call();
    const partyFilter = db.collectionMocks.politicalParties.countDocuments.mock.calls[0][0];
    expect(partyFilter.isDefunct).toEqual({ $ne: true });
    const billFilter = db.collectionMocks.bills.countDocuments.mock.calls[0][0];
    expect(billFilter.status.$nin).toEqual(
      expect.arrayContaining(["signed", "failed", "withdrawn", "vetoed", "override_failed"])
    );
    expect(billFilter.status.$nin).not.toContain("passed_origin");
  });

  it("degrades each figure to null when its query fails", async () => {
    db.collection("centralBanks");
    db.collectionMocks.centralBanks.findOne.mockRejectedValue(new Error("down"));
    db.collection("politicalParties");
    db.collectionMocks.politicalParties.countDocuments.mockRejectedValue(new Error("down"));
    const { response, body } = await call();
    expect(response.status).toBe(200);
    expect(body.primeRate).toBeNull();
    expect(body.parties).toBeNull();
    // the rest still resolve (defaults: 0 counts, no bank doc)
    expect(body.bills).toBe(0);
  });

  it("returns null primeRate when the bank document is missing", async () => {
    const { body } = await call();
    expect(body.primeRate).toBeNull();
  });
});
