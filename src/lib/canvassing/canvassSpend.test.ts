import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { applyCanvassSpend } from "./canvassSpend";
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
// primitive emits ($inc / $push+$each+$slice / $set writes, dotted paths;
// _id equality plus plain equality, $ne-on-keys and $gte-on-balance
// filters; duplicate-key errors on insert), so an injected crash between any
// two writes models a real process death between the corresponding sequential
// Mongo writes.
// ---------------------------------------------------------------------------

function docKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id instanceof ObjectId) return id.toHexString();
  return Buffer.from((id as { buffer: Uint8Array }).buffer).toString("hex");
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

function equalValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
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
    if (!equalValue(getPath(doc, field), condition)) return false;
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
const surrogateCampaignId = new ObjectId();
const STAMP = new Date("2026-01-02T00:00:00Z");

function seedDb(
  db: FakeDb,
  opts: { actions?: number; funds?: number; pool?: number; stamp?: Date } = {}
): void {
  db.collection("characters").docs.set(characterId.toHexString(), {
    _id: characterId,
    actions: opts.actions ?? 10,
    funds: opts.funds ?? 5000,
  });
  db.collection("campaigns").docs.set(surrogateCampaignId.toHexString(), {
    _id: surrogateCampaignId,
    runningMateSurrogateActionsRemaining: opts.pool ?? 10,
  });
  db.collection("stateDemographicTurnout").docs.set("IA", {
    _id: "IA",
    modifiers: { youth: { students: 1 } },
    lastUpdated: opts.stamp ?? new Date(STAMP),
  });
}

