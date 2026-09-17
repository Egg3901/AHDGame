import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyForexCancelSpend,
  applyForexFillSpend,
  applyForexOrderCreateSpend,
  FOREX_CANCEL_ORDER_MISSING,
  FOREX_CANCEL_UNAVAILABLE,
  FOREX_DIRECT_INSUFFICIENT,
  FOREX_DIRECT_ORDER_MISSING,
  FOREX_DIRECT_UNAVAILABLE,
  FOREX_DIRECT_WRONG_TYPE,
  FOREX_FILL_INSUFFICIENT,
  FOREX_FILL_ORDER_MISSING,
  FOREX_FILL_RACED,
  FOREX_FILL_UNAVAILABLE,
  FOREX_ORDER_INSUFFICIENT,
} from "./forexSpend";
import {
  keyedInsertId,
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  DIRECT_TRADE_SPREAD,
  LIMIT_ORDER_SPREAD,
  SPREAD_FEE_FOREX_REVENUE_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
} from "@/lib/constants/currencies";

const { supportMock } = vi.hoisted(() => ({ supportMock: vi.fn() }));

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: supportMock,
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: vi.fn(),
  getDb: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fakes. They honor exactly the operators the forex
// primitives emit ($inc / $set / $unset / $push+$each+$slice writes; _id
// equality, $ne-on-keys, $gte-on-balance, $in-on-status guards;
// duplicate-key errors on insert), so an injected crash between any two
// writes models a real process death between the corresponding sequential
// Mongo writes. ObjectIds survive the round trip (unlike structuredClone,
// which strips their prototype), so _id lookups stay exact.
// ---------------------------------------------------------------------------

function cloneValue<T>(value: T): T {
  if (value instanceof ObjectId) return new ObjectId(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneValue(v);
    return out as T;
  }
  return value;
}

function docKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id instanceof ObjectId) return id.toHexString();
  return JSON.stringify(id);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId) return docKey(a) === docKey(b);
  return a === b;
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

function deletePath(doc: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = node[parts[i]!];
    if (typeof next !== "object" || next === null) return;
    node = next as Record<string, unknown>;
  }
  delete node[parts[parts.length - 1]!];
}

function matchesCondition(
  doc: Record<string, unknown>,
  field: string,
  condition: unknown
): boolean {
  const value = getPath(doc, field);
  if (condition === null || condition === undefined) return value == null;
  if (typeof condition !== "object" || condition instanceof ObjectId) {
    return sameValue(value, condition);
  }
  const ops = condition as Record<string, unknown>;
  if ("$ne" in ops) {
    const keys = doc[field] as string[] | undefined;
    if (keys?.includes(ops.$ne as string)) return false;
    return true;
  }
  if ("$gte" in ops) {
    const balance = value as number | undefined;
    return (balance ?? Number.NEGATIVE_INFINITY) >= (ops.$gte as number);
  }
  if ("$in" in ops) {
    return (ops.$in as unknown[]).some((candidate) => sameValue(value, candidate));
  }
  if ("$exists" in ops) {
    const exists = value !== undefined && value !== null;
    return ops.$exists ? exists : !exists;
  }
  return false;
}

function matchesFlowFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    if (!matchesCondition(doc, field, condition)) return false;
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
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return null;
    if (!opts?.projection) return cloneValue(doc);
    const out: Record<string, unknown> = { _id: cloneValue(doc._id) };
    for (const field of Object.keys(opts.projection)) {
      if (field === "_id") continue;
      const value = getPath(doc, field);
      if (value !== undefined) setPath(out, field, cloneValue(value));
    }
    return out;
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    const doc = this.docs.get(docKey(filter._id));
    if (doc && !matchesFlowFilter(doc, filter)) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };

    const inc = (update.$inc ?? {}) as Record<string, number>;
    for (const [field, delta] of Object.entries(inc)) {
      setPath(doc, field, ((getPath(doc, field) as number | undefined) ?? 0) + delta);
    }
    const push = (update.$push ?? {}) as Record<string, unknown>;
    for (const [field, spec] of Object.entries(push)) {
      const current = (doc[field] as unknown[] | undefined) ?? [];
      const each =
        spec !== null && typeof spec === "object" && "$each" in (spec as Record<string, unknown>)
          ? ((spec as { $each: unknown[] }).$each ?? [])
          : [spec];
      const next = [...current, ...each];
      const slice = (spec as { $slice?: number })?.$slice;
      doc[field] = typeof slice === "number" && slice < 0 ? next.slice(slice) : next;
    }
    const set = (update.$set ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(set)) {
      setPath(doc, field, cloneValue(value));
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

const makerId = new ObjectId();
const takerId = new ObjectId();
const now = new Date("2026-02-01T00:00:00Z");

function seedDb(db: FakeDb): void {
  db.collection("characters").docs.set(makerId.toHexString(), {
    _id: makerId,
    name: "Maker",
    currencyBalances: { personal: { USD: 20_000, GBP: 0 } },
    appliedMoneyFlowKeys: [],
  });
  db.collection("characters").docs.set(takerId.toHexString(), {
    _id: takerId,
    name: "Taker",
    currencyBalances: { personal: { USD: 0, GBP: 100_000 } },
    appliedMoneyFlowKeys: [],
  });
}

function charDoc(db: FakeDb, id: ObjectId): Record<string, unknown> {
  const doc = db.collection("characters").docs.get(id.toHexString());
  if (!doc) throw new Error(`missing character ${id.toHexString()}`);
  return doc;
}

function personalOf(db: FakeDb, id: ObjectId): Record<string, number> {
  return (
    (charDoc(db, id).currencyBalances as { personal: Record<string, number> }).personal ?? {}
  );
}

function orderDoc(db: FakeDb, id: ObjectId): Record<string, unknown> {
  const doc = db.collection("currencyOrders").docs.get(id.toHexString());
  if (!doc) throw new Error(`missing order ${id.toHexString()}`);
  return doc;
}

function historyDocs(db: FakeDb): Record<string, unknown>[] {
  return [...db.collection("tradeHistory").docs.values()];
}

function bankDoc(db: FakeDb, bankId: string): Record<string, unknown> {
  return db.collection("centralBanks").docs.get(bankId) ?? {};
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    | MoneyFlowReceipt
    | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

/** Maker escrows `amount` USD into a limit order asking `rate` GBP per USD. */
async function createLimitOrder(
  db: FakeDb,
  overrides: Record<string, unknown> = {}
): Promise<{ orderId: ObjectId; duplicate: boolean }> {
  return applyForexOrderCreateSpend(db as unknown as Db, {
    characterId: makerId,
    characterName: "Maker",
    countryId: "US",
    orderType: "limit",
    direction: "buy",
    fromCurrency: "USD",
    toCurrency: "GBP",
    amount: 10_000,
    limitRate: 0.8,
    now,
    fingerprint: "fp-limit",
    idempotencyKey: `key-limit-${Math.random().toString(36).slice(2)}`,
    ...(overrides as Record<string, never>),
  });
}

/** Half-spread skim in `amount` units, mirroring calculateSpreadFee rounding. */
function halfSpread(amount: number, spread: number): number {
  return Math.round(amount * (spread / 2));
}

function spreadSlices(fee: number): { revenue: number; reserve: number; destroyed: number } {
  const reserve = Math.round(fee * SPREAD_FEE_RESERVE_RATIO);
  const revenue = Math.round(fee * SPREAD_FEE_FOREX_REVENUE_RATIO);
  return { revenue, reserve, destroyed: fee - (reserve + revenue) };
}

beforeEach(() => {
  vi.clearAllMocks();
  supportMock.mockResolvedValue(false);
});

describe("applyForexOrderCreateSpend", () => {
  it("escrows exactly once and stores the order under the deterministic key id", async () => {
    const db = new FakeDb();
    seedDb(db);

    const { orderId, duplicate } = await createLimitOrder(db, {
      fingerprint: "fp-create-happy",
      idempotencyKey: "create-happy",
    });

    expect(duplicate).toBe(false);
    // Deterministic id: the same key always rebuilds the same order row.
    expect(orderId).toEqual(keyedInsertId("create-happy", "forex-order"));
    expect(personalOf(db, makerId).USD).toBe(10_000);
    const stored = orderDoc(db, orderId);
    expect(stored).toMatchObject({
      characterId: makerId,
      type: "limit",
      direction: "buy",
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 10_000,
      limitRate: 0.8,
      status: "open",
      filledAmount: 0,
      spreadCharged: 0,
    });
    expect(receipt(db, "create-happy").status).toBe("completed");
  });

  it("stores direct requests with the target and expiry the caller passed", async () => {
    const db = new FakeDb();
    seedDb(db);

    const { orderId } = await applyForexOrderCreateSpend(db as unknown as Db, {
      characterId: makerId,
      characterName: "Maker",
      countryId: "US",
      orderType: "direct",
      direction: "buy",
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 2_000,
      limitRate: 0.75,
      targetCharacterId: takerId,
      targetCharacterName: "Taker",
      expiresAtTurn: 124,
      now,
      fingerprint: "fp-direct-create",
      idempotencyKey: "direct-create",
    });

    const stored = orderDoc(db, orderId);
    expect(stored).toMatchObject({
      type: "direct",
      targetCharacterId: takerId,
      targetCharacterName: "Taker",
      expiresAtTurn: 124,
      status: "open",
    });
    expect(personalOf(db, makerId).USD).toBe(18_000);
  });

  it("fails closed with INSUFFICIENT and no order row when the escrow races", async () => {
    const db = new FakeDb();
    seedDb(db);
    personalOf(db, makerId).USD = 10;

    await expect(
      createLimitOrder(db, { fingerprint: "fp-create-poor", idempotencyKey: "create-poor" })
    ).rejects.toThrow(FOREX_ORDER_INSUFFICIENT);

    expect(personalOf(db, makerId).USD).toBe(10);
    expect(db.collection("currencyOrders").docs.size).toBe(0);
    expect(receipt(db, "create-poor").status).toBe("failed");
  });

  it("a crash between the debit and the insert reconciles to exactly one escrowed order", async () => {
    const db = new FakeDb();
    seedDb(db);
    // Writes: 1 receipt insert + 1 escrow leg, then the crash lands on the
    // order-row insert.
    db.crashAfterWrites = 2;

    await expect(
      createLimitOrder(db, { fingerprint: "fp-create-crash", idempotencyKey: "create-crash" })
    ).rejects.toThrow("INJECTED_CRASH");
    expect(personalOf(db, makerId).USD).toBe(10_000);
    expect(db.collection("currencyOrders").docs.size).toBe(0);
    expect(receipt(db, "create-crash").status).toBe("in_progress");

    // Same-key retry resumes the in-progress receipt: the debit converges
    // (already-applied) and the order row lands, exactly once.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const retry = await createLimitOrder(db, {
      fingerprint: "fp-create-crash",
      idempotencyKey: "create-crash",
    });

    expect(retry.duplicate).toBe(true);
    expect(personalOf(db, makerId).USD).toBe(10_000);
    expect(db.collection("currencyOrders").docs.size).toBe(1);
    expect(receipt(db, "create-crash").status).toBe("completed");
  });

  it("replays the stored order id on a duplicate retry without escrowing again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const first = await createLimitOrder(db, {
      fingerprint: "fp-create-replay",
      idempotencyKey: "create-replay",
    });
    const second = await createLimitOrder(db, {
      fingerprint: "fp-create-replay",
      idempotencyKey: "create-replay",
    });

    expect(second).toEqual({ duplicate: true, orderId: first.orderId });
    expect(personalOf(db, makerId).USD).toBe(10_000);
    expect(db.collection("currencyOrders").docs.size).toBe(1);
  });

  it("rejects a key reused for a different order instead of replaying it", async () => {
    const db = new FakeDb();
    seedDb(db);
    await createLimitOrder(db, { fingerprint: "fp-create-a", idempotencyKey: "create-conflict" });

    await expect(
      createLimitOrder(db, { fingerprint: "fp-create-b", idempotencyKey: "create-conflict" })
    ).rejects.toThrow(MoneyFlowKeyConflictError);
    expect(personalOf(db, makerId).USD).toBe(10_000);
  });

  it("fails closed on a settled key: retrying a failed escrow needs a new key", async () => {
    const db = new FakeDb();
    seedDb(db);
    personalOf(db, makerId).USD = 5;
    await expect(
      createLimitOrder(db, { fingerprint: "fp-create-term", idempotencyKey: "create-terminal" })
    ).rejects.toThrow(FOREX_ORDER_INSUFFICIENT);

    await expect(
      createLimitOrder(db, { fingerprint: "fp-create-term", idempotencyKey: "create-terminal" })
    ).rejects.toThrow(MoneyFlowTerminalError);
  });

  it("validates its inputs before touching the database", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      createLimitOrder(db, { fingerprint: "fp-x", idempotencyKey: "" })
    ).rejects.toThrow(RangeError);
    await expect(
      createLimitOrder(db, { fingerprint: "fp-x", idempotencyKey: "k".repeat(129) })
    ).rejects.toThrow(RangeError);
    await expect(createLimitOrder(db, { amount: 0 })).rejects.toThrow(RangeError);
    await expect(createLimitOrder(db, { limitRate: -1 })).rejects.toThrow(RangeError);
    expect(personalOf(db, makerId).USD).toBe(20_000);
    expect(db.collection("currencyOrders").docs.size).toBe(0);
  });
});

