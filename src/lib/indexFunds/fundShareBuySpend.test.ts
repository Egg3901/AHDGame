import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Collection, type Db } from "mongodb";
import type { MoneyFlowReceipt } from "@/lib/db/nonAtomicMoneyFlow";
import {
  applyFundShareBuySpend,
  buildBuySteps,
  buildFundShareBuyFingerprint,
  buildFundShareBuyKey,
  FUND_SHARE_BUY_CORP,
  FUND_SHARE_BUY_FUNDS,
  isFundShareBuyOutcome,
  type FundShareBuySpendInput,
} from "./fundShareBuySpend";
import {
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
// Stateful in-memory fakes honoring exactly the operators the float-buy
// primitive emits ($inc incl. dotted and positional paths, $push in $each and
// single-doc form plus key records, $set incl. dotted and positional paths,
// $pull, $unset, $setOnInsert + upsert; _id equality, dotted-path equality
// into arrays, $ne-on-keys, $gte guards, $not/$elemMatch, ObjectId equality,
// duplicate-key errors on insert), so an injected crash between any two
// writes models a real process death between the corresponding sequential
// Mongo writes.
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

function deletePath(doc: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = node[parts[i]!] as Record<string, unknown> | undefined;
    if (typeof next !== "object" || next === null) return;
    node = next;
  }
  delete node[parts[parts.length - 1]!];
}

/** Resolve one positional `$` against equality conditions on the same array in the filter. */
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
  const idx = (list as Record<string, unknown>[]).findIndex((el) =>
    conds.every(([k, v]) => valueEquals(el[k.slice(prefix.length)], v))
  );
  if (idx < 0) return null;
  return `${arr}.${idx}.${rest}`;
}

