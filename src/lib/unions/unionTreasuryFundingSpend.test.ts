import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyUnionTreasuryFundingSpend,
  UNION_FUND_CREDIT_FAILED,
  UNION_FUND_DEBIT_INSUFFICIENT,
} from "./unionTreasuryFundingSpend";
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
// primitive and the funding steps emit ($inc / $set / $push+$each+$slice
// writes; _id equality, $ne-on-keys, $gte-on-balance guards; duplicate-key
// errors on insert), so an injected crash between any two writes models a
// real process death between the corresponding sequential Mongo writes.
// ---------------------------------------------------------------------------

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

const characterId = new ObjectId();
const unionId = new ObjectId();
const now = new Date("2026-02-01T00:00:00Z");
const CONTRIBUTION = 1_000;

function seedDb(db: FakeDb): void {
  db.collection("characters").docs.set(characterId.toHexString(), {
    _id: characterId,
    funds: 50_000,
    updatedAt: new Date("2026-01-10T00:00:00Z"),
  });
  db.collection("unions").docs.set(unionId.toHexString(), {
    _id: unionId,
    treasury: 250,
    updatedAt: new Date("2026-01-10T00:00:00Z"),
  });
}

function fundInput(overrides: Record<string, unknown> = {}) {
  return {
    characterId,
    unionId,
    campaignFundsField: "funds",
    contribution: CONTRIBUTION,
    now,
    fingerprint: `fund:${characterId.toHexString()}:${unionId.toHexString()}:${CONTRIBUTION}`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function characterDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("characters").docs.get(characterId.toHexString())!;
}

function unionDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("unions").docs.get(unionId.toHexString())!;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    | MoneyFlowReceipt
    | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyUnionTreasuryFundingSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("moves campaign funds into the treasury exactly once", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = fundInput({ idempotencyKey: "fund-happy" });

    const result = await applyUnionTreasuryFundingSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(characterDoc(db).funds).toBe(49_000);
    expect(unionDoc(db).treasury).toBe(1_250);
    expect(receipt(db, "fund-happy").status).toBe("completed");
  });

  it("fails closed with INSUFFICIENT when campaign funds race, crediting nothing", async () => {
    const db = new FakeDb();
    seedDb(db);
    characterDoc(db).funds = 10;
    const input = fundInput({ idempotencyKey: "fund-poor" });

    await expect(applyUnionTreasuryFundingSpend(db as unknown as Db, input)).rejects.toThrow(
      UNION_FUND_DEBIT_INSUFFICIENT
    );

    expect(characterDoc(db).funds).toBe(10);
    expect(unionDoc(db).treasury).toBe(250);
    expect(receipt(db, "fund-poor").status).toBe("failed");
  });

  it("reports a vanished funder distinctly, crediting nothing", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("characters").docs.delete(characterId.toHexString());
    const input = fundInput({ idempotencyKey: "fund-ghost" });

    await expect(applyUnionTreasuryFundingSpend(db as unknown as Db, input)).rejects.toThrow(
      `${UNION_FUND_DEBIT_INSUFFICIENT}:character-missing`
    );

    expect(unionDoc(db).treasury).toBe(250);
    expect(receipt(db, "fund-ghost").status).toBe("failed");
  });

  it("refunds the debit when the union row is gone", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("unions").docs.delete(unionId.toHexString());
    const input = fundInput({ idempotencyKey: "fund-no-union" });

    await expect(applyUnionTreasuryFundingSpend(db as unknown as Db, input)).rejects.toThrow(
      UNION_FUND_CREDIT_FAILED
    );

    expect(characterDoc(db).funds).toBe(50_000);
    expect(receipt(db, "fund-no-union").status).toBe("compensated");
  });

  // Writes per attempt: 1 receipt claim, 2 funder debit, 3 treasury credit,
  // 4 receipt settle. A throw from the fake models a real process death ONLY
  // where no cleanup code runs for it, so the retry reconciles to exactly
  // one charged contribution.
  it.each([0, 1, 2])(
    "reconciles a crash after %i successful writes to exactly one charged contribution",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = fundInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyUnionTreasuryFundingSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key reconciles.
      // Crash-on-write-0 left no receipt at all, so that retry is a fresh
      // attempt; a later crash reconciles an in-progress receipt.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyUnionTreasuryFundingSpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      expect(characterDoc(db).funds).toBe(49_000);
      expect(unionDoc(db).treasury).toBe(1_250);
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged contribution", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 3;
    const input = fundInput({ idempotencyKey: "crash-settle" });

    await expect(applyUnionTreasuryFundingSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // Every step survived; the retry replays them as already-applied and
    // settles completed.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyUnionTreasuryFundingSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: true });
    expect(characterDoc(db).funds).toBe(49_000);
    expect(unionDoc(db).treasury).toBe(1_250);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("replays a completed key without charging or crediting again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = fundInput({ idempotencyKey: "replay" });

    const first = await applyUnionTreasuryFundingSpend(db as unknown as Db, input);
    const second = await applyUnionTreasuryFundingSpend(db as unknown as Db, input);

    expect(first).toEqual({ duplicate: false });
    expect(second).toEqual({ duplicate: true });
    expect(characterDoc(db).funds).toBe(49_000);
    expect(unionDoc(db).treasury).toBe(1_250);
  });

  it("rejects a key reused for a different contribution", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyUnionTreasuryFundingSpend(db as unknown as Db, fundInput({ idempotencyKey: "s" }));

    await expect(
      applyUnionTreasuryFundingSpend(
        db as unknown as Db,
        fundInput({
          idempotencyKey: "s",
          contribution: 2_000,
          fingerprint: `fund:${characterId.toHexString()}:${unionId.toHexString()}:2000`,
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(characterDoc(db).funds).toBe(49_000);
    expect(unionDoc(db).treasury).toBe(1_250);
  });

  it("keeps a terminal failure terminal across retries", async () => {
    const db = new FakeDb();
    seedDb(db);
    characterDoc(db).funds = 10;
    const input = fundInput({ idempotencyKey: "poor-retry" });

    await expect(applyUnionTreasuryFundingSpend(db as unknown as Db, input)).rejects.toThrow(
      UNION_FUND_DEBIT_INSUFFICIENT
    );
    await expect(
      applyUnionTreasuryFundingSpend(db as unknown as Db, input)
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
    expect(characterDoc(db).funds).toBe(10);
    expect(unionDoc(db).treasury).toBe(250);
  });

  it("leaves the prefix stranded-but-visible when compensation itself crashes", async () => {
    const db = new FakeDb();
    seedDb(db);
    // The union row is gone, so the credit fails and the debit prefix must
    // compensate; the crash lands on the compensation write itself.
    db.collection("unions").docs.delete(unionId.toHexString());
    const input = fundInput({ idempotencyKey: "comp-crash" });
    const characters = db.collection("characters");
    const realUpdate = characters.updateOne.bind(characters);
    let calls = 0;
    characters.updateOne = (async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => {
      calls += 1;
      // Call 1 is the debit leg; call 2 is its compensation revert.
      if (calls === 2) throw new Error("INJECTED_CRASH");
      return realUpdate(filter, update);
    }) as typeof characters.updateOne;

    await expect(applyUnionTreasuryFundingSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // The debit applied and was never reversed: the receipt rests
    // in_progress (fail open by crash, TTL-visible) rather than pretending
    // the prefix was reversed.
    expect(characterDoc(db).funds).toBe(49_000);
    expect(receipt(db, "comp-crash").status).toBe("in_progress");
  });

  it("rejects bad contributions and bad keys before touching storage", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyUnionTreasuryFundingSpend(db as unknown as Db, fundInput({ contribution: 0 }))
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      applyUnionTreasuryFundingSpend(db as unknown as Db, fundInput({ idempotencyKey: "" }))
    ).rejects.toBeInstanceOf(RangeError);
    expect(characterDoc(db).funds).toBe(50_000);
    expect(unionDoc(db).treasury).toBe(250);
    expect(db.writeCount).toBe(0);
  });

  it("preserves the transaction path when the deployment supports it", async () => {
    supportMock.mockResolvedValue(true);
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransaction = vi.fn(async (callback: (session: unknown) => Promise<unknown>) =>
      callback({})
    );
    getMongoClientMock.mockResolvedValue({
      startSession: () => ({ withTransaction, endSession }),
    });

    const db = new FakeDb();
    seedDb(db);

    const result = await applyUnionTreasuryFundingSpend(
      db as unknown as Db,
      fundInput({ idempotencyKey: "tx-path" })
    );

    expect(result).toEqual({ duplicate: false });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(characterDoc(db).funds).toBe(49_000);
    expect(unionDoc(db).treasury).toBe(1_250);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });
});