describe("applyForexFillSpend (limit)", () => {
  /** Partial peer fill of 4_000 of a 10_000 USD order at 0.8 with half spreads. */
  async function partialFill(db: FakeDb, orderId: ObjectId, key: string) {
    return applyForexFillSpend(db as unknown as Db, {
      kind: "limit",
      orderId,
      takerCharacterId: takerId,
      requestedAmount: 4_000,
      now,
      turn: 51,
      fingerprint: "fp-fill-partial",
      idempotencyKey: key,
    });
  }

  it("partially fills: taker pays cost+spread, maker is credited, order goes partial", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-fill-setup",
      idempotencyKey: "fill-setup",
    });

    // 4_000 USD @ 0.8 = 3_200 GBP; maker half-spread round(4000*0.0032)=13 USD,
    // taker half-spread round(3200*0.0032)=10 GBP; taker pays 3_210, nets 3_987.
    const fill = await partialFill(db, orderId, "fill-partial");

    expect(fill).toMatchObject({
      duplicate: false,
      fillAmount: 4_000,
      rate: 0.8,
      makerSpread: halfSpread(4_000, LIMIT_ORDER_SPREAD),
      takerSpread: halfSpread(3_200, LIMIT_ORDER_SPREAD),
      orderStatus: "partial",
    });
    expect(personalOf(db, takerId)).toMatchObject({ GBP: 100_000 - 3_210, USD: 3_987 });
    expect(personalOf(db, makerId)).toMatchObject({ USD: 10_000, GBP: 3_200 });
    const stored = orderDoc(db, orderId);
    expect(stored).toMatchObject({ status: "partial", filledAmount: 4_000, spreadCharged: 13 });
    const [history] = historyDocs(db);
    expect(history).toMatchObject({
      buyerCharacterId: makerId,
      sellerCharacterId: takerId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 4_000,
      rate: 0.8,
      spread: 13,
      turn: 51,
      source: "limit_order",
    });
    expect(receipt(db, "fill-partial").status).toBe("completed");
  });

  it("routes both half-spreads to the right central banks with the legacy split", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-fill-spread",
      idempotencyKey: "fill-spread-setup",
    });
    await partialFill(db, orderId, "fill-spread");

    // Maker slice (13 USD, source US): revenue round(13*.25)=3 to the US
    // bank, reserve round(13*.5)=7 USD to the UK bank as a foreign reserve,
    // 3 destroyed.
    expect(spreadSlices(13)).toEqual({ revenue: 3, reserve: 7, destroyed: 3 });
    expect(bankDoc(db, "US")).toMatchObject({
      forexRevenue: 3,
      spreadFeeReserveBalances: { GBP: 5 },
    });
    // Taker slice (10 GBP, source UK): revenue round(10*.25)=3 to the UK
    // bank, reserve round(10*.5)=5 GBP to the US bank as a foreign reserve,
    // 2 destroyed.
    expect(spreadSlices(10)).toEqual({ revenue: 3, reserve: 5, destroyed: 2 });
    expect(bankDoc(db, "UK")).toMatchObject({
      forexRevenue: 3,
      spreadFeeReserveBalances: { USD: 7 },
    });
  });

  it("conserves every unit across a full fill: escrow splits exactly into credit + CB slice", async () => {
    const db = new FakeDb();
    seedDb(db);
    const makerBefore = { ...personalOf(db, makerId) };
    const takerBefore = { ...personalOf(db, takerId) };
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-fill-full",
      idempotencyKey: "fill-full-setup",
    });

    const fill = await applyForexFillSpend(db as unknown as Db, {
      kind: "limit",
      orderId,
      takerCharacterId: takerId,
      now,
      turn: 51,
      fingerprint: "fp-fill-full",
      idempotencyKey: "fill-full",
    });

    expect(fill.orderStatus).toBe("filled");
    expect(fill.fillAmount).toBe(10_000);
    // Maker escrowed 10_000: taker credit (10_000 - makerSpread) + makerSpread
    // to the CBs, nothing created or destroyed outside the spread sink.
    const makerAfter = personalOf(db, makerId);
    const takerAfter = personalOf(db, takerId);
    expect(takerAfter.USD).toBe(fill.fillAmount - fill.makerSpread);
    expect(makerAfter.GBP - makerBefore.GBP).toBe(fill.fillAmount * fill.rate);
    expect(takerBefore.GBP - takerAfter.GBP).toBe(fill.fillAmount * fill.rate + fill.takerSpread);
    expect(makerAfter.USD).toBe(makerBefore.USD - 10_000);
    expect(orderDoc(db, orderId)).toMatchObject({ status: "filled", filledAmount: 10_000 });
  });

  it("fails closed with INSUFFICIENT when the taker cannot cover cost + spread", async () => {
    const db = new FakeDb();
    seedDb(db);
    personalOf(db, takerId).GBP = 1;
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-fill-broke",
      idempotencyKey: "fill-broke-setup",
    });

    await expect(
      applyForexFillSpend(db as unknown as Db, {
        kind: "limit",
        orderId,
        takerCharacterId: takerId,
        now,
        turn: 51,
        fingerprint: "fp-fill-broke",
        idempotencyKey: "fill-broke",
      })
    ).rejects.toThrow(FOREX_FILL_INSUFFICIENT);

    expect(personalOf(db, takerId).GBP).toBe(1);
    expect(personalOf(db, makerId).GBP).toBe(0);
    expect(orderDoc(db, orderId).status).toBe("open");
    expect(historyDocs(db)).toHaveLength(0);
    expect(receipt(db, "fill-broke").status).toBe("failed");
  });

  it("rejects fills against missing, wrong-type, and closed orders", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyForexFillSpend(db as unknown as Db, {
        kind: "limit",
        orderId: new ObjectId(),
        takerCharacterId: takerId,
        now,
        turn: 51,
        fingerprint: "fp-fill-missing",
        idempotencyKey: "fill-missing",
      })
    ).rejects.toThrow(FOREX_FILL_ORDER_MISSING);

    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-fill-closed",
      idempotencyKey: "fill-closed-setup",
    });
    await expect(
      applyForexFillSpend(db as unknown as Db, {
        kind: "direct",
        orderId,
        takerCharacterId: takerId,
        now,
        turn: 51,
        fingerprint: "fp-fill-wrong",
        idempotencyKey: "fill-wrong",
      })
    ).rejects.toThrow(FOREX_DIRECT_WRONG_TYPE);

    orderDoc(db, orderId).status = "filled";
    await expect(
      applyForexFillSpend(db as unknown as Db, {
        kind: "limit",
        orderId,
        takerCharacterId: takerId,
        now,
        turn: 51,
        fingerprint: "fp-fill-shut",
        idempotencyKey: "fill-shut",
      })
    ).rejects.toThrow(FOREX_FILL_UNAVAILABLE);
  });

  it("a crash after the taker leg reconciles to exactly one fill on retry", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-fill-crash",
      idempotencyKey: "fill-crash-setup",
    });
    // Writes: 1 receipt + 2 taker leg; the crash lands on the maker credit.
    db.crashAfterWrites = db.writeCount + 2;

    await expect(
      applyForexFillSpend(db as unknown as Db, {
        kind: "limit",
        orderId,
        takerCharacterId: takerId,
        requestedAmount: 4_000,
        now,
        turn: 51,
        fingerprint: "fp-fill-crash",
        idempotencyKey: "fill-crash",
      })
    ).rejects.toThrow("INJECTED_CRASH");
    expect(receipt(db, "fill-crash").status).toBe("in_progress");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const retry = await applyForexFillSpend(db as unknown as Db, {
      kind: "limit",
      orderId,
      takerCharacterId: takerId,
      requestedAmount: 4_000,
      now,
      turn: 51,
      fingerprint: "fp-fill-crash",
      idempotencyKey: "fill-crash",
    });

    expect(retry.duplicate).toBe(true);
    expect(retry.fillAmount).toBe(4_000);
    // Exactly one fill landed: no double debit, no double credit, one history.
    expect(personalOf(db, takerId)).toMatchObject({ GBP: 100_000 - 3_210, USD: 3_987 });
    expect(personalOf(db, makerId).GBP).toBe(3_200);
    expect(historyDocs(db)).toHaveLength(1);
    expect(receipt(db, "fill-crash").status).toBe("completed");
  });

  it("compensates the taker when a concurrent fill wins the order race", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-fill-race",
      idempotencyKey: "fill-race-setup",
    });
    // A rival fill commits between this fill's pre-read and its order step:
    // the guarded transition then rejects and this fill must unwind its legs.
    const orders = db.collection("currencyOrders");
    const realUpdate = orders.updateOne.bind(orders);
    let calls = 0;
    orders.updateOne = (async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => {
      calls += 1;
      if (calls === 1) {
        const live = orders.docs.get(orderId.toHexString())!;
        live.filledAmount = 10_000;
        live.status = "filled";
      }
      return realUpdate(filter, update);
    }) as typeof orders.updateOne;

    await expect(
      applyForexFillSpend(db as unknown as Db, {
        kind: "limit",
        orderId,
        takerCharacterId: takerId,
        requestedAmount: 4_000,
        now,
        turn: 51,
        fingerprint: "fp-fill-race",
        idempotencyKey: "fill-race",
      })
    ).rejects.toThrow(FOREX_FILL_RACED);

    // The loser leaves no money moved: taker legs compensated, receipt rests
    // compensated, the winner's fill stands untouched.
    expect(personalOf(db, takerId)).toMatchObject({ GBP: 100_000, USD: 0 });
    expect(personalOf(db, makerId).GBP).toBe(0);
    expect(historyDocs(db)).toHaveLength(0);
    expect(receipt(db, "fill-race").status).toBe("compensated");
  });

  it("compensates the taker when a concurrent cancel wins the order race", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-fill-cancelled",
      idempotencyKey: "fill-cancelled-setup",
    });
    const orders = db.collection("currencyOrders");
    const realUpdate = orders.updateOne.bind(orders);
    let calls = 0;
    orders.updateOne = (async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => {
      calls += 1;
      if (calls === 1) {
        orders.docs.get(orderId.toHexString())!.status = "cancelled";
      }
      return realUpdate(filter, update);
    }) as typeof orders.updateOne;

    await expect(
      applyForexFillSpend(db as unknown as Db, {
        kind: "limit",
        orderId,
        takerCharacterId: takerId,
        requestedAmount: 4_000,
        now,
        turn: 51,
        fingerprint: "fp-fill-cancelled",
        idempotencyKey: "fill-cancelled",
      })
    ).rejects.toThrow(FOREX_FILL_RACED);

    expect(personalOf(db, takerId)).toMatchObject({ GBP: 100_000, USD: 0 });
    expect(receipt(db, "fill-cancelled").status).toBe("compensated");
  });

  it("replays a completed fill without moving money again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-fill-replay",
      idempotencyKey: "fill-replay-setup",
    });
    const input = {
      kind: "limit" as const,
      orderId,
      takerCharacterId: takerId,
      requestedAmount: 4_000,
      now,
      turn: 51,
      fingerprint: "fp-fill-replay",
      idempotencyKey: "fill-replay",
    };
    const first = await applyForexFillSpend(db as unknown as Db, input);
    const second = await applyForexFillSpend(db as unknown as Db, input);

    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({
      duplicate: true,
      fillAmount: first.fillAmount,
      rate: first.rate,
      makerSpread: first.makerSpread,
      takerSpread: first.takerSpread,
      orderStatus: "partial",
    });
    expect(personalOf(db, takerId)).toMatchObject({ GBP: 100_000 - 3_210, USD: 3_987 });
    expect(historyDocs(db)).toHaveLength(1);
  });

  it("rejects a fill key reused for a different fill and keeps settled fills terminal", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-fill-keys",
      idempotencyKey: "fill-keys-setup",
    });
    await applyForexFillSpend(db as unknown as Db, {
      kind: "limit",
      orderId,
      takerCharacterId: takerId,
      requestedAmount: 4_000,
      now,
      turn: 51,
      fingerprint: "fp-fill-keys",
      idempotencyKey: "fill-keys",
    });

    await expect(
      applyForexFillSpend(db as unknown as Db, {
        kind: "limit",
        orderId,
        takerCharacterId: takerId,
        requestedAmount: 1_000,
        now,
        turn: 51,
        fingerprint: "fp-fill-other",
        idempotencyKey: "fill-keys",
      })
    ).rejects.toThrow(MoneyFlowKeyConflictError);
    expect(personalOf(db, takerId).USD).toBe(3_987);
  });
});

