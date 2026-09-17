import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Collection } from "mongodb";
import type { MoneyFlowReceipt } from "@/lib/db/nonAtomicMoneyFlow";
import {
  applyFundShareSellSpend,
  buildFundShareSellFingerprint,
  buildFundShareSellKey,
  buildSellSteps,
  FUND_SHARE_SELL_CREDIT,
  FUND_SHARE_SELL_HOLDINGS,
  FUND_SHARE_SELL_ISSUER,
  FUND_SHARE_SELL_RELEASE,
  FUND_SHARE_SELL_TX,
  isFundShareSellOutcome,
  type FundShareSellSpendInput,
} from "./fundShareSellSpend";
import {
  claimMoneyFlowReceipt,
  failMoneyFlowReceipt,
  keyedInsertId,
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";

const { supportMock, getMongoClientMock } = vi.hoisted(() => ({
  supportMock: vi.fn(),
  getMongoClientMock: vi.fn(),
}));

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: supportMock,
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: getMongoClientMock,
  getDb: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fakes honoring exactly the operators the float-sale
// primitive emits ($inc incl. dotted and positional paths, $set incl. dotted
// and positional paths, $push in $each form plus key records, $pull with
// equality and $lte, _id equality, dotted-path equality into arrays,
// $elemMatch with equality/$gte/$lte, $ne-on-keys, $gte guards, ObjectId
// equality, duplicate-key errors on insert), so an injected crash between
// any two writes models a real process death between the corresponding
// sequential Mongo writes.
// ---------------------------------------------------------------------------

function docKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id instanceof ObjectId) return id.toHexString();
  return String(id);
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (actual instanceof ObjectId && expected instanceof ObjectId) {
    return actual.equals(expected);
  }
  return actual === expected;
}

function getPath(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], doc);
}

function getPathValues(node: unknown, parts: string[]): unknown[] {
  if (parts.length === 0) return [node];
  if (Array.isArray(node)) {
    return node.flatMap((el) =>
      getPathValues((el as Record<string, unknown>)?.[parts[0]!], parts.slice(1))
    );
  }
  if (node !== null && typeof node === "object") {
    return getPathValues((node as Record<string, unknown>)[parts[0]!], parts.slice(1));
  }
  return [];
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

function criterionMatches(value: unknown, criterion: unknown): boolean {
  if (
    criterion !== null &&
    typeof criterion === "object" &&
    !(criterion instanceof ObjectId) &&
    !(criterion instanceof Date) &&
    !Array.isArray(criterion)
  ) {
    const ops = criterion as Record<string, unknown>;
    if ("$gte" in ops) {
      return typeof value === "number" && value >= (ops.$gte as number);
    }
    if ("$lte" in ops) {
      return typeof value === "number" && value <= (ops.$lte as number);
    }
    return false;
  }
  return valueEquals(value, criterion);
}

function elemMatches(el: unknown, criteria: Record<string, unknown>): boolean {
  if (el === null || typeof el !== "object") return false;
  return Object.entries(criteria).every(([k, v]) =>
    criterionMatches((el as Record<string, unknown>)[k], v)
  );
}

/** Resolve one positional `$` against equality/$elemMatch conditions on the same array. */
function resolvePositionalPath(
  doc: Record<string, unknown>,
  path: string,
  filter: Record<string, unknown>
): string | null {
  const dollar = path.indexOf(".$.");
  if (dollar < 0) return path;
  const arr = path.slice(0, dollar);
  const rest = path.slice(dollar + 3);
  const list = getPath(doc, arr);
  if (!Array.isArray(list)) return null;
  const prefix = `${arr}.`;
  const conds = Object.entries(filter).filter(
    ([k, v]) =>
      k.startsWith(prefix) &&
      !k.slice(prefix.length).includes(".") &&
      (typeof v !== "object" || v instanceof ObjectId || v instanceof Date)
  );
  const elemMatch = (filter[arr] ?? {}) as Record<string, unknown>;
  const matchCriteria =
    elemMatch && typeof elemMatch === "object" && "$elemMatch" in elemMatch
      ? (elemMatch.$elemMatch as Record<string, unknown>)
      : null;
  const idx = (list as Record<string, unknown>[]).findIndex(
    (el) =>
      conds.every(([k, v]) => valueEquals(el[k.slice(prefix.length)], v)) &&
      (!matchCriteria || elemMatches(el, matchCriteria))
  );
  if (idx < 0) return null;
  return `${arr}.${idx}.${rest}`;
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
    if (
      isOperatorObject(condition) &&
      "$elemMatch" in condition &&
      !("$ne" in condition) &&
      !("$gte" in condition) &&
      !("$exists" in condition) &&
      !("$not" in condition)
    ) {
      const list = getPath(doc, field);
      if (!Array.isArray(list)) return false;
      if (!list.some((el) => elemMatches(el, condition.$elemMatch as Record<string, unknown>))) {
        return false;
      }
      continue;
    }
    const raw = getPathValues(doc, field.split("."));
    const values = raw.length === 1 && Array.isArray(raw[0]) ? (raw[0] as unknown[]) : raw;
    if (isOperatorObject(condition)) {
      if ("$ne" in condition) {
        if (values.some((v) => valueEquals(v, condition.$ne))) return false;
        continue;
      }
      if ("$gte" in condition) {
        if (!values.some((v) => typeof v === "number" && v >= (condition.$gte as number)))
          return false;
        continue;
      }
      if ("$exists" in condition) {
        const exists = values.some((v) => v !== undefined);
        if (exists !== Boolean(condition.$exists)) return false;
        continue;
      }
      if ("$not" in condition) {
        const inner = condition.$not as Record<string, unknown>;
        if (inner && typeof inner === "object" && "$elemMatch" in inner) {
          const criteria = inner.$elemMatch as Record<string, unknown>;
          if (values.some((el) => elemMatches(el, criteria))) return false;
          continue;
        }
        return false;
      }
      return false;
    }
    if (!values.some((v) => valueEquals(v, condition))) return false;
  }
  return true;
}

