import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCorporationSectorDetail } from "./sectorDetail";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/market/featureFlag", async (original) => ({
  ...(await original<typeof import("@/lib/market/featureFlag")>()),
  getMarketSystemMode: vi.fn().mockResolvedValue("plants"),
}));

let db: MockDb;
const corporationId = new ObjectId();
const sectorId = new ObjectId();
const userId = new ObjectId();
const sector = {
  _id: sectorId,
  corporationId,
  countryId: "US",
  stateId: "CA",
  sectorType: "media",
  strategyId: "standard",
  revenue: 10000,
  realizedRevenue: 10000,
  profitMargin: 90,
  currentGrowthCost: 0,
  capitalStock: 1000,
  operatingCapacityUnits: 1000,
  producedUnits: 1000,
  soldUnits: 1000,
  plantsStartTurn: 0,
  clearingStartTurn: 0,
  plantsUpkeepMarginBasisAnchor: 0.2,
  workers: 100,
  buildQueue: [{ unitsOrdered: 500, startTurn: 100, onlineTurn: 124, costPaidAnchor: 500 }],
  plantsPnl: {
    turn: 100,
    revenue: 10000,
    inputs: 500,
    labour: 200,
    upkeep: 100,
    compliance: 100,
    otherOpex: 100,
    financialLegs: 0,
    policyCredit: 400,
    operatingCost: 400,
    totalCost: 600,
    profit: 9400,
  },
};

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { getAuthUser } = await import("@/lib/auth");
  vi.mocked(getAuthUser).mockResolvedValue({
    userId: userId.toHexString(),
    username: "fixture",
    email: "fixture@example.test",
    role: "user",
  });
  db.collection("corporations").findOne.mockResolvedValue({
    _id: corporationId,
    userId,
    sequentialId: 6,
    name: "Expansion fixture",
    countryId: "US",
    type: "media",
    liquidCurrencyCode: "USD",
    liquidCapital: 100000,
  });
  db.collection("corporateSectors").findOne.mockResolvedValue(sector);
  db.collectionMocks.corporateSectors.find().toArray.mockResolvedValue([sector]);
  db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 100 });
  db.collection("gameConfig").findOne.mockResolvedValue({ marketGovernorRampTurns: 48 });
  db.collection("tradeFlowSnapshots").findOne.mockImplementation(
    async (query: { turn?: number }) =>
      query.turn === 100
        ? {
            turn: 100,
            books: {
              US: {
                advertising: {
                  supply: 1000,
                  domesticDemand: 5000,
                  demand: 5000,
                  imports: 0,
                  exports: 0,
                },
              },
            },
          }
        : null
  );
});

async function loadPlants() {
  const response = await getCorporationSectorDetail(
    new Request(`http://localhost/api/corporations/6/sectors/${sectorId.toHexString()}`),
    { params: Promise.resolve({ id: "6", sectorId: sectorId.toHexString() }) }
  );
  expect(response.status).toBe(200);
  return (await response.json()).plants;
}

describe("sector expansion budget payload", () => {
  it("deducts queued builds and reserves expenses before policy credits", async () => {
    const plants = await loadPlants();
    expect(plants.measuredDemandGapUnits).toBe(3500);
    expect(plants.investment.operatingReserveAnchor).toBeGreaterThan(600 / 24);
    expect(db.collectionMocks.corporateSectors.find).toHaveBeenCalledWith(
      { corporationId },
      expect.objectContaining({
        projection: expect.objectContaining({ "plantsPnl.policyCredit": 1, buildQueue: 1 }),
      })
    );
  });
  it.each(["pending", "defaulted"])(
    "withholds a budget when a %s loan needs servicing",
    async (status) => {
      db.collection("bankLoans").findOne.mockImplementation(
        async (query: { status: { $in: string[] } }) =>
          query.status.$in.includes(status)
            ? { _id: new ObjectId(), status, principal: 1000 }
            : null
      );
      expect((await loadPlants()).investment.operatingReserveAnchor).toBeNull();
    }
  );
  it("does not reuse an older reachable snapshot for automatic sizing", async () => {
    db.collection("tradeFlowSnapshots").findOne.mockResolvedValue(null);
    expect((await loadPlants()).measuredDemandGapUnits).toBeNull();
  });
});
