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
  corpCapitalToAnchor: vi.fn((value: number) => value),
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

// Bank NAV: 123.41M cash - 71.11M household deposits = 52.3M realizable equity.
// Quoted at sharePrice 10 (12.5 with the 25% premium): the market leg prices
// the whole 1000-share corp at 12,500, far below the bank it carries.
const BANK_CASH = 123_410_000;
const BANK_DEPOSITS = 71_110_000;
const BANK_EQUITY = BANK_CASH - BANK_DEPOSITS;
const TOTAL_SHARES = 1000;
const FLOOR_PER_SHARE = BANK_EQUITY / TOTAL_SHARES;
const MINORITY_SHARES = 36;

function makeCharter(charteredTurn: number, overrides: Record<string, unknown> = {}) {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn,
    postedCapital: 50_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    cashReserves: BANK_CASH,
    npcDeposits: BANK_DEPOSITS,
    playerDeposits: 0,
    totalDeposits: BANK_DEPOSITS,
    totalLoans: 0,
    discountWindowDebt: 0,
    cbMarginDebt: 0,
    interbankDebt: 0,
    ...overrides,
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
  db.collection("gameConfig");
});

async function setupMocks(opts: {
  parentId: ObjectId;
  targetId: ObjectId;
  holderId: ObjectId;
  parent: Record<string, unknown>;
  target: Record<string, unknown>;
  holder: Record<string, unknown>;
  gameConfig: Record<string, unknown> | null;
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

  db.collectionMocks.corporations.findOne.mockImplementation((filter: { _id: ObjectId }) => {
    if ((filter._id as ObjectId).equals(opts.targetId))
      return Promise.resolve(opts.target as never);
    if ((filter._id as ObjectId).equals(opts.holderId))
      return Promise.resolve(opts.holder as never);
    return Promise.resolve(opts.parent as never);
  });
  db.collectionMocks.gameConfig.findOne.mockResolvedValue(opts.gameConfig as never);
  db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);
  db.collectionMocks.corporateSectors.find.mockReturnValue(makeCursor([]));
  db.collectionMocks.states.find.mockReturnValue(makeCursor([]));
  db.collectionMocks.corporations.find.mockReturnValue(makeCursor([]));
}

function makeCorps(targetCharter: Record<string, unknown> | undefined) {
  const parentId = new ObjectId();
  const targetId = new ObjectId();
  const holderId = new ObjectId();
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
    totalShares: TOTAL_SHARES,
    shareholders: [
      { corporationId: parentId, shares: TOTAL_SHARES - MINORITY_SHARES },
      { corporationId: holderId, shares: MINORITY_SHARES },
    ],
    liquidCurrencyCode: "USD",
    ...(targetCharter ? { bankCharter: targetCharter } : {}),
  };
  const holder = {
    _id: holderId,
    name: "Minority Co",
    liquidCapital: 0,
    liquidCurrencyCode: "USD",
    shareholders: [],
  };
  return { parentId, targetId, holderId, parent, target, holder };
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

describe("hostile takeover bank-NAV floor (issue #1750)", () => {
  // The hostile-takeover route graph is heavy (full server module import plus
  // the whole merge path); allow 60s per test on a shared host.
  it("floors the squeeze-out at realizable bank equity when the market price underprices it", async () => {
    const { parentId, targetId, holderId, parent, target, holder } = makeCorps(makeCharter(150));
    await setupMocks({ parentId, targetId, holderId, parent, target, holder, gameConfig: null });

    const response = await postTakeover(targetId, parentId);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.bankNavFloorApplied).toBe(true);

    // Minority is bought out at full bank equity per share, not at 12.5.
    const expectedPayout = MINORITY_SHARES * FLOOR_PER_SHARE;
    expect(body.minorityPayoutAnchorTotal).toBe(expectedPayout);

    // The implied whole-corp consideration covers the realizable bank.
    const impliedFullValue =
      (Number(body.minorityPayoutAnchorTotal) / MINORITY_SHARES) * TOTAL_SHARES;
    expect(impliedFullValue).toBeGreaterThanOrEqual(BANK_EQUITY);

    // The parent funds the floored debit, and the minority holder is credited.
    const debit = db.collectionMocks.corporations.updateOne.mock.calls.find(
      ([filter, update]) =>
        ((filter as { _id: ObjectId })._id as ObjectId).equals(parentId) &&
        (update as { $inc?: { liquidCapital?: number } }).$inc?.liquidCapital === -expectedPayout
    );
    expect(debit).toBeDefined();
    const credit = db.collectionMocks.corporations.updateOne.mock.calls.find(
      ([filter, update]) =>
        ((filter as { _id: ObjectId })._id as ObjectId).equals(holderId) &&
        (update as { $inc?: { liquidCapital?: number } }).$inc?.liquidCapital === expectedPayout
    );
    expect(credit).toBeDefined();
  }, 60_000);

  it("counts the marked bond/prop book in the floor, net of borrowings", async () => {
    // The acquirer inherits the whole charter including the prop book, so a
    // bank carrying a 300M marked book cannot be squeezed out at cash-minus-
    // deposits. Borrowings still net against the floor.
    const propBookMarkValue = 300_000_000;
    const discountWindowDebt = 10_000_000;
    const nav = BANK_CASH + propBookMarkValue - BANK_DEPOSITS - discountWindowDebt;
    const charter = makeCharter(150, { propBookMarkValue, discountWindowDebt });
    const { parentId, targetId, holderId, parent, target, holder } = makeCorps(charter);
    await setupMocks({ parentId, targetId, holderId, parent, target, holder, gameConfig: null });

    const response = await postTakeover(targetId, parentId);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.bankNavFloorApplied).toBe(true);
    const expectedPayout = MINORITY_SHARES * (nav / TOTAL_SHARES);
    expect(body.minorityPayoutAnchorTotal).toBe(expectedPayout);
    const impliedFullValue =
      (Number(body.minorityPayoutAnchorTotal) / MINORITY_SHARES) * TOTAL_SHARES;
    expect(impliedFullValue).toBeGreaterThanOrEqual(nav);
  }, 60_000);

  it("leaves pricing untouched for targets without a bank", async () => {
    const { parentId, targetId, holderId, parent, target, holder } = makeCorps(undefined);
    await setupMocks({ parentId, targetId, holderId, parent, target, holder, gameConfig: null });

    const response = await postTakeover(targetId, parentId);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.bankNavFloorApplied).toBe(false);
    expect(body.minorityPayoutAnchorTotal).toBe(MINORITY_SHARES * 10 * 1.25);
  }, 60_000);

  it("treats player deposits as liabilities under an authoritative savings read", async () => {
    const playerDeposits = 30_000_000;
    const charter = makeCharter(150, {
      playerDeposits,
      totalDeposits: BANK_DEPOSITS + playerDeposits,
    });
    const { parentId, targetId, holderId, parent, target, holder } = makeCorps(charter);
    await setupMocks({
      parentId,
      targetId,
      holderId,
      parent,
      target,
      holder,
      gameConfig: {
        savingsAccountsMode: "authoritative",
        savingsAccountsReadCurrencies: ["USD"],
      },
    });

    const response = await postTakeover(targetId, parentId);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.bankNavFloorApplied).toBe(true);
    const expectedPayout = MINORITY_SHARES * ((BANK_EQUITY - playerDeposits) / TOTAL_SHARES);
    expect(body.minorityPayoutAnchorTotal).toBe(expectedPayout);
  }, 60_000);
});