class FakeCollection {
  readonly docs = new Map<string, Record<string, unknown>>();

  constructor(private readonly db: FakeDb) {}

  private countWrite(): void {
    this.db.writeCount += 1;
    if (this.db.writeCount > this.db.crashAfterWrites) {
      throw new Error("INJECTED_CRASH");
    }
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

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    _opts?: unknown
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    void _opts;
    this.countWrite();
    const doc = "_id" in filter ? this.docs.get(docKey(filter._id)) : undefined;
    if (!doc) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    if (!matchesFilter(doc, filter)) return { matchedCount: 0, modifiedCount: 0 };

    const inc = (update.$inc ?? {}) as Record<string, number>;
    for (const [field, delta] of Object.entries(inc)) {
      const resolved = resolvePositionalPath(doc, field, filter);
      if (!resolved) return { matchedCount: 0, modifiedCount: 0 };
      setPath(doc, resolved, ((getPath(doc, resolved) as number | undefined) ?? 0) + delta);
    }
    const push = (update.$push ?? {}) as Record<string, unknown>;
    for (const [field, spec] of Object.entries(push)) {
      const current = (doc[field] as unknown[] | undefined) ?? [];
      const each =
        spec !== null && typeof spec === "object" && "$each" in (spec as Record<string, unknown>)
          ? ((spec as { $each: unknown[] }).$each ?? [])
          : [spec];
      const next = [...current, ...each.map(cloneValue)];
      const slice = (spec as { $slice?: unknown }).$slice;
      doc[field] = typeof slice === "number" && slice < 0 ? next.slice(slice) : next;
    }
    const pull = (update.$pull ?? {}) as Record<string, Record<string, unknown>>;
    for (const [field, criteria] of Object.entries(pull)) {
      const current = doc[field];
      if (!Array.isArray(current)) continue;
      doc[field] = current.filter((el) => !elemMatches(el, criteria));
    }
    const set = (update.$set ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(set)) {
      const resolved = resolvePositionalPath(doc, field, filter);
      if (!resolved) return { matchedCount: 0, modifiedCount: 0 };
      setPath(doc, resolved, cloneValue(value));
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

const fundId = new ObjectId();
const corpId = new ObjectId();
const TURN = 5;
const SHARES = 50;
const PRICE_LOCAL = 10;
const PRICE_ANCHOR = 10;
const PROCEEDS = SHARES * PRICE_ANCHOR;
const ISSUER_DEBIT = SHARES * PRICE_LOCAL;

function seedFund(db: FakeDb, overrides?: Record<string, unknown>): void {
  db.collection("indexFunds").docs.set(fundId.toHexString(), {
    _id: fundId,
    slug: "test-fund",
    name: "Test Fund",
    cashAnchor: 1_000,
    unitSupply: 500_000,
    holdings: [
      {
        corporationId: corpId,
        shares: 200,
        avgCostPerShareAnchor: 8,
        lastValueAnchor: 1600,
      },
    ],
    ...overrides,
  });
}

function seedCorp(db: FakeDb, overrides?: Record<string, unknown>): void {
  db.collection("corporations").docs.set(corpId.toHexString(), {
    _id: corpId,
    publicFloat: 500,
    shareholders: [{ fundId, shares: 200, avgCostPerShare: 8 }],
    liquidCapital: 10_000,
    shareIssuanceProceeds: 2_000,
    shareEscrowBalance: 0,
    ...overrides,
  });
}

function seedPool(db: FakeDb, overrides?: Record<string, unknown>): void {
  db.collection("equityMarketPools").docs.set("USD", {
    _id: "USD",
    cashLocal: 100_000,
    targetCashLocal: 0,
    lifetime: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

function baseInput(overrides?: Partial<FundShareSellSpendInput>): FundShareSellSpendInput {
  const input: FundShareSellSpendInput = {
    fundId,
    corpId,
    sharesToSell: SHARES,
    executionPriceLocal: PRICE_LOCAL,
    pricePerShareAnchor: PRICE_ANCHOR,
    proceedsAnchor: PROCEEDS,
    issuerDebitLocal: ISSUER_DEBIT,
    escrowDebited: 0,
    treasuryDebited: 0,
    orderFlowEligible: false,
    currency: "USD",
    issuerRoute: "liquid",
    counterparty: "market",
    holdingAvgCostAnchor: 8,
    note: "Redemption liquidity",
    turn: TURN,
    fingerprint: "",
    idempotencyKey: buildFundShareSellKey(fundId, corpId, TURN, SHARES),
    ...overrides,
  };
  if (!overrides?.fingerprint) {
    input.fingerprint = buildFundShareSellFingerprint({
      fundId: input.fundId,
      corpId: input.corpId,
      sharesToSell: input.sharesToSell,
      executionPriceLocal: input.executionPriceLocal,
      pricePerShareAnchor: input.pricePerShareAnchor,
      proceedsAnchor: input.proceedsAnchor,
      issuerDebitLocal: input.issuerDebitLocal,
      escrowDebited: input.escrowDebited,
      treasuryDebited: input.treasuryDebited,
      orderFlowEligible: input.orderFlowEligible,
      currency: input.currency,
      issuerRoute: input.issuerRoute,
      counterparty: input.counterparty,
      holdingAvgCostAnchor: input.holdingAvgCostAnchor,
      note: input.note,
      turn: input.turn,
    });
  }
  return input;
}

function readDoc(db: FakeDb, collection: string, id: ObjectId | string): Record<string, unknown> {
  const doc = db.collection(collection).docs.get(typeof id === "string" ? id : id.toHexString());
  if (!doc) throw new Error(`missing ${collection} doc`);
  return doc;
}

function receiptStatus(db: FakeDb, key: string): string {
  return String(readDoc(db, "nonAtomicMoneyFlowReceipts", key).status);
}

beforeEach(() => {
  vi.clearAllMocks();
  supportMock.mockResolvedValue(false);
  getMongoClientMock.mockReturnValue(undefined);
});

describe("fundShareSellSpend — liquid route happy path", () => {
  it("moves issuer debit, float, cash, holdings, and audit row exactly once", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput();

    const result = await applyFundShareSellSpend(db as never, input);

    expect(result.duplicate).toBe(false);
    expect(result.outcome).toEqual({ sharesSold: SHARES, cashRaisedAnchor: PROCEEDS });
    expect(isFundShareSellOutcome(result.outcome)).toBe(true);

    const fund = readDoc(db, "indexFunds", fundId);
    expect(fund.cashAnchor).toBe(1_000 + PROCEEDS);
    expect(fund.holdings).toEqual([
      {
        corporationId: corpId,
        shares: 150,
        avgCostPerShareAnchor: 8,
        lastValueAnchor: 150 * PRICE_ANCHOR,
      },
    ]);

    const corp = readDoc(db, "corporations", corpId);
    expect(corp.publicFloat).toBe(500 + SHARES);
    expect(corp.shareholders).toEqual([{ fundId, shares: 150, avgCostPerShare: 8 }]);
    expect(corp.orderFlowWindowSellValue).toBeUndefined();
    // Instant-mode issuer: treasury debit plus issuance-proceeds capture.
    expect(corp.liquidCapital).toBe(10_000 - ISSUER_DEBIT);
    expect(corp.shareIssuanceProceeds).toBe(2_000 - ISSUER_DEBIT);
    expect(corp.shareEscrowBalance).toBe(0);

    // Deterministic audit row under the flow key.
    const txId = keyedInsertId(input.idempotencyKey!, "indexfund-share-sell-tx");
    const tx = readDoc(db, "indexFundTransactions", txId);
    expect(tx).toMatchObject({
      fundId,
      kind: "public_float_sell",
      corporationId: corpId,
      shares: SHARES,
      navAnchor: PRICE_ANCHOR,
      amountAnchor: PROCEEDS,
      note: "Redemption liquidity",
    });

    expect(receiptStatus(db, input.idempotencyKey!)).toBe("completed");
  });

  it("removes the holding row on a full-position sale and tallies order flow", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput({
      sharesToSell: 200,
      proceedsAnchor: 200 * PRICE_ANCHOR,
      issuerDebitLocal: 200 * PRICE_LOCAL,
      orderFlowEligible: true,
      idempotencyKey: buildFundShareSellKey(fundId, corpId, TURN, 200),
    });

    const result = await applyFundShareSellSpend(db as never, input);

    expect(result.outcome).toEqual({ sharesSold: 200, cashRaisedAnchor: 2000 });
    expect(readDoc(db, "indexFunds", fundId).holdings).toEqual([]);
    const corp = readDoc(db, "corporations", corpId);
    // Release decrements to zero; the registry row pull stays post-commit.
    expect(corp.shareholders).toEqual([{ fundId, shares: 0, avgCostPerShare: 8 }]);
    expect(corp.orderFlowWindowSellValue).toBe(200 * PRICE_LOCAL);
  });

  it("skips the sale when the treasury cannot cover the debit", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db, { liquidCapital: 10 });
    const input = baseInput();

    await expect(applyFundShareSellSpend(db as never, input)).rejects.toThrow(
      new RegExp(`^${FUND_SHARE_SELL_ISSUER}:`)
    );
    // First step failed: nothing applied, receipt failed, no money moved.
    expect(receiptStatus(db, input.idempotencyKey!)).toBe("failed");
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(1_000);
    expect(readDoc(db, "corporations", corpId).liquidCapital).toBe(10);
  });

  it("compensates the issuer prefix when the float race is lost", async () => {
    const db = new FakeDb();
    seedFund(db);
    // Only 10 shares on the registry: the $gte guard rejects a 50-share sale.
    seedCorp(db, { shareholders: [{ fundId, shares: 10, avgCostPerShare: 8 }] });
    const input = baseInput();

    await expect(applyFundShareSellSpend(db as never, input)).rejects.toThrow(
      new RegExp(`^${FUND_SHARE_SELL_RELEASE}:`)
    );
    expect(receiptStatus(db, input.idempotencyKey!)).toBe("compensated");
    // The landed issuer debit is refunded exactly (treasury + issuance).
    const corp = readDoc(db, "corporations", corpId);
    expect(corp.liquidCapital).toBe(10_000);
    expect(corp.shareIssuanceProceeds).toBe(2_000);
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(1_000);
  });
});

describe("fundShareSellSpend — pool and escrow routes", () => {
  it("debits the pool on the pool route and touches no corp balance", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    seedPool(db);
    const input = baseInput({ issuerRoute: "pool" });

    const result = await applyFundShareSellSpend(db as never, input);

    expect(result.outcome).toEqual({ sharesSold: SHARES, cashRaisedAnchor: PROCEEDS });
    const pool = readDoc(db, "equityMarketPools", "USD");
    expect(pool.cashLocal).toBe(100_000 - ISSUER_DEBIT);
    expect(pool).toMatchObject({ lifetime: { salesOut: ISSUER_DEBIT } });
    const corp = readDoc(db, "corporations", corpId);
    expect(corp.liquidCapital).toBe(10_000);
    expect(corp.shareIssuanceProceeds).toBe(2_000);
    expect(corp.shareEscrowBalance).toBe(0);
  });

  it("skips the sale when the pool cannot pay", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    seedPool(db, { cashLocal: 5 });
    const input = baseInput({ issuerRoute: "pool" });

    await expect(applyFundShareSellSpend(db as never, input)).rejects.toThrow(
      new RegExp(`^${FUND_SHARE_SELL_ISSUER}:`)
    );
    expect(receiptStatus(db, input.idempotencyKey!)).toBe("failed");
    expect(readDoc(db, "equityMarketPools", "USD").cashLocal).toBe(5);
  });

  it("splits the escrow debit from the pinned pre-state", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db, { shareEscrowBalance: 300 });
    const input = baseInput({
      issuerRoute: "escrow",
      escrowDebited: 300,
      treasuryDebited: ISSUER_DEBIT - 300,
    });

    const result = await applyFundShareSellSpend(db as never, input);

    expect(result.outcome).toEqual({ sharesSold: SHARES, cashRaisedAnchor: PROCEEDS });
    const corp = readDoc(db, "corporations", corpId);
    expect(corp.shareEscrowBalance).toBe(0);
    expect(corp.liquidCapital).toBe(10_000 - (ISSUER_DEBIT - 300));
    // Escrow route carries no issuance-proceeds tracking, like the legacy path.
    expect(corp.shareIssuanceProceeds).toBe(2_000);
  });

  it("skips when concurrent escrow movement breaks the pinned split", async () => {
    const db = new FakeDb();
    seedFund(db);
    // Escrow drained after the quote pinned 300: the floor guard rejects.
    seedCorp(db, { shareEscrowBalance: 10 });
    const input = baseInput({
      issuerRoute: "escrow",
      escrowDebited: 300,
      treasuryDebited: ISSUER_DEBIT - 300,
    });

    await expect(applyFundShareSellSpend(db as never, input)).rejects.toThrow(
      new RegExp(`^${FUND_SHARE_SELL_ISSUER}:`)
    );
    expect(receiptStatus(db, input.idempotencyKey!)).toBe("failed");
    expect(readDoc(db, "corporations", corpId).liquidCapital).toBe(10_000);
  });

  it("completes a dust-proceeds sale with no fund-credit step", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    // Proceeds round to zero: the legacy credit was a no-op, so the flow
    // carries no fund-credit step and still completes.
    const input = baseInput({ proceedsAnchor: 0 });

    const result = await applyFundShareSellSpend(db as never, input);

    expect(result.outcome).toEqual({ sharesSold: SHARES, cashRaisedAnchor: 0 });
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(1_000);
    expect(readDoc(db, "corporations", corpId).liquidCapital).toBe(10_000 - ISSUER_DEBIT);
    expect(receiptStatus(db, input.idempotencyKey!)).toBe("completed");
  });
});

