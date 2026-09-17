import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyUnionBustingSpend,
  BUSTING_COOLDOWN_ACTIVE,
  BUSTING_INSUFFICIENT_FUNDS,
} from "./unionBustingSpend";
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
// primitive emits ($inc / $push+$each+$slice / $set writes; _id equality,
// $ne-on-keys, $gte-on-balance, $or cooldown alternatives, $lte/$exists
// guards; duplicate-key errors on insert), so an injected crash between any
// two writes models a real process death between the corresponding
// sequential Mongo writes.
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

function matchesCondition(
  doc: Record<string, unknown>,
  field: string,
  condition: unknown
): boolean {
  const value = getPath(doc, field);
  if (condition === null || condition === undefined) return value == null;
  if (typeof condition !== "object") return value === condition;
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

const corpId = new ObjectId();
const sectorId = new ObjectId();

function seedDb(db: FakeDb): void {
  db.collection("corporations").docs.set(corpId.toHexString(), {
    _id: corpId,
    liquidCapital: 1_000_000,
  });
  db.collection("corporateSectors").docs.set(sectorId.toHexString(), {
    _id: sectorId,
    unionization: 50,
    bustingCooldownUntilTurn: null,
    strikeStartedAtTurn: 8,
    strikeCooldownUntilTurn: null,
  });
}

function bustingInput(overrides: Record<string, unknown> = {}) {
  return {
    corporationId: corpId,
    sectorId,
    currentTurn: 10,
    cashCost: 12000,
    prior: {
      unionization: 50,
      bustingCooldownUntilTurn: null,
      strikeStartedAtTurn: 8,
      strikeCooldownUntilTurn: null,
    },
    newUnionization: 30,
    cooldownUntilTurn: 22,
    endsActiveStrike: true,
    strikeCooldownUntilTurn: 22,
    fingerprint: `${corpId.toHexString()}:${sectorId.toHexString()}:10:12000`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function sectorDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("corporateSectors").docs.get(sectorId.toHexString())!;
}

function corpCash(db: FakeDb): number {
  return db.collection("corporations").docs.get(corpId.toHexString())?.liquidCapital as number;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyUnionBustingSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("charges one successful bust: unionization drops, cooldown lands, strike ends", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = bustingInput({ idempotencyKey: "bust-happy" });

    const result = await applyUnionBustingSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false, unionization: 30 });
    expect(sectorDoc(db).unionization).toBe(30);
    expect(sectorDoc(db).bustingCooldownUntilTurn).toBe(22);
    expect(sectorDoc(db).strikeStartedAtTurn).toBeNull();
    expect(sectorDoc(db).strikeCooldownUntilTurn).toBe(22);
    expect(corpCash(db)).toBe(1_000_000 - 12000);
    expect(receipt(db, "bust-happy").status).toBe("completed");
  });

  it("leaves an active strike untouched on a backfire outcome", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = bustingInput({
      idempotencyKey: "bust-backfire",
      newUnionization: 60,
      endsActiveStrike: false,
    });

    const result = await applyUnionBustingSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false, unionization: 60 });
    expect(sectorDoc(db).unionization).toBe(60);
    expect(sectorDoc(db).strikeStartedAtTurn).toBe(8);
    expect(sectorDoc(db).strikeCooldownUntilTurn).toBeNull();
    expect(corpCash(db)).toBe(1_000_000 - 12000);
  });

  // Writes per attempt: 1 receipt claim, 2 sector claim, 3 cash debit,
  // 4 receipt settle. A throw from the fake models a real process death ONLY
  // where no cleanup code runs for it: the claim and the debit leg propagate
  // untouched, so the retry reconciles to exactly one charged bust.
  it.each([0, 1, 2])(
    "reconciles a crash after %i successful writes to exactly one charged bust",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = bustingInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyUnionBustingSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key reconciles.
      // Crash-on-write-0 left no receipt at all, so that retry is a fresh
      // attempt; a later crash reconciles an in-progress receipt and reports
      // the stored unionization.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyUnionBustingSpend(db as unknown as Db, input);

      expect(result.unionization).toBe(30);
      expect(result.duplicate).toBe(crashAfter > 0);
      expect(sectorDoc(db).unionization).toBe(30);
      expect(sectorDoc(db).bustingCooldownUntilTurn).toBe(22);
      expect(sectorDoc(db).strikeStartedAtTurn).toBeNull();
      expect(corpCash(db)).toBe(1_000_000 - 12000);
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged bust", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 3;
    const input = bustingInput({ idempotencyKey: "crash-settle" });

    await expect(applyUnionBustingSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // Claim and debit both survived; the retry replays every step as
    // already-applied and settles completed.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyUnionBustingSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(true);
    expect(result.unionization).toBe(30);
    expect(sectorDoc(db).unionization).toBe(30);
    expect(corpCash(db)).toBe(1_000_000 - 12000);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("reports the stored unionization when a recovery retry recomputes a different roll", async () => {
    const db = new FakeDb();
    seedDb(db);
    const first = bustingInput({ idempotencyKey: "reroll", newUnionization: 30 });
    await applyUnionBustingSpend(db as unknown as Db, first);

    // Same key, same attempt fingerprint, but this call rolled a backfire.
    // The steps converge onto the first attempt; the stored outcome wins.
    const retry = bustingInput({ idempotencyKey: "reroll", newUnionization: 60 });
    const result = await applyUnionBustingSpend(db as unknown as Db, retry);

    expect(result).toEqual({ duplicate: true, unionization: 30 });
    expect(sectorDoc(db).unionization).toBe(30);
    expect(corpCash(db)).toBe(1_000_000 - 12000);
  });

  it("fails closed with COOLDOWN_ACTIVE when the sector claim races, never debiting", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A concurrent bust lands first and sets the cooldown past this turn.
    sectorDoc(db).bustingCooldownUntilTurn = 30;
    const input = bustingInput({ idempotencyKey: "cooldown-race" });

    await expect(applyUnionBustingSpend(db as unknown as Db, input)).rejects.toThrow(
      BUSTING_COOLDOWN_ACTIVE
    );

    expect(corpCash(db)).toBe(1_000_000);
    expect(sectorDoc(db).unionization).toBe(50);
    expect(receipt(db, "cooldown-race").status).toBe("failed");
  });

  it("restores the exact prior sector when the cash debit cannot be written", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = bustingInput({ idempotencyKey: "poor-corp", cashCost: 5_000_000 });

    await expect(applyUnionBustingSpend(db as unknown as Db, input)).rejects.toThrow(
      BUSTING_INSUFFICIENT_FUNDS
    );

    // The compensated attempt is invisible downstream: unionization,
    // cooldown, and both strike fields read exactly as before.
    expect(sectorDoc(db).unionization).toBe(50);
    expect(sectorDoc(db).bustingCooldownUntilTurn).toBeNull();
    expect(sectorDoc(db).strikeStartedAtTurn).toBe(8);
    expect(sectorDoc(db).strikeCooldownUntilTurn).toBeNull();
    expect(corpCash(db)).toBe(1_000_000);
    expect(receipt(db, "poor-corp").status).toBe("compensated");
  });

  it("keeps an insufficient-funds failure terminal across retries", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = bustingInput({ idempotencyKey: "poor-retry", cashCost: 5_000_000 });

    await expect(applyUnionBustingSpend(db as unknown as Db, input)).rejects.toThrow(
      BUSTING_INSUFFICIENT_FUNDS
    );
    await expect(applyUnionBustingSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(sectorDoc(db).unionization).toBe(50);
    expect(corpCash(db)).toBe(1_000_000);
  });

  it("loses a cooldown race between two keys to exactly one winner", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyUnionBustingSpend(
      db as unknown as Db,
      bustingInput({ idempotencyKey: "race-winner" })
    );

    // The winner's cooldown now guards the sector: the loser's claim rejects.
    await expect(
      applyUnionBustingSpend(db as unknown as Db, bustingInput({ idempotencyKey: "race-loser" }))
    ).rejects.toThrow(BUSTING_COOLDOWN_ACTIVE);
    expect(corpCash(db)).toBe(1_000_000 - 12000);
    expect(sectorDoc(db).unionization).toBe(30);
  });

  it("replays a completed key without charging or writing again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = bustingInput({ idempotencyKey: "replay" });

    const first = await applyUnionBustingSpend(db as unknown as Db, input);
    const second = await applyUnionBustingSpend(db as unknown as Db, input);

    expect(first).toEqual({ duplicate: false, unionization: 30 });
    expect(second).toEqual({ duplicate: true, unionization: 30 });
    expect(corpCash(db)).toBe(1_000_000 - 12000);
    expect(sectorDoc(db).unionization).toBe(30);
  });

  it("rejects a key reused for a different attempt", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyUnionBustingSpend(db as unknown as Db, bustingInput({ idempotencyKey: "shared" }));

    await expect(
      applyUnionBustingSpend(
        db as unknown as Db,
        bustingInput({
          idempotencyKey: "shared",
          cashCost: 13000,
          fingerprint: `${corpId.toHexString()}:${sectorId.toHexString()}:10:13000`,
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(corpCash(db)).toBe(1_000_000 - 12000);
    expect(sectorDoc(db).unionization).toBe(30);
  });

  it("leaves the claim stranded-but-visible when compensation itself crashes", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = bustingInput({ idempotencyKey: "comp-crash", cashCost: 5_000_000 });
    const sectors = db.collection("corporateSectors");
    const realUpdate = sectors.updateOne.bind(sectors);
    let calls = 0;
    sectors.updateOne = (async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => {
      calls += 1;
      // Call 1 is the sector claim; call 2 is the compensation revert.
      if (calls === 2) throw new Error("INJECTED_CRASH");
      return realUpdate(filter, update);
    }) as typeof sectors.updateOne;

    await expect(applyUnionBustingSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // The claim applied, the debit never landed, the revert never ran: the
    // receipt rests in_progress (fail open by crash, TTL-visible) rather than
    // pretending the claim was reversed.
    expect(sectorDoc(db).unionization).toBe(30);
    expect(corpCash(db)).toBe(1_000_000);
    expect(receipt(db, "comp-crash").status).toBe("in_progress");
  });

  it("rejects non-positive costs and bad keys before touching storage", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyUnionBustingSpend(db as unknown as Db, bustingInput({ cashCost: 0 }))
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      applyUnionBustingSpend(db as unknown as Db, bustingInput({ idempotencyKey: "" }))
    ).rejects.toBeInstanceOf(RangeError);
    expect(sectorDoc(db).unionization).toBe(50);
    expect(corpCash(db)).toBe(1_000_000);
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

    const result = await applyUnionBustingSpend(
      db as unknown as Db,
      bustingInput({ idempotencyKey: "tx-path" })
    );

    expect(result).toEqual({ duplicate: false, unionization: 30 });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(sectorDoc(db).unionization).toBe(30);
    expect(corpCash(db)).toBe(1_000_000 - 12000);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });
});