function cloneValue<T>(value: T): T {
  // structuredClone denatures BSON ObjectIds into plain buffers; revive them
  // so stored docs keep comparable ids.
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

function elemMatches(el: unknown, criteria: Record<string, unknown>): boolean {
  if (el === null || typeof el !== "object") return false;
  return Object.entries(criteria).every(([k, v]) =>
    valueEquals((el as Record<string, unknown>)[k], v)
  );
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    const raw = getPathValues(doc, field.split("."));
    // An array-valued path contributes its elements, so `$ne` on a key list,
    // `$gte` on a balance, and dotted equality into a shareholder array all
    // compare element-wise.
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
    opts?: { upsert?: boolean }
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    let doc = "_id" in filter ? this.docs.get(docKey(filter._id)) : undefined;
    if (!doc) {
      if (opts?.upsert && "_id" in filter) {
        doc = { _id: cloneValue(filter._id) };
        this.docs.set(docKey(filter._id), doc);
        const setOnInsert = (update.$setOnInsert ?? {}) as Record<string, unknown>;
        for (const [field, value] of Object.entries(setOnInsert)) {
          setPath(doc, field, cloneValue(value));
        }
      } else {
        return { matchedCount: 0, modifiedCount: 0 };
      }
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
    const unset = (update.$unset ?? {}) as Record<string, unknown>;
    for (const field of Object.keys(unset)) {
      deletePath(doc, field);
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
const SHARES = 10;
const PRICE = 50;
const COST = SHARES * PRICE;

function seedFund(db: FakeDb, overrides?: Record<string, unknown>): void {
  db.collection("indexFunds").docs.set(fundId.toHexString(), {
    _id: fundId,
    slug: "test-fund",
    name: "Test Fund",
    cashAnchor: 10_000,
    unitSupply: 500_000,
    holdings: [],
    ...overrides,
  });
}

function seedCorp(db: FakeDb, overrides?: Record<string, unknown>): void {
  db.collection("corporations").docs.set(corpId.toHexString(), {
    _id: corpId,
    publicFloat: 500,
    shareholders: [],
    liquidCapital: 1_000,
    shareIssuanceProceeds: 0,
    shareEscrowBalance: 0,
    ...overrides,
  });
}

function seedPool(db: FakeDb, overrides?: Record<string, unknown>): void {
  db.collection("equityMarketPools").docs.set("USD", {
    _id: "USD",
    cashLocal: 1_000,
    targetCashLocal: 0,
    lifetime: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

function baseInput(overrides?: Partial<FundShareBuySpendInput>): FundShareBuySpendInput {
  const input: FundShareBuySpendInput = {
    fundId,
    corpId,
    shares: SHARES,
    executionPriceLocal: PRICE,
    executionPriceAnchor: PRICE,
    actualCost: COST,
    issuerCreditLocal: COST,
    orderFlowEligible: false,
    currency: "USD",
    issuerRoute: "liquid",
    turn: TURN,
    fingerprint: "",
    idempotencyKey: buildFundShareBuyKey(fundId, corpId, TURN, SHARES),
    ...overrides,
  };
  if (!overrides?.fingerprint) {
    input.fingerprint = buildFundShareBuyFingerprint({
      fundId: input.fundId,
      corpId: input.corpId,
      shares: input.shares,
      executionPriceLocal: input.executionPriceLocal,
      executionPriceAnchor: input.executionPriceAnchor,
      actualCost: input.actualCost,
      issuerCreditLocal: input.issuerCreditLocal,
      orderFlowEligible: input.orderFlowEligible,
      currency: input.currency,
      issuerRoute: input.issuerRoute,
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

describe("fundShareBuySpend — liquid route happy path", () => {
  it("moves cash, float, issuer credit, holdings, and audit row exactly once", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput();

    const result = await applyFundShareBuySpend(db as never, input);

    expect(result.duplicate).toBe(false);
    expect(result.outcome).toEqual({ sharesBought: SHARES, anchorSpent: COST });
    expect(isFundShareBuyOutcome(result.outcome)).toBe(true);

    const fund = readDoc(db, "indexFunds", fundId);
    expect(fund.cashAnchor).toBe(10_000 - COST);
    expect(fund.holdings).toEqual([
      {
        corporationId: corpId,
        shares: SHARES,
        avgCostPerShareAnchor: PRICE,
        lastValueAnchor: COST,
      },
    ]);

    const corp = readDoc(db, "corporations", corpId);
    expect(corp.publicFloat).toBe(500 - SHARES);
    expect(corp.shareholders).toEqual([{ fundId, shares: SHARES, avgCostPerShare: PRICE }]);
    expect(corp.orderFlowWindowBuyValue).toBeUndefined();
    // Instant-mode issuer: liquid capital plus issuance-proceeds tracking.
    expect(corp.liquidCapital).toBe(1_000 + COST);
    expect(corp.shareIssuanceProceeds).toBe(COST);
    expect(corp.shareEscrowBalance).toBe(0);

    // Deterministic audit row under the flow key.
    const txId = keyedInsertId(input.idempotencyKey!, "indexfund-share-buy-tx");
    const tx = readDoc(db, "indexFundTransactions", txId);
    expect(tx).toMatchObject({
      fundId,
      kind: "public_float_buy",
      corporationId: corpId,
      shares: SHARES,
      navAnchor: PRICE,
      amountAnchor: COST,
    });

    expect(receiptStatus(db, input.idempotencyKey!)).toBe("completed");
  });

  it("increments an existing shareholder entry with the weighted-average cost", async () => {
    const db = new FakeDb();
    seedFund(db, {
      holdings: [
        { corporationId: corpId, shares: 100, avgCostPerShareAnchor: 8, lastValueAnchor: 800 },
      ],
    });
    seedCorp(db, {
      shareholders: [{ fundId, shares: 100, avgCostPerShare: 8 }],
    });
    // Buy 100 more at 12: average becomes 10 on both the cap table and the book.
    const input = baseInput({
      shares: 100,
      executionPriceLocal: 12,
      executionPriceAnchor: 12,
      actualCost: 1_200,
      issuerCreditLocal: 1_200,
      idempotencyKey: buildFundShareBuyKey(fundId, corpId, TURN, 100),
    });

    const result = await applyFundShareBuySpend(db as never, input);

    expect(result.outcome).toEqual({ sharesBought: 100, anchorSpent: 1_200 });
    const corp = readDoc(db, "corporations", corpId);
    expect(corp.shareholders).toEqual([{ fundId, shares: 200, avgCostPerShare: 10 }]);
    const fund = readDoc(db, "indexFunds", fundId);
    expect(fund.holdings).toEqual([
      {
        corporationId: corpId,
        shares: 200,
        avgCostPerShareAnchor: 10,
        lastValueAnchor: 800 + 1_200,
      },
    ]);
  });

  it("credits the order-flow window tally only when eligible", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    await applyFundShareBuySpend(db as never, baseInput({ orderFlowEligible: true }));
    expect(readDoc(db, "corporations", corpId).orderFlowWindowBuyValue).toBe(COST);
  });
});

describe("fundShareBuySpend — issuer routes", () => {
  it("escrow route credits the issuer escrow and leaves liquid capital alone", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const result = await applyFundShareBuySpend(db as never, baseInput({ issuerRoute: "escrow" }));
    expect(result.outcome).toEqual({ sharesBought: SHARES, anchorSpent: COST });
    const corp = readDoc(db, "corporations", corpId);
    expect(corp.shareEscrowBalance).toBe(COST);
    expect(corp.liquidCapital).toBe(1_000);
    expect(corp.shareIssuanceProceeds).toBe(0);
  });

  it("pool route credits the pool and advances the caller snapshot", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    seedPool(db);
    const pools = new Map([["USD", { cashLocal: 1_000 }] as [string, Record<string, unknown>]]);
    const result = await applyFundShareBuySpend(
      db as never,
      baseInput({ issuerRoute: "pool", pools: pools as never })
    );
    expect(result.outcome).toEqual({ sharesBought: SHARES, anchorSpent: COST });
    expect(readDoc(db, "equityMarketPools", "USD").cashLocal).toBe(1_000 + COST);
    expect(pools.get("USD")!.cashLocal).toBe(1_000 + COST);
    const corp = readDoc(db, "corporations", corpId);
    expect(corp.liquidCapital).toBe(1_000);
  });

  it("pool route ensures a money-neutral shell when the pool vanished mid-flight", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    // No pool seeded: the shell creates it at zero and the credit still lands.
    const result = await applyFundShareBuySpend(db as never, baseInput({ issuerRoute: "pool" }));
    expect(result.outcome).toEqual({ sharesBought: SHARES, anchorSpent: COST });
    expect(readDoc(db, "equityMarketPools", "USD").cashLocal).toBe(COST);
  });

  it("a dust issuer credit that rounds to zero skips the pool write like the legacy no-op", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const result = await applyFundShareBuySpend(
      db as never,
      baseInput({ issuerRoute: "pool", issuerCreditLocal: 0.001 })
    );
    expect(result.outcome).toEqual({ sharesBought: SHARES, anchorSpent: COST });
    expect(db.collection("equityMarketPools").docs.has("USD")).toBe(false);
    expect(receiptStatus(db, baseInput().idempotencyKey!)).toBe("completed");
  });
});

describe("fundShareBuySpend — races, terminality, conflicts", () => {
  it("insufficient cash settles failed with nothing applied; retry is terminal", async () => {
    const db = new FakeDb();
    seedFund(db, { cashAnchor: 100 });
    seedCorp(db);
    const input = baseInput();

    await expect(applyFundShareBuySpend(db as never, input)).rejects.toThrow(
      new RegExp(`^${FUND_SHARE_BUY_FUNDS}:`)
    );
    expect(receiptStatus(db, input.idempotencyKey!)).toBe("failed");
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(100);
    expect(readDoc(db, "corporations", corpId).publicFloat).toBe(500);
    expect(db.collection("indexFundTransactions").docs.size).toBe(0);

    await expect(applyFundShareBuySpend(db as never, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });

  it("a lost float race compensates the debit and settles compensated", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db, { publicFloat: 4 });
    const input = baseInput();

    await expect(applyFundShareBuySpend(db as never, input)).rejects.toThrow(
      new RegExp(`^${FUND_SHARE_BUY_CORP}:`)
    );
    expect(receiptStatus(db, input.idempotencyKey!)).toBe("compensated");
    // Prefix reversed: cash back, float untouched, no holder row, no audit row.
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(10_000);
    expect(readDoc(db, "corporations", corpId).publicFloat).toBe(4);
    expect(readDoc(db, "corporations", corpId).shareholders).toEqual([]);
    expect(db.collection("indexFundTransactions").docs.size).toBe(0);

    await expect(applyFundShareBuySpend(db as never, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });

  it("same-key replay reports the stored outcome without moving money again", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput();

    const first = await applyFundShareBuySpend(db as never, input);
    expect(first.duplicate).toBe(false);
    const replay = await applyFundShareBuySpend(db as never, input);
    expect(replay.duplicate).toBe(true);
    expect(replay.outcome).toEqual(first.outcome);
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(10_000 - COST);
    expect(db.collection("indexFundTransactions").docs.size).toBe(1);
  });

  it("same key with a different fingerprint fails closed", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput();
    await applyFundShareBuySpend(db as never, input);

    const conflicting = { ...input, fingerprint: `${input.fingerprint}:other-buy` };
    await expect(applyFundShareBuySpend(db as never, conflicting)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(10_000 - COST);
  });

  it("concurrent same-key attempts apply exactly once", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput();

    const [a, b] = await Promise.all([
      applyFundShareBuySpend(db as never, input),
      applyFundShareBuySpend(db as never, { ...input }),
    ]);
    expect(a.outcome).toEqual({ sharesBought: SHARES, anchorSpent: COST });
    expect(b.outcome).toEqual({ sharesBought: SHARES, anchorSpent: COST });
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(10_000 - COST);
    expect(readDoc(db, "corporations", corpId).publicFloat).toBe(500 - SHARES);
    expect(db.collection("indexFundTransactions").docs.size).toBe(1);
  });

  it.each([
    ["zero shares", { shares: 0 }],
    ["negative shares", { shares: -3 }],
    ["fractional shares", { shares: 2.5 }],
    ["zero local price", { executionPriceLocal: 0 }],
    ["NaN anchor price", { executionPriceAnchor: Number.NaN }],
    ["zero cost", { actualCost: 0 }],
    ["negative issuer credit", { issuerCreditLocal: -1 }],
    ["empty currency", { currency: "" }],
    ["bad route", { issuerRoute: "vault" as FundShareBuySpendInput["issuerRoute"] }],
    ["negative turn", { turn: -1 }],
    ["empty fingerprint", { fingerprint: "x", idempotencyKey: undefined }],
  ])("negative control rejects %s before any write", async (_label, overrides) => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput(overrides as Partial<FundShareBuySpendInput>);
    if (overrides && "fingerprint" in overrides) input.fingerprint = "";
    // Type and range guards alike must fire before the receipt claim lands.
    await expect(applyFundShareBuySpend(db as never, input)).rejects.toThrow(Error);
    expect(db.collection("nonAtomicMoneyFlowReceipts").docs.size).toBe(0);
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(10_000);
  });

  it("negative control rejects an over-long key", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    await expect(
      applyFundShareBuySpend(db as never, baseInput({ idempotencyKey: "k".repeat(129) }))
    ).rejects.toThrow(RangeError);
    expect(db.collection("nonAtomicMoneyFlowReceipts").docs.size).toBe(0);
  });
});

describe("fundShareBuySpend — crash after every durable write", () => {
  function freshDb(route: "liquid" | "pool"): {
    db: FakeDb;
    pools?: Map<string, { cashLocal: number }>;
  } {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    if (route === "pool") {
      seedPool(db);
      return { db, pools: new Map([["USD", { cashLocal: 1_000 }]]) };
    }
    return { db };
  }

  function buyInput(
    route: "liquid" | "pool",
    pools?: Map<string, { cashLocal: number }>
  ): FundShareBuySpendInput {
    return baseInput({
      issuerRoute: route,
      ...(pools ? { pools: pools as never } : {}),
    });
  }

  function expectConverged(db: FakeDb, key: string): void {
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(10_000 - COST);
    expect(readDoc(db, "indexFunds", fundId).holdings).toEqual([
      {
        corporationId: corpId,
        shares: SHARES,
        avgCostPerShareAnchor: PRICE,
        lastValueAnchor: COST,
      },
    ]);
    expect(readDoc(db, "corporations", corpId).publicFloat).toBe(500 - SHARES);
    expect(db.collection("indexFundTransactions").docs.size).toBe(1);
    expect(receiptStatus(db, key)).toBe("completed");
  }

  it.each(["liquid", "pool"] as const)(
    "crash at write %s converges on same-key retry",
    async (route) => {
      const probe = freshDb(route);
      await applyFundShareBuySpend(probe.db as never, buyInput(route, probe.pools));
      const totalWrites = probe.db.writeCount;
      expect(totalWrites).toBeGreaterThan(0);

      // Crash fires on the write AFTER crashAfter: 0 crashes before the
      // claim lands (retry is a new attempt), N crashes with N writes durable.
      for (let crashAfter = 0; crashAfter < totalWrites; crashAfter += 1) {
        const attempt = freshDb(route);
        const input = buyInput(route, attempt.pools);
        const key = input.idempotencyKey!;
        attempt.db.crashAfterWrites = crashAfter;
        let firstError: unknown = null;
        try {
          await applyFundShareBuySpend(attempt.db as never, input);
        } catch (err) {
          firstError = err;
        }
        attempt.db.crashAfterWrites = Number.POSITIVE_INFINITY;
        // Every injection point surfaces as a real crash (no code runs past
        // it, so even a compensation write in flight just stops): the receipt
        // stays in_progress and the same key reconciles every applied step
        // without double-applying. A survived insert error instead compensates;
        // that path is covered by the sabotage tests below.
        expect((firstError as Error | null)?.message).toBe("INJECTED_CRASH");
        // Crashing before the claim lands leaves no receipt (the pool shell
        // runs before the claim on the pool route, so that route has two such
        // points), and the retry is a fresh attempt; anything later resumes
        // the stored plan.
        const receiptLanded = attempt.db.collection("nonAtomicMoneyFlowReceipts").docs.size > 0;
        const retry = await applyFundShareBuySpend(attempt.db as never, input);
        expect(retry.duplicate).toBe(receiptLanded);
        expect(retry.outcome).toEqual({ sharesBought: SHARES, anchorSpent: COST });
        expectConverged(attempt.db, key);
        if (attempt.pools) {
          expect(attempt.pools.get("USD")!.cashLocal).toBe(1_000 + COST);
        }
      }
    }
  );
});

describe("fundShareBuySpend — compensation exactness", () => {
  function sabotage(steps: MoneyFlowStep[], name: string): MoneyFlowStep[] {
    return steps.map((step) =>
      step.name === name
        ? { ...step, apply: async (): Promise<MoneyFlowLegOutcome> => "guard-rejected" }
        : step
    );
  }

  async function runSabotaged(
    db: FakeDb,
    key: string,
    input: FundShareBuySpendInput,
    sabotagedStep: string
  ): Promise<void> {
    const receipts = (await getMoneyFlowReceiptsCollection(
      db as unknown as Db
    )) as unknown as Collection<MoneyFlowReceipt>;
    const steps = sabotage(buildBuySteps(db as never, key, input, new Date()), sabotagedStep);
    const mapError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error =>
      new Error(`${step.name}:${outcome}`);
    await expect(runMoneyFlowSteps(receipts, key, steps, mapError)).rejects.toThrow(
      `${sabotagedStep}:guard-rejected`
    );
  }

  it("a failed holdings write reverses the increment-variant reserve with its exact average", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db, {
      shareholders: [{ fundId, shares: 100, avgCostPerShare: 8 }],
      liquidCapital: 1_000,
      shareIssuanceProceeds: 0,
    });
    const input = baseInput({
      shares: 100,
      executionPriceLocal: 12,
      executionPriceAnchor: 12,
      actualCost: 1_200,
      issuerCreditLocal: 1_200,
      idempotencyKey: buildFundShareBuyKey(fundId, corpId, TURN, 100),
    });

    await runSabotaged(db, "sabotage-holdings", input, "fund-holdings");

    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(10_000);
    expect(readDoc(db, "indexFunds", fundId).holdings).toEqual([]);
    const corp = readDoc(db, "corporations", corpId);
    expect(corp.publicFloat).toBe(500);
    expect(corp.shareholders).toEqual([{ fundId, shares: 100, avgCostPerShare: 8 }]);
    expect(corp.liquidCapital).toBe(1_000);
    expect(corp.shareIssuanceProceeds).toBe(0);
    expect(db.collection("indexFundTransactions").docs.size).toBe(0);
  });

  it("a failed audit-row insert pulls the pushed holder row and restores the float", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCorp(db);
    const input = baseInput();

    await runSabotaged(db, "sabotage-tx", input, "buy-tx");

    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(10_000);
    expect(readDoc(db, "indexFunds", fundId).holdings).toEqual([]);
    const corp = readDoc(db, "corporations", corpId);
    expect(corp.publicFloat).toBe(500);
    expect(corp.shareholders).toEqual([]);
    expect(corp.liquidCapital).toBe(1_000);
    expect(corp.shareIssuanceProceeds).toBe(0);
    expect(db.collection("indexFundTransactions").docs.size).toBe(0);
  });
});
