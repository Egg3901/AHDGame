import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyCampaignStrengthSpend,
  STRENGTH_ACTIVITY_FAILED,
  STRENGTH_CAMPAIGN_MISSING,
  STRENGTH_DEBIT_INSUFFICIENT,
} from "./campaignStrengthSpend";
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
// primitive and the strength steps emit ($inc / $set / $push+$each+$slice
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

const characterId = new ObjectId();
const campaignId = new ObjectId();
const now = new Date("2026-02-01T00:00:00Z");
const priorCampaignUpdatedAt = new Date("2026-01-15T00:00:00Z");
const COST_FUNDS = 1_000;
const COST_ACTIONS = 8;
const STRENGTH_ADDED = 75;

function seedDb(db: FakeDb): void {
  db.collection("characters").docs.set(characterId.toHexString(), {
    _id: characterId,
    actions: 50,
    funds: 5_000,
    updatedAt: new Date("2026-01-10T00:00:00Z"),
  });
  db.collection("campaigns").docs.set(campaignId.toHexString(), {
    _id: campaignId,
    campaignStrength: 100,
    updatedAt: priorCampaignUpdatedAt,
  });
}

function strengthInput(overrides: Record<string, unknown> = {}) {
  return {
    characterId,
    campaignId,
    fundsField: "funds",
    costFundsLocal: COST_FUNDS,
    costActions: COST_ACTIONS,
    strengthAdded: STRENGTH_ADDED,
    priorCampaignUpdatedAt,
    now,
    activityEntry: {
      type: "game_action",
      actionType: "campaign_strength",
      targetId: campaignId,
    },
    fingerprint: `campaign-strength:${campaignId.toHexString()}:${characterId.toHexString()}:1:75`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function characterDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("characters").docs.get(characterId.toHexString())!;
}

function campaignDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("campaigns").docs.get(campaignId.toHexString())!;
}

