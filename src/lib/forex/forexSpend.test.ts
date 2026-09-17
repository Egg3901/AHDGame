import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Collection, type Db } from "mongodb";
import {
  applyForexCancelSpend,
  applyForexExpireSpend,
  applyForexFillSpend,
  applyForexInterventionSpend,
  applyForexOrderCreateSpend,
  applyForexTurnFillSpend,
  forexExpireFingerprint,
  forexExpireKey,
  forexInterventionFingerprint,
  forexInterventionKey,
  forexTurnFillFingerprint,
  forexTurnFillKey,
  resumeForexExpireByKey,
  resumeForexInterventionByKey,
  resumeForexTurnFillByKey,
  FOREX_EXPIRE_ORDER_MISSING,
  FOREX_EXPIRE_UNAVAILABLE,
  FOREX_INTERVENTION_RATE,
  FOREX_INTERVENTION_RECEIPT_ORPHANED,
  FOREX_INTERVENTION_RESERVE,
  FOREX_TURN_FILL_RACED,
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
  type ForexInterventionInput,
} from "./forexSpend";
import {
  claimMoneyFlowReceipt,
  failMoneyFlowReceipt,
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
// primitives emit ($inc / $set / $unset / $pop / $push+$each+$slice writes; _id
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
    const pop = (update.$pop ?? {}) as Record<string, number>;
    for (const [field, direction] of Object.entries(pop)) {
      const current = getPath(doc, field);
      if (!Array.isArray(current) || current.length === 0) continue;
      if (direction === 1) current.pop();
      else if (direction === -1) current.shift();
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
  return (charDoc(db, id).currencyBalances as { personal: Record<string, number> }).personal ?? {};
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
    MoneyFlowReceipt | undefined;
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

    await expect(createLimitOrder(db, { fingerprint: "fp-x", idempotencyKey: "" })).rejects.toThrow(
      RangeError
    );
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
    expect(personalOf(db, takerId)).toMatchObject({ GBP: 100_000 - 1_503, USD: 1_996 });
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
    // Same-bank merge: each bank also takes the other fee's revenue slice
    // (maker 4 → revenue 1 to the US bank; taker 3 → revenue 1 to the UK
    // bank), and both slices land in ONE keyed write per bank — a second
    // same-bank step would collide on the key guard and skip its slice.
    expect(bankDoc(db, "UK")).toMatchObject({ forexRevenue: 1 });
    expect(bankDoc(db, "US")).toMatchObject({ forexRevenue: 1 });
    expect(bankDoc(db, "UK").appliedMoneyFlowKeys).toHaveLength(1);
    expect(bankDoc(db, "US").appliedMoneyFlowKeys).toHaveLength(1);
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

    await expect(applyForexFillSpend(db as unknown as Db, acceptInput(orderId))).rejects.toThrow(
      FOREX_DIRECT_UNAVAILABLE
    );

    expect(personalOf(db, takerId)).toMatchObject({ GBP: 100_000, USD: 0 });
    expect(personalOf(db, makerId).GBP).toBe(0);
    expect(historyDocs(db)).toHaveLength(0);
    expect(receipt(db, "direct-accept").status).toBe("compensated");
  });

  it("a crash mid-accept reconciles to exactly one settlement on retry", async () => {
    const db = new FakeDb();
    seedDb(db);
    const orderId = await createDirectRequest(db, "direct-crash-setup");
    db.crashAfterWrites = db.writeCount + 2;

    await expect(applyForexFillSpend(db as unknown as Db, acceptInput(orderId))).rejects.toThrow(
      "INJECTED_CRASH"
    );
    expect(receipt(db, "direct-accept").status).toBe("in_progress");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const retry = await applyForexFillSpend(db as unknown as Db, acceptInput(orderId));

    expect(retry.duplicate).toBe(true);
    expect(retry.fillAmount).toBe(2_000);
    expect(personalOf(db, takerId)).toMatchObject({ GBP: 100_000 - 1_503, USD: 1_996 });
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

describe("applyForexTurnFillSpend (turn triggered fills)", () => {
  const TURN = 50;
  const CROSS_RATE = 0.75; // GBP per USD

  /** A 10_000 USD -> GBP limit order with the maker escrow already taken. */
  function seedTurnOrder(db: FakeDb, overrides: Record<string, unknown> = {}): ObjectId {
    const orderId = new ObjectId();
    db.collection("currencyOrders").docs.set(orderId.toHexString(), {
      _id: orderId,
      characterId: makerId,
      characterName: "Maker",
      countryId: "US",
      type: "limit",
      direction: "buy",
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 10_000,
      filledAmount: 0,
      limitRate: 0.7,
      status: "open",
      spreadCharged: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
      _id: orderId,
    });
    return orderId;
  }

  function fillInputFor(
    db: FakeDb,
    orderId: ObjectId,
    crossRate: number = CROSS_RATE
  ): Parameters<typeof applyForexTurnFillSpend>[1] {
    const order = orderDoc(db, orderId);
    const filled = order.filledAmount as number;
    const remaining = (order.amount as number) - filled;
    return {
      orderId,
      crossRate,
      turn: TURN,
      now,
      fingerprint: forexTurnFillFingerprint(orderId, TURN, filled, remaining),
      idempotencyKey: forexTurnFillKey(TURN, orderId),
    };
  }

  // Legacy-exact expectations for 10_000 USD -> GBP at 0.75:
  // spread 64, net 9936, credit 7452, CB share 48, reserve 32, revenue 16.
  const EXPECTED = {
    spread: 64,
    net: 9_936,
    credit: 7_452,
    cbShare: 48,
    reserve: 32,
    revenue: 16,
  };

  function freshDb(): FakeDb {
    const db = new FakeDb();
    seedDb(db);
    return db;
  }

  it("fills exactly once with legacy-exact amounts, routing, and history", async () => {
    const db = freshDb();
    const orderId = seedTurnOrder(db);

    const result = await applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId));

    expect(result).toMatchObject({
      duplicate: false,
      outcome: "filled",
      fillAmount: 10_000,
      toAmount: EXPECTED.credit,
      filledRate: CROSS_RATE,
      spreadAmount: EXPECTED.spread,
      centralBankShare: EXPECTED.cbShare,
      orderStatus: "filled",
    });
    expect(personalOf(db, makerId).GBP).toBe(EXPECTED.credit);
    expect(personalOf(db, makerId).USD).toBe(20_000);
    expect(bankDoc(db, "US").forexRevenue).toBe(EXPECTED.revenue);
    expect((bankDoc(db, "UK").spreadFeeReserveBalances as Record<string, number>).USD).toBe(
      EXPECTED.reserve
    );
    const settled = orderDoc(db, orderId);
    expect(settled.status).toBe("filled");
    expect(settled.filledAmount).toBe(10_000);
    expect(settled.filledRate).toBe(CROSS_RATE);
    expect(settled.spreadCharged).toBe(EXPECTED.spread);
    const rows = historyDocs(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      buyerCharacterId: makerId,
      sellerCharacterId: null,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: EXPECTED.net,
      rate: CROSS_RATE,
      spread: EXPECTED.spread,
      turn: TURN,
      source: "limit_order",
    });
    expect(receipt(db, forexTurnFillKey(TURN, orderId)).status).toBe("completed");
  });

  it("a crash between the plan write and the credit converges on retry", async () => {
    const db = freshDb();
    const orderId = seedTurnOrder(db);
    // Writes: 1 claim + 1 plan, then the crash lands on the credit leg.
    db.crashAfterWrites = 2;

    await expect(
      applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId))
    ).rejects.toThrow("INJECTED_CRASH");
    expect(personalOf(db, makerId).GBP).toBe(0);
    expect(orderDoc(db, orderId).status).toBe("open");
    expect(receipt(db, forexTurnFillKey(TURN, orderId)).status).toBe("in_progress");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const retry = await applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId));

    expect(retry.duplicate).toBe(true);
    expect(retry.outcome).toBe("filled");
    expect(personalOf(db, makerId).GBP).toBe(EXPECTED.credit);
    expect(bankDoc(db, "US").forexRevenue).toBe(EXPECTED.revenue);
    expect(historyDocs(db)).toHaveLength(1);
    expect(receipt(db, forexTurnFillKey(TURN, orderId)).status).toBe("completed");
  });

  it("a crash after the credit but before the settle never double-pays", async () => {
    const db = freshDb();
    const orderId = seedTurnOrder(db);
    // Writes: claim + plan + credit land, then the crash lands on the settle.
    db.crashAfterWrites = 3;

    await expect(
      applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId))
    ).rejects.toThrow("INJECTED_CRASH");
    expect(personalOf(db, makerId).GBP).toBe(EXPECTED.credit);
    expect(orderDoc(db, orderId).status).toBe("open");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId));

    expect(personalOf(db, makerId).GBP).toBe(EXPECTED.credit);
    expect(orderDoc(db, orderId).status).toBe("filled");
    expect(historyDocs(db)).toHaveLength(1);
  });

  it("a crash mid-spread routes each bank slice exactly once", async () => {
    const db = freshDb();
    const orderId = seedTurnOrder(db);
    // Writes through the US spread slice land; the crash lands on the UK
    // existence insert.
    db.crashAfterWrites = 6;

    await expect(
      applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId))
    ).rejects.toThrow("INJECTED_CRASH");
    expect(bankDoc(db, "US").forexRevenue).toBe(EXPECTED.revenue);

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId));

    expect(bankDoc(db, "US").forexRevenue).toBe(EXPECTED.revenue);
    expect((bankDoc(db, "UK").spreadFeeReserveBalances as Record<string, number>).USD).toBe(
      EXPECTED.reserve
    );
    expect(personalOf(db, makerId).GBP).toBe(EXPECTED.credit);
    expect(historyDocs(db)).toHaveLength(1);
    expect(receipt(db, forexTurnFillKey(TURN, orderId)).status).toBe("completed");
  });

  it("replays the stored outcome on a duplicate retry without moving money", async () => {
    const db = freshDb();
    const orderId = seedTurnOrder(db);
    const first = await applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId));
    // A same-key retry recomputed at drifted rates still replays the stored
    // plan amounts instead of refilling.
    const second = await applyForexTurnFillSpend(db as unknown as Db, {
      ...fillInputFor(db, orderId),
      crossRate: 0.9,
    });

    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({
      duplicate: true,
      outcome: "filled",
      fillAmount: 10_000,
      toAmount: EXPECTED.credit,
      filledRate: CROSS_RATE,
    });
    expect(personalOf(db, makerId).GBP).toBe(EXPECTED.credit);
    expect(historyDocs(db)).toHaveLength(1);
  });

  it("rejects a key reused for a different order", async () => {
    const db = freshDb();
    const orderA = seedTurnOrder(db);
    const orderB = seedTurnOrder(db);
    await applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderA));

    await expect(
      applyForexTurnFillSpend(db as unknown as Db, {
        ...fillInputFor(db, orderB),
        idempotencyKey: forexTurnFillKey(TURN, orderA),
      })
    ).rejects.toThrow(MoneyFlowKeyConflictError);
    expect(orderDoc(db, orderB).status).toBe("open");
    expect(personalOf(db, makerId).GBP).toBe(EXPECTED.credit);
  });

  it("fails closed on a same-key retry after a terminal settlement", async () => {
    const db = freshDb();
    const orderId = seedTurnOrder(db);
    const key = forexTurnFillKey(TURN, orderId);
    const input = fillInputFor(db, orderId);
    const receipts = db.collection(
      NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION
    ) as unknown as Collection<MoneyFlowReceipt>;
    // The terminal setup must claim under the input's real fingerprint: a
    // mismatched fingerprint throws key-conflict before the terminal status
    // is ever consulted, which would test the wrong failure.
    expect(await claimMoneyFlowReceipt(receipts, key, input.fingerprint)).toBe("fresh");
    await failMoneyFlowReceipt(receipts, key, "FOREX_TURN_FILL_RACED:guard-rejected");

    await expect(applyForexTurnFillSpend(db as unknown as Db, input)).rejects.toThrow(
      MoneyFlowTerminalError
    );
    expect(personalOf(db, makerId).GBP).toBe(0);
    expect(orderDoc(db, orderId).status).toBe("open");
  });

  it("a settle loser compensates its credit instead of double-paying the winner", async () => {
    const db = freshDb();
    const orderId = seedTurnOrder(db);
    const key = forexTurnFillKey(TURN, orderId);
    // Crash after the credit but before the settle, then a concurrent
    // winner fills the order under its own key.
    db.crashAfterWrites = 3;
    await expect(
      applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId))
    ).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const winner = orderDoc(db, orderId);
    winner.status = "filled";
    winner.filledAmount = 10_000;

    await expect(resumeForexTurnFillByKey(db as unknown as Db, key)).rejects.toThrow(
      new RegExp(FOREX_TURN_FILL_RACED)
    );

    // The loser's credit was reversed; the winner's fill stands untouched.
    expect(personalOf(db, makerId).GBP).toBe(0);
    expect(orderDoc(db, orderId).status).toBe("filled");
    expect(receipt(db, key).status).toBe("compensated");
  });

  it("skips writeless on empty remainder, missing order, and unusable rate", async () => {
    const db = freshDb();
    const settledId = seedTurnOrder(db, { filledAmount: 10_000, status: "filled" });
    const skipped = await applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, settledId));
    expect(skipped.outcome).toBe("skipped");
    expect(db.writeCount).toBe(0);
    expect(db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.size).toBe(0);

    const missing = await applyForexTurnFillSpend(db as unknown as Db, {
      ...fillInputFor(db, settledId),
      orderId: new ObjectId(),
    });
    expect(missing.outcome).toBe("skipped");

    const orderId = seedTurnOrder(db);
    const badRate = await applyForexTurnFillSpend(db as unknown as Db, {
      ...fillInputFor(db, orderId),
      crossRate: Number.NaN,
    });
    expect(badRate.outcome).toBe("skipped");
    expect(orderDoc(db, orderId).status).toBe("open");
  });

  it("expires the order while keeping spread and history when the owner is gone", async () => {
    const db = freshDb();
    const orderId = seedTurnOrder(db);
    db.collection("characters").docs.delete(makerId.toHexString());

    const result = await applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId));

    expect(result).toMatchObject({ duplicate: false, outcome: "expired" });
    expect(result.centralBankShare).toBe(EXPECTED.cbShare);
    const settled = orderDoc(db, orderId);
    expect(settled.status).toBe("expired");
    expect(bankDoc(db, "US").forexRevenue).toBe(EXPECTED.revenue);
    expect(historyDocs(db)).toHaveLength(1);
    expect(receipt(db, forexTurnFillKey(TURN, orderId)).status).toBe("completed");

    const replay = await applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId));
    expect(replay).toMatchObject({ duplicate: true, outcome: "expired" });
    expect(historyDocs(db)).toHaveLength(1);
  });

  it("merges same-bank slices into one write", async () => {
    const db = freshDb();
    const orderId = seedTurnOrder(db, { toCurrency: "USD" });

    const result = await applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId, 1));

    expect(result.outcome).toBe("filled");
    expect(personalOf(db, makerId).USD).toBe(20_000 + 9_936);
    expect(bankDoc(db, "US").forexRevenue).toBe(EXPECTED.revenue);
    expect((bankDoc(db, "US").spreadFeeReserveBalances as Record<string, number>).USD).toBe(
      EXPECTED.reserve
    );
  });

  it("resumes a prior-turn orphan by key without a live input", async () => {
    const db = freshDb();
    const orderId = seedTurnOrder(db);
    db.crashAfterWrites = 2;
    await expect(
      applyForexTurnFillSpend(db as unknown as Db, fillInputFor(db, orderId))
    ).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const resumed = await resumeForexTurnFillByKey(
      db as unknown as Db,
      forexTurnFillKey(TURN, orderId)
    );

    expect(resumed).toMatchObject({
      duplicate: true,
      outcome: "filled",
      fillAmount: 10_000,
      toAmount: EXPECTED.credit,
      orderId,
    });
    expect(personalOf(db, makerId).GBP).toBe(EXPECTED.credit);
    expect(receipt(db, forexTurnFillKey(TURN, orderId)).status).toBe("completed");
    expect(await resumeForexTurnFillByKey(db as unknown as Db, "unrelated-key")).toBeNull();
  });
});

