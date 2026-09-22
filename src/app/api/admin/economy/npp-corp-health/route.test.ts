import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("corporations");
  db.collection("nppOperatorDiagnostics");
  vi.clearAllMocks();
  resetCorpFxRateCacheForTests();
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

function corpDoc(overrides: Record<string, unknown>) {
  return {
    countryId: "US",
    liquidCurrencyCode: "USD",
    ...overrides,
  };
}

describe("GET /api/admin/economy/npp-corp-health", () => {
  it("rejects a non-admin", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/npp-corp-health"));
    expect(response.status).toBe(403);
  });

  it("rejects an invalid turn", async () => {
    await setupAdmin();
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/economy/npp-corp-health?turn=-1")
    );
    expect(response.status).toBe(400);
  });

  it("computes the per-sector metric from live corporations and the latest diagnostics", async () => {
    await setupAdmin();
    const ceoIds = [new ObjectId(), new ObjectId(), new ObjectId()];
    db.collectionMocks.corporations.find.mockReturnValue(
      createAsyncIterableCursor([
        corpDoc({ ceoId: ceoIds[0], ceoType: "npp", type: "retail", liquidCapital: -50 }),
        corpDoc({ ceoId: ceoIds[1], ceoType: "npp", type: "retail", liquidCapital: 10 }),
        corpDoc({
          ceoId: ceoIds[2],
          ceoType: "npp",
          type: "energy",
          liquidCapital: 500,
          countryOwnerId: "US",
          bankCharter: { status: "active" },
        }),
      ])
    );
    db.collectionMocks.nppOperatorDiagnostics.findOne.mockResolvedValue({
      _id: "turn:440",
      schemaVersion: 1,
      turn: 440,
      generatedAt: new Date("2026-08-28T00:00:00Z"),
      corporationsObserved: 3,
      bindingGateCounts: { cash_floor: 2, no_enterable_market: 1 },
      constraintCounts: { budget_cash_crisis: 2, growth_unaffordable: 1 },
      budgetBandCounts: { distress: 2, thin: 1 },
      dividendPolicyCounts: { withheld: 3 },
      dividendRateSum: 0,
      divestedSectors: 0,
      reinvestments: 1,
      marginPctSum: 30,
      cashHeadroomAnchorSum: 5,
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/npp-corp-health"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      turn: number | null;
      health: {
        sectors: unknown[];
        totals: unknown;
        bindingGateCounts: unknown;
        bindingConstraintCounts: unknown;
        bindingConstraintLegCounts: unknown;
        operatorObservations: number;
      };
    };

    expect(body.turn).toBe(440);
    expect(body.health.sectors).toEqual([
      {
        sectorType: "energy",
        nppLed: 1,
        cashNegative: 0,
        cashNegativeShare: 0,
        medianLiquidCapitalAnchor: 500,
        stateOwned: 1,
        bankChartered: 1,
      },
      {
        sectorType: "retail",
        nppLed: 2,
        cashNegative: 1,
        cashNegativeShare: 0.5,
        medianLiquidCapitalAnchor: -20,
        stateOwned: 0,
        bankChartered: 0,
      },
    ]);
    expect(body.health.totals).toEqual({
      nppLed: 3,
      cashNegative: 1,
      cashNegativeShare: 1 / 3,
      medianLiquidCapitalAnchor: 10,
    });
    expect(body.health.bindingGateCounts).toEqual({ cash_floor: 2, no_enterable_market: 1 });
    expect(body.health.bindingConstraintCounts).toEqual({
      budget_cash_crisis: 2,
      growth_unaffordable: 1,
    });
    expect(body.health.bindingConstraintLegCounts).toEqual({ budget: 2, growth: 1 });
    expect(body.health.operatorObservations).toBe(3);
    // Privacy: no CEO / corporation identifiers leave the route.
    for (const id of ceoIds) {
      expect(JSON.stringify(body)).not.toContain(id.toString());
    }
    expect(db.collectionMocks.nppOperatorDiagnostics.findOne).toHaveBeenCalledWith(
      {},
      { sort: { turn: -1 } }
    );
  });

  it("reads a named retained turn's diagnostics", async () => {
    await setupAdmin();
    db.collectionMocks.corporations.find.mockReturnValue(createAsyncIterableCursor([]));
    db.collectionMocks.nppOperatorDiagnostics.findOne.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/economy/npp-corp-health?turn=439")
    );
    expect(response.status).toBe(200);
    expect(db.collectionMocks.nppOperatorDiagnostics.findOne).toHaveBeenCalledWith({
      _id: "turn:439",
    });
  });

  it("serves empty nulls when there are no NPP-led corporations or diagnostics", async () => {
    await setupAdmin();
    db.collectionMocks.corporations.find.mockReturnValue(createAsyncIterableCursor([]));
    db.collectionMocks.nppOperatorDiagnostics.findOne.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/npp-corp-health"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      turn: number | null;
      health: { sectors: unknown[]; totals: unknown; operatorObservations: number };
    };
    expect(body.turn).toBeNull();
    expect(body.health.sectors).toEqual([]);
    expect(body.health.totals).toEqual({
      nppLed: 0,
      cashNegative: 0,
      cashNegativeShare: null,
      medianLiquidCapitalAnchor: null,
    });
    expect(body.health.operatorObservations).toBe(0);
  });
});
