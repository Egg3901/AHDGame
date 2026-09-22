import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("economicVitalSigns");
  db.collection("sourcingNetworkLoad");
  db.collection("commoditySourcingFlows");
  db.collection("commodityPrices");
  vi.clearAllMocks();
});

async function setupAdmin() {
  const { getDb } = await import("@/lib/mongodb");
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { userId: "admin", isAdmin: true },
  } as never);
}

const TURN = 440;

function vitalSignsDoc() {
  return {
    _id: `turn:${TURN}`,
    turn: TURN,
    marketFormation: {
      coverageByState: [
        { stateId: "A", residentDemandValue: 100, localProducerDemandValue: 50 },
        { stateId: "B", residentDemandValue: 200, localProducerDemandValue: 100 },
      ],
    },
  };
}

function networkDoc() {
  return {
    turn: TURN,
    freightTeuByState: {},
    landedPremiums: { A1: { coal: 2 } },
    importAggregates: {},
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
  };
}

function commodityDoc() {
  return {
    basis: "buyer_intent_sourcing",
    commodity: "coal",
    turn: TURN,
    demandUnitsIntent: 100,
    intraStateUnits: 50,
    interStateUnits: 30,
    importUnits: 20,
    tariffPaid: 0,
    unmetUnits: 0,
    toleranceBoundUnits: 0,
    capacityBoundUnits: 0,
    shortageResponsiveUnits: 0,
    flows: [
      {
        originType: "state" as const,
        originId: "A1",
        destStateId: "B1",
        units: 30,
        hops: 2,
        freightClass: "bulk" as const,
        ask: 1,
        shippingPerUnit: 0.1,
        tariffRatePct: 0,
        tariffPaid: 0,
        landedPrice: 1.1,
        freightTeuConsumed: 1,
      },
      {
        originType: "country" as const,
        originId: "C1",
        destStateId: "B2",
        units: 20,
        hops: 6,
        freightClass: "bulk" as const,
        ask: 1,
        shippingPerUnit: 0.1,
        tariffRatePct: 0,
        tariffPaid: 0,
        landedPrice: 1.1,
        freightTeuConsumed: 0,
      },
    ],
    itemizedFlowCount: 2,
    totalFlowCount: 2,
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
  };
}

/** Wire the persisted docs a completed turn writes. */
function seedTurn(latest = true): void {
  const vitals = vitalSignsDoc();
  db.collectionMocks.economicVitalSigns.findOne.mockImplementation(
    async (filter: { turn?: number }) => (filter?.turn != null ? vitals : { turn: TURN })
  );
  db.collectionMocks.sourcingNetworkLoad.findOne.mockResolvedValue(networkDoc());
  db.collectionMocks.commoditySourcingFlows.find.mockReturnValue(
    createAsyncIterableCursor([commodityDoc()])
  );
  db.collectionMocks.commodityPrices.find.mockReturnValue(
    createAsyncIterableCursor([{ commodity: "coal", globalPrice: 10, basePrice: 8 }])
  );
  void latest;
}

describe("GET /api/admin/economy/market-access", () => {
  it("rejects a non-admin", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/market-access"));
    expect(response.status).toBe(403);
  });

  it("rejects an invalid turn", async () => {
    await setupAdmin();
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/economy/market-access?turn=-1")
    );
    expect(response.status).toBe(400);
  });

  it("returns 404 when the world has no economic snapshot at all", async () => {
    await setupAdmin();
    db.collectionMocks.economicVitalSigns.findOne.mockResolvedValue(null);
    db.collectionMocks.sourcingNetworkLoad.findOne.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/market-access"));
    expect(response.status).toBe(404);
    expect(db.collectionMocks.economicVitalSigns.findOne).toHaveBeenCalledWith(
      {},
      { projection: { turn: 1 }, sort: { turn: -1 } }
    );
  });

  it("computes the delivered price, route mix and demand split for the latest turn", async () => {
    await setupAdmin();
    seedTurn();
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/market-access"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      turn: number;
      marketAccess: {
        deliveredPrice: unknown[];
        routeMix: unknown;
        topRoutes: unknown[];
        residentDemandSplit: unknown;
      };
    };
    expect(body.turn).toBe(TURN);
    expect(body.marketAccess.deliveredPrice).toEqual([
      {
        commodity: "coal",
        globalPriceAnchor: 10,
        basePrice: 8,
        landedPremiumPerUnit: 2,
        deliveredPricePerUnit: 12,
        deliveredToBaseMultiple: 1.5,
        freightChargeAnchor: null,
        premiumStates: 1,
      },
    ]);
    expect(body.marketAccess.routeMix).toEqual({
      intraStateUnits: 50,
      interstateUnits: 30,
      importUnits: 20,
      deliveredUnits: 100,
      intraStateShare: 0.5,
      interstateShare: 0.3,
      importShare: 0.2,
    });
    expect(body.marketAccess.topRoutes).toEqual([
      { originType: "state", originId: "A1", destStateId: "B1", units: 30 },
      { originType: "country", originId: "C1", destStateId: "B2", units: 20 },
    ]);
    expect(body.marketAccess.residentDemandSplit).toEqual({
      statesObserved: 2,
      totalResidentDemandValue: 300,
      totalLocalProducerDemandValue: 150,
      medianResidentDemandValue: 150,
      medianLocalProducerDemandValue: 75,
      localAbsorptionShare: 0.5,
    });
  });

  it("serves a requested turn by matching its persisted docs", async () => {
    await setupAdmin();
    seedTurn();
    const { GET } = await import("./route");
    const response = await GET(
      new Request(`http://localhost/api/admin/economy/market-access?turn=${TURN}`)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ turn: TURN });
    expect(db.collectionMocks.economicVitalSigns.findOne).toHaveBeenCalledWith({ turn: TURN });
    expect(db.collectionMocks.sourcingNetworkLoad.findOne).toHaveBeenCalledWith({ turn: TURN });
  });

  it("returns 404 when the requested turn has no inputs", async () => {
    await setupAdmin();
    db.collectionMocks.economicVitalSigns.findOne.mockResolvedValue(null);
    db.collectionMocks.sourcingNetworkLoad.findOne.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/economy/market-access?turn=999")
    );
    expect(response.status).toBe(404);
  });

  it("keeps missing inputs null rather than zero on a half-written turn", async () => {
    await setupAdmin();
    db.collectionMocks.economicVitalSigns.findOne.mockImplementation(
      async (filter: { turn?: number }) => (filter?.turn != null ? { turn: TURN } : { turn: TURN })
    );
    db.collectionMocks.sourcingNetworkLoad.findOne.mockResolvedValue(null);
    db.collectionMocks.commoditySourcingFlows.find.mockReturnValue(createAsyncIterableCursor([]));
    db.collectionMocks.commodityPrices.find.mockReturnValue(
      createAsyncIterableCursor([{ commodity: "coal", globalPrice: 10, basePrice: 8 }])
    );
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/market-access"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      marketAccess: {
        deliveredPrice: Array<Record<string, unknown>>;
        residentDemandSplit: unknown;
        routeMix: { deliveredUnits: number; intraStateShare: number | null };
      };
    };
    expect(body.marketAccess.deliveredPrice[0]).toMatchObject({
      landedPremiumPerUnit: null,
      deliveredPricePerUnit: null,
      freightChargeAnchor: null,
    });
    expect(body.marketAccess.residentDemandSplit).toBeNull();
    expect(body.marketAccess.routeMix).toMatchObject({
      deliveredUnits: 0,
      intraStateShare: null,
    });
  });
});