describe("fundShareSellSpend — keys, replay, conflict, terminal", () => {
  it("builds deterministic keys and fingerprints", () => {
    const keyA = buildFundShareSellKey(fundId, corpId, TURN, SHARES);
    expect(buildFundShareSellKey(fundId, corpId, TURN, SHARES)).toBe(keyA);
    expect(buildFundShareSellKey(fundId, corpId, TURN, SHARES + 1)).not.toBe(keyA);
    expect(buildFundShareSellKey(fundId, new ObjectId(), TURN, SHARES)).not.toBe(keyA);
    const fp = (overrides?: Partial<FundShareSellSpendInput>): string =>
      buildFundShareSellFingerprint({ ...baseInput(overrides), fingerprint: "x" });
    expect(fp()).toBe(fp());
    expect(fp({ proceedsAnchor: PROCEEDS + 1 })).not.toBe(fp());
    expect(fp({ issuerRoute: "pool" })).not.toBe(fp());
    expect(fp({ counterparty: "issuer" })).not.toBe(fp());
  });

  it("replays a completed sale without moving money twice", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput();

    const first = await applyFundShareSellSpend(db as never, input);
    const second = await applyFundShareSellSpend(db as never, input);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.outcome).toEqual(first.outcome);
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(1_000 + PROCEEDS);
    expect(readDoc(db, "corporations", corpId).liquidCapital).toBe(10_000 - ISSUER_DEBIT);
  });

  it("converges concurrent same-key attempts onto one sale", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput();

    const [a, b] = await Promise.all([
      applyFundShareSellSpend(db as never, input),
      applyFundShareSellSpend(db as never, { ...input }),
    ]);

    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(1_000 + PROCEEDS);
  });

  it("fails closed when the key is reused for a different sale", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput();
    await applyFundShareSellSpend(db as never, input);

    const different = baseInput({ sharesToSell: SHARES, proceedsAnchor: PROCEEDS + 100 });
    // Same key (shares unchanged), different fingerprint: conflict, no write.
    await expect(applyFundShareSellSpend(db as never, different)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(1_000 + PROCEEDS);
  });

  it("refuses new attempts after a terminal settlement", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput();
    const receipts = (await getMoneyFlowReceiptsCollection(
      db as never
    )) as unknown as Collection<MoneyFlowReceipt>;
    await claimMoneyFlowReceipt(receipts, input.idempotencyKey!, input.fingerprint);
    await failMoneyFlowReceipt(receipts, input.idempotencyKey!, "boom");

    await expect(applyFundShareSellSpend(db as never, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(1_000);
  });

  it("rejects invalid inputs before claiming", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    await expect(
      applyFundShareSellSpend(db as never, baseInput({ sharesToSell: 0 }))
    ).rejects.toThrow(RangeError);
    await expect(
      applyFundShareSellSpend(db as never, baseInput({ executionPriceLocal: -1 }))
    ).rejects.toThrow(RangeError);
    await expect(
      applyFundShareSellSpend(db as never, baseInput({ proceedsAnchor: -1 }))
    ).rejects.toThrow(RangeError);
    await expect(
      applyFundShareSellSpend(db as never, baseInput({ issuerRoute: "vault" as never }))
    ).rejects.toThrow(TypeError);
    await expect(
      applyFundShareSellSpend(db as never, baseInput({ counterparty: "bank" as never }))
    ).rejects.toThrow(TypeError);
    await expect(
      applyFundShareSellSpend(
        db as never,
        baseInput({ issuerRoute: "escrow", escrowDebited: 1, treasuryDebited: 1 })
      )
    ).rejects.toThrow(RangeError);
    expect(db.collection("nonAtomicMoneyFlowReceipts").docs.size).toBe(0);
  });
});

