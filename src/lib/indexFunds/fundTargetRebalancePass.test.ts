import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  rebalanceFundToTarget,
  buildFundTargetRebalancePassKey,
  type TargetRebalanceOutcome,
} from "./fundCron";
import type { IndexFund } from "@/lib/db/types";
import { ObjectId } from "mongodb";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  keyedInsertId,
} from "@/lib/db/nonAtomicMoneyFlow";

// ---------------------------------------------------------------------------
// Module mocks: every ambient read/quotes layer is stubbed, exactly like
// fundCron.test.ts, except the pass driver under test and both figure
// quoters (which must run for real so pins are genuine).
// ---------------------------------------------------------------------------

vi.mock("@/lib/indexFunds/fundQueries", () => ({
  updateFundHoldings: vi.fn().mockResolvedValue(undefined),
  insertFundTransaction: vi.fn().mockResolvedValue(undefined),
  insertFundTransactionsBulk: vi.fn().mockResolvedValue(undefined),
  getFundById: vi.fn(),
  listActiveFunds: vi.fn(),
  listServiceableFunds: vi.fn(),
  updateFundNav: vi.fn(),
  updateFundConstituents: vi.fn(),
  setFundStatus: vi.fn(),
  listPendingRedemptions: vi.fn().mockResolvedValue([]),
  updateRedemptionEntry: vi.fn(),
  insertFundSnapshot: vi.fn(),
  FUND_REDEMPTION_QUEUE_COLLECTION: "indexFundRedemptionQueue",
  FUND_TRANSACTION_COLLECTION: "indexFundTransactions",
}));

const { applyBuyMock } = vi.hoisted(() => ({ applyBuyMock: vi.fn() }));

vi.mock("@/lib/indexFunds/fundShareBuySpend", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, applyFundShareBuySpend: applyBuyMock };
});

vi.mock("@/lib/equities/marketPool", () => ({
  loadEquityPoolsByCurrency: vi.fn().mockResolvedValue(new Map()),
  equityPoolCurrency: vi
    .fn()
    .mockImplementation(
      (corp: { liquidCurrencyCode?: string | null }) => corp.liquidCurrencyCode ?? "USD"
    ),
  readEquityPool: vi.fn().mockResolvedValue(null),
  loadEquityQuote: vi.fn().mockImplementation((_db, corp: { sharePrice: number }) =>
    Promise.resolve({
      active: false,
      currency: "USD",
      midPriceLocal: corp.sharePrice,
      bidPriceLocal: corp.sharePrice,
      askPriceLocal: corp.sharePrice,
      bidDepthShares: Number.MAX_SAFE_INTEGER,
      poolCash: 0,
      targetCash: 0,
    })
  ),
}));

vi.mock("@/lib/corporations/shareBuybackMode", () => ({
  getShareBuybackMode: vi.fn().mockReturnValue("instant"),
}));

vi.mock("@/lib/corporations/shareTradeHistory", () => ({
  recordShareTrade: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/corporations/marketExecution", () => ({
  isOrderFlowPriceEligible: vi.fn().mockReturnValue(false),
  resolveShareExecutionPrice: vi
    .fn()
    .mockImplementation((corp: { sharePrice: number }) => corp.sharePrice),
}));

vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(
      async (
        withSession: (s: undefined) => Promise<unknown>,
        withoutSession: () => Promise<unknown>
      ) => withoutSession()
    ),
}));