describe("applyForexFillSpend (direct accept)", () => {
  /** Sender escrows 2_000 USD proposing 0.75 GBP per USD; target accepts. */
  async function createDirectRequest(db: FakeDb, key: string): Promise<ObjectId> {
    const { orderId } = await applyForexOrderCreateSpend(db as unknown as Db, {
      characterId: makerId,
      characterName: "Maker",
      countryId: "US",
      orderType: "direct",
      direction: "buy",
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 2_000,
      limitRate: 0.75,
      targetCharacterId: takerId,
      targetCharacterName: "Taker",
      expiresAtTurn: 124,
      now,
      fingerprint: "fp-direct-setup",
      idempotencyKey: key,
    });
    return orderId;
  }

  function acceptInput(orderId: ObjectId, extra: Record<string, unknown> = {}) {
    return {
      kind: "direct" as const,
      orderId,
      takerCharacterId: takerId,
      now,
      turn: 52,
      fingerprint: "fp-direct-accept",
      idempotencyKey: "direct-accept",
      ...extra,
    };
  }

  it("settles the full request: sender paid, target nets escrow minus spread, history marked direct", async () => {
    const db = new FakeDb();
    seedDb(db);
    const orderId = await createDirectRequest(db, "direct-setup");

    // 2_000 USD @ 0.75 = 1_500 GBP; maker half-spread round(2000*0.0018)=4,
    // taker half-spread round(1500*0.0018)=3; target pays 1_503, nets 1_996.
    const fill = await applyForexFillSpend(db as unknown as Db, acceptInput(orderId));

    expect(fill).toMatchObject({
      duplicate: false,
      fillAmount: 2_000,
      rate: 0.75,
      makerSpread: halfSpread(2_000, DIRECT_TRADE_SPREAD),
      takerSpread: halfSpread(1_500, DIRECT_TRADE_SPREAD),
      orderStatus: "filled",
    });
    expect(fill.makerSpread).toBe(4);
    expect(fill.takerSpread).toBe(3);
    expect(personalOf(db, takerId)).toMatchObject({ GBP: 50_000 - 1_503, USD: 1_996 });
    expect(personalOf(db, makerId)).toMatchObject({ USD: 18_000, GBP: 1_500 });
    // Conservation: the 2_000 escrow splits exactly into the target credit
    // (1_996) plus the maker CB slice (4).
    expect(1_996 + 4).toBe(2_000);
    const stored = orderDoc(db, orderId);
    expect(stored).toMatchObject({
      status: "filled",
      filledAmount: 2_000,
      filledRate: 0.75,
      spreadCharged: 4,
    });
    const [history] = historyDocs(db);
    expect(history).toMatchObject({
      buyerCharacterId: makerId,
      sellerCharacterId: takerId,
      amount: 2_000,
      rate: 0.75,
      spread: 4,
      source: "direct",
    });
    // Opposite routing to the limit fill: the USD maker slice still accrues
    // to the UK bank as a foreign reserve, the GBP taker slice to the US bank.
    expect(bankDoc(db, "UK").spreadFeeReserveBalances).toMatchObject({ USD: 2 });
    expect(bankDoc(db, "US").spreadFeeReserveBalances).toMatchObject({ GBP: 2 });
    expect(receipt(db, "direct-accept").status).toBe("completed");
  });

  it("fails closed with INSUFFICIENT carrying exact need/have when the target is short", async () => {
    const db = new FakeDb();
    seedDb(db);
    personalOf(db, takerId).GBP = 100;
    const orderId = await createDirectRequest(db, "direct-broke-setup");

    const error = await applyForexFillSpend(db as unknown as Db, acceptInput(orderId)).catch(
      (e: Error) => e
    );
    expect(error.message).toMatch(new RegExp(`^${FOREX_DIRECT_INSUFFICIENT}:precheck:`));
    const [, , need, have] = error.message.split(":");
    expect(Number(need)).toBe(1_503);
    expect(Number(have)).toBe(100);

    expect(personalOf(db, takerId).GBP).toBe(100);
    expect(orderDoc(db, orderId).status).toBe("open");
    expect(receipt(db, "direct-accept").status).toBe("failed");
  });

  it("rejects accepts against missing, wrong-type, and closed requests", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyForexFillSpend(db as unknown as Db, acceptInput(new ObjectId()))
    ).rejects.toThrow(FOREX_DIRECT_ORDER_MISSING);

    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-accept-limit",
      idempotencyKey: "accept-limit-setup",
    });
    await expect(
      applyForexFillSpend(db as unknown as Db, {
        ...acceptInput(orderId),
        fingerprint: "fp-accept-limit-kind",
        idempotencyKey: "accept-limit-kind",
      })
    ).rejects.toThrow(FOREX_DIRECT_WRONG_TYPE);

    const directId = await createDirectRequest(db, "direct-closed-setup");
    orderDoc(db, directId).status = "cancelled";
    await expect(
      applyForexFillSpend(db as unknown as Db, {
        ...acceptInput(directId),
        fingerprint: "fp-accept-closed",
        idempotencyKey: "accept-closed",
      })
    ).rejects.toThrow(FOREX_DIRECT_UNAVAILABLE);
  });

  it("compensates the target when a concurrent decline wins the race", async () => {
    const db = new FakeDb();
    seedDb(db);
    const orderId = await createDirectRequest(db, "direct-race-setup");
    const orders = db.collection("currencyOrders");
    const realUpdate = orders.updateOne.bind(orders);
    let calls = 0;
    orders.updateOne = (async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => {
      calls += 1;
      if (calls === 1) {
        // The decline's transition commits first; this accept must unwind.
        orders.docs.get(orderId.toHexString())!.status = "cancelled";
      }
      return realUpdate(filter, update);
    }) as typeof orders.updateOne;

    await expect(
      applyForexFillSpend(db as unknown as Db, acceptInput(orderId))
    ).rejects.toThrow(FOREX_DIRECT_UNAVAILABLE);

    expect(personalOf(db, takerId)).toMatchObject({ GBP: 50_000, USD: 0 });
    expect(personalOf(db, makerId).GBP).toBe(0);
    expect(historyDocs(db)).toHaveLength(0);
    expect(receipt(db, "direct-accept").status).toBe("compensated");
  });

  it("a crash mid-accept reconciles to exactly one settlement on retry", async () => {
    const db = new FakeDb();
    seedDb(db);
    const orderId = await createDirectRequest(db, "direct-crash-setup");
    db.crashAfterWrites = db.writeCount + 2;

    await expect(
      applyForexFillSpend(db as unknown as Db, acceptInput(orderId))
    ).rejects.toThrow("INJECTED_CRASH");
    expect(receipt(db, "direct-accept").status).toBe("in_progress");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const retry = await applyForexFillSpend(db as unknown as Db, acceptInput(orderId));

    expect(retry.duplicate).toBe(true);
    expect(retry.fillAmount).toBe(2_000);
    expect(personalOf(db, takerId)).toMatchObject({ GBP: 50_000 - 1_503, USD: 1_996 });
    expect(personalOf(db, makerId).GBP).toBe(1_500);
    expect(historyDocs(db)).toHaveLength(1);
    expect(receipt(db, "direct-accept").status).toBe("completed");
  });

  it("replays a completed accept and rejects key reuse across different accepts", async () => {
    const db = new FakeDb();
    seedDb(db);
    const orderId = await createDirectRequest(db, "direct-replay-setup");
    const input = acceptInput(orderId);
    const first = await applyForexFillSpend(db as unknown as Db, input);
    const second = await applyForexFillSpend(db as unknown as Db, input);

    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({
      duplicate: true,
      fillAmount: 2_000,
      rate: 0.75,
      makerSpread: 4,
      takerSpread: 3,
      orderStatus: "filled",
    });
    expect(personalOf(db, takerId).USD).toBe(1_996);
    expect(historyDocs(db)).toHaveLength(1);

    await expect(
      applyForexFillSpend(db as unknown as Db, {
        ...input,
        fingerprint: "fp-direct-other",
        idempotencyKey: "direct-accept",
      })
    ).rejects.toThrow(MoneyFlowKeyConflictError);
  });

  it("rejects fills with a non-finite requested amount before reading state", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-fill-nan",
      idempotencyKey: "fill-nan-setup",
    });

    await expect(
      applyForexFillSpend(db as unknown as Db, {
        kind: "limit",
        orderId,
        takerCharacterId: takerId,
        requestedAmount: Number.NaN,
        now,
        turn: 51,
        fingerprint: "fp-fill-nan",
        idempotencyKey: "fill-nan",
      })
    ).rejects.toThrow(RangeError);
  });
});