describe("applyForexExpireSpend (turn expiry refunds)", () => {
  const TURN = 50;

  /** A 1000 USD order with 200 filled, due at turn 49 (refund 800 USD). */
  function seedExpireOrder(db: FakeDb, overrides: Record<string, unknown> = {}): ObjectId {
    const orderId = new ObjectId();
    db.collection("currencyOrders").docs.set(orderId.toHexString(), {
      _id: orderId,
      characterId: makerId,
      characterName: "Maker",
      countryId: "US",
      type: "limit",
      direction: "buy",
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 1000,
      filledAmount: 200,
      limitRate: 0.8,
      status: "partial",
      expiresAtTurn: 49,
      spreadCharged: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
      _id: orderId,
    });
    return orderId;
  }

  function expireInputFor(
    db: FakeDb,
    orderId: ObjectId,
    overrides: Record<string, unknown> = {}
  ): Parameters<typeof applyForexExpireSpend>[1] {
    void db;
    return {
      orderId,
      turn: TURN,
      now,
      fingerprint: forexExpireFingerprint(orderId),
      idempotencyKey: forexExpireKey(orderId),
      ...overrides,
    } as Parameters<typeof applyForexExpireSpend>[1];
  }

  function freshDb(): FakeDb {
    const db = new FakeDb();
    seedDb(db);
    return db;
  }

  it("expires exactly once, refunding the remainder to the escrow currency", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db);

    const result = await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));

    expect(result).toMatchObject({
      duplicate: false,
      refundedAmount: 800,
      refundedCurrency: "USD",
      orderStatus: "expired",
      transitionApplied: true,
    });
    expect(personalOf(db, makerId).USD).toBe(20_800);
    expect(orderDoc(db, orderId).status).toBe("expired");
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("completed");
  });

  it("a crash before the order terminalization converges on retry", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db);
    // Writes: 1 claim lands, then the crash lands on the transition.
    db.crashAfterWrites = 1;

    await expect(
      applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId))
    ).rejects.toThrow("INJECTED_CRASH");
    expect(orderDoc(db, orderId).status).toBe("partial");
    expect(personalOf(db, makerId).USD).toBe(20_000);
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("in_progress");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const retry = await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));

    expect(retry.duplicate).toBe(true);
    expect(retry.refundedAmount).toBe(800);
    expect(retry.transitionApplied).toBe(true);
    expect(personalOf(db, makerId).USD).toBe(20_800);
    expect(orderDoc(db, orderId).status).toBe("expired");
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("completed");
  });

  it("a crash after terminalization but before the credit refunds once", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db);
    // Writes: claim + transition land, then the crash lands on the credit.
    db.crashAfterWrites = 2;

    await expect(
      applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId))
    ).rejects.toThrow("INJECTED_CRASH");
    expect(orderDoc(db, orderId).status).toBe("expired");
    expect(personalOf(db, makerId).USD).toBe(20_000);

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));

    expect(personalOf(db, makerId).USD).toBe(20_800);
    expect(orderDoc(db, orderId).status).toBe("expired");
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("completed");
  });

  it("a crash after the credit but before settle never double-refunds", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db);
    // Writes: claim + transition + credit land, then the crash lands on settle.
    db.crashAfterWrites = 3;

    await expect(
      applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId))
    ).rejects.toThrow("INJECTED_CRASH");
    expect(personalOf(db, makerId).USD).toBe(20_800);
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("in_progress");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const retry = await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));

    expect(retry.duplicate).toBe(true);
    expect(retry.transitionApplied).toBe(false);
    expect(personalOf(db, makerId).USD).toBe(20_800);
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("completed");
  });

  it("concurrent same-key claims converge to one refund", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db);
    // A parallel worker crashes mid-flow; the second worker picks the same
    // key up while it is still in_progress and finishes it.
    db.crashAfterWrites = 2;
    await expect(
      applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId))
    ).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const worker = await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));
    expect(worker.duplicate).toBe(true);

    // The original worker retrying afterwards replays, never refunding again.
    const replay = await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));
    expect(replay.duplicate).toBe(true);
    expect(replay.refundedAmount).toBe(800);
    expect(personalOf(db, makerId).USD).toBe(20_800);
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("completed");
  });

  it("a different-key concurrent loser fails explicitly without moving money", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db);
    await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));

    await expect(
      applyForexExpireSpend(
        db as unknown as Db,
        expireInputFor(db, orderId, { fingerprint: "other-key-fp", idempotencyKey: "other-key" })
      )
    ).rejects.toThrow(FOREX_EXPIRE_UNAVAILABLE);
    expect(personalOf(db, makerId).USD).toBe(20_800);
  });

  it("replays the stored outcome on a duplicate retry without moving money", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db);
    const first = await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));
    const second = await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));

    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({
      duplicate: true,
      refundedAmount: 800,
      refundedCurrency: "USD",
      orderStatus: "expired",
      transitionApplied: false,
    });
    expect(personalOf(db, makerId).USD).toBe(20_800);
  });

  it("a stable order key never refunds twice across turns", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db);
    await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));

    // A later turn re-driving the same order-derived key replays the stored
    // outcome instead of refunding a second time.
    const later = await applyForexExpireSpend(
      db as unknown as Db,
      expireInputFor(db, orderId, { turn: 60 })
    );
    expect(later.duplicate).toBe(true);
    expect(later.transitionApplied).toBe(false);
    expect(personalOf(db, makerId).USD).toBe(20_800);
  });

  it("releases the order when the owner is gone without crediting anyone", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db);
    db.collection("characters").docs.delete(makerId.toHexString());

    const result = await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));

    expect(result).toMatchObject({
      duplicate: false,
      refundedAmount: 800,
      orderStatus: "expired",
      transitionApplied: true,
    });
    expect(orderDoc(db, orderId).status).toBe("expired");
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("completed");
  });

  it("fails explicitly on legacy already-expired rows without moving money", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db, { status: "expired" });

    await expect(
      applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId))
    ).rejects.toThrow(FOREX_EXPIRE_UNAVAILABLE);
    expect(personalOf(db, makerId).USD).toBe(20_000);
    expect(orderDoc(db, orderId).status).toBe("expired");
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("failed");
  });

  it("fails closed on missing orders", async () => {
    const db = freshDb();
    const orderId = new ObjectId();

    await expect(
      applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId))
    ).rejects.toThrow(FOREX_EXPIRE_ORDER_MISSING);
    expect(personalOf(db, makerId).USD).toBe(20_000);
  });

  it("fails closed when the order is not due yet", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db, { expiresAtTurn: 60 });

    await expect(
      applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId))
    ).rejects.toThrow(`${FOREX_EXPIRE_UNAVAILABLE}:not-due`);
    expect(orderDoc(db, orderId).status).toBe("partial");
    expect(personalOf(db, makerId).USD).toBe(20_000);
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("failed");
  });

  it("treats a missing expiry turn as not due when the driver passes a turn", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db, { expiresAtTurn: undefined });

    await expect(
      applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId))
    ).rejects.toThrow(`${FOREX_EXPIRE_UNAVAILABLE}:not-due`);
    expect(orderDoc(db, orderId).status).toBe("partial");
    expect(personalOf(db, makerId).USD).toBe(20_000);
  });

  it("expires malformed remainders without minting funds", async () => {
    const db = freshDb();
    const nanId = seedExpireOrder(db, { amount: Number.NaN });
    const nanResult = await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, nanId));
    expect(nanResult).toMatchObject({ orderStatus: "expired", refundedAmount: 0 });

    const overId = seedExpireOrder(db, { filledAmount: 1500 });
    const overResult = await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, overId));
    expect(overResult).toMatchObject({ orderStatus: "expired", refundedAmount: 0 });

    expect(personalOf(db, makerId).USD).toBe(20_000);
  });

  it("completes with zero refund on an empty remainder", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db, { filledAmount: 1000 });

    const result = await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));

    expect(result).toMatchObject({
      duplicate: false,
      refundedAmount: 0,
      orderStatus: "expired",
      transitionApplied: true,
    });
    expect(personalOf(db, makerId).USD).toBe(20_000);
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("completed");
  });

  it("rejects a key reused with a different fingerprint", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db);
    await applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId));

    await expect(
      applyForexExpireSpend(
        db as unknown as Db,
        expireInputFor(db, orderId, { fingerprint: "forex-expire:something-else" })
      )
    ).rejects.toThrow(MoneyFlowKeyConflictError);
    expect(personalOf(db, makerId).USD).toBe(20_800);
  });

  it("fails closed on a same-key retry after a terminal settlement", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db, { status: "expired" });
    const key = forexExpireKey(orderId);
    const input = expireInputFor(db, orderId);
    const receipts = db.collection(
      NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION
    ) as unknown as Collection<MoneyFlowReceipt>;
    // The terminal setup must claim under the input's real fingerprint: a
    // mismatched fingerprint throws key-conflict before the terminal status
    // is ever consulted, which would test the wrong failure.
    expect(await claimMoneyFlowReceipt(receipts, key, input.fingerprint)).toBe("fresh");
    await failMoneyFlowReceipt(receipts, key, `${FOREX_EXPIRE_UNAVAILABLE}:guard-rejected`);

    await expect(applyForexExpireSpend(db as unknown as Db, input)).rejects.toThrow(
      MoneyFlowTerminalError
    );
    expect(personalOf(db, makerId).USD).toBe(20_000);
  });

  it("resumes a crashed attempt by key without a live input", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db);
    db.crashAfterWrites = 2;
    await expect(
      applyForexExpireSpend(db as unknown as Db, expireInputFor(db, orderId))
    ).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const resumed = await resumeForexExpireByKey(db as unknown as Db, forexExpireKey(orderId));

    expect(resumed).toMatchObject({
      duplicate: true,
      refundedAmount: 800,
      refundedCurrency: "USD",
      orderStatus: "expired",
      orderId,
    });
    expect(personalOf(db, makerId).USD).toBe(20_800);
    expect(receipt(db, forexExpireKey(orderId)).status).toBe("completed");
    expect(await resumeForexExpireByKey(db as unknown as Db, "unrelated-key")).toBeNull();
    expect(await resumeForexExpireByKey(db as unknown as Db, forexExpireKey(orderId))).toBeNull();
  });

  it("resume fails closed on terminal receipts", async () => {
    const db = freshDb();
    const orderId = seedExpireOrder(db, { status: "expired" });
    const key = forexExpireKey(orderId);
    const receipts = db.collection(
      NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION
    ) as unknown as Collection<MoneyFlowReceipt>;
    expect(await claimMoneyFlowReceipt(receipts, key, forexExpireFingerprint(orderId))).toBe(
      "fresh"
    );
    await failMoneyFlowReceipt(receipts, key, `${FOREX_EXPIRE_UNAVAILABLE}:guard-rejected`);

    await expect(resumeForexExpireByKey(db as unknown as Db, key)).rejects.toThrow(
      MoneyFlowTerminalError
    );
  });
});

