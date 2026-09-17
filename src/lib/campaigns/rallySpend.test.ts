import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyRallySpend,
  RALLY_ACTIONS_CHANGED,
  RALLY_CANDIDATE_CHANGED,
} from "./rallySpend";
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
// primitive and the rally steps emit ($inc / $set / $push writes; _id
// equality, $ne-on-keys, $gte-on-balance, $exists guards), so an injected
// crash between any two writes models a real process death between the
// corresponding sequential Mongo writes.
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

const campaignId = new ObjectId();
const candidateRowId = new ObjectId();
const now = new Date("2026-02-01T00:00:00Z");
const ACTION_COST = 12;
const CURRENT_TURN = 100;

function seedDb(db: FakeDb): void {
  db.collection("campaigns").docs.set(campaignId.toHexString(), {
    _id: campaignId,
    actions: 100,
    updatedAt: new Date("2026-01-10T00:00:00Z"),
  });
  db.collection("electionCandidates").docs.set(candidateRowId.toHexString(), {
    _id: candidateRowId,
    support: 50,
    supportAccrual: [],
  });
}

function rallyInput(overrides: Record<string, unknown> = {}) {
  return {
    campaignId,
    candidateRowId,
    actionCost: ACTION_COST,
    priorLastRallyTurn: undefined,
    nextSupport: 56,
    currentTurn: CURRENT_TURN,
    accrualEntry: { amountPerTurn: 1, turnsRemaining: 4 },
    now,
    fingerprint: `rally:${campaignId.toHexString()}:${candidateRowId.toHexString()}:${CURRENT_TURN}`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function campaignDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("campaigns").docs.get(campaignId.toHexString())!;
}

function candidateDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("electionCandidates").docs.get(candidateRowId.toHexString())!;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    | MoneyFlowReceipt
    | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyRallySpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("fires one rally: actions debit, support bumps, throttle sets, drip queues", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = rallyInput({ idempotencyKey: "rally-happy" });

    const result = await applyRallySpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(campaignDoc(db).actions).toBe(88);
    expect(candidateDoc(db).support).toBe(56);
    expect(candidateDoc(db).lastRallyTurn).toBe(CURRENT_TURN);
    expect(candidateDoc(db).supportAccrual).toEqual([{ amountPerTurn: 1, turnsRemaining: 4 }]);
    expect(receipt(db, "rally-happy").status).toBe("completed");
  });

  it("fails closed with ACTIONS_CHANGED when the pool races, touching no candidate", async () => {
    const db = new FakeDb();
    seedDb(db);
    campaignDoc(db).actions = 1;
    const input = rallyInput({ idempotencyKey: "rally-poor" });

    await expect(applyRallySpend(db as unknown as Db, input)).rejects.toThrow(
      RALLY_ACTIONS_CHANGED
    );

    expect(campaignDoc(db).actions).toBe(1);
    expect(candidateDoc(db).support).toBe(50);
    expect(candidateDoc(db).lastRallyTurn).toBeUndefined();
    expect(receipt(db, "rally-poor").status).toBe("failed");
  });

  it("refunds the debit when a rival rally wins the same-turn throttle race", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A concurrent fire lands first and sets the throttle.
    candidateDoc(db).lastRallyTurn = CURRENT_TURN;
    const input = rallyInput({ idempotencyKey: "rally-race" });

    await expect(applyRallySpend(db as unknown as Db, input)).rejects.toThrow(
      RALLY_CANDIDATE_CHANGED
    );

    // The compensated debit restores the pool; the rival rally stands (its
    // support write is untouched) and no drip of ours queues.
    expect(campaignDoc(db).actions).toBe(100);
    expect(candidateDoc(db).support).toBe(50);
    expect(candidateDoc(db).supportAccrual).toEqual([]);
    expect(receipt(db, "rally-race").status).toBe("compensated");
  });

  it("reports a vanished candidate distinctly, refunding the debit", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("electionCandidates").docs.delete(candidateRowId.toHexString());
    const input = rallyInput({ idempotencyKey: "rally-ghost" });

    await expect(applyRallySpend(db as unknown as Db, input)).rejects.toThrow(
      `${RALLY_CANDIDATE_CHANGED}:candidate-missing`
    );

    expect(campaignDoc(db).actions).toBe(100);
    expect(receipt(db, "rally-ghost").status).toBe("compensated");
  });

  // Writes per attempt: 1 receipt claim, 2 actions debit, 3 candidate write,
  // 4 receipt settle. A throw from the fake models a real process death ONLY
  // where no cleanup code runs for it, so the retry reconciles to exactly
  // one charged rally.
  it.each([0, 1, 2])(
    "reconciles a crash after %i successful writes to exactly one charged rally",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = rallyInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyRallySpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key reconciles.
      // Crash-on-write-0 left no receipt at all, so that retry is a fresh
      // attempt; a later crash reconciles an in-progress receipt.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyRallySpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      expect(campaignDoc(db).actions).toBe(88);
      expect(candidateDoc(db).support).toBe(56);
      expect(candidateDoc(db).lastRallyTurn).toBe(CURRENT_TURN);
      expect(candidateDoc(db).supportAccrual).toHaveLength(1);
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged rally", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 3;
    const input = rallyInput({ idempotencyKey: "crash-settle" });

    await expect(applyRallySpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");

    // Every step survived; the retry replays them as already-applied and
    // settles completed.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyRallySpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: true });
    expect(campaignDoc(db).actions).toBe(88);
    expect(candidateDoc(db).support).toBe(56);
    expect(candidateDoc(db).supportAccrual).toHaveLength(1);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("replays a completed key without spending or bumping again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = rallyInput({ idempotencyKey: "replay" });

    const first = await applyRallySpend(db as unknown as Db, input);
    const second = await applyRallySpend(db as unknown as Db, input);

    expect(first).toEqual({ duplicate: false });
    expect(second).toEqual({ duplicate: true });
    expect(campaignDoc(db).actions).toBe(88);
    expect(candidateDoc(db).support).toBe(56);
    expect(candidateDoc(db).supportAccrual).toHaveLength(1);
  });

  it("rejects a key reused for a different turn", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyRallySpend(db as unknown as Db, rallyInput({ idempotencyKey: "shared" }));

    await expect(
      applyRallySpend(
        db as unknown as Db,
        rallyInput({
          idempotencyKey: "shared",
          currentTurn: CURRENT_TURN + 1,
          fingerprint: `rally:${campaignId.toHexString()}:${candidateRowId.toHexString()}:${CURRENT_TURN + 1}`,
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(campaignDoc(db).actions).toBe(88);
  });

  it("keeps a terminal failure terminal across retries", async () => {
    const db = new FakeDb();
    seedDb(db);
    campaignDoc(db).actions = 1;
    const input = rallyInput({ idempotencyKey: "poor-retry" });

    await expect(applyRallySpend(db as unknown as Db, input)).rejects.toThrow(
      RALLY_ACTIONS_CHANGED
    );
    await expect(applyRallySpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(campaignDoc(db).actions).toBe(1);
    expect(candidateDoc(db).support).toBe(50);
  });

  it("leaves the prefix stranded-but-visible when compensation itself crashes", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A rival rally wins the throttle, so the debit prefix must compensate;
    // the crash lands on the compensation write itself.
    candidateDoc(db).lastRallyTurn = CURRENT_TURN;
    const input = rallyInput({ idempotencyKey: "comp-crash" });
    const campaigns = db.collection("campaigns");
    const realUpdate = campaigns.updateOne.bind(campaigns);
    let calls = 0;
    campaigns.updateOne = (async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => {
      calls += 1;
      // Call 1 is the debit leg; call 2 is its compensation revert.
      if (calls === 2) throw new Error("INJECTED_CRASH");
      return realUpdate(filter, update);
    }) as typeof campaigns.updateOne;

    await expect(applyRallySpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");

    // The debit applied and was never reversed: the receipt rests
    // in_progress (fail open by crash, TTL-visible) rather than pretending
    // the prefix was reversed.
    expect(campaignDoc(db).actions).toBe(88);
    expect(receipt(db, "comp-crash").status).toBe("in_progress");
  });

  it("rejects bad costs and bad keys before touching storage", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyRallySpend(db as unknown as Db, rallyInput({ actionCost: 0 }))
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      applyRallySpend(db as unknown as Db, rallyInput({ idempotencyKey: "" }))
    ).rejects.toBeInstanceOf(RangeError);
    expect(campaignDoc(db).actions).toBe(100);
    expect(candidateDoc(db).support).toBe(50);
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

    const result = await applyRallySpend(db as unknown as Db, rallyInput({ idempotencyKey: "tx" }));

    expect(result).toEqual({ duplicate: false });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(campaignDoc(db).actions).toBe(88);
    expect(candidateDoc(db).support).toBe(56);
    expect(candidateDoc(db).supportAccrual).toHaveLength(1);
    expect(receipt(db, "tx").status).toBe("completed");
  });
});
