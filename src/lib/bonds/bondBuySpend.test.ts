import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyBondBuySpend,
  BOND_BUY_FUNDS,
  BOND_BUY_RESERVE,
  type BondBuySpendInput,
} from "./bondBuySpend";
import { splitSpreadFee } from "@/lib/currency/spreadFees";
import {
  MoneyFlowKeyConflictError,
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
// primitive emits ($inc incl. the positional `holders.$.units`, $push with
// both $each+$slice key records and raw holder-row pushes, $set/$setOnInsert
// with upsert for the pool shell; _id equality, $ne-on-keys, $gte guards,
// dotted holder-path equality, $not+$elemMatch push guards, ObjectId
// equality, duplicate-key errors on insert), so an injected crash between any
// two writes models a real process death between the corresponding sequential
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

type ElemIndex = { array: string; index: number };

function matchesCondition(
  doc: Record<string, unknown>,
  field: string,
  condition: unknown,
  elemIndex?: ElemIndex
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
  if ("$not" in ops) {
    // A negated inner match must not disturb the caller's positional index.
    return !matchesCondition(doc, field, ops.$not, { array: "", index: -1 });
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
  elemIndex?: ElemIndex;
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
    update: Record<string, unknown>,
    opts?: { upsert?: boolean }
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    let doc = this.docs.get(docKey(filter._id));
    if (!doc) {
      if (opts?.upsert) {
        doc = { _id: filter._id };
        const setOnInsert = (update.$setOnInsert ?? {}) as Record<string, unknown>;
        for (const [field, value] of Object.entries(setOnInsert)) setPath(doc, field, value);
        const set = (update.$set ?? {}) as Record<string, unknown>;
        for (const [field, value] of Object.entries(set)) setPath(doc, field, value);
        this.docs.set(docKey(filter._id), doc);
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
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
    const push = (update.$push ?? {}) as Record<string, unknown>;
    for (const [field, spec] of Object.entries(push)) {
      const current = (doc[field] as unknown[] | undefined) ?? [];
      if (spec !== null && typeof spec === "object" && "$each" in spec) {
        const each = (spec as { $each: unknown[] }).$each;
        const next = [...current, ...each];
        const slice = (spec as { $slice?: number }).$slice;
        doc[field] = slice !== undefined && slice < 0 ? next.slice(slice) : next;
      } else {
        // Raw document push (a new holder row): no key-record shape.
        doc[field] = [...current, spec];
      }
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
const imperialId = new ObjectId();
const corpId = new ObjectId();
const nppId = new ObjectId();

function seedDb(db: FakeDb): void {
  db.collection("bonds").docs.set(bondId.toHexString(), {
    _id: bondId,
    matured: false,
    publicFloat: 100,
    holders: [],
  });
  db.collection("bondMarketPools").docs.set("USD", {
    _id: "USD",
    cashLocal: 1_000_000,
    lifetime: { purchasesIn: 0 },
  });
  db.collection("characters").docs.set(characterId.toHexString(), {
    _id: characterId,
    cashOnHand: 100_000,
  });
  db.collection("imperialCharacters").docs.set(imperialId.toHexString(), {
    _id: imperialId,
    currencyBalances: { personal: { USD: 100_000 } },
  });
  db.collection("corporations").docs.set(corpId.toHexString(), {
    _id: corpId,
    liquidCapital: 500_000,
    liquidCurrencyCode: "USD",
  });
  db.collection("npps").docs.set(nppId.toHexString(), {
    _id: nppId,
    nppInvestmentCashAnchor: 500_000,
  });
}

function buyInput(overrides: Partial<BondBuySpendInput> = {}): BondBuySpendInput {
  return {
    bondId,
    buyerKind: "character",
    buyerId: characterId,
    units: 3,
    debitAmount: 3060,
    costLocal: 3060,
    bondCurrency: "USD",
    forexEnabled: false,
    now: new Date("2026-09-17T00:00:00Z"),
    fingerprint: `bond-buy:${bondId.toHexString()}:character:${characterId.toHexString()}:3:3060`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function bondDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("bonds").docs.get(bondId.toHexString())!;
}

function poolCash(db: FakeDb): number {
  return db.collection("bondMarketPools").docs.get("USD")?.cashLocal as number;
}

function characterCash(db: FakeDb): number {
  return db.collection("characters").docs.get(characterId.toHexString())?.cashOnHand as number;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyBondBuySpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("buys once: character pays, holder row pushed, pool credited", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = buyInput({ idempotencyKey: "buy-happy" });

    const result = await applyBondBuySpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(characterCash(db)).toBe(100_000 - 3060);
    expect(bondDoc(db).publicFloat).toBe(97);
    expect(bondDoc(db).holders).toEqual([{ characterId, units: 3 }]);
    expect(poolCash(db)).toBe(1_000_000 + 3060);
    expect(receipt(db, "buy-happy").status).toBe("completed");
  });

  it("adds to an existing holder row instead of pushing", async () => {
    const db = new FakeDb();
    seedDb(db);
    bondDoc(db).holders = [{ characterId, units: 5 }];

    await applyBondBuySpend(db as unknown as Db, buyInput({ idempotencyKey: "buy-existing" }));

    expect(bondDoc(db).holders).toEqual([{ characterId, units: 8 }]);
    expect(bondDoc(db).publicFloat).toBe(97);
    expect(characterCash(db)).toBe(100_000 - 3060);
  });

  it("debits the forex personal balance for imperial buyers when enabled", async () => {
    const db = new FakeDb();
    seedDb(db);

    await applyBondBuySpend(
      db as unknown as Db,
      buyInput({
        idempotencyKey: "buy-imperial",
        buyerKind: "imperial",
        buyerId: imperialId,
        fingerprint: `bond-buy:${bondId.toHexString()}:imperial:${imperialId.toHexString()}:3:3060`,
        forexEnabled: true,
      })
    );

    const imperial = db.collection("imperialCharacters").docs.get(imperialId.toHexString())!;
    expect(
      (imperial.currencyBalances as Record<string, Record<string, number>>).personal?.USD
    ).toBe(100_000 - 3060);
    expect(bondDoc(db).holders).toEqual([{ imperialCharacterId: imperialId, units: 3 }]);
  });

  it("routes the corp FX spread inside the flow on a cross-currency buy", async () => {
    const db = new FakeDb();
    seedDb(db);

    const result = await applyBondBuySpend(
      db as unknown as Db,
      buyInput({
        idempotencyKey: "buy-spread",
        buyerKind: "corporation",
        buyerId: corpId,
        debitAmount: 4080,
        corpCurrency: "GBP",
        spreadFee: 60,
        fingerprint: `bond-buy:${bondId.toHexString()}:corporation:${corpId.toHexString()}:3:3060:4080`,
      })
    );

    expect(result).toEqual({ duplicate: false });
    expect(db.collection("corporations").docs.get(corpId.toHexString())?.liquidCapital).toBe(
      500_000 - 4080
    );
    expect(poolCash(db)).toBe(1_000_000 + 3060);
    const { toReserveBalance, toForexRevenue } = splitSpreadFee(60);
    const banks = db.collection("centralBanks").docs;
    const gbBank = [...banks.values()].find(
      (doc) => (doc.forexRevenue as number | undefined) === toForexRevenue
    );
    expect(gbBank).toBeDefined();
    const reserveHit = [...banks.values()].some(
      (doc) =>
        ((doc.spreadFeeReserveBalances as Record<string, number> | undefined)?.GBP ?? 0) ===
        toReserveBalance
    );
    expect(reserveHit).toBe(true);
  });

  it("debits NPP investment cash and records avg cost on the holder row", async () => {
    const db = new FakeDb();
    seedDb(db);

    await applyBondBuySpend(
      db as unknown as Db,
      buyInput({
        idempotencyKey: "buy-npp",
        buyerKind: "npp",
        buyerId: nppId,
        debitAmount: 2850,
        costLocal: 2850,
        avgCostPerUnit: 950,
        fingerprint: `bond-buy:${bondId.toHexString()}:npp:${nppId.toHexString()}:3:2850`,
      })
    );

    expect(db.collection("npps").docs.get(nppId.toHexString())?.nppInvestmentCashAnchor).toBe(
      500_000 - 2850
    );
    expect(bondDoc(db).holders).toEqual([{ nppId, units: 3, avgCostPerUnit: 950 }]);
  });

  it("replays the same key without moving money again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = buyInput({ idempotencyKey: "buy-replay" });

    await applyBondBuySpend(db as unknown as Db, input);
    const replay = await applyBondBuySpend(db as unknown as Db, input);

    expect(replay).toEqual({ duplicate: true });
    expect(characterCash(db)).toBe(100_000 - 3060);
    expect(bondDoc(db).publicFloat).toBe(97);
    expect(poolCash(db)).toBe(1_000_000 + 3060);
  });

  it("rejects a key reused for a different purchase", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyBondBuySpend(db as unknown as Db, buyInput({ idempotencyKey: "buy-conflict" }));

    await expect(
      applyBondBuySpend(
        db as unknown as Db,
        buyInput({
          idempotencyKey: "buy-conflict",
          units: 5,
          debitAmount: 5100,
          costLocal: 5100,
          fingerprint: `bond-buy:${bondId.toHexString()}:character:${characterId.toHexString()}:5:5100`,
        })
      )
    ).rejects.toThrow(MoneyFlowKeyConflictError);

    // The first purchase stands exactly once; the conflicting retry moved nothing.
    expect(characterCash(db)).toBe(100_000 - 3060);
    expect(bondDoc(db).publicFloat).toBe(97);
  });

  it("fails without effect when funds are insufficient", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("characters").docs.get(characterId.toHexString())!.cashOnHand = 100;

    await expect(
      applyBondBuySpend(db as unknown as Db, buyInput({ idempotencyKey: "buy-poor" }))
    ).rejects.toThrow(new RegExp(`^${BOND_BUY_FUNDS}`));

    expect(receipt(db, "buy-poor").status).toBe("failed");
    expect(characterCash(db)).toBe(100);
    expect(bondDoc(db).publicFloat).toBe(100);
    expect(bondDoc(db).holders).toEqual([]);
    expect(poolCash(db)).toBe(1_000_000);
  });

  it("compensates the debit when the float loses the race", async () => {
    const db = new FakeDb();
    seedDb(db);
    bondDoc(db).publicFloat = 2;

    await expect(
      applyBondBuySpend(db as unknown as Db, buyInput({ idempotencyKey: "buy-race" }))
    ).rejects.toThrow(new RegExp(`^${BOND_BUY_RESERVE}`));

    expect(receipt(db, "buy-race").status).toBe("compensated");
    // The debit landed first, so the compensation refunds it with a
    // compensation key instead of stranding buyer funds.
    expect(characterCash(db)).toBe(100_000);
    expect(bondDoc(db).publicFloat).toBe(2);
    expect(bondDoc(db).holders).toEqual([]);
    expect(poolCash(db)).toBe(1_000_000);
  });

  it("recovers from a crash between reserve and pool credit to exactly one purchase", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = buyInput({ idempotencyKey: "buy-crash" });
    // Writes: 1 pool shell, 2 receipt claim, 3 buyer debit, 4 holder
    // reserve — the 5th (pool credit) throws, stranding debit+reserve.
    db.crashAfterWrites = 4;

    await expect(applyBondBuySpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const recovery = await applyBondBuySpend(db as unknown as Db, input);

    // Resumed from an `in_progress` claim, so the result reports the replay —
    // the economics below are what prove exactly-once.
    expect(recovery).toEqual({ duplicate: true });
    expect(characterCash(db)).toBe(100_000 - 3060);
    expect(bondDoc(db).publicFloat).toBe(97);
    expect(bondDoc(db).holders).toEqual([{ characterId, units: 3 }]);
    expect(poolCash(db)).toBe(1_000_000 + 3060);
    expect(receipt(db, "buy-crash").status).toBe("completed");
  });

  it("rejects empty and overlong keys, bad units, and zero cost", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyBondBuySpend(db as unknown as Db, buyInput({ idempotencyKey: "" }))
    ).rejects.toThrow(RangeError);
    await expect(
      applyBondBuySpend(db as unknown as Db, buyInput({ idempotencyKey: "k".repeat(129) }))
    ).rejects.toThrow(RangeError);
    await expect(applyBondBuySpend(db as unknown as Db, buyInput({ units: 0 }))).rejects.toThrow(
      RangeError
    );
    await expect(
      applyBondBuySpend(
        db as unknown as Db,
        buyInput({ idempotencyKey: "buy-zero", debitAmount: 0, costLocal: 0 })
      )
    ).rejects.toThrow(new RegExp(`^${BOND_BUY_FUNDS}`));
    expect(receipt(db, "buy-zero").status).toBe("failed");
    expect(characterCash(db)).toBe(100_000);
  });
});
