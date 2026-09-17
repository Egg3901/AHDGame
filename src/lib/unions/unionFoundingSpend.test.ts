import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyUnionFoundingSpend,
  FOUNDING_INSERT_BLOCKED,
  FOUNDING_INSERT_FAILED,
  FOUNDING_LEADERSHIP_CHANGED,
  FOUNDING_SPEND_INSUFFICIENT,
} from "./unionFoundingSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  keyedInsertId,
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
// primitive and the founding steps emit ($inc / $set / $unset /
// $push+$each+$slice writes; _id equality, $or, $ne-on-keys, $gte-on-balance
// guards; duplicate-key errors on insert; deletes), so an injected crash
// between any two writes models a real process death between the
// corresponding sequential Mongo writes.
// ---------------------------------------------------------------------------

function docKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id instanceof ObjectId) return id.toHexString();
  return JSON.stringify(id);
}

// Real Mongo preserves BSON value semantics across a write/read round trip:
// an ObjectId read back IS an ObjectId. `structuredClone` does not model
// that (it downgrades an ObjectId to a plain `{ buffer }` object, erasing
// the semantic equality `sameValue`/`docKey` rely on), so the fake clones
// through here instead of `structuredClone`.
function cloneValue<T>(value: T): T {
  if (value instanceof ObjectId) return new ObjectId(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [field, fieldValue] of Object.entries(value as Record<string, unknown>)) {
      out[field] = cloneValue(fieldValue);
    }
    return out as T;
  }
  return value;
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

function unsetPath(doc: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let node: Record<string, unknown> | undefined = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = node?.[parts[i]!];
    if (typeof next !== "object" || next === null) return;
    node = next as Record<string, unknown>;
  }
  delete node?.[parts[parts.length - 1]!];
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
  if ("$exists" in ops) {
    const exists = value !== undefined && value !== null;
    return ops.$exists ? exists : !exists;
  }
  return false;
}

function matchesFlowFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    if (field === "$or") {
      const alternatives = condition as Record<string, unknown>[];
      if (!alternatives.some((sub) => matchesFlowFilter(doc, sub))) return false;
      continue;
    }
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
    _opts?: { projection?: Record<string, unknown> }
  ): Promise<Record<string, unknown> | null> {
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return null;
    return cloneValue(doc);
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
    const unset = (update.$unset ?? {}) as Record<string, unknown>;
    for (const field of Object.keys(unset)) unsetPath(doc, field);
    const set = (update.$set ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(set)) {
      setPath(doc, field, value);
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
    this.countWrite();
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return { deletedCount: 0 };
    for (const [field, condition] of Object.entries(filter)) {
      if (field === "_id") continue;
      if (!matchesCondition(doc, field, condition)) return { deletedCount: 0 };
    }
    this.docs.delete(docKey(filter._id));
    return { deletedCount: 1 };
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
const now = new Date("2026-02-01T00:00:00Z");
const priorCharacterUpdatedAt = new Date("2026-01-10T00:00:00Z");
const COST_FUNDS = 100_000;
const COST_ACTIONS = 20;

function seedDb(db: FakeDb): void {
  db.collection("characters").docs.set(characterId.toHexString(), {
    _id: characterId,
    actions: 50,
    funds: 1_000_000,
    updatedAt: priorCharacterUpdatedAt,
  });
}

function foundingInput(overrides: Record<string, unknown> = {}) {
  return {
    characterId,
    campaignFundsField: "funds",
    costFundsLocal: COST_FUNDS,
    costActions: COST_ACTIONS,
    unionDoc: {
      countryId: "US",
      sectorType: "manufacturing",
      name: "United Steelworkers",
      ownerId: characterId,
      ownerType: "character",
      pendingLeaderCharacterId: null,
      treasury: 0,
      strength: 0,
      approval: 50,
      duesPerWorkerAnnual: 0,
      activeServices: [],
      foundedByCharacterId: characterId,
      lastCalledStrikeTurn: null,
      demandedWageLevel: null,
      createdAt: now,
      updatedAt: now,
    },
    priorCharacterUpdatedAt,
    now,
    fingerprint: "found-union:US:manufacturing:united steelworkers",
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function characterDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("characters").docs.get(characterId.toHexString())!;
}

function unionDocs(db: FakeDb): Record<string, unknown>[] {
  return [...db.collection("unions").docs.values()];
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    | MoneyFlowReceipt
    | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyUnionFoundingSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("founds one union: spend lands, deterministic row inserts, leadership claims", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = foundingInput({ idempotencyKey: "found-happy" });

    const result = await applyUnionFoundingSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(docKey(result.unionId)).toBe(docKey(keyedInsertId("found-happy", "union-founding")));
    expect(characterDoc(db).funds).toBe(900_000);
    expect(characterDoc(db).actions).toBe(30);
    expect(unionDocs(db)).toHaveLength(1);
    const union = unionDocs(db)[0]!;
    expect(docKey(union._id)).toBe(docKey(result.unionId));
    expect(union.name).toBe("United Steelworkers");
    expect(docKey(union.ownerId)).toBe(docKey(characterId));
    expect(docKey(union.foundedByCharacterId)).toBe(docKey(characterId));
    expect(docKey(characterDoc(db).unionLeaderOf)).toBe(docKey(result.unionId));
    expect(receipt(db, "found-happy").status).toBe("completed");
  });

  it("fails closed with INSUFFICIENT when the founder cannot cover both costs", async () => {
    const db = new FakeDb();
    seedDb(db);
    characterDoc(db).actions = 1;
    const input = foundingInput({ idempotencyKey: "found-poor" });

    await expect(applyUnionFoundingSpend(db as unknown as Db, input)).rejects.toThrow(
      FOUNDING_SPEND_INSUFFICIENT
    );

    expect(characterDoc(db).actions).toBe(1);
    expect(unionDocs(db)).toHaveLength(0);
    expect(receipt(db, "found-poor").status).toBe("failed");
  });

  it("reports a legacy unique-index block distinctly, refunding the spend", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = foundingInput({ idempotencyKey: "found-blocked" });
    // Some worlds still carry a legacy (countryId, sectorType) unique index:
    // the insert throws a duplicate key even though no row exists under OUR
    // deterministic `_id`.
    const unions = db.collection("unions");
    const realInsert = unions.insertOne.bind(unions);
    unions.insertOne = (async (doc: Record<string, unknown>) => {
      const error = new Error("E11000 duplicate key error") as Error & { code: number };
      error.code = 11000;
      void realInsert;
      void doc;
      throw error;
    }) as typeof unions.insertOne;

    await expect(applyUnionFoundingSpend(db as unknown as Db, input)).rejects.toThrow(
      FOUNDING_INSERT_BLOCKED
    );

    expect(characterDoc(db).funds).toBe(1_000_000);
    expect(characterDoc(db).actions).toBe(50);
    expect(unionDocs(db)).toHaveLength(0);
    expect(receipt(db, "found-blocked").status).toBe("compensated");
  });

  it("reports a genuine insert failure distinctly, refunding the spend", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = foundingInput({ idempotencyKey: "found-infra" });
    const unions = db.collection("unions");
    unions.insertOne = (() => Promise.reject(new Error("storage down"))) as typeof unions.insertOne;

    await expect(applyUnionFoundingSpend(db as unknown as Db, input)).rejects.toThrow(
      FOUNDING_INSERT_FAILED
    );

    expect(characterDoc(db).funds).toBe(1_000_000);
    expect(unionDocs(db)).toHaveLength(0);
    expect(receipt(db, "found-infra").status).toBe("compensated");
  });

  it("unwinds the founding when a concurrent win takes the leadership first", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A concurrent leadership win elsewhere lands between our read and write.
    const rivalUnionId = new ObjectId();
    characterDoc(db).unionLeaderOf = rivalUnionId;
    const input = foundingInput({ idempotencyKey: "found-race" });

    await expect(applyUnionFoundingSpend(db as unknown as Db, input)).rejects.toThrow(
      FOUNDING_LEADERSHIP_CHANGED
    );

    // The union row is deleted and the spend refunded: nothing charged for
    // a founding that did not complete, and the rival leadership stands.
    expect(unionDocs(db)).toHaveLength(0);
    expect(characterDoc(db).funds).toBe(1_000_000);
    expect(characterDoc(db).actions).toBe(50);
    expect(docKey(characterDoc(db).unionLeaderOf)).toBe(docKey(rivalUnionId));
    expect(receipt(db, "found-race").status).toBe("compensated");
  });

  // Writes per attempt: 1 receipt claim, 2 combined spend, 3 union insert,
  // 4 leadership claim, 5 receipt settle. A throw from the fake models a
  // real process death ONLY where no cleanup code runs for it, so the retry
  // reconciles to exactly one charged founding.
  it.each([0, 1, 2, 3])(
    "reconciles a crash after %i successful writes to exactly one charged founding",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = foundingInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyUnionFoundingSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key reconciles.
      // Crash-on-write-0 left no receipt at all, so that retry is a fresh
      // attempt; a later crash reconciles an in-progress receipt.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyUnionFoundingSpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      expect(characterDoc(db).funds).toBe(900_000);
      expect(unionDocs(db)).toHaveLength(1);
      expect(docKey(characterDoc(db).unionLeaderOf)).toBe(docKey(result.unionId));
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged founding", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 4;
    const input = foundingInput({ idempotencyKey: "crash-settle" });

    await expect(applyUnionFoundingSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // Every step survived; the retry replays them as already-applied and
    // settles completed.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyUnionFoundingSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(true);
    expect(unionDocs(db)).toHaveLength(1);
    expect(characterDoc(db).funds).toBe(900_000);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("replays a completed key without charging or founding again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = foundingInput({ idempotencyKey: "replay" });

    const first = await applyUnionFoundingSpend(db as unknown as Db, input);
    const second = await applyUnionFoundingSpend(db as unknown as Db, input);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(docKey(second.unionId)).toBe(docKey(first.unionId));
    expect(characterDoc(db).funds).toBe(900_000);
    expect(unionDocs(db)).toHaveLength(1);
  });

  it("rejects a key reused for a different founding", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyUnionFoundingSpend(db as unknown as Db, foundingInput({ idempotencyKey: "shared" }));

    await expect(
      applyUnionFoundingSpend(
        db as unknown as Db,
        foundingInput({
          idempotencyKey: "shared",
          fingerprint: "found-union:US:manufacturing:other union",
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(unionDocs(db)).toHaveLength(1);
  });

  it("keeps a terminal failure terminal across retries", async () => {
    const db = new FakeDb();
    seedDb(db);
    characterDoc(db).funds = 10;
    const input = foundingInput({ idempotencyKey: "poor-retry" });

    await expect(applyUnionFoundingSpend(db as unknown as Db, input)).rejects.toThrow(
      FOUNDING_SPEND_INSUFFICIENT
    );
    await expect(applyUnionFoundingSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(unionDocs(db)).toHaveLength(0);
  });

  it("leaves the prefix stranded-but-visible when compensation itself crashes", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A concurrent leadership win forces compensation of the spend prefix
    // plus the union row; the crash lands on the union-row delete, the first
    // compensation write in reverse order.
    const rivalUnionId = new ObjectId();
    characterDoc(db).unionLeaderOf = rivalUnionId;
    const input = foundingInput({ idempotencyKey: "comp-crash" });
    const unions = db.collection("unions");
    const realDelete = unions.deleteOne.bind(unions);
    unions.deleteOne = (async (filter: Record<string, unknown>) => {
      void realDelete;
      void filter;
      throw new Error("INJECTED_CRASH");
    }) as typeof unions.deleteOne;

    await expect(applyUnionFoundingSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // The spend applied and the union row was never unwound: the receipt
    // rests in_progress (fail open by crash, TTL-visible) rather than
    // pretending the prefix was reversed. The rival leadership still stands
    // and no founding leadership was claimed.
    expect(characterDoc(db).funds).toBe(900_000);
    expect(unionDocs(db)).toHaveLength(1);
    expect(docKey(characterDoc(db).unionLeaderOf)).toBe(docKey(rivalUnionId));
    expect(receipt(db, "comp-crash").status).toBe("in_progress");
  });

  it("rejects bad costs and bad keys before touching storage", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyUnionFoundingSpend(db as unknown as Db, foundingInput({ costFundsLocal: 0 }))
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      applyUnionFoundingSpend(db as unknown as Db, foundingInput({ idempotencyKey: "" }))
    ).rejects.toBeInstanceOf(RangeError);
    expect(characterDoc(db).funds).toBe(1_000_000);
    expect(unionDocs(db)).toHaveLength(0);
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

    const result = await applyUnionFoundingSpend(
      db as unknown as Db,
      foundingInput({ idempotencyKey: "tx-path" })
    );

    expect(result.duplicate).toBe(false);
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(unionDocs(db)).toHaveLength(1);
    expect(characterDoc(db).funds).toBe(900_000);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });
});
