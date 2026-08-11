import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";

/**
 * D9 retool rescale — BELOW-PLANTS BYTE-IDENTITY PIN.
 *
 * The RPU renormalization was applied unconditionally. It is a no-op below
 * CAPITAL mode (no `capitalStock` to scale), but under CAPITAL the sector turn
 * writes a non-zero `capitalStock` and gates production off it — so a retool
 * multiplied live production capacity by the output-mix ratio, which is orders
 * of magnitude for some strategy pairs. These tests pin that below plants
 * neither `capitalStock` nor `buildQueue` is touched by a retool or a cancel,
 * and that plants still gets the rescale.
 */

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/corporationCapital", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  getSectorHostFxRate: vi.fn().mockResolvedValue(1),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
  resolveSectorHostCurrencyCode: vi.fn().mockReturnValue("USD"),
  anchorToCorpLiquidCapital: vi.fn((anchor: number) => anchor),
  corpLiquidCapitalToAnchor: vi.fn((local: number) => local),
}));
vi.mock("@/lib/currency/marketMaker", () => ({
  distributeConversionSpread: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("capital"),
  marketAtLeast: vi.fn().mockReturnValue(false),
}));

let db: MockDb;
const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const CURRENT_TURN = 1000;

const CAPITAL_STOCK = 10_000;
const FROM_STRATEGY = "standard";
const TO_STRATEGY = "heavy_metals";
const RATIO = capacityRescaleRatio("manufacturing", FROM_STRATEGY, TO_STRATEGY);

const corporation = {
  _id: CORP_ID,
  name: "Retoolco",
  countryId: "US",
  type: "manufacturing",
  ceoId: new ObjectId(),
  liquidCapital: 1_000_000_000,
  liquidCurrencyCode: "USD",
};

function sectorDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    countryId: "US",
    stateId: "US-CA",
    sectorType: "manufacturing",
    revenue: 1_000_000,
    capitalStock: CAPITAL_STOCK,
    buildQueue: [{ unitsOrdered: 500, costPaidAnchor: 1000, onlineTurn: CURRENT_TURN + 5 }],
    ...overrides,
  };
}

async function wireMocks(sector: Record<string, unknown>, plantsEnabled: boolean) {
  const { marketAtLeast, getMarketSystemModeForDb } = await import("@/lib/market/featureFlag");
  vi.mocked(marketAtLeast).mockReturnValue(plantsEnabled);
  vi.mocked(getMarketSystemModeForDb).mockResolvedValue(plantsEnabled ? "plants" : "capital");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({ ok: true, user: { userId: "user-1" } } as never);
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
  db.collectionMocks.corporateSectors.findOne.mockResolvedValue(sector);
  db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  db.collectionMocks.corporations.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    _id: "current",
    currentTurn: CURRENT_TURN,
  });
}

const params = Promise.resolve({ id: CORP_ID.toString(), sectorId: SECTOR_ID.toString() });