describe("fundShareSellSpend — crash recovery after every durable write", () => {
  it("converges to exactly one sale no matter where the crash lands", async () => {
    // A liquid sale performs 9 durable writes (claim, plan, issuer, release,
    // credit, holdings, tx, settle, outcome). Crash before, between, and
    // after each one, then retry clean and compare against the happy path.
    for (let crashAfter = 0; crashAfter <= 10; crashAfter += 1) {
      const db = new FakeDb();
      seedFund(db);
      seedCorp(db);
      const input = baseInput();
      db.crashAfterWrites = crashAfter;
      try {
        await applyFundShareSellSpend(db as never, input);
      } catch (err) {
        expect((err as Error).message).toBe("INJECTED_CRASH");
      }
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyFundShareSellSpend(db as never, input);
      expect(result.outcome).toEqual({ sharesSold: SHARES, cashRaisedAnchor: PROCEEDS });
      expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(1_000 + PROCEEDS);
      expect(readDoc(db, "indexFunds", fundId).holdings).toEqual([
        {
          corporationId: corpId,
          shares: 150,
          avgCostPerShareAnchor: 8,
          lastValueAnchor: 150 * PRICE_ANCHOR,
        },
      ]);
      const corp = readDoc(db, "corporations", corpId);
      expect(corp.publicFloat).toBe(500 + SHARES);
      expect(corp.liquidCapital).toBe(10_000 - ISSUER_DEBIT);
      expect(corp.shareIssuanceProceeds).toBe(2_000 - ISSUER_DEBIT);
      expect(receiptStatus(db, input.idempotencyKey!)).toBe("completed");
    }
  });

  it("converges a pool-route crash the same way", async () => {
    for (let crashAfter = 0; crashAfter <= 10; crashAfter += 1) {
      const db = new FakeDb();
      seedFund(db);
      seedCorp(db);
      seedPool(db);
      const input = baseInput({ issuerRoute: "pool" });
      db.crashAfterWrites = crashAfter;
      try {
        await applyFundShareSellSpend(db as never, input);
      } catch (err) {
        expect((err as Error).message).toBe("INJECTED_CRASH");
      }
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyFundShareSellSpend(db as never, input);
      expect(result.outcome).toEqual({ sharesSold: SHARES, cashRaisedAnchor: PROCEEDS });
      expect(readDoc(db, "equityMarketPools", "USD").cashLocal).toBe(100_000 - ISSUER_DEBIT);
      expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(1_000 + PROCEEDS);
      expect(receiptStatus(db, input.idempotencyKey!)).toBe("completed");
    }
  });
});

