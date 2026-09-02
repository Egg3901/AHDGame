import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("plants"),
  marketAtLeast: vi.fn().mockReturnValue(true),
}));

let db: MockDb;
const supplierId = new ObjectId();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("supplyAgreements");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "user1" },
  } as never);

  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: supplierId, userId: "user1" },
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
});

describe("proposeSupplyAgreement", () => {
  function propose(body: Record<string, unknown>) {
    return import("./supplyAgreements").then(({ proposeSupplyAgreement }) =>
      proposeSupplyAgreement(
        new Request("http://localhost/api/corporations/supplier/supply-agreements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        supplierId.toString()
      )
    );
  }

  function seedFreightSupplier() {
    db.collection("states").findOne.mockImplementation(async (filter: { _id: string }) =>
      filter._id === "TX" || filter._id === "NY" ? { _id: filter._id } : null
    );
    db.collection("corporateSectors").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          sectorType: "logistics",
          capitalStock: 10_000,
          strategyId: "standard",
          productionPolicyLevel: 0,
          stateId: "TX",
        },
      ])
    );
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 10, currentYear: 1953 });
    db.collection("gameConfig").findOne.mockResolvedValue({ commandEconomyEnabled: false });
    db.collection("corporations").findOne.mockResolvedValue({ _id: new ObjectId() });
  }

  it("rejects a freight proposal that does not name the state it is fulfilled from", async () => {
    seedFreightSupplier();
    const response = await propose({
      buyerCorpId: new ObjectId().toString(),
      commodity: "freight",
      volumeCap: 100,
      pricePremium: 0,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("state");
    expect(db.collectionMocks.supplyAgreements.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a freight proposal for a state with no freight plants", async () => {
    seedFreightSupplier();
    const response = await propose({
      buyerCorpId: new ObjectId().toString(),
      commodity: "freight",
      stateId: "NY",
      volumeCap: 100,
      pricePremium: 0,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("NY");
    expect(db.collectionMocks.supplyAgreements.insertOne).not.toHaveBeenCalled();
  });

  it("rejects an unknown state", async () => {
    seedFreightSupplier();
    const response = await propose({
      buyerCorpId: new ObjectId().toString(),
      commodity: "freight",
      stateId: "ZZ",
      volumeCap: 100,
      pricePremium: 0,
    });
    expect(response.status).toBe(400);
    expect(db.collectionMocks.supplyAgreements.insertOne).not.toHaveBeenCalled();
  });

  it("stores the state on a freight proposal sized against that state's plants", async () => {
    seedFreightSupplier();
    const response = await propose({
      buyerCorpId: new ObjectId().toString(),
      commodity: "freight",
      stateId: "TX",
      volumeCap: 1,
      pricePremium: 0,
    });
    expect(response.status).toBe(200);
    expect(db.collectionMocks.supplyAgreements.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        commodity: "freight",
        stateId: "TX",
        volumeCapBasis: "scaledCapacity",
        status: "pending",
      })
    );
  });

  it("ignores a state on a reachable commodity", async () => {
    seedFreightSupplier();
    db.collection("corporateSectors").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          sectorType: "manufacturing",
          capitalStock: 10_000,
          strategyId: "standard",
          stateId: "TX",
        },
      ])
    );
    const response = await propose({
      buyerCorpId: new ObjectId().toString(),
      commodity: "steel",
      stateId: "TX",
      volumeCap: 1,
      pricePremium: 0,
    });
    expect(response.status).toBe(200);
    const doc = db.collectionMocks.supplyAgreements.insertOne.mock.calls[0]![0] as {
      stateId?: string;
    };
    expect(doc.stateId).toBeUndefined();
  });

  it("rejects freight because corporation-wide agreements have no state identity", async () => {
    const { proposeSupplyAgreement } = await import("./supplyAgreements");
    const response = await proposeSupplyAgreement(
      new Request("http://localhost/api/corporations/supplier/supply-agreements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyerCorpId: new ObjectId().toString(),
          commodity: "freight",
          volumeCap: 100,
          pricePremium: 0,
        }),
      }),
      supplierId.toString()
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("state");
    expect(db.collectionMocks.supplyAgreements.insertOne).not.toHaveBeenCalled();
  });
});