describe("applyForexCancelSpend", () => {
  function cancelInput(orderId: ObjectId, extra: Record<string, unknown> = {}) {
    return {
      orderId,
      now,
      fingerprint: "fp-cancel",
      idempotencyKey: "cancel",
      ...extra,
    };
  }

  it("cancels an open order and refunds the full escrow exactly once", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-cancel-setup",
      idempotencyKey: "cancel-setup",
    });

    const cancel = await applyForexCancelSpend(
      db as unknown as Db,
      cancelInput(orderId, { fingerprint: "fp-cancel-happy", idempotencyKey: "cancel-happy" })
    );

    expect(cancel).toMatchObject({
      duplicate: false,
      refundedAmount: 10_000,
      refundedCurrency: "USD",
    });
    expect(personalOf(db, makerId).USD).toBe(20_000);
    expect(orderDoc(db, orderId).status).toBe("cancelled");
    expect(receipt(db, "cancel-happy").status).toBe("completed");
  });

  it("refunds only the true remainder after a partial fill", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-cancel-partial",
      idempotencyKey: "cancel-partial-setup",
    });
    await applyForexFillSpend(db as unknown as Db, {
      kind: "limit",
      orderId,
      takerCharacterId: takerId,
      requestedAmount: 4_000,
      now,
      turn: 51,
      fingerprint: "fp-cancel-partial-fill",
      idempotencyKey: "cancel-partial-fill",
    });

    const cancel = await applyForexCancelSpend(
      db as unknown as Db,
      cancelInput(orderId, { fingerprint: "fp-cancel-rem", idempotencyKey: "cancel-rem" })
    );

    expect(cancel.refundedAmount).toBe(6_000);
    // Maker escrowed 10_000 and got nothing back from the fill (fills pay
    // the maker in toCurrency): 10_000 escrow - 4_000 filled + 6_000 refund.
    expect(personalOf(db, makerId).USD).toBe(10_000 + 6_000);
    expect(orderDoc(db, orderId).status).toBe("cancelled");
  });

  it("declines a direct request through the same primitive (decline fingerprint)", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await applyForexOrderCreateSpend(db as unknown as Db, {
      characterId: makerId,
      characterName: "Maker",
      countryId: "US",
      orderType: "direct",
      direction: "buy",
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 2_000,
      limitRate: 0.75,
      targetCharacterId: takerId,
      targetCharacterName: "Taker",
      expiresAtTurn: 124,
      now,
      fingerprint: "fp-decline-setup",
      idempotencyKey: "decline-setup",
    });

    const decline = await applyForexCancelSpend(
      db as unknown as Db,
      cancelInput(orderId, {
        fingerprint: `forex-decline:${orderId.toHexString()}:${takerId.toHexString()}`,
        idempotencyKey: "decline",
      })
    );

    expect(decline).toMatchObject({ duplicate: false, refundedAmount: 2_000 });
    expect(personalOf(db, makerId).USD).toBe(20_000);
    expect(orderDoc(db, orderId).status).toBe("cancelled");
  });

  it("rejects cancels against missing and closed orders without moving money", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyForexCancelSpend(
        db as unknown as Db,
        cancelInput(new ObjectId(), {
          fingerprint: "fp-cancel-gone",
          idempotencyKey: "cancel-gone",
        })
      )
    ).rejects.toThrow(FOREX_CANCEL_ORDER_MISSING);

    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-cancel-shut",
      idempotencyKey: "cancel-shut-setup",
    });
    orderDoc(db, orderId).status = "filled";
    await expect(
      applyForexCancelSpend(
        db as unknown as Db,
        cancelInput(orderId, { fingerprint: "fp-cancel-shut", idempotencyKey: "cancel-shut" })
      )
    ).rejects.toThrow(FOREX_CANCEL_UNAVAILABLE);
    expect(personalOf(db, makerId).USD).toBe(10_000);
  });

  it("a crash between the transition and the refund reconciles to a single refund", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-cancel-crash",
      idempotencyKey: "cancel-crash-setup",
    });
    // Writes: 1 receipt + 1 cancel transition; the crash lands on the refund.
    db.crashAfterWrites = db.writeCount + 2;

    await expect(
      applyForexCancelSpend(
        db as unknown as Db,
        cancelInput(orderId, { fingerprint: "fp-cancel-crash", idempotencyKey: "cancel-crash" })
      )
    ).rejects.toThrow("INJECTED_CRASH");
    expect(receipt(db, "cancel-crash").status).toBe("in_progress");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const retry = await applyForexCancelSpend(
      db as unknown as Db,
      cancelInput(orderId, { fingerprint: "fp-cancel-crash", idempotencyKey: "cancel-crash" })
    );

    expect(retry.duplicate).toBe(true);
    expect(retry.refundedAmount).toBe(10_000);
    expect(personalOf(db, makerId).USD).toBe(20_000);
    expect(orderDoc(db, orderId).status).toBe("cancelled");
    expect(receipt(db, "cancel-crash").status).toBe("completed");
  });

  it("loses cleanly when a concurrent fill commits first: no refund, receipt failed", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-cancel-loser",
      idempotencyKey: "cancel-loser-setup",
    });
    const orders = db.collection("currencyOrders");
    const realUpdate = orders.updateOne.bind(orders);
    let calls = 0;
    orders.updateOne = (async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => {
      calls += 1;
      if (calls === 1) {
        const live = orders.docs.get(orderId.toHexString())!;
        live.status = "filled";
        live.filledAmount = 10_000;
      }
      return realUpdate(filter, update);
    }) as typeof orders.updateOne;

    await expect(
      applyForexCancelSpend(
        db as unknown as Db,
        cancelInput(orderId, { fingerprint: "fp-cancel-loser", idempotencyKey: "cancel-loser" })
      )
    ).rejects.toThrow("FOREX_CANCEL_order-cancel");

    // Nothing applied, so nothing compensates: the escrow stays out (it paid
    // for the winner's fill) and the receipt rests failed, not partial.
    expect(personalOf(db, makerId).USD).toBe(10_000);
    expect(receipt(db, "cancel-loser").status).toBe("failed");
  });

  it("still releases the order when the owner account is gone (escrow died with it)", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-cancel-orphan",
      idempotencyKey: "cancel-orphan-setup",
    });
    db.collection("characters").docs.delete(makerId.toHexString());

    const cancel = await applyForexCancelSpend(
      db as unknown as Db,
      cancelInput(orderId, { fingerprint: "fp-cancel-orphan", idempotencyKey: "cancel-orphan" })
    );

    expect(cancel.refundedAmount).toBe(10_000);
    expect(orderDoc(db, orderId).status).toBe("cancelled");
    expect(receipt(db, "cancel-orphan").status).toBe("completed");
  });

  it("replays a completed cancel and rejects key reuse across different cancels", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { orderId } = await createLimitOrder(db, {
      fingerprint: "fp-cancel-replay",
      idempotencyKey: "cancel-replay-setup",
    });
    const input = cancelInput(orderId, {
      fingerprint: "fp-cancel-replay",
      idempotencyKey: "cancel-replay",
    });
    const first = await applyForexCancelSpend(db as unknown as Db, input);
    const second = await applyForexCancelSpend(db as unknown as Db, input);

    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({ duplicate: true, refundedAmount: 10_000 });
    expect(personalOf(db, makerId).USD).toBe(20_000);

    await expect(
      applyForexCancelSpend(
        db as unknown as Db,
        cancelInput(orderId, { fingerprint: "fp-cancel-other", idempotencyKey: "cancel-replay" })
      )
    ).rejects.toThrow(MoneyFlowKeyConflictError);
  });
});
