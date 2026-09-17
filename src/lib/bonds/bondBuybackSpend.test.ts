import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { applyBondBuybackSpend, BOND_BUYBACK_FLOAT, BOND_BUYBACK_FUNDS } from "./bondBuybackSpend";
import { splitSpreadFee } from "@/lib/currency/spreadFees";
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
// Stateful in-memory fakes honoring exactly the operators the buyback
// primitive emits ($inc incl. dotted lifetime counters, $push+$each+$slice,
// $set/$setOnInsert with upsert; _id equality, $ne-on-keys, $gte guards,
// ObjectId equality, duplicate-key errors on insert), so an injected crash
// between any two writes models a real process death between the
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

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    const actual = getPath(doc, field);
    if (typeof condition === "object" && condition !== null && !(condition instanceof ObjectId)) {
      const ops = condition as Record<string, unknown>;
      if ("$ne" in ops) {
        const keys = doc[field] as string[] | undefined;
        if (keys?.includes(ops.$ne as string)) return false;
        continue;
      }
      if ("$gte" in ops) {
        if (!(typeof actual === "number" && actual >= (ops.$gte as number))) return false;
        continue;
      }
      return false;
    }
    if (!valueEquals(actual, condition)) return false;
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
        return { matchedCount: 0, modifiedCount: 0 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
    if (!matchesFilter(doc, filter)) return { matchedCount: 0, modifiedCount: 0 };

    const inc = (update.$inc ?? {}) as Record<string, number>;
    for (const [field, delta] of Object.entries(inc)) {
      setPath(doc, field, ((getPath(doc, field) as number | undefined) ?? 0) + delta);
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
const corpId = new ObjectId();

function seedDb(db: FakeDb): void {
  db.collection("bonds").docs.set(bondId.toHexString(), {
    _id: bondId,
    matured: false,
    publicFloat: 100,
    totalIssued: 100_000,
    holders: [],
  });
  db.collection("bondMarketPools").docs.set("USD", {
    _id: "USD",
    cashLocal: 1_000_000,
    lifetime: { retiredIn: 0 },
  });
  db.collection("corporations").docs.set(corpId.toHexString(), {
    _id: corpId,
    liquidCapital: 500_000,
  });
}

function buybackInput(overrides: Record<string, unknown> = {}) {
  return {
    bondId,
    corpId,
    units: 3,
    costLocal: 3060,
    costInCorpCapital: 3060,
    bondCurrency: "USD" as const,
    corpCurrency: "USD" as const,
    spreadFee: 0,
    now: new Date("2026-09-17T00:00:00Z"),
    fingerprint: `bond-buyback:${bondId.toHexString()}:${corpId.toHexString()}:3:3060:3060`,
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

function corpCapital(db: FakeDb): number {
  return db.collection("corporations").docs.get(corpId.toHexString())?.liquidCapital as number;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyBondBuybackSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("retires once: corp pays, float shrinks, pool is credited", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = buybackInput({ idempotencyKey: "buyback-happy" });

    const result = await applyBondBuybackSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(corpCapital(db)).toBe(500_000 - 3060);
    expect(bondDoc(db).publicFloat).toBe(97);
    expect(bondDoc(db).totalIssued).toBe(100_000 - 3000);
    expect(poolCash(db)).toBe(1_000_000 + 3060);
    expect(receipt(db, "buyback-happy").status).toBe("completed");
  });

  it("routes the FX spread to the central banks on a cross-currency buyback", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = buybackInput({
      idempotencyKey: "buyback-spread",
      corpCurrency: "GBP" as const,
      costInCorpCapital: 4080,
      spreadFee: 60,
      fingerprint: `bond-buyback:${bondId.toHexString()}:${corpId.toHexString()}:3:3060:4080`,
    });

    const result = await applyBondBuybackSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(corpCapital(db)).toBe(500_000 - 4080);
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

  it("replays the same key without moving money again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = buybackInput({ idempotencyKey: "buyback-replay" });

    await applyBondBuybackSpend(db as unknown as Db, input);
    const replay = await applyBondBuybackSpend(db as unknown as Db, input);

    expect(replay).toEqual({ duplicate: true });
    expect(corpCapital(db)).toBe(500_000 - 3060);
    expect(bondDoc(db).publicFloat).toBe(97);
    expect(poolCash(db)).toBe(1_000_000 + 3060);
  });

  it("rejects a key reused for a different buyback", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyBondBuybackSpend(
      db as unknown as Db,
      buybackInput({ idempotencyKey: "buyback-conflict" })
    );

    await expect(
      applyBondBuybackSpend(
        db as unknown as Db,
        buybackInput({
          idempotencyKey: "buyback-conflict",
          units: 2,
          fingerprint: "bond-buyback:other",
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(corpCapital(db)).toBe(500_000 - 3060);
  });

  it("fails closed on a settled terminal key: a retry needs a new key", async () => {
    const db = new FakeDb();
    seedDb(db);
    // Starve the corp so the first attempt settles failed with nothing applied.
    db.collection("corporations").docs.get(corpId.toHexString())!.liquidCapital = 10;
    const input = buybackInput({ idempotencyKey: "buyback-terminal" });

    await expect(applyBondBuybackSpend(db as unknown as Db, input)).rejects.toThrow(
      BOND_BUYBACK_FUNDS
    );
    expect(receipt(db, "buyback-terminal").status).toBe("failed");
    await expect(applyBondBuybackSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(corpCapital(db)).toBe(10);
    expect(bondDoc(db).publicFloat).toBe(100);
  });

  it("compensates the corp debit when the float claim loses the race", async () => {
    const db = new FakeDb();
    seedDb(db);
    bondDoc(db).publicFloat = 1;

    await expect(
      applyBondBuybackSpend(db as unknown as Db, buybackInput({ idempotencyKey: "buyback-race" }))
    ).rejects.toThrow(`${BOND_BUYBACK_FLOAT}:guard-rejected`);
    expect(receipt(db, "buyback-race").status).toBe("compensated");
    // Full reversal: corp refunded, float and pool untouched.
    expect(corpCapital(db)).toBe(500_000);
    expect(bondDoc(db).publicFloat).toBe(1);
    expect(poolCash(db)).toBe(1_000_000);
  });

  it("converges after a crash between the float claim and the pool credit", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = buybackInput({ idempotencyKey: "buyback-crash" });
    // Writes: pool shell, receipt insert, corp debit, float claim, pool
    // credit. Crash after the fourth (claim landed, credit never ran).
    db.crashAfterWrites = 4;

    await expect(applyBondBuybackSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const recovery = await applyBondBuybackSpend(db as unknown as Db, input);
    expect(recovery).toEqual({ duplicate: true });
    expect(corpCapital(db)).toBe(500_000 - 3060);
    expect(bondDoc(db).publicFloat).toBe(97);
    expect(bondDoc(db).totalIssued).toBe(100_000 - 3000);
    expect(poolCash(db)).toBe(1_000_000 + 3060);
    expect(receipt(db, "buyback-crash").status).toBe("completed");
  });
});
