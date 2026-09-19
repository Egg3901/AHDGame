import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn(),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/validate")>();
  return { ...actual, parseJsonBody: vi.fn() };
});
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  corporationQueryFromParamId: vi.fn(),
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/corporations/corporateOwnership", () => ({
  acquirerOwnershipPercent: vi.fn(),
  HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT: 50,
  HOSTILE_TAKEOVER_PREMIUM_RATE: 0.25,
}));
vi.mock("@/lib/currency/characterFunds", () => ({
  buildPersonalBalanceInc: vi.fn(() => ({})),
  getHomeCurrency: vi.fn(() => "USD"),
  loadCharacterFxRate: vi.fn(),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpLiquidCapital: vi.fn((value: number) => value),
  corpLiquidCapitalToAnchor: vi.fn((value: number) => value),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  fxRateForCorpFromMap: vi.fn().mockReturnValue(1),
  resolveCorpLiquidCurrencyCode: vi.fn(() => "USD"),
}));
vi.mock("@/lib/currency/marketMaker", () => ({ safeDistributeConversionSpread: vi.fn() }));
vi.mock("@/lib/corporations/shareTradeHistory", () => ({ recordShareTrade: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));

let db: MockDb;

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function makeCharter(charteredTurn: number) {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn,
    postedCapital: 50_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    cashReserves: 123_410_000,
    npcDeposits: 71_110_000,
  };
}

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("states");
  db.collection("bonds");
  db.collection("shareOrders");
  db.collection("shareListings");
  db.collection("bankLoans");
  db.collection("interbankLoans");
  db.collection("savingsAccounts");
  db.collection("characters");
});

async function setupMocks(opts: {
  parentId: ObjectId;
  targetId: ObjectId;
  parent: Record<string, unknown>;
  target: Record<string, unknown>;
}) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "user-1" },
  } as never);

  const { parseJsonBody } = await import("@/lib/api/validate");
  vi.mocked(parseJsonBody).mockResolvedValue({
    success: true,
    data: { parentCorporationId: opts.parentId.toString() },
  } as never);

  const { requireCorporationActionsEnabled } = await import("@/lib/api/requireCorporationActions");
  vi.mocked(requireCorporationActionsEnabled).mockResolvedValue(null);

  const { corporationQueryFromParamId, resolveCorporation, requireCeo } =
    await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(corporationQueryFromParamId).mockReturnValue({ _id: opts.parentId } as never);
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: opts.target } as never);
  vi.mocked(requireCeo).mockReturnValue(null);

  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({
    ok: true,
    limit: 100,
    remaining: 99,
    resetAt: Date.now() + 60_000,
  });

  const { isForexEnabled } = await import("@/lib/currency/featureFlag");
  vi.mocked(isForexEnabled).mockResolvedValue(false);

  const { acquirerOwnershipPercent } = await import("@/lib/corporations/corporateOwnership");
  vi.mocked(acquirerOwnershipPercent).mockReturnValue(96.4);

  const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
  vi.mocked(getCurrentTurn).mockResolvedValue(156);

  // Route reads both corp docs through corporations.findOne — serve each by id
  // so the transfer helper sees the same docs the route validated.
  db.collectionMocks.corporations.findOne.mockImplementation((filter: { _id: ObjectId }) => {
    const doc = (filter._id as ObjectId).equals(opts.targetId) ? opts.target : opts.parent;
    return Promise.resolve(doc as never);
  });
  db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);
  db.collectionMocks.corporateSectors.find.mockReturnValue(makeCursor([]));
  db.collectionMocks.states.find.mockReturnValue(makeCursor([]));
  db.collectionMocks.corporations.find.mockReturnValue(makeCursor([]));
}

async function postTakeover(targetId: ObjectId, parentId: ObjectId) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/corporations/target/hostile-takeover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentCorporationId: parentId.toString() }),
    }),
    { params: Promise.resolve({ id: targetId.toString() }) }
  );
}

describe("hostile takeover with a banked subsidiary (ticket-1267)", () => {
  it("moves the subsidiary bank to the parent instead of deleting it", async () => {
    const parentId = new ObjectId();
    const targetId = new ObjectId();
    const parent = {
      _id: parentId,
      name: "Holding Co",
      liquidCapital: 1_000_000_000,
      shareholders: [],
    };
    const target = {
      _id: targetId,
      name: "Vermont Finance",
      liquidCapital: 0,
      sharePrice: 10,
      shareholders: [{ corporationId: parentId, shares: 964 }],
      liquidCurrencyCode: "USD",
      bankCharter: makeCharter(150),
    };
    await setupMocks({ parentId, targetId, parent, target });

    const response = await postTakeover(targetId, parentId);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.bankCharterTransferred).toBe(true);

    // Charter slot claimed on the parent …
    const claimCall = db.collectionMocks.corporations.updateOne.mock.calls.find(
      ([filter]) =>
        (filter as Record<string, unknown>)._id === parentId &&
        "bankCharter" in (filter as Record<string, unknown>)
    );
    expect(claimCall).toBeDefined();
    expect((claimCall?.[1] as { $set: Record<string, unknown> }).$set.bankCharter).toMatchObject({
      currency: "USD",
      charteredTurn: 150,
    });

    // … and every satellite record re-keyed to the new owner.
    expect(db.collectionMocks.bankLoans.updateMany).toHaveBeenCalledWith(
      { bankCorporationId: targetId },
      expect.objectContaining({ $set: expect.objectContaining({ bankCorporationId: parentId }) })
    );
    expect(db.collectionMocks.interbankLoans.updateMany).toHaveBeenCalledWith(
      { lenderCorporationId: targetId },
      expect.objectContaining({})
    );
    expect(db.collectionMocks.interbankLoans.updateMany).toHaveBeenCalledWith(
      { borrowerCorporationId: targetId },
      expect.objectContaining({})
    );
    expect(db.collectionMocks.savingsAccounts.updateMany).toHaveBeenCalledWith(
      { holder: targetId.toString(), status: { $ne: "closed" } },
      expect.objectContaining({})
    );
    expect(db.collectionMocks.characters.updateMany).toHaveBeenCalledWith(
      { [`currencyBalances.savingsHolder.USD`]: targetId.toString() },
      expect.objectContaining({})
    );
  });

  it("refuses the merge when the parent already operates a bank, before any money moves", async () => {
    const parentId = new ObjectId();
    const targetId = new ObjectId();
    const parent = {
      _id: parentId,
      name: "Holding Co",
      liquidCapital: 1_000_000_000,
      shareholders: [],
      bankCharter: makeCharter(100),
    };
    const target = {
      _id: targetId,
      name: "Vermont Finance",
      liquidCapital: 0,
      sharePrice: 10,
      shareholders: [{ corporationId: parentId, shares: 964 }],
      liquidCurrencyCode: "USD",
      bankCharter: makeCharter(150),
    };
    await setupMocks({ parentId, targetId, parent, target });

    const response = await postTakeover(targetId, parentId);

    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/already operates a bank/);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.deleteOne).not.toHaveBeenCalled();
  });
});