describe("fundShareSellSpend — compensation", () => {
  function sabotage(
    db: FakeDb,
    key: string,
    input: FundShareSellSpendInput,
    now: Date,
    stepName: string
  ): MoneyFlowStep[] {
    return buildSellSteps(db as never, key, input, now).map((step) =>
      step.name === stepName
        ? { ...step, apply: async () => "guard-rejected" as MoneyFlowLegOutcome }
        : step
    );
  }

  function mapError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
    if (step.name === "issuer-debit") return new Error(`${FUND_SHARE_SELL_ISSUER}:${outcome}`);
    if (step.name === "corp-release") return new Error(`${FUND_SHARE_SELL_RELEASE}:${outcome}`);
    if (step.name === "fund-credit") return new Error(`${FUND_SHARE_SELL_CREDIT}:${outcome}`);
    if (step.name === "fund-holdings") return new Error(`${FUND_SHARE_SELL_HOLDINGS}:${outcome}`);
    return new Error(`${FUND_SHARE_SELL_TX}:${outcome}`);
  }

  it("reverses the issuer debit when the release fails", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    seedPool(db);
    const input = baseInput({ issuerRoute: "pool" });
    const now = new Date();
    const key = input.idempotencyKey!;
    const receipts = (await getMoneyFlowReceiptsCollection(
      db as never
    )) as unknown as Collection<MoneyFlowReceipt>;
    await claimMoneyFlowReceipt(receipts, key, input.fingerprint);

    await expect(
      runMoneyFlowSteps(receipts, key, sabotage(db, key, input, now, "corp-release"), mapError)
    ).rejects.toThrow(new RegExp(`^${FUND_SHARE_SELL_RELEASE}:`));

    expect(receiptStatus(db, key)).toBe("compensated");
    expect(readDoc(db, "equityMarketPools", "USD").cashLocal).toBe(100_000);
    expect(readDoc(db, "equityMarketPools", "USD")).toMatchObject({
      lifetime: { salesOut: 0 },
    });
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(1_000);
  });

  it("reverses the full prefix when the audit row fails, restoring holdings", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput();
    const now = new Date();
    const key = input.idempotencyKey!;
    const receipts = (await getMoneyFlowReceiptsCollection(
      db as never
    )) as unknown as Collection<MoneyFlowReceipt>;
    await claimMoneyFlowReceipt(receipts, key, input.fingerprint);

    await expect(
      runMoneyFlowSteps(receipts, key, sabotage(db, key, input, now, "sell-tx"), mapError)
    ).rejects.toThrow(new RegExp(`^${FUND_SHARE_SELL_TX}:`));

    expect(receiptStatus(db, key)).toBe("compensated");
    const corp = readDoc(db, "corporations", corpId);
    expect(corp.liquidCapital).toBe(10_000);
    expect(corp.shareIssuanceProceeds).toBe(2_000);
    expect(corp.publicFloat).toBe(500);
    expect(corp.shareholders).toEqual([{ fundId, shares: 200, avgCostPerShare: 8 }]);
    const fund = readDoc(db, "indexFunds", fundId);
    expect(fund.cashAnchor).toBe(1_000);
    // Shares and average restore exactly; the value mark is re-struck at the
    // sale price (the legacy formula always marks shares x last trade price,
    // so the stale 1600 seed mark is not part of the compensated state).
    expect(fund.holdings).toEqual([
      { corporationId: corpId, shares: 200, avgCostPerShareAnchor: 8, lastValueAnchor: 2000 },
    ]);
  });

  it("restores a fully-sold holding row with the pinned average on revert", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput({
      sharesToSell: 200,
      proceedsAnchor: 200 * PRICE_ANCHOR,
      issuerDebitLocal: 200 * PRICE_LOCAL,
      idempotencyKey: buildFundShareSellKey(fundId, corpId, TURN, 200),
    });
    const now = new Date();
    const key = input.idempotencyKey!;
    const receipts = (await getMoneyFlowReceiptsCollection(
      db as never
    )) as unknown as Collection<MoneyFlowReceipt>;
    await claimMoneyFlowReceipt(receipts, key, input.fingerprint);

    await expect(
      runMoneyFlowSteps(receipts, key, sabotage(db, key, input, now, "sell-tx"), mapError)
    ).rejects.toThrow(new RegExp(`^${FUND_SHARE_SELL_TX}:`));

    // The pushed-back row carries the pinned average; its value mark is the
    // sale price, matching the formula the sale always used.
    expect(readDoc(db, "indexFunds", fundId).holdings).toEqual([
      { corporationId: corpId, shares: 200, avgCostPerShareAnchor: 8, lastValueAnchor: 2000 },
    ]);
  });
});

