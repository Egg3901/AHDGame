import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/corporations/shareTradeHistory", () => ({ recordShareTrade: vi.fn() }));
vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCorporationTargets: vi.fn().mockResolvedValue({
    ordersCancelled: 0,
    listingsCancelled: 0,
    offersCancelled: 0,
  }),
}));
vi.mock("@/lib/turn/stockExchangeSnapshot", () => ({
  generateStockExchangeSnapshots: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

async function runConsolidate(opts: {
  corp: Record<string, unknown>;
  targetTotalShares: number;
  currentTurn?: number;
}): Promise<Response> {
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);

  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: opts.corp,
  } as never);

  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: opts.currentTurn ?? 100 } as never);

  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/corporations/x/shares/consolidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetTotalShares: opts.targetTotalShares }),
    }),
    { params: Promise.resolve({ id: "x" }) }
  );
}

function baseCorp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: new ObjectId(),
    name: "Test Corp",
    countryId: "US",
    liquidCurrencyCode: "USD",
    ceoId: new ObjectId(),
    sharePrice: 100,
    fundamentalSharePrice: 80,
    totalShares: 1_200_000,
    publicFloat: 1_200_000,
    shareholders: [],
    lastShareStructureTurn: null,
    ...overrides,
  };
}

describe("POST /api/corporations/[id]/shares/consolidate", () => {
  it("scales fundamentalSharePrice alongside sharePrice on a reverse split (regression: bug #0449)", async () => {
    // Setup: corp where sharePrice and fundamentalSharePrice differ — i.e.,
    // sentiment/orderFlow multipliers have moved the live price off the
    // fundamental. This is the AURORA-Group shape from bug #0449. If we only
    // scale sharePrice, the next applyPriceMultipliers cron tick recomputes
    // sharePrice = fundamentalSharePrice × multipliers and clobbers the
    // post-split price back to the pre-split level.
    const corp = baseCorp();
    const response = await runConsolidate({ corp, targetTotalShares: 1_000_000 });

    expect(response.status).toBe(200);

    // Factor = 1,200,000 / 1,000,000 = 1.2
    // sharePrice            : 100 × 1.2 = 120
    // fundamentalSharePrice : 80  × 1.2 = 96
    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenCalledWith(
      { _id: corp._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          totalShares: 1_000_000,
          sharePrice: 120,
          fundamentalSharePrice: 96,
          lastShareStructureTurn: 100,
        }),
      })
    );
  });

  it("scales fundamentalSharePrice down on a forward stock split", async () => {
    // 100 → 200 shares: factor = 0.5
    // sharePrice            : 50 × 0.5 = 25
    // fundamentalSharePrice : 40 × 0.5 = 20
    const corp = baseCorp({
      sharePrice: 50,
      fundamentalSharePrice: 40,
      totalShares: 1_000_000,
      publicFloat: 1_000_000,
    });
    const response = await runConsolidate({ corp, targetTotalShares: 2_000_000 });

    expect(response.status).toBe(200);
    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenCalledWith(
      { _id: corp._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          totalShares: 2_000_000,
          sharePrice: 25,
          fundamentalSharePrice: 20,
        }),
      })
    );
  });

  it("falls back to scaling sharePrice when fundamentalSharePrice is missing (legacy corp)", async () => {
    // Legacy corps (founded before the fundamental/sentiment/order-flow split)
    // have no `fundamentalSharePrice` field. Type allows it as optional. The
    // route must seed the new field by scaling sharePrice — otherwise the
    // applyPriceMultipliers cron skips the corp (fundamentalPrice <= 0 guard)
    // and the live sharePrice never gets re-multipliered.
    const corp = baseCorp({
      sharePrice: 100,
      fundamentalSharePrice: undefined,
      totalShares: 1_200_000,
      publicFloat: 1_200_000,
    });
    delete corp.fundamentalSharePrice;
    const response = await runConsolidate({ corp, targetTotalShares: 1_000_000 });

    expect(response.status).toBe(200);
    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenCalledWith(
      { _id: corp._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          sharePrice: 120,
          fundamentalSharePrice: 120,
        }),
      })
    );
  });

  it("clears orders/listings/offers then rebuilds exchange snapshots (ticket #1154)", async () => {
    const corp = baseCorp();
    const response = await runConsolidate({ corp, targetTotalShares: 1_000_000 });
    expect(response.status).toBe(200);

    const { cleanupShareMarketActivityForCorporationTargets } =
      await import("@/lib/corporations/cleanupShareMarketActivity");
    expect(cleanupShareMarketActivityForCorporationTargets).toHaveBeenCalledWith(
      expect.anything(),
      [corp._id],
      expect.any(Date),
      true
    );

    const { generateStockExchangeSnapshots } = await import("@/lib/turn/stockExchangeSnapshot");
    expect(generateStockExchangeSnapshots).toHaveBeenCalledWith(100, expect.anything());

    const body = await response.json();
    expect(body.newMarketCap).toBe(Math.round(120 * 1_000_000));
    expect(body.newSharePrice).toBe(120);
    expect(body.newTotalShares).toBe(1_000_000);
  });
});