vi.mock("@/lib/indexFunds/fundConstituentLifecycle", () => ({
  findRemovedConstituentHoldings: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn().mockResolvedValue(false),
  INDEX_FUNDS_DISABLED_MESSAGE: "disabled",
}));
vi.mock("@/lib/indexFunds/fundBondReserve", () => ({ deployBondReserveFromCash: vi.fn() }));
vi.mock("@/lib/indexFunds/fundCrossRebalancing", () => ({
  executeFundCrossRebalancing: vi.fn(),
  planFundCrossRebalancing: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/indexFunds/nppInvesting", () => ({ processNPPFundInvestments: vi.fn() }));
vi.mock("@/lib/indexFunds/fundRedemptionLiquidity", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sellFundHoldingsForRedemptionCash: vi.fn(),
    sellFundHoldingShares: vi.fn(),
  };
});
vi.mock("@/lib/bonds/fundBondHoldings", () => ({
  sumFundBondHoldingsValueAnchor: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/currency/characterFunds", () => ({ buildPersonalBalanceInc: vi.fn() }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
  fxRateForCorpFromMap: vi.fn().mockReturnValue(1),
  corpLiquidCapitalToAnchor: vi.fn().mockImplementation((amount: number) => amount),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  shareTradeAnchorValue: vi
    .fn()
    .mockImplementation(
      (shares: number, corp: { sharePrice?: number }) => shares * (corp?.sharePrice ?? 0)
    ),
}));

const { placeBidMock, cancelBidMock } = vi.hoisted(() => ({
  placeBidMock: vi.fn(),
  cancelBidMock: vi.fn(),
}));

vi.mock("@/lib/indexFunds/fundShareOrders", () => ({
  placeFundShareBuyOrder: placeBidMock,
  cancelFundShareOrder: cancelBidMock,
}));

vi.mock("@/lib/indexFunds/fundBidPolicy", () => ({
  fundBidLimitPriceLocal: vi.fn().mockImplementation((price: number) => price * 1.02),
  INDEX_FUND_BID_MAX_OPEN_TURNS: 24,
}));
vi.mock("@/lib/indexFunds/fundTxLog", () => ({
  logIndexFundRedeem: vi.fn(),
  resolveIndexFundHolder: vi.fn(),
}));
vi.mock("@/lib/indexFunds/fundFloatAbsorptionPlan", () => ({
  planFloatAbsorptionAcrossFunds: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// Stateful FakeDb with crash injection: honors the operators the pass driver
// and the real money-flow machinery emit (insertOne with E11000, findOne with
// projection, find/toArray, updateOne with $inc/$set incl. dotted paths/
// $push+$each+$slice/$pull/$unset; _id fast path, dotted equality, $ne on
// key arrays, $gte guards, $exists, ObjectId equality). Throwing
// INJECTED_CRASH after N writes models a process death between sequential
// Mongo writes: state persists, in-flight work does not.
// ---------------------------------------------------------------------------

const INJECTED_CRASH = "INJECTED_CRASH";

function docKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id instanceof ObjectId) return id.toHexString();
  return String(id);
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (actual instanceof ObjectId && expected instanceof ObjectId) return actual.equals(expected);
  return actual === expected;
}

function getPath(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], doc);
}

function setPath(doc: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    const next = node[part];
    if (typeof next !== "object" || next === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
}

function cloneValue<T>(value: T): T {
  if (value instanceof ObjectId) return new ObjectId(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cloneValue(v)])
    ) as T;
  }
  return value;
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof ObjectId) &&
    !(value instanceof Date) &&
    !Array.isArray(value)
  );
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    const actual = getPath(doc, field);
    if (isOperatorObject(condition)) {
      if ("$ne" in condition) {
        const values = Array.isArray(actual) ? actual : actual === undefined ? [] : [actual];
        if (values.some((v) => valueEquals(v, condition.$ne))) return false;
        continue;
      }
      if ("$gte" in condition) {
        if (!(typeof actual === "number" && actual >= (condition.$gte as number))) return false;
        continue;
      }
      if ("$exists" in condition) {
        if ((actual !== undefined) !== Boolean(condition.$exists)) return false;
        continue;
      }
      return false;
    }
    if (!valueEquals(actual, condition)) return false;
  }
  return true;
}

