import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { applyStateAttackSpend } from "./stateAttackSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";
import type { PrimaryStateAction } from "@/lib/db/types";

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
// primitive emits ($inc / $push+$each+$slice / $set writes; _id equality,
// $ne-on-keys and $gte-on-balance filters; duplicate-key errors on insert),
// so an injected crash between any two writes models a real process death
// between the corresponding sequential Mongo writes.
// ---------------------------------------------------------------------------

function docKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id instanceof ObjectId) return id.toHexString();
  // structuredClone on some Node versions strips the ObjectId prototype on
  // read-back (newer versions keep only the internal words); fall back to
  // the raw 12-byte buffer when it survives as an own property.
  return Buffer.from((id as { buffer: Uint8Array }).buffer).toString("hex");
}

// structuredClone strips the ObjectId/Date prototypes on some Node versions
// (newer ones keep only the driver's internal words), which breaks the row-id
// comparison below. Clone plain data while preserving ObjectId and Date, so
// the fake still isolates stored docs without mangling ids or stamps.
function cloneDoc<T>(value: T): T {
  if (value instanceof ObjectId) return new ObjectId(value.toHexString()) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => cloneDoc(entry)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneDoc(v);
    return out as unknown as T;
  }
  return value;
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
    this.docs.set(key, cloneDoc(doc));
    return { insertedId: doc._id };
  }

  async findOne(
    filter: Record<string, unknown>,
    opts?: { projection?: Record<string, unknown> }
  ): Promise<Record<string, unknown> | null> {
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return null;
    if (!opts?.projection) return cloneDoc(doc);
    const out: Record<string, unknown> = { _id: doc._id };
    for (const field of Object.keys(opts.projection)) {
      if (field !== "_id") out[field] = cloneDoc(doc[field]);
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
    const push = update.$push as
      { appliedMoneyFlowKeys?: { $each: string[]; $slice: number } } | undefined;
    if (push?.appliedMoneyFlowKeys) {
      const current = (doc.appliedMoneyFlowKeys as string[] | undefined) ?? [];
      const next = [...current, ...push.appliedMoneyFlowKeys.$each];
      const slice = push.appliedMoneyFlowKeys.$slice;
      doc.appliedMoneyFlowKeys = slice < 0 ? next.slice(slice) : next;
    }
    const set = (update.$set ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(set)) {
      setPath(doc, field, value);
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

function matchesFlowFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    if (
      condition !== null &&
      typeof condition === "object" &&
      "$ne" in (condition as Record<string, unknown>)
    ) {
      const keys = doc[field] as string[] | undefined;
      if (keys?.includes((condition as { $ne: string }).$ne)) return false;
      continue;
    }
    if (
      condition !== null &&
      typeof condition === "object" &&
      "$gte" in (condition as Record<string, unknown>)
    ) {
      const balance = getPath(doc, field) as number | undefined;
      if (!((balance ?? Number.NEGATIVE_INFINITY) >= (condition as { $gte: number }).$gte)) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
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
const campaignId = new ObjectId();
const electionId = new ObjectId();
const actorCandidateId = new ObjectId();
const targetCandidateId = new ObjectId();
const targetCharacterId = new ObjectId();

function seedDb(db: FakeDb, actions = 5, funds = 1000): void {
  db.collection("characters").docs.set(characterId.toHexString(), {
    _id: characterId,
    actions,
  });
  db.collection("campaigns").docs.set(campaignId.toHexString(), {
    _id: campaignId,
    funds,
  });
}

function spendInput(overrides: Record<string, unknown> = {}) {
  return {
    characterId,
    campaignId,
    costActions: 3,
    costFundsLocal: 100,
    action: {
      electionId,
      actorCandidateId,
      targetCandidateId,
      targetCharacterId,
      stateId: "IA",
      kind: "localFavorability",
      magnitude: 2,
      shieldApplied: 0,
      appliedTurn: 10,
      expiresTurn: 14,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    } as Omit<PrimaryStateAction, "_id">,
    fingerprint: "actor:target:IA:localFavorability:10",
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function balances(db: FakeDb): { actions: number; funds: number } {
  return {
    actions: db.collection("characters").docs.get(characterId.toHexString())?.actions as number,
    funds: db.collection("campaigns").docs.get(campaignId.toHexString())?.funds as number,
  };
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

function attackRows(db: FakeDb): Record<string, unknown>[] {
  return [...db.collection("primaryStateActions").docs.values()];
}

describe("applyStateAttackSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("charges once, records one attack row, and completes the receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "happy" });

    const result = await applyStateAttackSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(balances(db)).toEqual({ actions: 2, funds: 900 });
    expect(attackRows(db)).toHaveLength(1);
    // The fake round-trips docs through structuredClone, which strips the
    // ObjectId prototype, so compare by hex.
    expect(docKey(attackRows(db)[0]?._id)).toBe(result.actionId.toHexString());
    expect(receipt(db, "happy").status).toBe("completed");
  });

  // Writes per attempt: 1 receipt claim, 2 actions debit, 3 funds debit,
  // 4 attack-row insert, 5 receipt settle. A throw from the fake models a
  // process death ONLY where no cleanup code runs for it: the legs and the
  // claim propagate untouched, so the retry reconciles. The insert step
  // converts a survived error into a compensatable failure (a real crash
  // would run no code at all), which the insert-failure test below covers.
  it.each([0, 1, 2])(
    "reconciles a crash after %i successful writes to exactly one charged attack",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = spendInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyStateAttackSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key reconciles.
      // Crash-on-write-0 left no receipt at all, so that retry is a fresh
      // attempt; every later crash reconciles an in-progress receipt.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyStateAttackSpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      expect(balances(db)).toEqual({ actions: 2, funds: 900 });
      expect(attackRows(db)).toHaveLength(1);
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged attack", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 4;
    const input = spendInput({ idempotencyKey: "crash-settle" });

    await expect(applyStateAttackSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // Both debits and the row survived; the retry replays every step as
    // already-applied (the row insert converges on the deterministic `_id`)
    // and settles completed.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyStateAttackSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(true);
    expect(balances(db)).toEqual({ actions: 2, funds: 900 });
    expect(attackRows(db)).toHaveLength(1);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("hands everything back when the attack row cannot be written", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "row-failure" });
    db.collection("primaryStateActions").insertOne = async () => {
      throw new Error("disk on fire");
    };

    await expect(applyStateAttackSpend(db as unknown as Db, input)).rejects.toThrow(
      "STATE_ATTACK_CONFLICT"
    );

    // Both debits refunded, no row, receipt compensated: never a partial state.
    expect(balances(db)).toEqual({ actions: 5, funds: 1000 });
    expect(attackRows(db)).toHaveLength(0);
    expect(receipt(db, "row-failure").status).toBe("compensated");
  });

  it("replays a completed key without charging or recording again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "replay" });

    const first = await applyStateAttackSpend(db as unknown as Db, input);
    const second = await applyStateAttackSpend(db as unknown as Db, input);

    expect(second).toEqual({ duplicate: true, actionId: first.actionId });
    expect(balances(db)).toEqual({ actions: 2, funds: 900 });
    expect(attackRows(db)).toHaveLength(1);
  });

  it("fails closed on insufficient actions and keeps the failure terminal", async () => {
    const db = new FakeDb();
    seedDb(db, 2, 1000);
    const input = spendInput({ idempotencyKey: "poor-actions" });

    await expect(applyStateAttackSpend(db as unknown as Db, input)).rejects.toThrow(
      "INSUFFICIENT_RESOURCES"
    );
    expect(balances(db)).toEqual({ actions: 2, funds: 1000 });
    expect(attackRows(db)).toHaveLength(0);
    expect(receipt(db, "poor-actions").status).toBe("failed");

    await expect(applyStateAttackSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(balances(db)).toEqual({ actions: 2, funds: 1000 });
  });

  it("compensates the actions debit when the funds debit fails, exactly once", async () => {
    const db = new FakeDb();
    seedDb(db, 5, 50);
    const input = spendInput({ idempotencyKey: "poor-funds" });

    await expect(applyStateAttackSpend(db as unknown as Db, input)).rejects.toThrow(
      "INSUFFICIENT_RESOURCES"
    );

    // One debit, one refund: net zero, not a double refund.
    expect(balances(db)).toEqual({ actions: 5, funds: 50 });
    expect(attackRows(db)).toHaveLength(0);
    const charDoc = db.collection("characters").docs.get(characterId.toHexString())!;
    expect(charDoc.appliedMoneyFlowKeys).toContain("poor-funds");
    expect(charDoc.appliedMoneyFlowKeys).toContain("poor-funds:compensate:actions-debit");
    expect(receipt(db, "poor-funds").status).toBe("compensated");

    await expect(applyStateAttackSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(balances(db)).toEqual({ actions: 5, funds: 50 });
  });

  it("recovers a crash during compensation without refunding twice", async () => {
    const db = new FakeDb();
    seedDb(db, 5, 50);
    // Writes: 1 receipt claim, 2 actions debit, 3 funds attempt (guard
    // rejects), 4 compensating refund, 5 receipt settle. Crash on 5.
    db.crashAfterWrites = 4;
    const input = spendInput({ idempotencyKey: "crash-compensate" });

    await expect(applyStateAttackSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await expect(applyStateAttackSpend(db as unknown as Db, input)).rejects.toThrow(
      "INSUFFICIENT_RESOURCES"
    );

    expect(balances(db)).toEqual({ actions: 5, funds: 50 });
    expect(attackRows(db)).toHaveLength(0);
    expect(receipt(db, "crash-compensate").status).toBe("compensated");
  });

  it("rejects a key reused for a different attack", async () => {
    const db = new FakeDb();
    seedDb(db);
    const first = spendInput({ idempotencyKey: "shared" });
    await applyStateAttackSpend(db as unknown as Db, first);

    const second = spendInput({
      idempotencyKey: "shared",
      fingerprint: "actor:target:IA:voteSuppression:10",
    });
    await expect(applyStateAttackSpend(db as unknown as Db, second)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(balances(db)).toEqual({ actions: 2, funds: 900 });
    expect(attackRows(db)).toHaveLength(1);
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
    const input = spendInput({ idempotencyKey: "tx-path" });

    const result = await applyStateAttackSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(balances(db)).toEqual({ actions: 2, funds: 900 });
    expect(attackRows(db)).toHaveLength(1);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });

  it("derives the same row id from the same key and distinct ids per key", async () => {
    const db = new FakeDb();
    seedDb(db, 100, 100_000);

    const first = await applyStateAttackSpend(
      db as unknown as Db,
      spendInput({ idempotencyKey: "stable" })
    );
    // Same key replays the same row id instead of inserting a second row.
    const replay = await applyStateAttackSpend(
      db as unknown as Db,
      spendInput({ idempotencyKey: "stable" })
    );
    expect(replay.actionId).toEqual(first.actionId);

    const other = await applyStateAttackSpend(
      db as unknown as Db,
      spendInput({ idempotencyKey: "other" })
    );
    expect(other.actionId).not.toEqual(first.actionId);
    expect(attackRows(db)).toHaveLength(2);
  });
});