// ── Intervention command ────────────────────────────────────────────────────

const interventionChairId = new ObjectId();
const interventionSetById = new ObjectId();
const INTERVENTION_BANK = "US";
const INTERVENTION_TURN = 50;

function baseInterventionPolicy(): Record<string, unknown> {
  return {
    floor: 0.95,
    ceiling: 1.05,
    setByCharacterId: interventionSetById,
    setByCharacterName: "Prior Chair",
    setAtTurn: 40,
    lastAdjustedAtTurn: 40,
    recentInterventions: [],
  };
}

function seedIntervention(
  db: FakeDb,
  opts: { bank?: Record<string, unknown>; rate?: Record<string, unknown>; seedBank?: boolean } = {}
): void {
  if (opts.seedBank !== false) {
    db.collection("centralBanks").docs.set(INTERVENTION_BANK, {
      _id: INTERVENTION_BANK,
      forexRevenue: 0,
      reserveBalance: 0,
      spreadFeeReserveBalances: { GBP: 750_000 },
      chairInfamy: 0,
      appliedMoneyFlowKeys: [],
      ...opts.bank,
    });
  }
  db.collection("exchangeRates").docs.set("US", {
    _id: "US",
    rate: 1.15,
    macroTarget: 1.16,
    baseRate: 1.0,
    rateHistory: [{ turn: 49, rate: 1.14 }],
    buyVolume24: 0,
    sellVolume24: 0,
    cyclePressureRegime: "steady",
    cyclePressureUntilTurn: 62,
    interventionPolicy: baseInterventionPolicy(),
    updatedAt: now,
    appliedMoneyFlowKeys: [],
    ...opts.rate,
  });
}