describe("fundShareSellSpend — old-code negative control", () => {
  it("a naive unguarded retry credits the fund twice, the keyed flow once", async () => {
    // The legacy shape: unguarded sequential writes (issuer debit, fund
    // credit, audit row) with no idempotency key. A crash after the credit
    // followed by a naive retry double-applies: the issuer pays twice and
    // the fund is credited twice for one sale.
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const corps = db.collection("corporations");
    const funds = db.collection("indexFunds");
    const txs = db.collection("indexFundTransactions");
    const naiveSale = async (): Promise<void> => {
      await corps.updateOne(
        { _id: corpId },
        { $inc: { liquidCapital: -ISSUER_DEBIT }, $set: { updatedAt: new Date() } }
      );
      await funds.updateOne(
        { _id: fundId },
        { $inc: { cashAnchor: PROCEEDS }, $set: { updatedAt: new Date() } }
      );
      await txs.insertOne({ _id: new ObjectId(), kind: "public_float_sell" });
    };

    db.crashAfterWrites = 2;
    await expect(naiveSale()).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await naiveSale();
    // Issuer debited twice, fund credited twice: the strand the migration
    // removes. This assertion pins the flaw the keyed flow must not have.
    expect(readDoc(db, "corporations", corpId).liquidCapital).toBe(10_000 - 2 * ISSUER_DEBIT);
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(1_000 + 2 * PROCEEDS);

    // Same crash point through the primitive converges to exactly one sale.
    const keyed = new FakeDb();
    seedFund(keyed);
    seedCorp(keyed);
    const input = baseInput();
    keyed.crashAfterWrites = 3;
    await expect(applyFundShareSellSpend(keyed as never, input)).rejects.toThrow("INJECTED_CRASH");
    keyed.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyFundShareSellSpend(keyed as never, input);
    expect(result.outcome).toEqual({ sharesSold: SHARES, cashRaisedAnchor: PROCEEDS });
    expect(readDoc(keyed, "indexFunds", fundId).cashAnchor).toBe(1_000 + PROCEEDS);
    expect(readDoc(keyed, "corporations", corpId).liquidCapital).toBe(10_000 - ISSUER_DEBIT);
  });
});
