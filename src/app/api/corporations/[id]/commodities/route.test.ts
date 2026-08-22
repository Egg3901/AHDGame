import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));
vi.mock("@/lib/market/featureFlag", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/market/featureFlag")>();
  return { ...original, getMarketSystemMode: vi.fn().mockResolvedValue("plants") };
});
vi.mock("@/lib/corporations/corpMarketShare", () => ({
  computeCorpMarketShare: vi.fn().mockResolvedValue([]),
}));

let db: MockDb;
const buyerId = new ObjectId();
const buyerUserId = new ObjectId();

const cursor = (rows: unknown[]) => ({
  project: vi.fn().mockReturnThis(),
  toArray: vi.fn().mockResolvedValue(rows),
});

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of [
    "corporateSectors",
    "gameState",
    "states",
    "commodityFlows",
    "gameConfig",
    "supplyAgreements",
  ]) {
    db.collection(name);
  }

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { getAuthUser } = await import("@/lib/auth");
  vi.mocked(getAuthUser).mockResolvedValue({ userId: buyerUserId.toString() } as never);
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: {
      _id: buyerId,
      name: "Buyer",
      countryId: "US",
      isPrivate: false,
      userId: buyerUserId,
    },
  } as never);

  db.collectionMocks.corporateSectors.find.mockReturnValue(
    cursor([
      {
        _id: new ObjectId(),
        corporationId: buyerId,
        sectorType: "manufacturing",
        stateId: "CA",
        revenue: 30_000,
        strategyId: "standard",
      },
    ])
  );
  db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 10 });
  db.collectionMocks.states.find.mockReturnValue(
    cursor([{ _id: "CA", name: "California", region: "West" }])
  );
  db.collectionMocks.commodityFlows.aggregate.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
  db.collectionMocks.gameConfig.findOne.mockResolvedValue({
    _id: "default",
    supplyAgreementsEnabled: true,
    marketSystemMode: "plants",
  });
  db.collectionMocks.supplyAgreements.find.mockReturnValue(
    cursor([
      {
        buyerCorpId: buyerId,
        commodity: "energy",
        volumeCap: 80,
        status: "active",
        lastDeliveryTurn: 9,
        lastDeliveredUnits: 60,
      },
    ])
  );
});

describe("GET /api/corporations/[id]/commodities private supply", () => {
  it("returns the latest delivered agreement quantities on the buyer's commodity row", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/corporations/buyer/commodities"), {
      params: Promise.resolve({ id: "buyer" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    const energy = data.commodities.find(
      (row: { commodity: string }) => row.commodity === "energy"
    );
    expect(energy.privateSupply).toEqual({
      contractedUnits: 80,
      deliveredUnits: 60,
      consumptionCoveredUnits: 60,
      coveragePercent: 60,
      turn: 9,
    });
  });

  it("keeps an active agreement visible when the buyer has no consuming sector", async () => {
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([]));
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/corporations/buyer/commodities"), {
      params: Promise.resolve({ id: "buyer" }),
    });
    const data = await response.json();

    expect(
      data.commodities.find((row: { commodity: string }) => row.commodity === "energy")
    ).toMatchObject({
      consumptionUnits: 0,
      privateSupply: {
        contractedUnits: 80,
        deliveredUnits: 60,
        consumptionCoveredUnits: 0,
        coveragePercent: 0,
        turn: 9,
      },
    });
  });

  it("does not disclose private agreement delivery to a non-CEO viewer", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: new ObjectId().toString() } as never);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/corporations/buyer/commodities"), {
      params: Promise.resolve({ id: "buyer" }),
    });
    const data = await response.json();

    expect(
      data.commodities.find((row: { commodity: string }) => row.commodity === "energy")
        .privateSupply
    ).toBeUndefined();
  });
});