function request(body: unknown) {
  return new Request("http://localhost/api/corporations/1/sectors/2/strategy", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** The `$set` the command wrote to corporateSectors. */
function sectorSet(): Record<string, unknown> {
  const call = db.collectionMocks.corporateSectors.updateOne.mock.calls[0];
  return (call?.[1] as { $set: Record<string, unknown> }).$set;
}

describe("retool capital-stock rescale is plants-gated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("gameState");
    db.collection("commodityPrices");
    db.collection("stateResourceCapacity");
  });

  // Guard the fixture: if the chosen strategy pair ever becomes RPU-neutral the
  // tests below would pass for the wrong reason.
  it("uses a strategy pair whose rescale ratio is not 1", () => {
    expect(RATIO).not.toBe(1);
  });

  it("setSectorStrategy leaves capitalStock and buildQueue alone below plants", async () => {
    await wireMocks(sectorDoc({ strategyId: FROM_STRATEGY }), false);
    const { setSectorStrategy } = await import("./setSectorStrategy");
    const res = await setSectorStrategy(request({ strategyId: TO_STRATEGY }), { params });
    expect(res.status).toBe(200);

    const set = sectorSet();
    expect(set.strategyId).toBe(TO_STRATEGY);
    expect(set).not.toHaveProperty("capitalStock");
    expect(set).not.toHaveProperty("buildQueue");
  });

  it("setSectorStrategy still rescales under plants", async () => {
    await wireMocks(sectorDoc({ strategyId: FROM_STRATEGY }), true);
    const { setSectorStrategy } = await import("./setSectorStrategy");
    const res = await setSectorStrategy(request({ strategyId: TO_STRATEGY }), { params });
    expect(res.status).toBe(200);

    const set = sectorSet();
    expect(set.capitalStock).toBeCloseTo(CAPITAL_STOCK * RATIO, 6);
    expect((set.buildQueue as Array<{ unitsOrdered: number }>)[0].unitsOrdered).toBeCloseTo(
      500 * RATIO,
      6
    );
  });

  it("cancelSectorStrategy leaves capitalStock and buildQueue alone below plants", async () => {
    await wireMocks(
      sectorDoc({
        strategyId: TO_STRATEGY,
        transitionFromStrategyId: FROM_STRATEGY,
        transitionStartTurn: CURRENT_TURN - 3,
      }),
      false
    );
    const { cancelSectorStrategy } = await import("./cancelSectorStrategy");
    const res = await cancelSectorStrategy(request({}), { params });
    expect(res.status).toBe(200);

    const set = sectorSet();
    expect(set.strategyId).toBe(FROM_STRATEGY);
    expect(set).not.toHaveProperty("capitalStock");
    expect(set).not.toHaveProperty("buildQueue");
  });

  it("cancelSectorStrategy still rescales under plants", async () => {
    await wireMocks(
      sectorDoc({
        strategyId: TO_STRATEGY,
        transitionFromStrategyId: FROM_STRATEGY,
        transitionStartTurn: CURRENT_TURN - 3,
        // The retool that opened this transition ran under plants and rescaled.
        retoolRescaleApplied: true,
      }),
      true
    );
    const { cancelSectorStrategy } = await import("./cancelSectorStrategy");
    const res = await cancelSectorStrategy(request({}), { params });
    expect(res.status).toBe(200);

    // The cancel runs the same rescale in the opposite direction, so composing
    // it with the forward retool returns the sector to its original stock.
    const set = sectorSet();
    expect(set.capitalStock).toBeCloseTo(CAPITAL_STOCK / RATIO, 6);
  });

  // ── The mode can FLIP between the set and the cancel ──
  //
  // Each command used to resolve `plantsEnabled` at its own call time, so a
  // retool committed in one mode and cancelled in the other applied exactly one
  // half of an exact, invertible pair: a permanent mint or burn of the whole RPU
  // ratio, which reaches 327x for a coal to rare-earth pair. The decision is now
  // persisted on the sector, and the inverse runs only when the forward step did.
  it("does not invert a rescale that never happened when the world flips to plants", async () => {
    await wireMocks(
      sectorDoc({
        strategyId: TO_STRATEGY,
        transitionFromStrategyId: FROM_STRATEGY,
        transitionStartTurn: CURRENT_TURN - 3,
        // Committed under capital mode: no forward rescale was applied.
        retoolRescaleApplied: false,
      }),
      // ...and the world is plants by the time the player cancels.
      true
    );
    const { cancelSectorStrategy } = await import("./cancelSectorStrategy");
    const res = await cancelSectorStrategy(request({}), { params });
    expect(res.status).toBe(200);

    const set = sectorSet();
    expect(set.strategyId).toBe(FROM_STRATEGY);
    expect(set).not.toHaveProperty("capitalStock");
    expect(set).not.toHaveProperty("buildQueue");
  });

  it("treats a legacy sector with no flag as never rescaled", async () => {
    await wireMocks(
      sectorDoc({
        strategyId: TO_STRATEGY,
        transitionFromStrategyId: FROM_STRATEGY,
        transitionStartTurn: CURRENT_TURN - 3,
      }),
      true
    );
    const { cancelSectorStrategy } = await import("./cancelSectorStrategy");
    const res = await cancelSectorStrategy(request({}), { params });
    expect(res.status).toBe(200);
    expect(sectorSet()).not.toHaveProperty("capitalStock");
  });

  it("setSectorStrategy records which side of the gate the retool ran on", async () => {
    await wireMocks(sectorDoc({ strategyId: FROM_STRATEGY }), true);
    const { setSectorStrategy } = await import("./setSectorStrategy");
    await setSectorStrategy(request({ strategyId: TO_STRATEGY }), { params });
    expect(sectorSet().retoolRescaleApplied).toBe(true);

    vi.clearAllMocks();
    await wireMocks(sectorDoc({ strategyId: FROM_STRATEGY }), false);
    await setSectorStrategy(request({ strategyId: TO_STRATEGY }), { params });
    expect(sectorSet().retoolRescaleApplied).toBe(false);
  });
});
