/**
 * Index-fund subscribe -> rebalance -> redeem round trip (issue #2120).
 *
 * Drives the REAL production flow through `runIndexFundCron`: the NPP investing
 * pass subscribes a fund and (with `nppFundRedemptionEnabled`) queues a bounded
 * autonomous redemption, the next cron turn's Pass 3c pays it through the NPP
 * branch of `processQueuedRedemptions`, and a rebalance sells an overweight
 * holding while placing a residual fund buy bid through the fundBidPolicy path.
 *
 * The Mongo collection layer is a small stateful in-memory fake — the same
 * "mock the collection layer, keep the query helpers real" style the existing
 * fund tests use (`fundCron.test.ts`, `fundCronRedemption.test.ts`), but keeping
 * enough state that the round trip really mutates a fund instead of watching a
 * scripted stub. Every module that reaches outside Mongo (equities, bonds,
 * escrow, ledger, shareholder ops) is mocked at the boundary.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

// ── Module mocks (external I/O boundaries only) ──────────────────────────────

vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn().mockResolvedValue(true),
  INDEX_FUNDS_DISABLED_MESSAGE: "disabled",
  INDEX_FUNDS_PARTIAL_MESSAGE: "partial",
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/ledger/emit", () => ({ emitLedgerEntries: vi.fn() }));
vi.mock("@/lib/ledger/featureFlag", () => ({
  isLedgerShadowEnabledFromConfig: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(),
  emitTxBulk: vi.fn(),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn(
    async (_withSession: unknown, withoutSession: () => Promise<boolean>) => withoutSession()
  ),
}));
vi.mock("@/lib/corporations/shareholderOps", () => ({
  creditSharesToFund: vi.fn().mockResolvedValue(true),
  debitSharesFromFund: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/corporations/shareEscrowSettlement", () => ({
  applyFloatBuyCredit: vi.fn(),
  settleFloatSellDebit: vi.fn().mockResolvedValue({ ok: true, split: undefined }),
  reverseFloatSellDebit: vi.fn(),
  onFloatSellCommitted: vi.fn(),
}));
vi.mock("@/lib/corporations/shareTradeHistory", () => ({ recordShareTrade: vi.fn() }));
vi.mock("@/lib/equities/marketPool", () => ({
  equityPoolCurrency: vi.fn().mockReturnValue("USD"),
  loadEquityPoolsByCurrency: vi.fn().mockResolvedValue(new Map()),
  loadEquityQuote: vi.fn().mockImplementation((_db: unknown, corp: { sharePrice: number }) =>
    Promise.resolve({
      active: false,
      currency: "USD",
      mid: corp.sharePrice,
      bidPriceLocal: corp.sharePrice,
      askPriceLocal: corp.sharePrice,
      bidDepthShares: Number.MAX_SAFE_INTEGER,
      poolCash: 0,
      targetCash: 0,
    })
  ),
}));
vi.mock("@/lib/indexFunds/fundRedemptionLiquidity", () => ({
  sellFundHoldingsForRedemptionCash: vi.fn().mockResolvedValue({
    cashRaisedAnchor: 0,
    sharesSold: 0,
    salesExecuted: 0,
  }),
  sellFundHoldingShares: vi
    .fn()
    .mockResolvedValue({ cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 }),
}));
vi.mock("@/lib/bonds/fundBondHoldings", () => ({
  sumFundBondHoldingsValueAnchor: vi.fn().mockResolvedValue(0),
  sumFundBondHoldingsByFundId: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/bonds/sellFundBondUnits", () => ({
  sellFundBondHoldingsForCash: vi.fn().mockResolvedValue({ proceedsAnchor: 0 }),
}));
vi.mock("@/lib/indexFunds/fundBondReserve", () => ({
  deployBondReserveFromCash: vi.fn().mockResolvedValue({ deployedAnchor: 0 }),
}));
vi.mock("@/lib/indexFunds/fundCrossRebalancing", () => ({
  executeFundCrossRebalancing: vi.fn(),
  planFundCrossRebalancing: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/indexFunds/fundConstituentLifecycle", () => ({
  findRemovedConstituentHoldings: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/indexFunds/fundHoldingWriteOff", () => ({
  writeOffDeadConstituentHoldings: vi.fn().mockResolvedValue({
    writtenOffCount: 0,
    writtenOffValueAnchor: 0,
    unsellableCount: 0,
  }),
}));
vi.mock("@/lib/indexFunds/fundTxLog", () => ({
  logIndexFundRedeem: vi.fn(),
  logIndexFundRedeemActivity: vi.fn(),
  resolveIndexFundHolder: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/indexFunds/fundShareOrders", () => ({
  placeFundShareBuyOrder: vi.fn().mockResolvedValue({ ok: true }),
  cancelFundShareOrder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/characterFunds", () => ({
  buildPersonalBalanceInc: vi.fn().mockReturnValue({}),
  loadCharacterFxRate: vi.fn().mockResolvedValue({ ok: true, rate: 1 }),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  corpLiquidCapitalToAnchor: vi.fn((amount: number) => amount),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
  fxRateForCorpFromMap: vi.fn().mockReturnValue(1),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  shareTradeAnchorValue: vi.fn(
    (shares: number, corp: { sharePrice: number }) => shares * corp.sharePrice
  ),
}));
vi.mock("@/lib/indexFunds/domesticSovereignCoverage/ensure", () => ({
  domesticCoverageEnabled: vi.fn().mockReturnValue(false),
  ensureDomesticSovereignBondFunds: vi.fn().mockResolvedValue({ ensured: [] }),
}));
vi.mock("@/lib/indexFunds/equityLiquidityFacility", () => ({
  EQUITY_LIQUIDITY_SNAPSHOTS_COLLECTION: "equityLiquidityFacilitySnapshots",
  refreshEquityLiquidityFacility: vi
    .fn()
    .mockResolvedValue({ quotePairsPlaced: 0, bidDepthAnchor: 0, askDepthAnchor: 0 }),
}));
vi.mock("@/lib/indexFunds/petitions/service", () => ({
  loadActiveWaiverIds: vi.fn().mockResolvedValue(new Set()),
  resolveDueListingPetitions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/indexFunds/sponsorship/expenseFees", () => ({
  chargeSponsorExpenseFees: vi.fn().mockResolvedValue({ fundsCharged: 0, totalFeeAnchor: 0 }),
}));
vi.mock("@/lib/indexFunds/sponsorship/windUp", () => ({
  advanceWindDowns: vi.fn().mockResolvedValue({ fundsProcessed: 0, fundsCompleted: 0, errors: [] }),
}));

// ── Stateful in-memory Mongo fake ────────────────────────────────────────────

type Doc = Record<string, any>;

function isOperatorObject(cond: unknown): cond is Record<string, unknown> {
  return (
    typeof cond === "object" &&
    cond !== null &&
    !Array.isArray(cond) &&
    !(cond instanceof ObjectId) &&
    !(cond instanceof Date) &&
    Object.keys(cond).some((key) => key.startsWith("$"))
  );
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  if (a instanceof Date || b instanceof Date) return Number(a) === Number(b);
  return a === b;
}

function getPath(doc: Doc, path: string): unknown {
  let current: unknown = doc;
  for (const part of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Doc)[part];
  }
  return current;
}

function matchesOperators(value: unknown, cond: Record<string, unknown>): boolean {
  for (const [op, expected] of Object.entries(cond)) {
    switch (op) {
      case "$in":
        if (!(expected as unknown[]).some((e) => valuesEqual(value, e))) return false;
        break;
      case "$nin":
        if ((expected as unknown[]).some((e) => valuesEqual(value, e))) return false;
        break;
      case "$gte":
        if (!(typeof value === "number" && value >= (expected as number))) return false;
        break;
      case "$gt":
        if (!(typeof value === "number" && value > (expected as number))) return false;
        break;
      case "$lte":
        if (!(typeof value === "number" && value <= (expected as number))) return false;
        break;
      case "$lt":
        if (!(typeof value === "number" && value < (expected as number))) return false;
        break;
      case "$ne":
        if (valuesEqual(value, expected)) return false;
        break;
      case "$exists":
        if ((value !== undefined) !== (expected as boolean)) return false;
        break;
      default:
        throw new Error(`fakeDb: unsupported query operator ${op}`);
    }
  }
  return true;
}

function matches(doc: Doc, filter: Doc): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === "$or") {
      if (!(cond as Doc[]).some((sub) => matches(doc, sub))) return false;
      continue;
    }
    if (key === "$and") {
      if (!(cond as Doc[]).every((sub) => matches(doc, sub))) return false;
      continue;
    }
    const value = getPath(doc, key);
    if (isOperatorObject(cond)) {
      if (!matchesOperators(value, cond)) return false;
    } else if (!valuesEqual(value, cond)) {
      return false;
    }
  }
  return true;
}

function evalExpr(expr: any, doc: Doc): any {
  if (typeof expr === "string" && expr.startsWith("$")) return getPath(doc, expr.slice(1));
  if (expr instanceof Date || expr instanceof ObjectId || expr === null) return expr;
  if (isOperatorObject(expr)) {
    const [op, arg] = Object.entries(expr)[0]!;
    const evalArg = (a: unknown) => evalExpr(a, doc);
    const args = Array.isArray(arg) ? arg.map(evalArg) : [evalArg(arg)];
    switch (op) {
      case "$subtract":
        return args[0] - args[1];
      case "$add":
        return args.reduce((a, b) => a + b, 0);
      case "$multiply":
        return args.reduce((a, b) => a * b, 1);
      case "$divide":
        return args[0] / args[1];
      case "$max":
        return Math.max(...args);
      case "$min":
        return Math.min(...args);
      case "$sum":
        return args.reduce((a, b) => a + b, 0);
      case "$ifNull":
        return args[0] ?? args[1];
      case "$gt":
        return args[0] > args[1];
      case "$gte":
        return args[0] >= args[1];
      case "$lt":
        return args[0] < args[1];
      case "$lte":
        return args[0] <= args[1];
      case "$eq":
        return args[0] === args[1];
      case "$ne":
        return args[0] !== args[1];
      case "$cond": {
        if (Array.isArray(arg)) return evalArg(arg[0]) ? evalArg(arg[1]) : evalArg(arg[2]);
        const branch = arg as Doc;
        return evalArg(branch.if) ? evalArg(branch.then) : evalArg(branch.else);
      }
      default:
        throw new Error(`fakeDb: unsupported expression operator ${op}`);
    }
  }
  return expr;
}

function applyUpdate(doc: Doc, update: any): void {
  if (Array.isArray(update)) {
    for (const stage of update as Doc[]) {
      if (stage.$set) {
        for (const [key, expr] of Object.entries(stage.$set as Doc)) doc[key] = evalExpr(expr, doc);
      }
    }
    return;
  }
  for (const [op, spec] of Object.entries(update as Doc)) {
    if (op === "$inc") {
      for (const [key, value] of Object.entries(spec as Doc))
        doc[key] = (typeof doc[key] === "number" ? doc[key] : 0) + (value as number);
    } else if (op === "$set") {
      for (const [key, value] of Object.entries(spec as Doc)) doc[key] = value;
    } else if (op === "$unset") {
      for (const key of Object.keys(spec as Doc)) delete doc[key];
    } else if (op === "$max") {
      for (const [key, value] of Object.entries(spec as Doc))
        doc[key] = Math.max(typeof doc[key] === "number" ? doc[key] : -Infinity, value as number);
    } else if (op === "$min") {
      for (const [key, value] of Object.entries(spec as Doc))
        doc[key] = Math.min(typeof doc[key] === "number" ? doc[key] : Infinity, value as number);
    } else if (op === "$push") {
      for (const [key, value] of Object.entries(spec as Doc)) {
        if (!Array.isArray(doc[key])) doc[key] = [];
        doc[key].push(value);
      }
    } else if (op === "$addToSet") {
      for (const [key, value] of Object.entries(spec as Doc)) {
        if (!Array.isArray(doc[key])) doc[key] = [];
        if (!doc[key].some((el: unknown) => valuesEqual(el, value))) doc[key].push(value);
      }
    } else if (op === "$pull") {
      for (const [key, cond] of Object.entries(spec as Doc)) {
        if (Array.isArray(doc[key]))
          doc[key] = (doc[key] as Doc[]).filter((el) => !matches(el, cond as Doc));
      }
    }
  }
}

function sortBy(rows: Doc[], spec: Doc): Doc[] {
  const entries = Object.entries(spec) as [string, number][];
  return [...rows].sort((a, b) => {
    for (const [key, direction] of entries) {
      const av = getPath(a, key);
      const bv = getPath(b, key);
      if (av === bv) continue;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      const cmp = (av as number | string) < (bv as number | string) ? -1 : 1;
      return direction < 0 ? -cmp : cmp;
    }
    return 0;
  });
}

function evalGroupExpr(expr: any, row: Doc): any {
  if (typeof expr === "string" && expr.startsWith("$")) return getPath(row, expr.slice(1));
  if (isOperatorObject(expr)) {
    const [op, arg] = Object.entries(expr)[0]!;
    if (op === "$toString") return String(evalGroupExpr(arg, row));
    if (op === "$multiply")
      return (arg as unknown[])
        .map((entry) => Number(evalGroupExpr(entry, row)))
        .reduce((acc: number, value: number) => acc * value, 1);
    if (op === "$subtract") {
      const [a, b] = arg as unknown[];
      return Number(evalGroupExpr(a, row)) - Number(evalGroupExpr(b, row));
    }
  }
  return expr;
}

function groupStage(rows: Doc[], spec: Doc): Doc[] {
  const groups = new Map<string, Doc>();
  for (const row of rows) {
    const key = evalGroupExpr(spec._id, row);
    const mapKey = key instanceof ObjectId ? key.toString() : String(key);
    let acc = groups.get(mapKey);
    if (!acc) {
      acc = { _id: key };
      groups.set(mapKey, acc);
    }
    for (const [field, expr] of Object.entries(spec)) {
      if (field === "_id") continue;
      const e = expr as Doc;
      if (e.$sum !== undefined) acc[field] = (acc[field] ?? 0) + Number(evalGroupExpr(e.$sum, row));
    }
  }
  return [...groups.values()];
}

function runAggregate(rows: Doc[], pipeline: Doc[]): Doc[] {
  let current = rows;
  for (const stage of pipeline) {
    if (stage.$match) current = current.filter((r) => matches(r, stage.$match));
    else if (stage.$group) current = groupStage(current, stage.$group);
    else if (stage.$sort) current = sortBy(current, stage.$sort);
    else if (stage.$limit) current = current.slice(0, stage.$limit);
    // $project: identity — the fake stores full docs and callers only read the
    // fields they projected anyway.
  }
  return current;
}

class FakeCursor {
  constructor(private rows: Doc[]) {}
  sort(spec?: Doc) {
    if (spec) this.rows = sortBy(this.rows, spec);
    return this;
  }
  project() {
    return this;
  }
  limit(n: number) {
    this.rows = this.rows.slice(0, n);
    return this;
  }
  skip(n: number) {
    this.rows = this.rows.slice(n);
    return this;
  }
  async toArray() {
    return this.rows;
  }
  async next() {
    return this.rows[0] ?? null;
  }
  async *[Symbol.asyncIterator]() {
    for (const row of this.rows) yield row;
  }
}

class FakeCollection {
  docs: Doc[];
  constructor(seed: Doc[] = []) {
    this.docs = seed;
  }
  find(filter: Doc = {}) {
    return new FakeCursor(this.docs.filter((doc) => matches(doc, filter)));
  }
  async findOne(filter: Doc = {}) {
    return this.docs.find((doc) => matches(doc, filter)) ?? null;
  }
  async insertOne(doc: Doc) {
    const withId: Doc = { _id: new ObjectId(), ...doc };
    this.docs.push(withId);
    return { insertedId: withId._id };
  }
  async insertMany(docs: Doc[]) {
    const insertedIds: Record<number, ObjectId> = {};
    docs.forEach((doc, index) => {
      const withId: Doc = { _id: new ObjectId(), ...doc };
      this.docs.push(withId);
      insertedIds[index] = withId._id;
    });
    return { insertedIds };
  }
  async updateOne(filter: Doc, update: any, options?: { upsert?: boolean }) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (doc) {
      applyUpdate(doc, update);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
    if (options?.upsert) {
      const base: Doc = {};
      for (const [key, value] of Object.entries(filter)) {
        if (!key.startsWith("$") && !isOperatorObject(value)) base[key] = value;
      }
      applyUpdate(base, update);
      base._id ??= new ObjectId();
      this.docs.push(base);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: base._id };
    }
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
  }
  async updateMany(filter: Doc, update: any) {
    let matched = 0;
    for (const doc of this.docs) {
      if (matches(doc, filter)) {
        applyUpdate(doc, update);
        matched++;
      }
    }
    return { matchedCount: matched, modifiedCount: matched };
  }
  async findOneAndUpdate(filter: Doc, update: any, options?: { returnDocument?: string }) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) return null;
    const before = { ...doc };
    applyUpdate(doc, update);
    return options?.returnDocument === "before" ? before : doc;
  }
  async deleteOne(filter: Doc) {
    const index = this.docs.findIndex((d) => matches(d, filter));
    if (index < 0) return { deletedCount: 0 };
    this.docs.splice(index, 1);
    return { deletedCount: 1 };
  }
  async deleteMany(filter: Doc) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matches(d, filter));
    return { deletedCount: before - this.docs.length };
  }
  async countDocuments(filter: Doc = {}) {
    return this.docs.filter((d) => matches(d, filter)).length;
  }
  aggregate(pipeline: Doc[]) {
    return new FakeCursor(runAggregate(this.docs, pipeline));
  }
  async bulkWrite(ops: Doc[]) {
    let matchedCount = 0;
    let upsertedCount = 0;
    let insertedCount = 0;
    for (const op of ops) {
      if (op.updateOne) {
        const res = await this.updateOne(
          op.updateOne.filter,
          op.updateOne.update,
          op.updateOne.upsert ? { upsert: true } : undefined
        );
        matchedCount += res.matchedCount;
        upsertedCount += res.upsertedCount ?? 0;
      } else if (op.insertOne) {
        await this.insertOne(op.insertOne);
        insertedCount++;
      } else if (op.deleteOne) {
        await this.deleteOne(op.deleteOne.filter);
      }
    }
    return {
      matchedCount,
      modifiedCount: matchedCount,
      upsertedCount,
      insertedCount,
      deletedCount: 0,
    };
  }
}

function createStatefulDb(seed: Record<string, Doc[]>) {
  const collections = new Map<string, FakeCollection>();
  for (const [name, docs] of Object.entries(seed)) collections.set(name, new FakeCollection(docs));
  const db = {
    collection(name: string) {
      let collection = collections.get(name);
      if (!collection) {
        collection = new FakeCollection();
        collections.set(name, collection);
      }
      return collection;
    },
  };
  return {
    db: db as unknown as Db,
    collection(name: string): FakeCollection {
      let collection = collections.get(name);
      if (!collection) {
        collection = new FakeCollection();
        collections.set(name, collection);
      }
      return collection;
    },
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

import { runIndexFundCron, rebalanceFundToTarget } from "@/lib/indexFunds/fundCron";
import { fundBidLimitPriceLocal } from "@/lib/indexFunds/fundBidPolicy";
import { placeFundShareBuyOrder } from "@/lib/indexFunds/fundShareOrders";
import { sellFundHoldingShares } from "@/lib/indexFunds/fundRedemptionLiquidity";

const FUND_ID = new ObjectId();
const CORP_ID = new ObjectId();
const NPP_ID = new ObjectId();

const INITIAL_UNIT_SUPPLY = 500_000;
const INITIAL_CASH = 50_000_000;
const INITIAL_NAV = 100;

function seedCorporation(overrides: Record<string, unknown> = {}): Doc {
  return {
    _id: CORP_ID,
    name: "Acme Technologies",
    countryId: "US",
    type: "technology",
    sharePrice: 50,
    fundamentalSharePrice: 50,
    totalShares: 100_000,
    publicFloat: 1_000,
    liquidCurrencyCode: "USD",
    liquidCapital: 10_000_000,
    shareholders: [],
    ...overrides,
  };
}

function seedFund(overrides: Record<string, unknown> = {}): Doc {
  return {
    _id: FUND_ID,
    slug: "us_top_25",
    name: "US Large-Cap 25 Index",
    tickerSymbol: "US25",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: INITIAL_NAV,
    unitSupply: INITIAL_UNIT_SUPPLY,
    reserveUnits: 0,
    cashAnchor: INITIAL_CASH,
    targetConstituents: [{ corporationId: CORP_ID, targetWeight: 1, marketCapAnchor: 1_000_000 }],
    holdings: [
      { corporationId: CORP_ID, shares: 1000, avgCostPerShareAnchor: 50, lastValueAnchor: 50_000 },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function seedNpp(overrides: Record<string, unknown> = {}): Doc {
  return {
    _id: NPP_ID,
    name: "Test NPP",
    countryId: "US",
    // Conservative archetype (score 80): target fund share 0.55.
    favorability: 80,
    politicalInfluence: 80,
    retiredAt: null,
    nppInvestmentCashAnchor: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function seedConfig(overrides: Record<string, unknown> = {}): Doc {
  return { _id: "default", indexFundsMode: "full", nppFundRedemptionEnabled: true, ...overrides };
}

function roundTripSeed(config: Doc = seedConfig()) {
  return createStatefulDb({
    gameConfig: [config],
    corporations: [seedCorporation()],
    indexFunds: [seedFund()],
    npps: [seedNpp()],
    indexFundPositions: [],
    indexFundRedemptionQueue: [],
    indexFundTransactions: [],
    indexFundSnapshots: [],
    shareOrders: [],
    exchangeRates: [],
  });
}

function fundDoc(state: ReturnType<typeof createStatefulDb>): Doc {
  return state.collection("indexFunds").docs.find((d) => String(d._id) === FUND_ID.toString())!;
}

describe("index fund subscribe -> redeem round trip via fundCron (#2120)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes via the NPP path and queues a bounded autonomous redemption that debits units and burns supply", async () => {
    const state = roundTripSeed();

    const result = await runIndexFundCron(state.db, { currentTurn: 4 });

    // The NPP subscribed this pass (4 turns' worth of the throttled budget).
    expect(result.nppInvested).toBeGreaterThan(0);

    // Position grew by the subscription, then shrank by the bounded redemption.
    const positions = state.collection("indexFundPositions").docs;
    expect(positions).toHaveLength(1);
    const nppPosition = positions[0]!;
    expect(nppPosition.holderKind).toBe("npp");
    expect(nppPosition.units).toBeGreaterThan(0);

    // One bounded autonomous redemption was queued through enqueueRedemption.
    const queue = state.collection("indexFundRedemptionQueue").docs;
    expect(queue).toHaveLength(1);
    const entry = queue[0]!;
    expect(entry).toMatchObject({
      fundId: FUND_ID,
      holderKind: "npp",
      nppId: NPP_ID,
      unitsBurnedAtRequest: true,
      status: "queued",
    });
    expect(entry.units).toBe(1); // floor(18 units × 10% fraction cap)
    expect(entry.requestedAmountAnchor).toBeCloseTo(entry.units * entry.requestedNavAnchor, 6);

    // Units left the position (18 subscribed − 1 redeemed) and the fund supply
    // was burned by exactly the redeemed units: no phantom units in the NAV
    // denominator and no orphan position.
    expect(nppPosition.units).toBe(18 - entry.units);
    const fund = fundDoc(state);
    expect(fund.unitSupply).toBe(INITIAL_UNIT_SUPPLY + 18 - entry.units);
  });

  it("pays the queued NPP redemption on the next cron turn, NAV-matched, with no orphan holdings", async () => {
    const state = roundTripSeed();

    // Turn 4: subscribe + queue the autonomous redemption.
    await runIndexFundCron(state.db, { currentTurn: 4 });
    const entry = state.collection("indexFundRedemptionQueue").docs[0]!;
    const queuedUnits = entry.units as number;
    const nppCashAfterSubscribe = state.collection("npps").docs[0]!
      .nppInvestmentCashAnchor as number;
    const cashAfterSubscribe = fundDoc(state).cashAnchor as number;
    const supplyAfterSubscribe = fundDoc(state).unitSupply as number;

    // Turn 5: Pass 3c pays the queue through the NPP branch of
    // processQueuedRedemptions.
    const result = await runIndexFundCron(state.db, { currentTurn: 5 });
    expect(result.redemptionsPaid).toBe(1);

    const fund = fundDoc(state);
    const npp = state.collection("npps").docs[0]!;
    const paidEntry = state.collection("indexFundRedemptionQueue").docs[0]!;

    // Queue row fully served.
    expect(paidEntry.status).toBe("paid");
    expect(paidEntry.units).toBe(0);

    // Payout is NAV-matched: the redemption transaction records the units paid
    // at the fund's forward NAV, and the NPP wallet moved by exactly that.
    const redeemTx = state
      .collection("indexFundTransactions")
      .docs.find((t) => t.kind === "redemption" && String(t.nppId) === NPP_ID.toString())!;
    expect(redeemTx).toBeDefined();
    expect(redeemTx.units).toBe(queuedUnits);
    const payout = redeemTx.amountAnchor as number;
    expect(payout).toBeCloseTo(queuedUnits * (redeemTx.navAnchor as number), 6);
    expect((npp.nppInvestmentCashAnchor as number) - nppCashAfterSubscribe).toBeCloseTo(payout, 6);

    // Fund cash fell by the payout; supply is unchanged at pay time (the units
    // were burned at request). No orphan: the NPP position still holds units and
    // the queue left nothing unserved.
    expect(cashAfterSubscribe - (fund.cashAnchor as number)).toBeCloseTo(payout, 6);
    expect(fund.unitSupply).toBe(supplyAfterSubscribe);
    expect(state.collection("indexFundPositions").docs.every((p) => (p.units as number) > 0)).toBe(
      true
    );
    expect(state.collection("indexFundPositions").docs).toHaveLength(1);

    // Backing stays consistent with the quoted liability (NAV never collapses).
    const backingRatio = fund.backingRatio as number;
    expect(backingRatio).toBeGreaterThan(0.9);
    expect(backingRatio).toBeLessThan(1.1);
  });

  it("is a no-op round trip when nppFundRedemptionEnabled is off (no queue rows)", async () => {
    const state = roundTripSeed(seedConfig({ nppFundRedemptionEnabled: false }));

    await runIndexFundCron(state.db, { currentTurn: 4 });
    await runIndexFundCron(state.db, { currentTurn: 5 });

    // Subscriptions still happen (NPP investing is unrelated to the flag) but
    // nothing is ever queued for autonomous redemption.
    expect(state.collection("npps").docs[0]!.nppInvestmentCashAnchor).not.toBe(0);
    expect(state.collection("indexFundRedemptionQueue").docs).toHaveLength(0);
  });

  it("reaches the fund buy-bid path (fundBidPolicy → placeFundShareBuyOrder) from the rebalance sell flow", async () => {
    const overweightId = new ObjectId();
    const underweightId = new ObjectId();
    const bidFund = seedFund({
      _id: new ObjectId(),
      cashAnchor: 500_000,
      targetConstituents: [
        { corporationId: underweightId, targetWeight: 0.5, marketCapAnchor: 1_000_000 },
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
    const state = createStatefulDb({
      indexFunds: [bidFund],
      shareOrders: [],
      indexFundTransactions: [],
      indexFundSnapshots: [],
      corporations: [
        seedCorporation({ _id: overweightId, sharePrice: 10, fundamentalSharePrice: 10 }),
        // No float on the underweight corp, so the residual deficit becomes a
        // standing limit bid rather than an immediate float buy.
        seedCorporation({
          _id: underweightId,
          sharePrice: 10,
          fundamentalSharePrice: 10,
          publicFloat: 0,
        }),
      ],
    });

    vi.mocked(sellFundHoldingShares).mockResolvedValueOnce({
      cashRaisedAnchor: 10_000,
      sharesSold: 1000,
      salesExecuted: 1,
    });

    const result = await rebalanceFundToTarget(
      state.db,
      bidFund as never,
      state.collection("corporations").docs as never,
      {},
      new Map(),
      24
    );

    // Sell leg fired (overweight trimmed) …
    expect(result.sells).toBe(1);
    expect(sellFundHoldingShares).toHaveBeenCalledTimes(1);

    // … and the same rebalance reachably places a fund buy bid priced by the
    // shared fundBidPolicy helper.
    expect(placeFundShareBuyOrder).toHaveBeenCalledTimes(1);
    const bidInput = vi.mocked(placeFundShareBuyOrder).mock.calls[0]![1];
    expect(bidInput.shares).toBe(1000);
    expect(bidInput.limitPriceLocal).toBeCloseTo(fundBidLimitPriceLocal(10), 6);
  });
});