function stable(value: unknown): string {
  if (value instanceof ObjectId) return `$oid:${value.toHexString()}`;
  if (value instanceof Date) return `$date:${value.getTime()}`;
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}:${stable(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

class FakeCollection {
  readonly docs = new Map<string, Record<string, unknown>>();

  constructor(private readonly db: FakeDb) {}

  private countWrite(): void {
    this.db.writeCount += 1;
    if (this.db.writeCount > this.db.crashAfterWrites) throw new Error(INJECTED_CRASH);
  }

  async insertOne(doc: Record<string, unknown>): Promise<{ insertedId: unknown }> {
    this.countWrite();
    const key = docKey(doc._id);
    if (this.docs.has(key)) {
      const error = new Error("E11000 duplicate key error") as Error & { code: number };
      error.code = 11000;
      throw error;
    }
    this.docs.set(key, cloneValue(doc));
    return { insertedId: doc._id };
  }

  async findOne(
    filter: Record<string, unknown>,
    opts?: { projection?: Record<string, unknown> }
  ): Promise<Record<string, unknown> | null> {
    const doc =
      "_id" in filter
        ? this.docs.get(docKey(filter._id))
        : [...this.docs.values()].find((d) => matchesFilter(d, filter));
    if (!doc) return null;
    if (!opts?.projection) return cloneValue(doc);
    const out: Record<string, unknown> = { _id: cloneValue(doc._id) };
    for (const field of Object.keys(opts.projection)) {
      if (field !== "_id") out[field] = cloneValue(getPath(doc, field));
    }
    return out;
  }

  find(filter: Record<string, unknown>): { toArray: () => Promise<Record<string, unknown>[]> } {
    const docs = [...this.docs.values()].filter((doc) => {
      if ("_id" in filter && docKey(doc._id) !== docKey(filter._id)) return false;
      return matchesFilter(doc, filter);
    });
    return { toArray: async () => cloneValue(docs) };
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    const doc = "_id" in filter ? this.docs.get(docKey(filter._id)) : undefined;
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    if (!matchesFilter(doc, filter)) return { matchedCount: 0, modifiedCount: 0 };

    const inc = (update.$inc ?? {}) as Record<string, number>;
    for (const [field, delta] of Object.entries(inc)) {
      setPath(doc, field, ((getPath(doc, field) as number | undefined) ?? 0) + delta);
    }
    const pull = (update.$pull ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(pull)) {
      const current = getPath(doc, field);
      if (Array.isArray(current))
        setPath(
          doc,
          field,
          current.filter((v) => !valueEquals(v, value))
        );
    }
    const push = (update.$push ?? {}) as Record<string, { $each: unknown[]; $slice: number }>;
    for (const [field, spec] of Object.entries(push)) {
      const current = (getPath(doc, field) as unknown[] | undefined) ?? [];
      const next = [...current, ...spec.$each];
      setPath(doc, field, spec.$slice < 0 ? next.slice(spec.$slice) : next);
    }
    const set = (update.$set ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(set)) {
      setPath(doc, field, cloneValue(value));
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

class FakeDb {
  writeCount = 0;
  crashAfterWrites = Number.POSITIVE_INFINITY;
  private readonly collections = new Map<string, FakeCollection>();

  collection(name: string): FakeCollection {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new FakeCollection(this);
      this.collections.set(name, collection);
    }
    return collection;
  }
}

// ---------------------------------------------------------------------------
// Scenarios: a drift fund (sell overweight + buy underweight) and a bid fund
// (zero-float constituent pins a standing bid; a seeded off-basket open order
// pins a cancel). Corps carry the full candidate shape the real quoters read.
// ---------------------------------------------------------------------------

const TURN = 5;

type CorpRow = {
  _id: ObjectId;
  countryId: "US";
  type: "tech";
  secondaryType: undefined;
  sharePrice: number;
  fundamentalSharePrice: number;
  totalShares: number;
  liquidCurrencyCode: "USD";
  publicFloat: number;
  shareBuybackMode: undefined;
};

function makeCorp(overrides: Partial<CorpRow> & { _id: ObjectId }): CorpRow {
  return {
    countryId: "US",
    type: "tech",
    secondaryType: undefined,
    sharePrice: 10,
    fundamentalSharePrice: 10,
    totalShares: 100_000,
    liquidCurrencyCode: "USD",
    publicFloat: 5_000,
    shareBuybackMode: undefined,
    ...overrides,
  };
}

function makeFund(overrides: Partial<IndexFund> & { _id: ObjectId }): IndexFund {
  return {
    slug: "us_top_25",
    name: "US Top 25",
    tickerSymbol: "US25",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 500_000,
    reserveUnits: 500_000,
    cashAnchor: 100_000,
    targetConstituents: [],
    holdings: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as IndexFund;
}

function seedCorporations(db: FakeDb, corps: CorpRow[]): void {
  const coll = db.collection("corporations");
  for (const corp of corps) {
    coll.docs.set(corp._id.toHexString(), {
      ...cloneValue(corp),
      name: "Test Corp",
      shareEscrowBalance: 0,
    });
  }
}

function seedOpenOrder(db: FakeDb, order: Record<string, unknown> & { _id: ObjectId }): void {
  db.collection("shareOrders").docs.set(order._id.toHexString(), cloneValue(order));
}

// ---------------------------------------------------------------------------
// Child fakes: model the keyed-child contract (one apply per child key, later
// same-key calls reconcile to the stored outcome) and throw INJECTED_CRASH on
// scripted call indices so a crash inside a child boundary is reproducible.
// Captured pins let the tests assert a retry replays figures bit-for-bit.
// ---------------------------------------------------------------------------

type ChildHarness = {
  sellCalls: Array<{ key: string; pins: string }>;
  buyCalls: Array<{ key: string; figures: string }>;
  placeCalls: Array<{ key: string; args: string }>;
  cancelCalls: string[];
  appliedSells: Map<
    string,
    { cashRaisedAnchor: number; sharesSold: number; salesExecuted: number }
  >;
  appliedBuys: Map<string, { sharesBought: number; anchorSpent: number }>;
  appliedBids: Map<string, { orderId: ObjectId }>;
  crashSellOn: Set<number>;
  crashBuyOn: Set<number>;
  crashPlaceOn: Set<number>;
  sellCount: number;
  buyCount: number;
  placeCount: number;
};

function makeChildHarness(): ChildHarness {
  return {
    sellCalls: [],
    buyCalls: [],
    placeCalls: [],
    cancelCalls: [],
    appliedSells: new Map(),
    appliedBuys: new Map(),
    appliedBids: new Map(),
    crashSellOn: new Set(),
    crashBuyOn: new Set(),
    crashPlaceOn: new Set(),
    sellCount: 0,
    buyCount: 0,
    placeCount: 0,
  };
}

async function installChildFakes(harness: ChildHarness, fundsById: Map<string, IndexFund>) {
  const { getFundById } = await import("@/lib/indexFunds/fundQueries");
  vi.mocked(getFundById).mockImplementation(async (_db, fundId: ObjectId) =>
    cloneValue(fundsById.get(fundId.toString()) ?? null)
  );

  const { sellFundHoldingShares } = await import("@/lib/indexFunds/fundRedemptionLiquidity");
  vi.mocked(sellFundHoldingShares).mockImplementation(
    async (_db, _fund, _corpId, _shares, opts) => {
      const key = opts?.keyOptions?.idempotencyKey ?? `no-key:${harness.sellCount}`;
      const pins = stable(opts?.pinnedLeg ?? null);
      harness.sellCalls.push({ key, pins });
      const callIndex = harness.sellCount;
      harness.sellCount += 1;
      if (harness.crashSellOn.has(callIndex)) throw new Error(INJECTED_CRASH);
      const existing = harness.appliedSells.get(key);
      if (existing) return { ...existing };
      const pinned = opts?.pinnedLeg;
      const outcome = {
        cashRaisedAnchor: pinned?.proceedsAnchor ?? 0,
        sharesSold: pinned?.sharesToSell ?? 0,
        salesExecuted: 1,
      };
      harness.appliedSells.set(key, outcome);
      return { ...outcome };
    }
  );

  applyBuyMock.mockImplementation(async (_db, input: Record<string, unknown>) => {
    const key = input.idempotencyKey as string;
    harness.buyCalls.push({ key, figures: stable(input) });
    const callIndex = harness.buyCount;
    harness.buyCount += 1;
    if (harness.crashBuyOn.has(callIndex)) throw new Error(INJECTED_CRASH);
    const existing = harness.appliedBuys.get(key);
    if (existing) return { duplicate: true, outcome: { ...existing } };
    const outcome = {
      sharesBought: input.shares as number,
      anchorSpent: input.actualCost as number,
    };
    harness.appliedBuys.set(key, outcome);
    return { duplicate: false, outcome: { ...outcome } };
  });

  placeBidMock.mockImplementation(async (_db, input: Record<string, unknown>) => {
    const key = (input.keyOptions as { idempotencyKey: string }).idempotencyKey;
    harness.placeCalls.push({ key, args: stable(input) });
    const callIndex = harness.placeCount;
    harness.placeCount += 1;
    if (harness.crashPlaceOn.has(callIndex)) throw new Error(INJECTED_CRASH);
    const existing = harness.appliedBids.get(key);
    if (existing) return { ok: true, orderId: existing.orderId, duplicate: true };
    const orderId = keyedInsertId(key, "test-bid-order");
    harness.appliedBids.set(key, { orderId });
    return { ok: true, orderId, duplicate: false };
  });

  cancelBidMock.mockImplementation(async (_db, orderId: ObjectId) => {
    harness.cancelCalls.push(orderId.toString());
  });
}

function driftScenario(): {
  fund: IndexFund;
  corps: CorpRow[];
  overweightId: ObjectId;
  underweightId: ObjectId;
} {
  const overweightId = new ObjectId();
  const underweightId = new ObjectId();
  const fund = makeFund({
    _id: new ObjectId(),
    cashAnchor: 100_000,
    targetConstituents: [
      { corporationId: overweightId, targetWeight: 0.1, marketCapAnchor: 1_000_000 },
      { corporationId: underweightId, targetWeight: 0.1, marketCapAnchor: 1_000_000 },
    ],
    holdings: [
      {
        corporationId: overweightId,
        shares: 5000,
        avgCostPerShareAnchor: 10,
        lastValueAnchor: 50_000,
      },
    ],
  });
  const corps = [
    makeCorp({ _id: overweightId, publicFloat: 0 }),
    makeCorp({ _id: underweightId, publicFloat: 5000 }),
  ];
  return { fund, corps, overweightId, underweightId };
}

function bidScenario(): {
  fund: IndexFund;
  corps: CorpRow[];
  inBasketId: ObjectId;
  offBasketId: ObjectId;
  offBasketOrderId: ObjectId;
} {
  const inBasketId = new ObjectId();
  const offBasketId = new ObjectId();
  const offBasketOrderId = new ObjectId();
  const fundId = new ObjectId();
  const fund = makeFund({
    _id: fundId,
    cashAnchor: 500_000,
    targetConstituents: [
      { corporationId: inBasketId, targetWeight: 0.1, marketCapAnchor: 1_000_000 },
    ],
    holdings: [],
  });
  const corps = [
    makeCorp({ _id: inBasketId, sharePrice: 100, fundamentalSharePrice: 100, publicFloat: 0 }),
  ];
  return { fund, corps, inBasketId, offBasketId, offBasketOrderId };
}

async function runPass(
  db: FakeDb,
  fund: IndexFund,
  corps: CorpRow[]
): Promise<TargetRebalanceOutcome> {
  return rebalanceFundToTarget(
    db as never,
    fund,
    corps as unknown as Parameters<typeof rebalanceFundToTarget>[2],
    {},
    new Map(),
    TURN
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fundTargetRebalancePass — crash after every parent durable write", () => {
  it("converges to the golden outcome with single-apply children and bit-identical pins", async () => {
    const { fund, corps } = driftScenario();

    // Golden run: no crash. Records the write budget and the pinned legs.
    const goldenDb = new FakeDb();
    seedCorporations(goldenDb, corps);
    const goldenFunds = new Map([[fund._id.toString(), fund]]);
    const goldenHarness = makeChildHarness();
    await installChildFakes(goldenHarness, goldenFunds);
    const golden = await runPass(goldenDb, fund, corps);
    expect(golden.sells).toBeGreaterThanOrEqual(1);
    expect(golden.buys).toBeGreaterThanOrEqual(1);
    const totalWrites = goldenDb.writeCount;
    expect(totalWrites).toBeGreaterThan(0);
    const goldenSellKeys = goldenHarness.sellCalls.map((c) => c.key);
    const goldenBuyKeys = goldenHarness.buyCalls.map((c) => c.key);

    // Every crash point: fresh state, crash once, then retry clean.
    for (let crashAt = 0; crashAt <= totalWrites; crashAt += 1) {
      const db = new FakeDb();
      seedCorporations(db, corps);
      const fundsById = new Map([[fund._id.toString(), fund]]);
      const harness = makeChildHarness();
      await installChildFakes(harness, fundsById);

      db.crashAfterWrites = crashAt;
      const attempt = runPass(db, fund, corps);
      if (crashAt < totalWrites) {
        await expect(attempt).rejects.toThrow(INJECTED_CRASH);
      } else {
        await expect(attempt).resolves.toEqual(golden);
      }

      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      await expect(runPass(db, fund, corps)).resolves.toEqual(golden);

      // Every call replays a golden leg: same key set, bit-identical figures.
      expect(new Set(harness.sellCalls.map((c) => c.key))).toEqual(new Set(goldenSellKeys));
      for (const key of goldenSellKeys) {
        expect(harness.sellCalls.filter((c) => c.key === key).length).toBeGreaterThanOrEqual(1);
      }
      for (const call of harness.sellCalls) {
        const goldenCall = goldenHarness.sellCalls.find((g) => g.key === call.key);
        expect(goldenCall?.pins).toBe(call.pins);
      }
      for (const call of harness.buyCalls) {
        const goldenCall = goldenHarness.buyCalls.find((g) => g.key === call.key);
        expect(goldenCall?.figures).toBe(call.figures);
      }
      // One apply per child key no matter how many times the leg re-ran.
      expect(harness.appliedSells.size).toBe(new Set(goldenSellKeys).size);
      expect(harness.appliedBuys.size).toBe(new Set(goldenBuyKeys).size);
    }
  });
});

describe("fundTargetRebalancePass — crash inside child boundaries", () => {
  it("a dying sell reconciles under its pinned key instead of selling twice", async () => {
    const { fund, corps } = driftScenario();
    const db = new FakeDb();
    seedCorporations(db, corps);
    const harness = makeChildHarness();
    harness.crashSellOn.add(0);
    await installChildFakes(harness, new Map([[fund._id.toString(), fund]]));

    await expect(runPass(db, fund, corps)).rejects.toThrow(INJECTED_CRASH);
    expect(harness.appliedSells.size).toBe(0);

    const pinsBefore = harness.sellCalls.map((c) => c.pins);
    const outcome = await runPass(db, fund, corps);
    expect(outcome.sells).toBeGreaterThanOrEqual(1);
    // The retry replays the crashed leg's exact pins under the same key.
    expect(harness.sellCalls[0]!.key).toBe(harness.sellCalls[1]!.key);
    expect(harness.sellCalls[1]!.pins).toBe(pinsBefore[0]);
    for (const call of harness.sellCalls) {
      const first = harness.sellCalls.find((c) => c.key === call.key);
      expect(call.pins).toBe(first!.pins);
    }
    expect(harness.appliedSells.size).toBe(new Set(harness.sellCalls.map((c) => c.key)).size);
  });

  it("a dying buy reconciles under its pinned key instead of buying twice", async () => {
    const { fund, corps } = driftScenario();
    const db = new FakeDb();
    seedCorporations(db, corps);
    const harness = makeChildHarness();
    harness.crashBuyOn.add(0);
    await installChildFakes(harness, new Map([[fund._id.toString(), fund]]));

    await expect(runPass(db, fund, corps)).rejects.toThrow(INJECTED_CRASH);
    expect(harness.appliedBuys.size).toBe(0);

    const outcome = await runPass(db, fund, corps);
    expect(outcome.buys).toBeGreaterThanOrEqual(1);
    expect(harness.buyCalls[0]!.key).toBe(harness.buyCalls[1]!.key);
    expect(harness.buyCalls[0]!.figures).toBe(harness.buyCalls[1]!.figures);
    expect(harness.appliedBuys.size).toBe(1);
    const { recordShareTrade } = await import("@/lib/corporations/shareTradeHistory");
    // The post-commit trade log fires once per fresh buy, never on replay.
    expect(vi.mocked(recordShareTrade).mock.calls.length).toBe(1);
  });
});

describe("fundTargetRebalancePass — changed state on replay", () => {
  it("replays stored targets, holdings, prices, and FX instead of replanning", async () => {
    const { fund, corps, overweightId, underweightId } = driftScenario();
    const db = new FakeDb();
    seedCorporations(db, corps);
    const fundsById = new Map([[fund._id.toString(), fund]]);
    const harness = makeChildHarness();
    await installChildFakes(harness, fundsById);

    // Crash on the sell settle (receipt + plan landed, sell applied but
    // unsettled, buys never ran): the retry must replay the stored sell pins
    // and quote the buys from the stored plan, all pre-mutation figures.
    // crashAfterWrites=N lets N writes land; the (N+1)th (sell settle) dies.
    db.crashAfterWrites = 2;
    await expect(runPass(db, fund, corps)).rejects.toThrow(INJECTED_CRASH);
    const firstSellPins = harness.sellCalls.map((c) => c.pins);
    expect(firstSellPins.length).toBeGreaterThanOrEqual(1);
    expect(harness.buyCalls.length).toBe(0);

    // The world moves before the retry: targets, holdings, prices, currency.
    // Any requote from this state would price 10x higher and plan new sizes.
    fund.targetConstituents = [
      { corporationId: overweightId, targetWeight: 0.01, marketCapAnchor: 1 },
      { corporationId: underweightId, targetWeight: 0.5, marketCapAnchor: 9_999_999 },
    ];
    fund.holdings = [];
    for (const corp of corps) {
      corp.sharePrice = corp.sharePrice * 10 + 7;
      corp.liquidCurrencyCode = "EUR" as unknown as "USD";
    }
    seedCorporations(db, corps);
    fundsById.set(fund._id.toString(), fund);

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const outcome = await runPass(db, fund, corps);
    expect(outcome.sells).toBeGreaterThanOrEqual(1);
    expect(outcome.buys).toBeGreaterThanOrEqual(1);
    // Pins replayed, not requoted from post-crash state: same-key sell calls
    // carry identical pins, and the buys quote at the pre-mutation price
    // (10) rather than the post-mutation price (107).
    expect(harness.sellCalls.length).toBeGreaterThan(firstSellPins.length);
    for (const call of harness.sellCalls) {
      const first = harness.sellCalls.find((c) => c.key === call.key);
      expect(call.pins).toBe(first!.pins);
    }
    // The crashed leg re-ran under its original key with its original pins.
    expect(harness.sellCalls[1]!.key).toBe(harness.sellCalls[0]!.key);
    expect(harness.sellCalls[1]!.pins).toBe(firstSellPins[0]);
    expect(harness.buyCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of harness.buyCalls) {
      expect(call.figures).toContain("executionPriceLocal:10");
    }
    expect(harness.appliedSells.size).toBe(new Set(harness.sellCalls.map((c) => c.key)).size);
    expect(harness.appliedBuys.size).toBe(new Set(harness.buyCalls.map((c) => c.key)).size);
  });
});

describe("fundTargetRebalancePass — partial multi-fund completion", () => {
  it("a crashed fund resumes while the completed fund stays settled", async () => {
    const drift = driftScenario();
    const bid = bidScenario();
    const db = new FakeDb();
    seedCorporations(db, [...drift.corps, ...bid.corps]);
    seedOpenOrder(db, {
      _id: bid.offBasketOrderId,
      corporationId: bid.offBasketId,
      placerFundId: bid.fund._id,
      type: "buy",
      status: "open",
      createdAt: new Date(),
      shares: 5,
      sharesRemaining: 5,
      pricePerShare: 50,
      escrowAmount: 250,
      escrowAnchor: 250,
      updatedAt: new Date(),
    });
    const fundsById = new Map([
      [drift.fund._id.toString(), drift.fund],
      [bid.fund._id.toString(), bid.fund],
    ]);
    const harness = makeChildHarness();
    await installChildFakes(harness, fundsById);

    const driftOutcome = await runPass(db, drift.fund, drift.corps);
    expect(driftOutcome.sells).toBeGreaterThanOrEqual(1);

    db.crashAfterWrites = db.writeCount + 3;
    await expect(runPass(db, bid.fund, bid.corps)).rejects.toThrow(INJECTED_CRASH);
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const bidOutcome = await runPass(db, bid.fund, bid.corps);
    expect(bidOutcome.bidsPlaced).toBe(1);
    expect(bidOutcome.bidsCancelled).toBe(1);

    // The finished fund replays its stored outcome without touching children.
    const sellCount = harness.sellCount;
    const buyCount = harness.buyCount;
    await expect(runPass(db, drift.fund, drift.corps)).resolves.toEqual(driftOutcome);
    expect(harness.sellCount).toBe(sellCount);
    expect(harness.buyCount).toBe(buyCount);
  });
});

describe("fundTargetRebalancePass — concurrent retry", () => {
  it("two same-key passes converge on one outcome with one apply per leg", async () => {
    const { fund, corps } = driftScenario();
    const db = new FakeDb();
    seedCorporations(db, corps);
    const harness = makeChildHarness();
    await installChildFakes(harness, new Map([[fund._id.toString(), fund]]));

    const [first, second] = await Promise.all([runPass(db, fund, corps), runPass(db, fund, corps)]);
    expect(first).toEqual(second);
    expect(first.sells).toBeGreaterThanOrEqual(1);
    expect(first.buys).toBeGreaterThanOrEqual(1);
    expect(harness.appliedSells.size).toBe(new Set(harness.sellCalls.map((c) => c.key)).size);
    expect(harness.appliedBuys.size).toBe(new Set(harness.buyCalls.map((c) => c.key)).size);
  });
});

describe("fundTargetRebalancePass — terminal and conflict", () => {
  it("fails closed on settled and mismatched keys", async () => {
    const { fund, corps } = driftScenario();
    const db = new FakeDb();
    seedCorporations(db, corps);
    await installChildFakes(makeChildHarness(), new Map([[fund._id.toString(), fund]]));

    const outcome = await runPass(db, fund, corps);
    expect(outcome.sells).toBeGreaterThanOrEqual(1);

    const parentKey = buildFundTargetRebalancePassKey(fund._id, TURN);
    const receipts = db.collection("nonAtomicMoneyFlowReceipts");
    const stored = receipts.docs.get(parentKey);
    expect(stored?.status).toBe("completed");

    // A settled key never runs again: mutating it to a terminal state throws.
    stored!.status = "failed";
    await expect(runPass(db, fund, corps)).rejects.toBeInstanceOf(MoneyFlowTerminalError);

    // A reused key with a different fingerprint is a different pass: conflict.
    stored!.status = "in_progress";
    stored!.fingerprint = "tampered-fingerprint";
    await expect(runPass(db, fund, corps)).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
  });
});

describe("fundTargetRebalancePass — deterministic bids", () => {
  it("creates the bid and its audit row once under a stable key, cancels the pinned order once", async () => {
    const bid = bidScenario();
    const db = new FakeDb();
    seedCorporations(db, bid.corps);
    seedOpenOrder(db, {
      _id: bid.offBasketOrderId,
      corporationId: bid.offBasketId,
      placerFundId: bid.fund._id,
      type: "buy",
      status: "open",
      createdAt: new Date(),
      shares: 5,
      sharesRemaining: 5,
      pricePerShare: 50,
      escrowAmount: 250,
      escrowAnchor: 250,
      updatedAt: new Date(),
    });
    // Golden run first: the shared module mocks record into one harness at a
    // time, so the golden harness must be installed, run, and retired before
    // the crash harness is installed.
    const goldenDb = new FakeDb();
    seedCorporations(goldenDb, bid.corps);
    seedOpenOrder(goldenDb, {
      _id: bid.offBasketOrderId,
      corporationId: bid.offBasketId,
      placerFundId: bid.fund._id,
      type: "buy",
      status: "open",
      createdAt: new Date(),
      shares: 5,
      sharesRemaining: 5,
      pricePerShare: 50,
      escrowAmount: 250,
      escrowAnchor: 250,
      updatedAt: new Date(),
    });
    await installChildFakes(makeChildHarness(), new Map([[bid.fund._id.toString(), bid.fund]]));
    const golden = await runPass(goldenDb, bid.fund, bid.corps);
    expect(golden.bidsPlaced).toBe(1);
    expect(golden.bidsCancelled).toBe(1);

    // Crash on the final settle: bid placed, audit row written, outcome pending.
    const harness = makeChildHarness();
    await installChildFakes(harness, new Map([[bid.fund._id.toString(), bid.fund]]));
    db.crashAfterWrites = goldenDb.writeCount - 1;
    await expect(runPass(db, bid.fund, bid.corps)).rejects.toThrow(INJECTED_CRASH);
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await expect(runPass(db, bid.fund, bid.corps)).resolves.toEqual(golden);

    // One bid placement under one key with identical figures across the retry.
    // The driver sets skipTx and writes the escrow audit row itself.
    expect(harness.placeCalls.length).toBeGreaterThanOrEqual(1);
    const keys = new Set(harness.placeCalls.map((c) => c.key));
    expect(keys.size).toBe(1);
    const args = new Set(harness.placeCalls.map((c) => c.args));
    expect(args.size).toBe(1);
    expect(harness.placeCalls[0]!.args).toContain("skipTx:true");
    // The pinned cancel ran exactly once against the seeded order.
    expect(harness.cancelCalls).toEqual([bid.offBasketOrderId.toString()]);
    // The deterministic audit row converged to a single document.
    const txDocs = db.collection("indexFundTransactions").docs;
    expect(txDocs.size).toBe(1);
    const tx = [...txDocs.values()][0]!;
    expect(tx.kind).toBe("public_float_buy");
    expect(tx.note).toBe("limit_buy_order_escrow");
  });
});

describe("fundTargetRebalancePass — post-completion idempotency", () => {
  it("replays the stored outcome without re-invoking any child", async () => {
    const { fund, corps } = driftScenario();
    const db = new FakeDb();
    seedCorporations(db, corps);
    const harness = makeChildHarness();
    await installChildFakes(harness, new Map([[fund._id.toString(), fund]]));

    const outcome = await runPass(db, fund, corps);
    const calls = harness.sellCount + harness.buyCount + harness.placeCount;
    expect(calls).toBeGreaterThan(0);

    await expect(runPass(db, fund, corps)).resolves.toEqual(outcome);
    expect(harness.sellCount + harness.buyCount + harness.placeCount).toBe(calls);
  });
});

describe("fundTargetRebalancePass — old-code negative control", () => {
  it("an unkeyed debit-plus-insert double-applies across a crash, proving the harness bites", async () => {
    const fundId = new ObjectId();
    const db = new FakeDb();
    db.collection("indexFunds").docs.set(fundId.toHexString(), {
      _id: fundId,
      cashAnchor: 1_000,
    });

    // The legacy shape: sequential writes with no idempotency key. The crash
    // lands after the debit and the row, so the retry repeats real work.
    const legacyBuy = async (): Promise<void> => {
      await db.collection("indexFunds").updateOne({ _id: fundId }, { $inc: { cashAnchor: -500 } });
      await db
        .collection("indexFundTransactions")
        .insertOne({ _id: new ObjectId(), kind: "buy", amountAnchor: 500 });
      await db
        .collection("indexFunds")
        .updateOne({ _id: fundId }, { $set: { updatedAt: new Date() } });
    };

    db.crashAfterWrites = 2;
    await expect(legacyBuy()).rejects.toThrow(INJECTED_CRASH);
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await legacyBuy();

    // No key, no convergence: the debit applied twice and two rows exist.
    expect(db.collection("indexFunds").docs.get(fundId.toHexString())?.cashAnchor).toBe(0);
    expect(db.collection("indexFundTransactions").docs.size).toBe(2);
  });
});