function activityDocs(db: FakeDb): Record<string, unknown>[] {
  return [...db.collection("activityLog").docs.values()];
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    | MoneyFlowReceipt
    | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyCampaignStrengthSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("charges one purchase: debit lands, strength credits, audit row records", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = strengthInput({ idempotencyKey: "strength-happy" });

    const result = await applyCampaignStrengthSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(characterDoc(db).funds).toBe(4_000);
    expect(characterDoc(db).actions).toBe(42);
    expect(campaignDoc(db).campaignStrength).toBe(175);
    expect(activityDocs(db)).toHaveLength(1);
    expect(receipt(db, "strength-happy").status).toBe("completed");
  });

  it("fails closed with INSUFFICIENT when funds race below the quote", async () => {
    const db = new FakeDb();
    seedDb(db);
    characterDoc(db).funds = 10;
    const input = strengthInput({ idempotencyKey: "strength-poor" });

    await expect(applyCampaignStrengthSpend(db as unknown as Db, input)).rejects.toThrow(
      STRENGTH_DEBIT_INSUFFICIENT
    );

    expect(characterDoc(db).funds).toBe(10);
    expect(campaignDoc(db).campaignStrength).toBe(100);
    expect(activityDocs(db)).toHaveLength(0);
    expect(receipt(db, "strength-poor").status).toBe("failed");
  });

  it("fails closed with INSUFFICIENT when actions race below the quote", async () => {
    const db = new FakeDb();
    seedDb(db);
    characterDoc(db).actions = 1;
    const input = strengthInput({ idempotencyKey: "strength-no-ap" });

    await expect(applyCampaignStrengthSpend(db as unknown as Db, input)).rejects.toThrow(
      STRENGTH_DEBIT_INSUFFICIENT
    );

    expect(characterDoc(db).actions).toBe(1);
    expect(campaignDoc(db).campaignStrength).toBe(100);
    expect(receipt(db, "strength-no-ap").status).toBe("failed");
  });

  it("reports a vanished character distinctly, moving no money", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("characters").docs.delete(characterId.toHexString());
    const input = strengthInput({ idempotencyKey: "strength-ghost" });

    await expect(applyCampaignStrengthSpend(db as unknown as Db, input)).rejects.toThrow(
      `${STRENGTH_DEBIT_INSUFFICIENT}:character-missing`
    );

    expect(campaignDoc(db).campaignStrength).toBe(100);
    expect(receipt(db, "strength-ghost").status).toBe("failed");
  });

  it("refunds the debit exactly when the campaign row is gone", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("campaigns").docs.delete(campaignId.toHexString());
    const input = strengthInput({ idempotencyKey: "strength-no-campaign" });

    await expect(applyCampaignStrengthSpend(db as unknown as Db, input)).rejects.toThrow(
      STRENGTH_CAMPAIGN_MISSING
    );

    // The compensated debit restores both funds and actions; no audit row.
    expect(characterDoc(db).funds).toBe(5_000);
    expect(characterDoc(db).actions).toBe(50);
    expect(activityDocs(db)).toHaveLength(0);
    expect(receipt(db, "strength-no-campaign").status).toBe("compensated");
  });

  // Writes per attempt: 1 receipt claim, 2 character debit, 3 campaign
  // credit, 4 audit insert, 5 receipt settle. A throw from the fake models a
  // real process death ONLY where no cleanup code runs for it: the claim,
  // the leg, the keyed update, and the insert propagate untouched, so the
  // retry reconciles to exactly one charged purchase.
  it.each([0, 1, 2, 3])(
    "reconciles a crash after %i successful writes to exactly one charged purchase",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = strengthInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyCampaignStrengthSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key reconciles.
      // Crash-on-write-0 left no receipt at all, so that retry is a fresh
      // attempt; a later crash reconciles an in-progress receipt.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyCampaignStrengthSpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      expect(characterDoc(db).funds).toBe(4_000);
      expect(characterDoc(db).actions).toBe(42);
      expect(campaignDoc(db).campaignStrength).toBe(175);
      expect(activityDocs(db)).toHaveLength(1);
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged purchase", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 4;
    const input = strengthInput({ idempotencyKey: "crash-settle" });

    await expect(applyCampaignStrengthSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // Every step survived; the retry replays them as already-applied and
    // settles completed.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyCampaignStrengthSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: true });
    expect(characterDoc(db).funds).toBe(4_000);
    expect(campaignDoc(db).campaignStrength).toBe(175);
    expect(activityDocs(db)).toHaveLength(1);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("replays a completed key without charging or crediting again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = strengthInput({ idempotencyKey: "replay" });

    const first = await applyCampaignStrengthSpend(db as unknown as Db, input);
    const second = await applyCampaignStrengthSpend(db as unknown as Db, input);

    expect(first).toEqual({ duplicate: false });
    expect(second).toEqual({ duplicate: true });
    expect(characterDoc(db).funds).toBe(4_000);
    expect(campaignDoc(db).campaignStrength).toBe(175);
    expect(activityDocs(db)).toHaveLength(1);
  });

  it("rejects a key reused for a different purchase", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyCampaignStrengthSpend(
      db as unknown as Db,
      strengthInput({ idempotencyKey: "shared" })
    );

    await expect(
      applyCampaignStrengthSpend(
        db as unknown as Db,
        strengthInput({
          idempotencyKey: "shared",
          costFundsLocal: 2_000,
          fingerprint: `campaign-strength:${campaignId.toHexString()}:${characterId.toHexString()}:2:75`,
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(characterDoc(db).funds).toBe(4_000);
    expect(campaignDoc(db).campaignStrength).toBe(175);
  });

  it("keeps a terminal failure terminal across retries", async () => {
    const db = new FakeDb();
    seedDb(db);
    characterDoc(db).funds = 10;
    const input = strengthInput({ idempotencyKey: "poor-retry" });

    await expect(applyCampaignStrengthSpend(db as unknown as Db, input)).rejects.toThrow(
      STRENGTH_DEBIT_INSUFFICIENT
    );
    await expect(applyCampaignStrengthSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(characterDoc(db).funds).toBe(10);
    expect(campaignDoc(db).campaignStrength).toBe(100);
  });

  it("fails a second key closed when a rival purchase drains the balance first", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyCampaignStrengthSpend(
      db as unknown as Db,
      strengthInput({ idempotencyKey: "first", costFundsLocal: 4_500 })
    );

    await expect(
      applyCampaignStrengthSpend(db as unknown as Db, strengthInput({ idempotencyKey: "second" }))
    ).rejects.toThrow(STRENGTH_DEBIT_INSUFFICIENT);
    expect(characterDoc(db).funds).toBe(500);
    expect(campaignDoc(db).campaignStrength).toBe(175);
  });

  it("leaves the prefix stranded-but-visible when compensation itself crashes", async () => {
    const db = new FakeDb();
    seedDb(db);
    // The campaign row is gone, so the credit fails and the debit prefix must
    // compensate; the crash lands on the compensation write itself.
    db.collection("campaigns").docs.delete(campaignId.toHexString());
    const input = strengthInput({ idempotencyKey: "comp-crash" });
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

    await expect(applyCampaignStrengthSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // The debit applied and was never reversed: the receipt rests
    // in_progress (fail open by crash, TTL-visible) rather than pretending
    // the prefix was reversed.
    expect(characterDoc(db).funds).toBe(4_000);
    expect(receipt(db, "comp-crash").status).toBe("in_progress");
  });

  it("rejects bad amounts and bad keys before touching storage", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyCampaignStrengthSpend(db as unknown as Db, strengthInput({ costFundsLocal: 0 }))
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      applyCampaignStrengthSpend(db as unknown as Db, strengthInput({ idempotencyKey: "" }))
    ).rejects.toBeInstanceOf(RangeError);
    expect(db.collection("characters").docs.get(characterId.toHexString())).toBeDefined();
    expect(characterDoc(db).funds).toBe(5_000);
    expect(campaignDoc(db).campaignStrength).toBe(100);
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

    const result = await applyCampaignStrengthSpend(
      db as unknown as Db,
      strengthInput({ idempotencyKey: "tx-path" })
    );

    expect(result).toEqual({ duplicate: false });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(characterDoc(db).funds).toBe(4_000);
    expect(campaignDoc(db).campaignStrength).toBe(175);
    expect(activityDocs(db)).toHaveLength(1);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });

  it("surfaces the activity insert sentinel when the audit write fails", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = strengthInput({ idempotencyKey: "audit-fail" });
    const activity = db.collection("activityLog");
    activity.insertOne = (() => Promise.reject(new Error("audit down"))) as typeof activity.insertOne;

    await expect(applyCampaignStrengthSpend(db as unknown as Db, input)).rejects.toThrow(
      STRENGTH_ACTIVITY_FAILED
    );

    // The spend prefix compensated: no charge, no strength, receipt compensated.
    expect(characterDoc(db).funds).toBe(5_000);
    expect(campaignDoc(db).campaignStrength).toBe(100);
    expect(receipt(db, "audit-fail").status).toBe("compensated");
  });
});
