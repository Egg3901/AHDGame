import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));

let db: MockDb;
const supplierId = new ObjectId();
const buyerId = new ObjectId();
const agreementId = new ObjectId();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  db.collection("supplyAgreements");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "ceo-user" },
  } as never);
  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: supplierId, countryOwnerId: null, userId: "ceo-user" },
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);

  db.collectionMocks.corporations.findOne.mockResolvedValue({ _id: buyerId });
  db.collectionMocks.corporations.find.mockReturnValue(
    createAsyncIterableCursor([
      { _id: supplierId, name: "Gridworks", ticker: "GRID" },
      { _id: buyerId, name: "Tinky Corporation", ticker: "TCI" },
    ])
  );
  db.collectionMocks.supplyAgreements.find.mockReturnValue(
    createAsyncIterableCursor([
      {
        _id: agreementId,
        supplierCorpId: supplierId,
        buyerCorpId: buyerId,
        proposedByCorpId: supplierId,
        commodity: "energy",
        volumeCap: 80,
        pricePremium: 0,
        status: "active",
      },
    ])
  );
});

describe("GET corporation supply agreements", () => {
  it("requires the corporation CEO before returning private agreement terms", async () => {
    const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(requireCeo).mockReturnValue(
      Response.json({ error: "Only the CEO can view supply agreements" }, { status: 403 }) as never
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/corporations/601/supply-agreements"),
      { params: Promise.resolve({ id: "601" }) }
    );

    expect(response.status).toBe(403);
    expect(db.collectionMocks.supplyAgreements.find).not.toHaveBeenCalled();
  });

  it("returns both counterparty names and tickers", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/corporations/601/supply-agreements"),
      {
        params: Promise.resolve({ id: "601" }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agreements[0]).toMatchObject({
      supplierCorpId: supplierId.toString(),
      supplierCorpName: "Gridworks",
      supplierCorpTicker: "GRID",
      buyerCorpId: buyerId.toString(),
      buyerCorpName: "Tinky Corporation",
      buyerCorpTicker: "TCI",
    });
    expect(body.agreements[0].currentOffer).toMatchObject({
      revision: 1,
      proposedByCorpId: supplierId.toString(),
      volumeCap: 80,
    });
    expect(body.agreements[0].offers).toHaveLength(1);
  });

  it("returns current contract capacity and the latest achievable ceiling", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: supplierId,
      countryOwnerId: null,
    });
    db.collection("gameConfig");
    db.collection("gameState");
    db.collection("corporateSectors");
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      marketSystemMode: "plants",
      commandEconomyEnabled: false,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 10,
      currentYear: 2026,
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      createAsyncIterableCursor([
        {
          corporationId: supplierId,
          sectorType: "manufacturing",
          capitalStock: 1_000,
          strategyId: "standard",
          productionPolicyLevel: 0,
          contractAchievableUnits: 500,
          countryId: "US",
        },
      ])
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/corporations/601/supply-agreements"),
      { params: Promise.resolve({ id: "601" }) }
    );
    const body = await response.json();

    expect(body.capacityByCommodity.steel.currentCapacityUnits).toBeGreaterThan(0);
    expect(body.capacityByCommodity.steel.maxContractUnits).toBeGreaterThan(
      body.capacityByCommodity.steel.currentCapacityUnits
    );
    expect(body.capacityByCommodity.steel.achievableUnits).toBeGreaterThan(0);
  });
});
