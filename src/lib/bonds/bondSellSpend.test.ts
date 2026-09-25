import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyBondSellSpend,
  BOND_SELL_INSUFFICIENT,
  BOND_SELL_PAYOUT_MISSING,
  BOND_SELL_POOL_DEPTH,
} from "./bondSellSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";

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
// Stateful in-memory fakes. They honor exactly the operators the money-flow
// primitive emits ($inc incl. the positional `holders.$.units`, $push+$each+
// $slice, $set; _id equality, $ne-on-keys, $gte guards, $elemMatch holder
// claims, ObjectId equality, duplicate-key errors on insert), so an injected
// crash between any two writes models a real process death between the
// corresponding sequential Mongo writes.
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
  if (actual instanceof ObjectId && typeof expected === "string") {
    return actual.toHexString() === expected;
  }
  if (typeof actual === "string" && expected instanceof ObjectId) {
    return actual === expected.toHexString();
  }
  return actual === expected;
}

function getPath(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], doc);
}

/** All candidate values for a dotted path, fanning out across arrays (Mongo semantics). */
function collectValues(node: unknown, parts: string[]): unknown[] {
  if (parts.length === 0) return [node];
  if (Array.isArray(node)) return node.flatMap((el) => collectValues(el, parts));
  if (node !== null && typeof node === "object") {
    return collectValues((node as Record<string, unknown>)[parts[0]!], parts.slice(1));
  }
  return [];
}

/**
 * Resolve a positional `array.$.rest` update path against the filter: the
 * `$` is the first array element satisfying the filter's equality condition
 * on that same array (real Mongo derives it from the query match).
 */
function resolvePositional(
  array: string,
  rest: string,
  doc: Record<string, unknown>,
  filter: Record<string, unknown>
): string | null {
  const arr = doc[array];
  if (!Array.isArray(arr)) return null;
  const prefix = `${array}.`;
  const conditions = Object.entries(filter).filter(([field]) => field.startsWith(prefix));
  const index = (arr as Array<Record<string, unknown>>).findIndex((elem) =>
    conditions.every(([field, cond]) => {
      const sub = field.slice(prefix.length);
      if (typeof cond === "object" && cond !== null && !(cond instanceof ObjectId)) return true;
      return valueEquals(collectValues(elem, sub.split("."))[0], cond);
    })
  );
  if (index < 0) return null;
  return `${array}.${index}.${rest}`;
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

function matchesCondition(
  doc: Record<string, unknown>,
  field: string,
  condition: unknown,
  elemIndex?: { array: string; index: number }
): boolean {
  const resolvedField =
    elemIndex && field.startsWith(`${elemIndex.array}.$.`)
      ? `${elemIndex.array}.${elemIndex.index}.${field.slice(elemIndex.array.length + 3)}`
      : field;
  if (condition === null || condition === undefined) {
    return collectValues(doc, resolvedField.split(".")).some((value) => value == null);
  }
  if (typeof condition !== "object" || condition instanceof ObjectId) {
    return collectValues(doc, resolvedField.split(".")).some((value) =>
      valueEquals(value, condition)
    );
  }
  const ops = condition as Record<string, unknown>;
  if ("$ne" in ops) {
    const keys = doc[field] as string[] | undefined;
    if (keys?.includes(ops.$ne as string)) return false;
    return true;
  }
  if ("$gte" in ops) {
    return collectValues(doc, resolvedField.split(".")).some(
      (value) => ((value as number | undefined) ?? Number.NEGATIVE_INFINITY) >= (ops.$gte as number)
    );
  }
  if ("$elemMatch" in ops) {
    const arr = getPath(doc, field) as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(arr)) return false;
    const sub = ops.$elemMatch as Record<string, unknown>;
    const index = arr.findIndex((elem) =>
      Object.entries(sub).every(([subField, subCond]) =>
        matchesCondition(elem as Record<string, unknown>, subField, subCond)
      )
    );
    if (index < 0) return false;
    if (elemIndex) {
      elemIndex.array = field;
      elemIndex.index = index;
    }
    return true;
  }
  return false;
}

