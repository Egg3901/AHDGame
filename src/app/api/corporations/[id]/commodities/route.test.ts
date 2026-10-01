import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { COMMODITY_BASE_PRICES, dollarsToUnits } from "@/lib/constants/commodities";
import { MARKET_ECONOMY_MEDIA_SUPPLY_FACTOR } from "@/lib/constants/sectorStrategies";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";

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
    "exchangeRates",
    "stateResourceCapacity",
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
        lastBuyerConsumptionUnits: 100,
        previousDeliveryTurn: 8,
        previousDeliveredUnits: 20,
        previousBuyerConsumptionUnits: 90,
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
      consumptionUnits: 100,
      previousTurn: 8,
      previousDeliveredUnits: 20,
      previousConsumptionUnits: 90,
    });
  });

  it("sums deliveries without counting shared buyer consumption twice", async () => {
    db.collectionMocks.supplyAgreements.find.mockReturnValue(
      cursor([
        {
          commodity: "energy",
          volumeCap: 50,
          lastDeliveryTurn: 9,
          lastDeliveredUnits: 40,
          lastBuyerConsumptionUnits: 100,
          previousDeliveryTurn: 8,
          previousDeliveredUnits: 10,
          previousBuyerConsumptionUnits: 90,
        },
        {
          commodity: "energy",
          volumeCap: 30,
          lastDeliveryTurn: 9,
          lastDeliveredUnits: 20,
          lastBuyerConsumptionUnits: 100,
          previousDeliveryTurn: 8,
          previousDeliveredUnits: 10,
          previousBuyerConsumptionUnits: 90,
        },
      ])
    );

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/corporations/buyer/commodities"), {
      params: Promise.resolve({ id: "buyer" }),
    });
    const data = await response.json();
    const energy = data.commodities.find(
      (row: { commodity: string }) => row.commodity === "energy"
    );

    expect(energy.privateSupply).toMatchObject({
      contractedUnits: 80,
      deliveredUnits: 60,
      consumptionUnits: 100,
      previousDeliveredUnits: 20,
      previousConsumptionUnits: 90,
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
        consumptionCoveredUnits: 60,
        coveragePercent: 60,
        turn: 9,
        consumptionUnits: 100,
        previousTurn: 8,
        previousDeliveredUnits: 20,
        previousConsumptionUnits: 90,
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

// The derivation itself is unit-tested in corpCommodityFlows.test.ts. These
// prove the ROUTE actually loads and threads what it needs — without them the
// route could pass no context at all and every unit test would still be green.
describe("GET /api/corporations/[id]/commodities world context", () => {
  it("derates media output through the plants production chain", async () => {
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: buyerId,
          sectorType: "media",
          stateId: "CA",
          countryId: "US",
          revenue: 30_000,
          strategyId: "standard",
          // Deliberately far from the revenue nameplate (30,000 x 0.5 / 150 =
          // 100 units) so this cannot pass on the nameplate path by accident.
          producedUnits: 4_000,
          capitalStock: 4_000,
        },
      ])
    );
    db.collectionMocks.supplyAgreements.find.mockReturnValue(cursor([]));

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporations/x/commodities"), {
      params: Promise.resolve({ id: "x" }),
    });
    const body = await res.json();

    // Measured production (1,000 units), carrying the market-economy media
    // supply factor the world ledger and the clearing offer both apply.
    const advertising = body.commodities.find(
      (c: { commodity: string }) => c.commodity === "advertising"
    );
    expect(advertising.outputUnits).toBeCloseTo(4_000 * MARKET_ECONOMY_MEDIA_SUPPLY_FACTOR, 1);
  });

  it("normalizes a foreign sector's host-currency revenue before deriving output", async () => {
    const fxRate = 366.55;
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: buyerId,
          sectorType: "manufacturing",
          stateId: "FR_OUE",
          countryId: "FR",
          // Booked in francs. Never ran a plants turn, so this exercises the
          // nameplate fallback, which is where the conversion has to happen.
          revenue: 30_000 * fxRate,
          strategyId: "standard",
        },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(
      cursor([{ _id: "FR_OUE", name: "Ouest", region: "Ouest" }])
    );
    db.collectionMocks.exchangeRates.find.mockReturnValue(
      cursor([{ currencyCode: "FRF", rate: fxRate }])
    );
    db.collectionMocks.supplyAgreements.find.mockReturnValue(cursor([]));

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporations/x/commodities"), {
      params: Promise.resolve({ id: "x" }),
    });
    const body = await res.json();

    const steel = body.commodities.find((c: { commodity: string }) => c.commodity === "steel");
    expect(steel.outputUnits).toBeCloseTo(
      dollarsToUnits(30_000 * 0.4, COMMODITY_BASE_PRICES.steel),
      1
    );
  });
});

describe("GET /api/corporations/[id]/commodities currencies without a live rate", () => {
  it("converts a currency that has no exchangeRates document at its authored era rate", async () => {
    // Six 1953 command-economy currencies are deliberately not player-traded
    // and have no exchangeRates row, but their sectors still book revenue in
    // local units. Falling back to 1.0 inflates them 13.5x to 27x, which is
    // exactly what the turn path backfills the authored rate to avoid.
    const authoredPlzRate = 24;
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 10,
      preset: "1953-default",
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: buyerId,
          sectorType: "manufacturing",
          stateId: "PL_MAZ",
          countryId: "PL",
          revenue: 30_000 * authoredPlzRate,
          strategyId: "standard",
        },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(
      cursor([{ _id: "PL_MAZ", name: "Mazowieckie", region: "Mazowieckie" }])
    );
    db.collectionMocks.exchangeRates.find.mockReturnValue(cursor([]));
    db.collectionMocks.supplyAgreements.find.mockReturnValue(cursor([]));

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporations/x/commodities"), {
      params: Promise.resolve({ id: "x" }),
    });
    const body = await res.json();

    // The 1953 preset also puts the ledger on its era unit basis, the same
    // leg the world supply ledger applies to a nameplate. What this pins is
    // the 24x: without the authored rate the figure comes back 24 times larger.
    const steel = body.commodities.find((c: { commodity: string }) => c.commodity === "steel");
    expect(steel.outputUnits).toBeCloseTo(
      dollarsToUnits(30_000 * 0.4, COMMODITY_BASE_PRICES.steel) * getEraUnitScale("1953-default"),
      1
    );
  });
});