function interventionInput(db: FakeDb): ForexInterventionInput {
  const bankDoc = db.collection("centralBanks").docs.get(INTERVENTION_BANK) ?? {};
  const nextPolicy = {
    ...baseInterventionPolicy(),
    recentInterventions: [
      {
        turn: INTERVENTION_TURN,
        direction: "buy" as const,
        reservesSpent: 750_000,
        fundingSource: "spreadFeeReserves" as const,
        resultingRate: 1.12,
      },
    ],
  };
  return {
    countryId: "US",
    bankId: INTERVENTION_BANK,
    turn: INTERVENTION_TURN,
    fingerprint: forexInterventionFingerprint(INTERVENTION_TURN, "US"),
    idempotencyKey: forexInterventionKey(INTERVENTION_TURN, "US"),
    outcome: {
      rate: 1.12,
      macroTarget: 1.1,
      record: {
        turn: INTERVENTION_TURN,
        direction: "buy",
        reservesSpent: 750_000,
        fundingSource: "spreadFeeReserves",
        resultingRate: 1.12,
      },
      forexRevenueDelta: 0,
      reserveBalanceDelta: 0,
      spreadFeeReserveDeltas: { GBP: -750_000, USD: 840_000 },
      infamyCharged: false,
      chairCharacterIdHex: interventionChairId.toHexString(),
    },
    rateSet: {
      rate: 1.12,
      macroTarget: 1.1,
      rateHistory: [
        { turn: 49, rate: 1.14 },
        { turn: INTERVENTION_TURN, rate: 1.12 },
      ],
      buyVolume24: 0,
      sellVolume24: 0,
      cyclePressureRegime: "steady",
      cyclePressureUntilTurn: 62,
      interventionPolicy: nextPolicy,
      updatedAt: now,
    },
    prior: {
      rate: 1.15,
      macroTarget: 1.16,
      buyVolume24: 0,
      sellVolume24: 0,
      cyclePressureRegime: "steady",
      cyclePressureUntilTurn: 62,
      policy: baseInterventionPolicy() as unknown as ForexInterventionInput["prior"]["policy"],
      hardPeg: null,
      updatedAtIso: now.toISOString(),
      chairInfamy: Number(bankDoc.chairInfamy ?? 0),
    },
  };
}