function matchesFlowFilter(
  doc: Record<string, unknown>,
  filter: Record<string, unknown>
): {
  matched: boolean;
  elemIndex?: { array: string; index: number };
} {
  const elemIndex = { array: "", index: -1 };
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    if (!matchesCondition(doc, field, condition, elemIndex)) return { matched: false };
  }
  return { matched: true, elemIndex: elemIndex.index >= 0 ? elemIndex : undefined };
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
    this.docs.set(key, structuredClone(doc));
    return { insertedId: doc._id };
  }

  async findOne(
    filter: Record<string, unknown>,
    opts?: { projection?: Record<string, unknown> }
  ): Promise<Record<string, unknown> | null> {
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return null;
    if (!opts?.projection) return structuredClone(doc);
    const out: Record<string, unknown> = { _id: doc._id };
    for (const field of Object.keys(opts.projection)) {
      if (field !== "_id") out[field] = structuredClone(doc[field]);
    }
    return out;
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    const { matched, elemIndex } = matchesFlowFilter(doc, filter);
    if (!matched) return { matchedCount: 0, modifiedCount: 0 };

    const inc = (update.$inc ?? {}) as Record<string, number>;
    for (const [field, delta] of Object.entries(inc)) {
      let resolved = field;
      const positional = /^(.+)\.\$\.(.+)$/.exec(field);
      if (positional) {
        const [, array, rest] = positional as unknown as [string, string, string];
        if (elemIndex && elemIndex.array === array) {
          resolved = `${array}.${elemIndex.index}.${rest}`;
        } else {
          const viaFilter = resolvePositional(array, rest, doc, filter);
          if (!viaFilter) return { matchedCount: 0, modifiedCount: 0 };
          resolved = viaFilter;
        }
      }
      setPath(doc, resolved, ((getPath(doc, resolved) as number | undefined) ?? 0) + delta);
    }
    const push = (update.$push ?? {}) as Record<string, { $each: unknown[]; $slice: number }>;
    for (const [field, spec] of Object.entries(push)) {
      const current = (doc[field] as unknown[] | undefined) ?? [];
      const next = [...current, ...spec.$each];
      doc[field] = spec.$slice < 0 ? next.slice(spec.$slice) : next;
    }
    const set = (update.$set ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(set)) {
      setPath(doc, field, value);
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

const bondId = new ObjectId();
const characterId = new ObjectId();
const corpId = new ObjectId();

function seedDb(db: FakeDb): void {
  db.collection("bonds").docs.set(bondId.toHexString(), {
    _id: bondId,
    defaulted: false,
    marketPrice: 1,
    currencyCode: "USD",
    publicFloat: 100,
    holders: [{ characterId, units: 5 }],
  });
  db.collection("bondMarketPools").docs.set("USD", {
    _id: "USD",
    cashLocal: 1_000_000,
    lifetime: { salesOut: 0 },
  });
  db.collection("characters").docs.set(characterId.toHexString(), {
    _id: characterId,
    cashOnHand: 100,
  });
  db.collection("corporations").docs.set(corpId.toHexString(), {
    _id: corpId,
    liquidCapital: 50_000,
  });
}

function sellInput(overrides: Record<string, unknown> = {}) {
  return {
    bondId,
    sellerKind: "character" as const,
    sellerId: characterId,
    units: 3,
    proceedsLocal: 2940,
    payoutAmount: 2940,
    bondCurrency: "USD" as const,
    forexEnabled: false,
    now: new Date("2026-09-17T00:00:00Z"),
    fingerprint: `bond-sell:${bondId.toHexString()}:character:${characterId.toHexString()}:3:2940`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function bondDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("bonds").docs.get(bondId.toHexString())!;
}

function holderUnits(db: FakeDb): number {
  const holders = bondDoc(db).holders as Array<{ units: number }>;
  return holders.reduce((sum, h) => sum + h.units, 0);
}

function poolCash(db: FakeDb): number {
  return db.collection("bondMarketPools").docs.get("USD")?.cashLocal as number;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyBondSellSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("sells once: holder units drop, float rises, pool pays, seller is credited", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = sellInput({ idempotencyKey: "sell-happy" });

    const result = await applyBondSellSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(holderUnits(db)).toBe(2);
    expect(bondDoc(db).publicFloat).toBe(103);
    expect(poolCash(db)).toBe(1_000_000 - 2940);
    expect(db.collection("characters").docs.get(characterId.toHexString())?.cashOnHand).toBe(
      100 + 2940
    );
    expect(receipt(db, "sell-happy").status).toBe("completed");
  });

  it("replays the same key without moving money again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = sellInput({ idempotencyKey: "sell-replay" });

    await applyBondSellSpend(db as unknown as Db, input);
    const replay = await applyBondSellSpend(db as unknown as Db, input);

    expect(replay).toEqual({ duplicate: true });
    expect(holderUnits(db)).toBe(2);
    expect(poolCash(db)).toBe(1_000_000 - 2940);
    expect(db.collection("characters").docs.get(characterId.toHexString())?.cashOnHand).toBe(
      100 + 2940
    );
  });

  it("rejects a key reused for a different sale", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyBondSellSpend(db as unknown as Db, sellInput({ idempotencyKey: "sell-conflict" }));

    await expect(
      applyBondSellSpend(
        db as unknown as Db,
        sellInput({ idempotencyKey: "sell-conflict", units: 2, fingerprint: "bond-sell:other" })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    // The first sale still applied exactly once.
    expect(holderUnits(db)).toBe(2);
  });

  it("fails closed on a settled terminal key: a retry needs a new key", async () => {
    const db = new FakeDb();
    seedDb(db);
    // Empty the pool so the first attempt settles compensated (claim reverted).
    db.collection("bondMarketPools").docs.get("USD")!.cashLocal = 10;
    const input = sellInput({ idempotencyKey: "sell-terminal" });

    await expect(applyBondSellSpend(db as unknown as Db, input)).rejects.toThrow(
      BOND_SELL_POOL_DEPTH
    );
    expect(receipt(db, "sell-terminal").status).toBe("compensated");
    await expect(applyBondSellSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    // Compensated means no net effect: holder kept the units, pool kept cash.
    expect(holderUnits(db)).toBe(5);
    expect(poolCash(db)).toBe(10);
  });

  it("rejects a lost holder race without touching the pool or the seller", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyBondSellSpend(db as unknown as Db, sellInput({ idempotencyKey: "sell-race", units: 50 }))
    ).rejects.toThrow(`${BOND_SELL_INSUFFICIENT}:guard-rejected`);
    expect(receipt(db, "sell-race").status).toBe("failed");
    expect(holderUnits(db)).toBe(5);
    expect(poolCash(db)).toBe(1_000_000);
  });

  it("compensates claim + pool when the seller row is gone", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("characters").docs.delete(characterId.toHexString());

    await expect(
      applyBondSellSpend(db as unknown as Db, sellInput({ idempotencyKey: "sell-missing" }))
    ).rejects.toThrow(`${BOND_SELL_PAYOUT_MISSING}:missing`);
    expect(receipt(db, "sell-missing").status).toBe("compensated");
    // Full reversal: holder restored, pool refunded.
    expect(holderUnits(db)).toBe(5);
    expect(bondDoc(db).publicFloat).toBe(100);
    expect(poolCash(db)).toBe(1_000_000);
  });

  it("converges after a crash between the pool debit and the payout", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = sellInput({ idempotencyKey: "sell-crash" });
    // Receipt insert (1) + holder claim write + disambiguation-free apply path:
    // writes are receipt insert, claim update, pool update, payout update.
    // Crash after the third write (pool debit landed, payout never ran).
    db.crashAfterWrites = 3;

    await expect(applyBondSellSpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const recovery = await applyBondSellSpend(db as unknown as Db, input);
    expect(recovery).toEqual({ duplicate: true });
    expect(holderUnits(db)).toBe(2);
    expect(bondDoc(db).publicFloat).toBe(103);
    expect(poolCash(db)).toBe(1_000_000 - 2940);
    expect(db.collection("characters").docs.get(characterId.toHexString())?.cashOnHand).toBe(
      100 + 2940
    );
    expect(receipt(db, "sell-crash").status).toBe("completed");
  });

  it("converges after a crash right after the holder claim", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = sellInput({ idempotencyKey: "sell-crash-claim" });
    // Writes are receipt insert (1), holder claim (2), pool debit (3),
    // payout (4). Crash after the second write: the claim landed, the pool
    // debit and payout never ran.
    db.crashAfterWrites = 2;

    await expect(applyBondSellSpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const recovery = await applyBondSellSpend(db as unknown as Db, input);
    expect(recovery).toEqual({ duplicate: true });
    expect(holderUnits(db)).toBe(2);
    expect(bondDoc(db).publicFloat).toBe(103);
    expect(poolCash(db)).toBe(1_000_000 - 2940);
    expect(db.collection("characters").docs.get(characterId.toHexString())?.cashOnHand).toBe(
      100 + 2940
    );
    expect(receipt(db, "sell-crash-claim").status).toBe("completed");
  });

  it("converges after a crash after the payout before the receipt settles", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = sellInput({ idempotencyKey: "sell-crash-payout" });
    // Crash on the fifth write (receipt settle to completed): every money
    // leg already landed, so the retry verifies each leg and settles.
    db.crashAfterWrites = 4;

    await expect(applyBondSellSpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const recovery = await applyBondSellSpend(db as unknown as Db, input);
    expect(recovery).toEqual({ duplicate: true });
    expect(holderUnits(db)).toBe(2);
    expect(bondDoc(db).publicFloat).toBe(103);
    expect(poolCash(db)).toBe(1_000_000 - 2940);
    expect(db.collection("characters").docs.get(characterId.toHexString())?.cashOnHand).toBe(
      100 + 2940
    );
    expect(receipt(db, "sell-crash-payout").status).toBe("completed");
  });

  it("pays a corporation seller in liquid capital", async () => {
    const db = new FakeDb();
    seedDb(db);
    bondDoc(db).holders = [{ corporationId: corpId, units: 5 }];
    const input = sellInput({
      idempotencyKey: "sell-corp",
      sellerKind: "corporation" as const,
      sellerId: corpId,
      payoutAmount: 3000,
      fingerprint: `bond-sell:${bondId.toHexString()}:corporation:${corpId.toHexString()}:3:2940`,
    });

    const result = await applyBondSellSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(holderUnits(db)).toBe(2);
    expect(poolCash(db)).toBe(1_000_000 - 2940);
    expect(db.collection("corporations").docs.get(corpId.toHexString())?.liquidCapital).toBe(
      50_000 + 3000
    );
  });
});
