import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/nuclear/test/route";

// The conventional-doctrine gate: "Nuclear Delivery" is strat decade-5.
const ENTRY_DOCTRINE_KEY = "strat-5";

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };

describe("POST nuclear/test", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    db.collection("gameState");
    db.collection("cabinetMembers");
    db.collection("nationalDoctrine");
    db.collection("nuclearPrograms");
    db.collection("federalBudget");
    db.collection("coldWarTension");
    db.collection("politicalMetrics");
    db.collection("newsPosts");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      coldWarEnabled: true,
      currentYear: 1953,
      currentTurn: 42,
      startingYear: 1953,
    });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue({
      countryId: "US",
      adopted: { [ENTRY_DOCTRINE_KEY]: 1 },
      points: 4,
    });
    db.collectionMocks.nuclearPrograms.findOne.mockResolvedValue(null); // empty programme
    db.collectionMocks.nuclearPrograms.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      countryId: "US",
      defenseAppropriation: {
        balance: 50_000,
        encumbered: 0,
        accruedThroughTurn: 0,
        arrearsRatio: 0,
      },
    });
    db.collectionMocks.federalBudget.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.coldWarTension.findOne.mockResolvedValue(null);
  });

  it("conducts a first fission test: adopts the node, spikes tension, posts news", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ nodeKey: "device-fission" }), call);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adopted["device-fission"]).toBe(42);
    expect(body.lastTestTurn).toBe(42);
    // Money left through the guarded debit against the defence appropriation.
    expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "US" }),
      { $inc: { "defenseAppropriation.balance": -12_000 } }
    );
    // The tension ledger recorded the test's spike.
    expect(db.collectionMocks.coldWarTension.updateOne).toHaveBeenCalled();
    expect(db.collectionMocks.newsPosts.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ isSystem: true, category: "executive" })
    );
  });

  it("404s when the Cold War subsystem is off", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ coldWarEnabled: false });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ nodeKey: "device-fission" }), call);
    expect(res.status).toBe(404);
  });

  it("403s a nation outside the capable set", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ nodeKey: "device-fission" }), {
      params: Promise.resolve({
        code: "fr",
        positionId: DEFENSE_POSITION_BY_COUNTRY.FR as string,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("409s when the entry doctrine node is not adopted", async () => {
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue({
      countryId: "US",
      adopted: {},
      points: 12,
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ nodeKey: "device-fission" }), call);
    expect(res.status).toBe(409);
  });

  it("400s a delivery node - those adopt through the quiet route, not a test", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ nodeKey: "delivery-bombers" }), call);
    expect(res.status).toBe(400);
  });

  it("400s a device node whose prerequisites are missing", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ nodeKey: "device-thermo" }), call);
    expect(res.status).toBe(400);
  });

  it("400s a device node not yet available in the current year", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      coldWarEnabled: true,
      currentYear: 1950,
      currentTurn: 10,
      startingYear: 1950,
    });
    db.collectionMocks.nuclearPrograms.findOne.mockResolvedValue({
      _id: "US",
      adopted: { "device-fission": 2 },
      warheads: 0,
      productionRate: 0,
    });
    const { POST } = await import(ROUTE);
    // Boosted fission is 1951; a 1950 world must refuse it.
    const res = await POST(req({ nodeKey: "device-boosted" }), call);
    expect(res.status).toBe(400);
  });

  it("409s when the defence appropriation cannot cover the test", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      countryId: "US",
      defenseAppropriation: { balance: 500, encumbered: 0, accruedThroughTurn: 0, arrearsRatio: 0 },
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ nodeKey: "device-fission" }), call);
    expect(res.status).toBe(409);
    expect(db.collectionMocks.nuclearPrograms.updateOne).not.toHaveBeenCalled();
  });

  it("403s a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "other" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ nodeKey: "device-fission" }), call);
    expect(res.status).toBe(403);
  });
});
