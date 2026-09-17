import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyBargainingEscalationSpend,
  ESCALATION_CAMPAIGN_CHANGED,
  ESCALATION_INSUFFICIENT_TREASURY,
  ESCALATION_SECTOR_CHANGED,
} from "./bargainingEscalationSpend";
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
// primitive and the escalation steps emit ($inc / $set / $unset / $push+$each
// / $pull+$in writes; _id equality, $ne-on-keys, $gte-on-balance, scalar
// equality guards; duplicate-key errors on insert), so an injected crash
// between any two writes models a real process death between the
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
  if ("$lte" in ops) {
    const current = typeof value === "number" ? value : Number.NEGATIVE_INFINITY;
    return current <= (ops.$lte as number);
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
    const pull = (update.$pull ?? {}) as Record<string, Record<string, { $in: unknown[] }>>;
    for (const [field, spec] of Object.entries(pull)) {
      const current = (doc[field] as Record<string, unknown>[] | undefined) ?? [];
      const [[pullField, pullCondition]] = Object.entries(spec);
      const banned = new Set((pullCondition.$in ?? []).map(docKey));
      doc[field] = current.filter((entry) => !banned.has(docKey(entry[pullField!])));
    }
    const unset = (update.$unset ?? {}) as Record<string, unknown>;
    for (const field of Object.keys(unset)) unsetPath(doc, field);
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

const unionId = new ObjectId();
const campaignId = new ObjectId();
const sectorId = new ObjectId();
const now = new Date("2026-02-01T00:00:00Z");
const priorCampaignUpdatedAt = new Date("2026-01-15T00:00:00Z");
const priorUnionUpdatedAt = new Date("2026-01-16T00:00:00Z");

const priorMandate = {
  coverage: 70,
  grievance: 50,
  laborTightness: 70,
  lawSupport: 60,
  strikeFundRunway: 4,
  support: 70,
  leverage: 60,
  organizedLocalCount: 1,
  totalLocalCount: 1,
};

function seedDb(db: FakeDb): void {
  db.collection("unions").docs.set(unionId.toHexString(), {
    _id: unionId,
    treasury: 2400,
    lastCalledStrikeTurn: null,
    updatedAt: priorUnionUpdatedAt,
  });
  db.collection("bargainingCampaigns").docs.set(campaignId.toHexString(), {
    _id: campaignId,
    status: "dispute",
    escalationLevel: "overtime_ban",
    lastActionTurn: 101,
    mandate: structuredClone(priorMandate),
    mandateUpdatedAtTurn: 101,
    escalationExpectations: [],
    updatedAt: priorCampaignUpdatedAt,
  });
  db.collection("corporateSectors").docs.set(sectorId.toHexString(), {
    _id: sectorId,
    strikeStartedAtTurn: null,
    workerExpectationIndex: 1.2,
  });
}

function escalationInput(overrides: Record<string, unknown> = {}) {
  return {
    campaignId,
    unionId,
    currentTurn: 102,
    now,
    priorEscalationLevel: "overtime_ban" as const,
    priorLastActionTurn: 101,
    nextEscalationLevel: "selective_strike" as const,
    nextMandate: { ...priorMandate, grievance: 80 },
    recordedExpectations: [{ sectorId, previousExpectationIndex: 1.2 }],
    priorMandate: structuredClone(priorMandate),
    priorCampaignUpdatedAt,
    priorEscalationStartedAtTurn: null,
    priorMandateUpdatedAtTurn: 101,
    cashCost: 400,
    priorLastCalledStrikeTurn: null,
    priorUnionUpdatedAt,
    strikes: [
      {
        sectorId,
        priorStrikeStartedAtTurn: null,
        priorExpectationIndex: 1.2,
        newExpectation: 2.5,
      },
    ],
    fingerprint: `${unionId.toHexString()}:${campaignId.toHexString()}:102:selective_strike:400`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function campaignDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("bargainingCampaigns").docs.get(campaignId.toHexString())!;
}

function unionDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("unions").docs.get(unionId.toHexString())!;
}

function sectorDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("corporateSectors").docs.get(sectorId.toHexString())!;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyBargainingEscalationSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("charges one escalation: claim lands, treasury debits, strikes start", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = escalationInput({ idempotencyKey: "escalate-happy" });

    const result = await applyBargainingEscalationSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(campaignDoc(db).escalationLevel).toBe("selective_strike");
    expect(campaignDoc(db).escalationStartedAtTurn).toBe(102);
    expect(campaignDoc(db).lastActionTurn).toBe(102);
    expect(campaignDoc(db).mandateUpdatedAtTurn).toBe(102);
    expect(
      (campaignDoc(db).escalationExpectations as { sectorId: ObjectId }[]).map((entry) =>
        entry.sectorId.toHexString()
      )
    ).toEqual([sectorId.toHexString()]);
    expect(unionDoc(db).treasury).toBe(2000);
    expect(unionDoc(db).lastCalledStrikeTurn).toBe(102);
    expect(sectorDoc(db).strikeStartedAtTurn).toBe(102);
    expect(sectorDoc(db).workerExpectationIndex).toBe(2.5);
    expect(receipt(db, "escalate-happy").status).toBe("completed");
  });

  it("runs a free rung with no debit step", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = escalationInput({ idempotencyKey: "escalate-free", cashCost: 0 });

    const result = await applyBargainingEscalationSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(unionDoc(db).treasury).toBe(2400);
    expect(unionDoc(db).lastCalledStrikeTurn).toBeNull();
    expect(campaignDoc(db).escalationLevel).toBe("selective_strike");
    expect(sectorDoc(db).strikeStartedAtTurn).toBe(102);
    expect(receipt(db, "escalate-free").status).toBe("completed");
  });

  // Writes per attempt: 1 receipt claim, 2 campaign claim, 3 treasury debit,
  // 4 strike start, 5 receipt settle. A throw from the fake models a real
  // process death ONLY where no cleanup code runs for it: the claim, the
  // debit leg, and the strike writes propagate untouched, so the retry
  // reconciles to exactly one charged escalation.
  it.each([0, 1, 2, 3])(
    "reconciles a crash after %i successful writes to exactly one charged escalation",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = escalationInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyBargainingEscalationSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key reconciles.
      // Crash-on-write-0 left no receipt at all, so that retry is a fresh
      // attempt; a later crash reconciles an in-progress receipt.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyBargainingEscalationSpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      expect(campaignDoc(db).escalationLevel).toBe("selective_strike");
      expect(unionDoc(db).treasury).toBe(2000);
      expect(sectorDoc(db).strikeStartedAtTurn).toBe(102);
      expect(sectorDoc(db).workerExpectationIndex).toBe(2.5);
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged escalation", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 4;
    const input = escalationInput({ idempotencyKey: "crash-settle" });

    await expect(applyBargainingEscalationSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // Every step survived; the retry replays them as already-applied and
    // settles completed.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyBargainingEscalationSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: true });
    expect(unionDoc(db).treasury).toBe(2000);
    expect(sectorDoc(db).strikeStartedAtTurn).toBe(102);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("fails closed with CAMPAIGN_CHANGED when the dispute moves, moving no money", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A concurrent escalation lands first and advances the claim guard.
    campaignDoc(db).escalationLevel = "selective_strike";
    const input = escalationInput({ idempotencyKey: "campaign-race" });

    await expect(applyBargainingEscalationSpend(db as unknown as Db, input)).rejects.toThrow(
      ESCALATION_CAMPAIGN_CHANGED
    );

    expect(unionDoc(db).treasury).toBe(2400);
    expect(sectorDoc(db).strikeStartedAtTurn).toBeNull();
    expect(receipt(db, "campaign-race").status).toBe("failed");
  });

  it("compensates the claim and the debit exactly when a strike start races", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A concurrent strike call starts the local first, so our strike guard rejects.
    sectorDoc(db).strikeStartedAtTurn = 99;
    const input = escalationInput({ idempotencyKey: "sector-race" });

    await expect(applyBargainingEscalationSpend(db as unknown as Db, input)).rejects.toThrow(
      ESCALATION_SECTOR_CHANGED
    );

    // The compensated escalation is invisible downstream: the campaign reads
    // exactly as before (level, mandate, no recorded expectations, no
    // introduced fields), the treasury is whole, and the raced strike stands.
    expect(campaignDoc(db).escalationLevel).toBe("overtime_ban");
    expect(campaignDoc(db).lastActionTurn).toBe(101);
    expect(campaignDoc(db).mandate).toEqual(priorMandate);
    expect(campaignDoc(db).escalationExpectations).toEqual([]);
    expect(campaignDoc(db).escalationStartedAtTurn).toBeUndefined();
    expect(campaignDoc(db).mandateUpdatedAtTurn).toBe(101);
    expect(unionDoc(db).treasury).toBe(2400);
    expect(unionDoc(db).lastCalledStrikeTurn).toBeNull();
    expect(unionDoc(db).updatedAt).toEqual(priorUnionUpdatedAt);
    expect(sectorDoc(db).strikeStartedAtTurn).toBe(99);
    expect(sectorDoc(db).workerExpectationIndex).toBe(1.2);
    expect(receipt(db, "sector-race").status).toBe("compensated");
  });

  it("restores the exact prior campaign when the strike fund cannot cover the rung", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = escalationInput({ idempotencyKey: "poor-union", cashCost: 99999 });

    await expect(applyBargainingEscalationSpend(db as unknown as Db, input)).rejects.toThrow(
      ESCALATION_INSUFFICIENT_TREASURY
    );

    expect(campaignDoc(db).escalationLevel).toBe("overtime_ban");
    expect(campaignDoc(db).mandate).toEqual(priorMandate);
    expect(campaignDoc(db).escalationExpectations).toEqual([]);
    expect(sectorDoc(db).strikeStartedAtTurn).toBeNull();
    expect(unionDoc(db).treasury).toBe(2400);
    expect(receipt(db, "poor-union").status).toBe("compensated");
  });

  it("keeps a terminal failure terminal across retries", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = escalationInput({ idempotencyKey: "poor-retry", cashCost: 99999 });

    await expect(applyBargainingEscalationSpend(db as unknown as Db, input)).rejects.toThrow(
      ESCALATION_INSUFFICIENT_TREASURY
    );
    await expect(applyBargainingEscalationSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(unionDoc(db).treasury).toBe(2400);
    expect(campaignDoc(db).escalationLevel).toBe("overtime_ban");
  });

  it("replays a completed key without charging or striking again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = escalationInput({ idempotencyKey: "replay" });

    const first = await applyBargainingEscalationSpend(db as unknown as Db, input);
    const second = await applyBargainingEscalationSpend(db as unknown as Db, input);

    expect(first).toEqual({ duplicate: false });
    expect(second).toEqual({ duplicate: true });
    expect(unionDoc(db).treasury).toBe(2000);
    expect(sectorDoc(db).strikeStartedAtTurn).toBe(102);
  });

  it("rejects a key reused for a different escalation", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyBargainingEscalationSpend(
      db as unknown as Db,
      escalationInput({ idempotencyKey: "shared" })
    );

    await expect(
      applyBargainingEscalationSpend(
        db as unknown as Db,
        escalationInput({
          idempotencyKey: "shared",
          cashCost: 500,
          fingerprint: `${unionId.toHexString()}:${campaignId.toHexString()}:102:selective_strike:500`,
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(unionDoc(db).treasury).toBe(2000);
  });

  it("leaves the prefix stranded-but-visible when compensation itself crashes", async () => {
    const db = new FakeDb();
    seedDb(db);
    // The strike guard rejects (moved local). Compensation runs in reverse
    // (fund revert, then campaign revert); the crash lands on the campaign
    // revert, the second compensation write.
    sectorDoc(db).strikeStartedAtTurn = 99;
    const input = escalationInput({ idempotencyKey: "comp-crash" });
    const campaigns = db.collection("bargainingCampaigns");
    const realUpdate = campaigns.updateOne.bind(campaigns);
    let calls = 0;
    campaigns.updateOne = (async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => {
      calls += 1;
      // Call 1 is the campaign claim; call 2 is its compensation revert.
      // (The fund revert runs on unions, so campaign writes isolate the
      // claim/revert pair.)
      if (calls === 2) throw new Error("INJECTED_CRASH");
      return realUpdate(filter, update);
    }) as typeof campaigns.updateOne;

    await expect(applyBargainingEscalationSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // The claim applied and the strike never landed; the fund revert ran, but
    // the campaign revert never did: the receipt rests in_progress (fail open
    // by crash, TTL-visible) rather than pretending the prefix was reversed.
    expect(campaignDoc(db).escalationLevel).toBe("selective_strike");
    expect(unionDoc(db).treasury).toBe(2400);
    expect(unionDoc(db).lastCalledStrikeTurn).toBeNull();
    expect(receipt(db, "comp-crash").status).toBe("in_progress");
  });

  it("rejects negative costs and bad keys before touching storage", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyBargainingEscalationSpend(db as unknown as Db, escalationInput({ cashCost: -1 }))
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      applyBargainingEscalationSpend(db as unknown as Db, escalationInput({ idempotencyKey: "" }))
    ).rejects.toBeInstanceOf(RangeError);
    expect(campaignDoc(db).escalationLevel).toBe("overtime_ban");
    expect(unionDoc(db).treasury).toBe(2400);
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

    const result = await applyBargainingEscalationSpend(
      db as unknown as Db,
      escalationInput({ idempotencyKey: "tx-path" })
    );

    expect(result).toEqual({ duplicate: false });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(campaignDoc(db).escalationLevel).toBe("selective_strike");
    expect(unionDoc(db).treasury).toBe(2000);
    expect(sectorDoc(db).strikeStartedAtTurn).toBe(102);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });
});