function spendInput(overrides: Record<string, unknown> = {}) {
  return {
    characterId,
    campaignFundsField: "funds",
    totalFundsCostLocal: 200,
    totalActionsCost: 2,
    turnout: {
      stateId: "IA",
      lastUpdated: new Date(STAMP),
      modifierPath: "modifiers.youth.students",
      modifierValue: 1.5,
      campaignModifiers: { youth: { students: 1.5 } },
    },
    fingerprint: "char:IA:modifiers.youth.students:2",
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function spend(db: FakeDb): { actions: number; funds: number; pool: number; modifier: number } {
  return {
    actions: db.collection("characters").docs.get(characterId.toHexString())?.actions as number,
    funds: db.collection("characters").docs.get(characterId.toHexString())?.funds as number,
    pool: db.collection("campaigns").docs.get(surrogateCampaignId.toHexString())
      ?.runningMateSurrogateActionsRemaining as number,
    modifier: getPath(
      db.collection("stateDemographicTurnout").docs.get("IA")!,
      "modifiers.youth.students"
    ) as number,
  };
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyCanvassSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("charges once and lands the turnout boost", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "happy" });

    const result = await applyCanvassSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(spend(db)).toEqual({ actions: 8, funds: 4800, pool: 10, modifier: 1.5 });
    expect(receipt(db, "happy").status).toBe("completed");
  });

  // Writes per attempt (no surrogate): 1 receipt claim, 2 character spend,
  // 3 turnout write, 4 receipt settle. Throws propagate untouched from legs
  // and the claim, so the retry reconciles instead of double-applying.
  it.each([0, 1, 2, 3])(
    "reconciles a crash after %i successful writes to exactly one canvass",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = spendInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyCanvassSpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");

      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyCanvassSpend(db as unknown as Db, input);

      expect(result).toEqual({ duplicate: crashAfter > 0 });
      expect(spend(db)).toEqual({ actions: 8, funds: 4800, pool: 10, modifier: 1.5 });
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("replays a completed key without charging or boosting again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "replay" });

    await applyCanvassSpend(db as unknown as Db, input);
    const second = await applyCanvassSpend(db as unknown as Db, input);

    expect(second).toEqual({ duplicate: true });
    expect(spend(db)).toEqual({ actions: 8, funds: 4800, pool: 10, modifier: 1.5 });
  });

  it("fails closed on insufficient funds and keeps the failure terminal", async () => {
    const db = new FakeDb();
    seedDb(db, { funds: 100 });
    const input = spendInput({ idempotencyKey: "poor" });

    await expect(applyCanvassSpend(db as unknown as Db, input)).rejects.toThrow(
      "INSUFFICIENT_RESOURCES"
    );
    expect(spend(db)).toEqual({ actions: 10, funds: 100, pool: 10, modifier: 1 });
    expect(receipt(db, "poor").status).toBe("failed");

    await expect(applyCanvassSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(spend(db)).toEqual({ actions: 10, funds: 100, pool: 10, modifier: 1 });
  });

  it("refunds the spend when the turnout stamp raced, exactly once", async () => {
    const db = new FakeDb();
    seedDb(db, { stamp: new Date("2026-01-03T00:00:00Z") });
    const input = spendInput({ idempotencyKey: "stale" });

    await expect(applyCanvassSpend(db as unknown as Db, input)).rejects.toThrow("TURNOUT_CONFLICT");

    // One spend, one refund: net zero, boost untouched.
    expect(spend(db)).toEqual({ actions: 10, funds: 5000, pool: 10, modifier: 1 });
    expect(receipt(db, "stale").status).toBe("compensated");
  });

  it("recovers a crash during turnout compensation without refunding twice", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("stateDemographicTurnout").docs.delete("IA");
    // Writes: 1 receipt claim, 2 character spend, 3 turnout attempt
    // (matches nothing), 4 compensating refund, 5 receipt settle. Crash on 5.
    db.crashAfterWrites = 4;
    const input = spendInput({ idempotencyKey: "crash-compensate" });

    await expect(applyCanvassSpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await expect(applyCanvassSpend(db as unknown as Db, input)).rejects.toThrow("TURNOUT_CONFLICT");

    expect(spend(db).actions).toBe(10);
    expect(spend(db).funds).toBe(5000);
    expect(receipt(db, "crash-compensate").status).toBe("compensated");
  });

  it("draws the surrogate pool inside the flow and refunds it on failure", async () => {
    const db = new FakeDb();
    seedDb(db, { stamp: new Date("2026-01-03T00:00:00Z") });
    const input = spendInput({ idempotencyKey: "surrogate-fail", surrogateCampaignId });

    await expect(applyCanvassSpend(db as unknown as Db, input)).rejects.toThrow("TURNOUT_CONFLICT");

    // Pool draw, character spend, and (missing) boost all net to zero.
    expect(spend(db)).toEqual({ actions: 10, funds: 5000, pool: 10, modifier: 1 });
    expect(receipt(db, "surrogate-fail").status).toBe("compensated");
  });

  it("blocks on a depleted surrogate pool with no character debit", async () => {
    const db = new FakeDb();
    seedDb(db, { pool: 1 });
    const input = spendInput({ idempotencyKey: "surrogate-dry", surrogateCampaignId });

    await expect(applyCanvassSpend(db as unknown as Db, input)).rejects.toThrow(
      "SURROGATE_DEPLETED"
    );

    expect(spend(db)).toEqual({ actions: 10, funds: 5000, pool: 1, modifier: 1 });
    expect(receipt(db, "surrogate-dry").status).toBe("failed");
  });

  it("rejects a key reused for a different canvass", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyCanvassSpend(db as unknown as Db, spendInput({ idempotencyKey: "shared" }));

    await expect(
      applyCanvassSpend(
        db as unknown as Db,
        spendInput({ idempotencyKey: "shared", fingerprint: "char:IA:other:2" })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(spend(db)).toEqual({ actions: 8, funds: 4800, pool: 10, modifier: 1.5 });
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
    const result = await applyCanvassSpend(
      db as unknown as Db,
      spendInput({ idempotencyKey: "tx-path" })
    );

    expect(result).toEqual({ duplicate: false });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(spend(db)).toEqual({ actions: 8, funds: 4800, pool: 10, modifier: 1.5 });
    expect(receipt(db, "tx-path").status).toBe("completed");
  });
});