function interventionRateDoc(db: FakeDb): Record<string, unknown> {
  const doc = db.collection("exchangeRates").docs.get("US");
  if (!doc) throw new Error("missing US exchange rate");
  return doc;
}

function interventionBankDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("centralBanks").docs.get(INTERVENTION_BANK) ?? {};
}

function interventionKey(): string {
  return forexInterventionKey(INTERVENTION_TURN, "US");
}

describe("applyForexInterventionSpend", () => {
  it("applies a buy intervention exactly once across rate, reserves, and policy", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);

    const result = await applyForexInterventionSpend(db as unknown as Db, input);

    expect(result).toMatchObject({
      duplicate: false,
      completedNow: true,
      outcome: "applied",
      rate: 1.12,
      macroTarget: 1.1,
      infamyCharged: false,
    });
    expect(result.record).toMatchObject({ direction: "buy", fundingSource: "spreadFeeReserves" });
    // Reserve draw: foreign spread reserves spent, home leg credited.
    expect(interventionBankDoc(db)).toMatchObject({
      forexRevenue: 0,
      reserveBalance: 0,
      spreadFeeReserveBalances: { GBP: 0, USD: 840_000 },
      chairInfamy: 0,
    });
    // Rate writeback: new rate, one appended snapshot, one audit record.
    const rate = interventionRateDoc(db);
    expect(rate.rate).toBe(1.12);
    expect(rate.rateHistory).toEqual([
      { turn: 49, rate: 1.14 },
      { turn: INTERVENTION_TURN, rate: 1.12 },
    ]);
    const policy = rate.interventionPolicy as { recentInterventions: unknown[] };
    expect(policy.recentInterventions).toHaveLength(1);
    expect(receipt(db, interventionKey()).status).toBe("completed");
  });

  it("draws mixed sell funding (home spread, forexRevenue, reserveBalance) in one bank write", async () => {
    const db = new FakeDb();
    seedIntervention(db, {
      bank: { forexRevenue: 50, reserveBalance: 10_000, spreadFeeReserveBalances: { USD: 50 } },
    });
    const input = interventionInput(db);
    input.outcome = {
      rate: 0.9,
      macroTarget: 0.92,
      record: {
        turn: INTERVENTION_TURN,
        direction: "sell",
        reservesSpent: 200,
        fundingSource: "mixed",
        resultingRate: 0.9,
      },
      forexRevenueDelta: -50,
      reserveBalanceDelta: -100,
      spreadFeeReserveDeltas: { USD: -50, GBP: 150 },
      infamyCharged: false,
      chairCharacterIdHex: interventionChairId.toHexString(),
    };

    const bankUpdates: unknown[] = [];
    const banks = db.collection("centralBanks");
    const realUpdate = banks.updateOne.bind(banks);
    banks.updateOne = (async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      bankUpdates.push(update);
      return realUpdate(filter, update);
    }) as typeof banks.updateOne;

    const result = await applyForexInterventionSpend(db as unknown as Db, input);

    expect(result.outcome).toBe("applied");
    expect(interventionBankDoc(db)).toMatchObject({
      forexRevenue: 0,
      reserveBalance: 9_900,
      spreadFeeReserveBalances: { USD: 0, GBP: 150 },
    });
    // One $inc (the legacy single-update shape), not one write per slice.
    const incUpdates = bankUpdates.filter(
      (update) => (update as { $inc?: unknown }).$inc !== undefined
    );
    expect(incUpdates).toHaveLength(1);
    expect(receipt(db, interventionKey()).status).toBe("completed");
  });

  it("keys an infamy-only outcome with no reserve slices", async () => {
    const db = new FakeDb();
    seedIntervention(db, { bank: { spreadFeeReserveBalances: {} } });
    const input = interventionInput(db);
    input.outcome = {
      rate: 1.15,
      macroTarget: 1.16,
      record: null,
      forexRevenueDelta: 0,
      reserveBalanceDelta: 0,
      spreadFeeReserveDeltas: {},
      infamyCharged: true,
      chairCharacterIdHex: interventionChairId.toHexString(),
    };

    const result = await applyForexInterventionSpend(db as unknown as Db, input);

    expect(result).toMatchObject({
      outcome: "applied",
      completedNow: true,
      infamyCharged: true,
      chairCharacterIdHex: interventionChairId.toHexString(),
    });
    expect(interventionBankDoc(db)).toMatchObject({
      forexRevenue: 0,
      reserveBalance: 0,
      chairInfamy: 15,
    });
    expect(receipt(db, interventionKey()).status).toBe("completed");
  });

  it("stays writeless on a null outcome (no receipt, no writes)", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    input.outcome = null;

    const result = await applyForexInterventionSpend(db as unknown as Db, input);

    expect(result).toMatchObject({ duplicate: false, completedNow: false, outcome: "noop" });
    expect(db.writeCount).toBe(0);
    expect(
      db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.has(interventionKey())
    ).toBe(false);
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({ GBP: 750_000 });
  });

  it("stays writeless on a record-less chargeless outcome", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    input.outcome!.record = null;

    const result = await applyForexInterventionSpend(db as unknown as Db, input);

    expect(result.outcome).toBe("noop");
    expect(db.writeCount).toBe(0);
    expect(
      db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.has(interventionKey())
    ).toBe(false);
  });

  it.each([1, 2, 3, 4])(
    "converges exactly once after a crash following write %i",
    async (after) => {
      const db = new FakeDb();
      seedIntervention(db);
      const input = interventionInput(db);
      // Writes: 1 claim insert + 1 plan store + 1 rate write + 1 bank ensure +
      // 1 bank write. Crashing after any prefix must converge on retry.
      db.crashAfterWrites = after;
      await expect(applyForexInterventionSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );
      expect(receipt(db, interventionKey()).status).toBe("in_progress");

      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const retry = await applyForexInterventionSpend(db as unknown as Db, input);

      expect(retry).toMatchObject({ duplicate: true, completedNow: true, outcome: "applied" });
      expect(interventionBankDoc(db)).toMatchObject({
        spreadFeeReserveBalances: { GBP: 0, USD: 840_000 },
      });
      expect(interventionRateDoc(db).rate).toBe(1.12);
      expect(interventionRateDoc(db).rateHistory).toEqual([
        { turn: 49, rate: 1.14 },
        { turn: INTERVENTION_TURN, rate: 1.12 },
      ]);
      const policy = interventionRateDoc(db).interventionPolicy as {
        recentInterventions: unknown[];
      };
      expect(policy.recentInterventions).toHaveLength(1);
      expect(receipt(db, interventionKey()).status).toBe("completed");
    }
  );

  it("reconciles a same-key retry through the stored plan, not the live recompute", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    // Crash after the plan store: nothing applied, plan durable.
    db.crashAfterWrites = 2;
    await expect(applyForexInterventionSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    // The retry recomputes with fresh jitter — drifted rate, doubled deltas.
    // The stored plan must win, or reserves double-draw.
    const drifted = interventionInput(db);
    drifted.outcome!.rate = 9.99;
    drifted.outcome!.spreadFeeReserveDeltas = { GBP: -1_500_000, USD: 1_680_000 };
    const retry = await applyForexInterventionSpend(db as unknown as Db, drifted);

    expect(retry).toMatchObject({ duplicate: true, rate: 1.12 });
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({
      GBP: 0,
      USD: 840_000,
    });
    expect(interventionRateDoc(db).rate).toBe(1.12);
  });

  it("converges two concurrent workers on a single draw", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);

    const [first, second] = await Promise.all([
      applyForexInterventionSpend(db as unknown as Db, input),
      applyForexInterventionSpend(db as unknown as Db, { ...input }),
    ]);

    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("applied");
    // One draw, one snapshot, one audit record — never two.
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({
      GBP: 0,
      USD: 840_000,
    });
    expect(interventionRateDoc(db).rateHistory).toEqual([
      { turn: 49, rate: 1.14 },
      { turn: INTERVENTION_TURN, rate: 1.12 },
    ]);
    expect(
      (interventionRateDoc(db).interventionPolicy as { recentInterventions: unknown[] })
        .recentInterventions
    ).toHaveLength(1);
    expect(receipt(db, interventionKey()).status).toBe("completed");
  });

  it("recreates a deleted bank document before drawing (legacy upsert parity)", async () => {
    const db = new FakeDb();
    seedIntervention(db, { seedBank: false });
    const input = interventionInput(db);

    const result = await applyForexInterventionSpend(db as unknown as Db, input);

    expect(result.outcome).toBe("applied");
    // Legacy-upsert parity: only the drawn slices exist on the recreated row
    // (undrawn pools stay absent, exactly as `$inc` + `upsert: true` left them).
    expect(interventionBankDoc(db)).toMatchObject({
      spreadFeeReserveBalances: { GBP: -750_000, USD: 840_000 },
    });
    expect(interventionBankDoc(db).forexRevenue).toBeUndefined();
    expect(interventionBankDoc(db).reserveBalance).toBeUndefined();
    expect(receipt(db, interventionKey()).status).toBe("completed");
  });

  it("applies fixed deltas when reserves changed mid-flight", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    // A concurrent spend drains half the foreign reserves before this flow
    // runs: the plan's fixed deltas still apply exactly once (legacy
    // unguarded-$inc parity), they do not re-derive from the new balances.
    interventionBankDoc(db).spreadFeeReserveBalances = { GBP: 375_000 };

    const result = await applyForexInterventionSpend(db as unknown as Db, input);

    expect(result.outcome).toBe("applied");
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({
      GBP: -375_000,
      USD: 840_000,
    });
    expect(receipt(db, interventionKey()).status).toBe("completed");
  });

  it("settles failed when the rate row vanished mid-turn", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    db.collection("exchangeRates").docs.delete("US");

    await expect(applyForexInterventionSpend(db as unknown as Db, input)).rejects.toThrow(
      `${FOREX_INTERVENTION_RATE}:missing`
    );

    // Nothing moved: the bank draw never ran, the receipt holds the sentinel.
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({ GBP: 750_000 });
    const settled = receipt(db, interventionKey());
    expect(settled.status).toBe("failed");
    expect(settled.error).toBe(`${FOREX_INTERVENTION_RATE}:missing`);
  });

  it("compensates the rate write when the bank write rejects, then fails closed", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    const banks = db.collection("centralBanks");
    const realUpdate = banks.updateOne.bind(banks);
    let calls = 0;
    banks.updateOne = (async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      calls += 1;
      // First bank write misses while the document exists: disambiguation
      // reports guard-rejected, so the applied rate prefix must unwind.
      if (calls === 1) return { matchedCount: 0, modifiedCount: 0 };
      return realUpdate(filter, update);
    }) as typeof banks.updateOne;

    await expect(applyForexInterventionSpend(db as unknown as Db, input)).rejects.toThrow(
      FOREX_INTERVENTION_RESERVE
    );

    // The rate row is restored exactly: scalars, policy, and history popped.
    const rate = interventionRateDoc(db);
    expect(rate.rate).toBe(1.15);
    expect(rate.rateHistory).toEqual([{ turn: 49, rate: 1.14 }]);
    expect(rate.interventionPolicy).toMatchObject({ floor: 0.95, recentInterventions: [] });
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({ GBP: 750_000 });
    expect(receipt(db, interventionKey()).status).toBe("compensated");

    // The compensated key stays fail-closed: a new attempt needs a new key.
    banks.updateOne = realUpdate;
    await expect(applyForexInterventionSpend(db as unknown as Db, input)).rejects.toThrow(
      MoneyFlowTerminalError
    );
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({ GBP: 750_000 });
  });

  it("fails closed on a failed receipt", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    const receipts = db.collection(
      NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION
    ) as unknown as Collection<MoneyFlowReceipt>;
    expect(await claimMoneyFlowReceipt(receipts, interventionKey(), input.fingerprint)).toBe(
      "fresh"
    );
    await failMoneyFlowReceipt(receipts, interventionKey(), `${FOREX_INTERVENTION_RATE}:missing`);

    await expect(applyForexInterventionSpend(db as unknown as Db, input)).rejects.toThrow(
      MoneyFlowTerminalError
    );
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({ GBP: 750_000 });
  });

  it("rejects a same-key retry with a different fingerprint", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    await applyForexInterventionSpend(db as unknown as Db, input);

    await expect(
      applyForexInterventionSpend(db as unknown as Db, { ...input, fingerprint: "other-event" })
    ).rejects.toThrow(MoneyFlowKeyConflictError);
    // The conflict attempt moved nothing.
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({
      GBP: 0,
      USD: 840_000,
    });
  });

  it("rejects a conflicting fingerprint on an in-progress attempt", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    db.crashAfterWrites = 2;
    await expect(applyForexInterventionSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    await expect(
      applyForexInterventionSpend(db as unknown as Db, { ...input, fingerprint: "other-event" })
    ).rejects.toThrow(MoneyFlowKeyConflictError);
  });

  it("replays a completed attempt without writing again", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    await applyForexInterventionSpend(db as unknown as Db, input);

    const writesBefore = db.writeCount;
    const replay = await applyForexInterventionSpend(db as unknown as Db, input);

    expect(replay).toMatchObject({
      duplicate: true,
      completedNow: false,
      outcome: "applied",
      rate: 1.12,
      infamyCharged: false,
    });
    expect(replay.record).toMatchObject({ direction: "buy" });
    expect(db.writeCount).toBe(writesBefore);
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({
      GBP: 0,
      USD: 840_000,
    });
  });

  it("throws orphaned when a completed receipt carries no usable plan", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.set(interventionKey(), {
      _id: interventionKey(),
      status: "completed",
      fingerprint: input.fingerprint,
      createdAt: now,
      updatedAt: now,
    });

    await expect(applyForexInterventionSpend(db as unknown as Db, input)).rejects.toThrow(
      FOREX_INTERVENTION_RECEIPT_ORPHANED
    );
  });

  it("resume completes orphans and ignores settled or unrelated keys", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    // Crash after the rate write: reserves not yet drawn.
    db.crashAfterWrites = 3;
    await expect(applyForexInterventionSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    expect(interventionRateDoc(db).rate).toBe(1.12);
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({ GBP: 750_000 });

    const resumed = await resumeForexInterventionByKey(db as unknown as Db, interventionKey());

    expect(resumed).toMatchObject({
      countryId: "US",
      duplicate: true,
      completedNow: true,
      outcome: "applied",
      rate: 1.12,
    });
    expect(interventionBankDoc(db).spreadFeeReserveBalances).toMatchObject({
      GBP: 0,
      USD: 840_000,
    });
    expect(receipt(db, interventionKey()).status).toBe("completed");

    // Settled and unrelated keys have nothing to resume.
    expect(await resumeForexInterventionByKey(db as unknown as Db, interventionKey())).toBeNull();
    expect(
      await resumeForexInterventionByKey(db as unknown as Db, "forex-turn-fill:50:ab")
    ).toBeNull();
    expect(await resumeForexInterventionByKey(db as unknown as Db, "bogus")).toBeNull();
    // A key naming a different event than the stored plan is refused.
    expect(
      await resumeForexInterventionByKey(db as unknown as Db, forexInterventionKey(50, "UK"))
    ).toBeNull();
    await expect(resumeForexInterventionByKey(db as unknown as Db, "")).rejects.toThrow(RangeError);
  });

  it("resume fails closed on terminal receipts", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    const receipts = db.collection(
      NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION
    ) as unknown as Collection<MoneyFlowReceipt>;
    expect(await claimMoneyFlowReceipt(receipts, interventionKey(), input.fingerprint)).toBe(
      "fresh"
    );
    await failMoneyFlowReceipt(receipts, interventionKey(), `${FOREX_INTERVENTION_RESERVE}:x`);

    await expect(
      resumeForexInterventionByKey(db as unknown as Db, interventionKey())
    ).rejects.toThrow(MoneyFlowTerminalError);
  });

  it("keys are stable per event and collision-safe across turn and country", () => {
    expect(forexInterventionKey(50, "US")).toBe("forex-intervention:50:US");
    expect(forexInterventionFingerprint(50, "US")).toBe("forex-intervention:50:US");
    expect(forexInterventionKey(51, "US")).not.toBe(forexInterventionKey(50, "US"));
    expect(forexInterventionKey(50, "UK")).not.toBe(forexInterventionKey(50, "US"));
  });

  it("validates its inputs", async () => {
    const db = new FakeDb();
    seedIntervention(db);
    const input = interventionInput(db);
    await expect(
      applyForexInterventionSpend(db as unknown as Db, { ...input, countryId: "" })
    ).rejects.toThrow(TypeError);
    await expect(
      applyForexInterventionSpend(db as unknown as Db, { ...input, bankId: "" })
    ).rejects.toThrow(TypeError);
    await expect(
      applyForexInterventionSpend(db as unknown as Db, { ...input, turn: Number.NaN })
    ).rejects.toThrow(TypeError);
    await expect(
      resumeForexInterventionByKey(db as unknown as Db, "x".repeat(129))
    ).rejects.toThrow(RangeError);
  });

  it("charges the capped infamy the legacy formula produces", async () => {
    const db = new FakeDb();
    seedIntervention(db, { bank: { chairInfamy: 95, spreadFeeReserveBalances: {} } });
    const input = interventionInput(db);
    input.outcome = {
      rate: 1.15,
      macroTarget: 1.16,
      record: null,
      forexRevenueDelta: 0,
      reserveBalanceDelta: 0,
      spreadFeeReserveDeltas: {},
      infamyCharged: true,
      chairCharacterIdHex: interventionChairId.toHexString(),
    };
    input.prior = { ...input.prior, chairInfamy: 95 };

    const result = await applyForexInterventionSpend(db as unknown as Db, input);

    // min(100, 95 + 15): capped, never hidden over-cap scrutiny.
    expect(result.infamyCharged).toBe(true);
    expect(interventionBankDoc(db).chairInfamy).toBe(100);
  });
});
