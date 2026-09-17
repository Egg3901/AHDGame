import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { applyPlayerAdSpend, PlayerAdSlotUnavailableError } from "./playerAdSpend";
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
// $ne-on-keys and $gte-on-balance filters; duplicate-key errors on insert),
// so an injected crash between any two writes models a real process death
// between the corresponding sequential Mongo writes.
// ---------------------------------------------------------------------------

function docKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id instanceof ObjectId) return id.toHexString();
  // structuredClone strips the ObjectId prototype on read-back; the raw
  // 12-byte buffer survives as an own property.
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

class FakeCollection {
  readonly docs = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly db: FakeDb,
    private readonly name: string
  ) {}

  private countWrite(): void {
    this.db.writeCount += 1;
    if (this.db.writeCount > this.db.crashAfterWrites) {
      throw new Error("INJECTED_CRASH");
    }
  }

  async insertOne(doc: Record<string, unknown>): Promise<{ insertedId: unknown }> {
    this.countWrite();
    // Models the ad-row write failing while the process survives (the
    // receipt claim must keep working so the flow can compensate).
    if (this.db.failInserts && this.name === "playerBannerAds") {
      throw new Error("INJECTED_INSERT_FAILURE");
    }
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

  // Supports only the window re-check query: characterId equality,
  // createdTurn $gte, and _id $ne (the flow's own deterministic row).
  // Anything else filters everything out.
  find(filter: Record<string, unknown>): {
    sort: (spec: Record<string, number>) => { toArray: () => Promise<Record<string, unknown>[]> };
  } {
    const rows = [...this.docs.values()].filter((doc) => {
      for (const [field, condition] of Object.entries(filter)) {
        if (field === "_id") {
          if (
            condition !== null &&
            typeof condition === "object" &&
            "$ne" in (condition as Record<string, unknown>)
          ) {
            if (docKey(doc._id) === docKey((condition as { $ne: unknown }).$ne)) return false;
            continue;
          }
          if (docKey(doc._id) !== docKey(condition)) return false;
          continue;
        }
        if (field === "characterId") {
          if (docKey(doc.characterId) !== docKey(condition)) return false;
          continue;
        }
        if (
          field === "createdTurn" &&
          condition !== null &&
          typeof condition === "object" &&
          "$gte" in (condition as Record<string, unknown>)
        ) {
          if (!((doc.createdTurn as number) >= (condition as { $gte: number }).$gte)) {
            return false;
          }
          continue;
        }
        return false;
      }
      return true;
    });
    return {
      sort: (spec: Record<string, number>) => ({
        toArray: async () => {
          const [[field, direction]] = Object.entries(spec);
          const sorted = [...rows].sort((a, b) =>
            direction === -1
              ? (b[field!] as number) - (a[field!] as number)
              : (a[field!] as number) - (b[field!] as number)
          );
          return sorted.map((doc) => structuredClone(doc));
        },
      }),
    };
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
  failInserts = false;
  private readonly collections = new Map<string, FakeCollection>();

  collection(name: string): FakeCollection {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new FakeCollection(this, name);
      this.collections.set(name, collection);
    }
    return collection;
  }
}

const characterId = new ObjectId();
const userId = new ObjectId();

function seedDb(db: FakeDb, cashOnHand = 1_000_000): void {
  db.collection("characters").docs.set(characterId.toHexString(), {
    _id: characterId,
    cashOnHand,
  });
}

function spendInput(overrides: Record<string, unknown> = {}) {
  return {
    characterId,
    userId,
    characterName: "Test Cand",
    countryId: "US",
    balanceField: "cashOnHand",
    cost: 500,
    isFree: false,
    imageUrl: "/ads/x.png",
    createdTurn: 110,
    currencyCode: "USD",
    windowStartTurn: 86,
    maxFree: 0,
    windowTurns: 24,
    fingerprint: `char:110:paid:500:USD`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function cashOnHand(db: FakeDb): number {
  return db.collection("characters").docs.get(characterId.toHexString())?.cashOnHand as number;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

function adRows(db: FakeDb): Record<string, unknown>[] {
  return [...db.collection("playerBannerAds").docs.values()];
}

describe("applyPlayerAdSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("charges once, records one ad row, and completes the receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "happy" });

    const result = await applyPlayerAdSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(cashOnHand(db)).toBe(1_000_000 - 500);
    expect(adRows(db)).toHaveLength(1);
    // The fake round-trips docs through structuredClone, which strips the
    // ObjectId prototype, so compare by hex.
    expect(docKey(adRows(db)[0]?._id)).toBe(result.adId.toHexString());
    expect(adRows(db)[0]?.costPaid).toBe(500);
    expect(adRows(db)[0]?.moderationStatus).toBe("pending");
    expect(receipt(db, "happy").status).toBe("completed");
  });

  it("records a free ad with no debit", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "free", isFree: true });

    const result = await applyPlayerAdSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(cashOnHand(db)).toBe(1_000_000);
    expect(adRows(db)).toHaveLength(1);
    expect(adRows(db)[0]?.costPaid).toBe(0);
    expect(receipt(db, "free").status).toBe("completed");
  });

  // Writes per paid attempt: 1 receipt claim, 2 cash debit, 3 ad-row insert,
  // 4 receipt settle. (The window re-check is a read.) A throw from the fake
  // models a real process death ONLY where no cleanup code runs for it: the
  // leg and the claim propagate untouched, so the retry reconciles. The
  // insert step converts a survived error into a compensatable failure (a
  // real crash would run no code at all), covered by the insert-failure test.
  it.each([0, 1, 2])(
    "reconciles a crash after %i successful writes to exactly one charged ad",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = spendInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyPlayerAdSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key reconciles.
      // Crash-on-write-0 left no receipt at all, so that retry is a fresh
      // attempt; every later crash reconciles an in-progress receipt.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyPlayerAdSpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      expect(cashOnHand(db)).toBe(1_000_000 - 500);
      expect(adRows(db)).toHaveLength(1);
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged ad", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 3;
    const input = spendInput({ idempotencyKey: "crash-settle" });

    await expect(applyPlayerAdSpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");

    // Debit and row survived; the retry replays every step as
    // already-applied (the row insert converges on the deterministic `_id`)
    // and settles completed.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyPlayerAdSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(true);
    expect(cashOnHand(db)).toBe(1_000_000 - 500);
    expect(adRows(db)).toHaveLength(1);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("replays a completed key without charging again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "replay" });

    const first = await applyPlayerAdSpend(db as unknown as Db, input);
    const second = await applyPlayerAdSpend(db as unknown as Db, input);

    expect(second.duplicate).toBe(true);
    expect(second.adId.toHexString()).toBe(first.adId.toHexString());
    expect(cashOnHand(db)).toBe(1_000_000 - 500);
    expect(adRows(db)).toHaveLength(1);
  });

  it("fails closed on insufficient funds with no ad row", async () => {
    const db = new FakeDb();
    seedDb(db, 100);
    const input = spendInput({ idempotencyKey: "broke" });

    await expect(applyPlayerAdSpend(db as unknown as Db, input)).rejects.toThrow(
      "PLAYER_AD_FUNDS_CHANGED"
    );

    expect(cashOnHand(db)).toBe(100);
    expect(adRows(db)).toHaveLength(0);
    expect(receipt(db, "broke").status).toBe("failed");
  });

  it("compensates the debit when the ad-row insert fails, then fails closed on retry", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.failInserts = true;
    const input = spendInput({ idempotencyKey: "insert-down" });

    await expect(applyPlayerAdSpend(db as unknown as Db, input)).rejects.toThrow(
      "PLAYER_AD_CONFLICT"
    );

    // The debit prefix was reversed; the receipt settles compensated.
    expect(cashOnHand(db)).toBe(1_000_000);
    expect(adRows(db)).toHaveLength(0);
    expect(receipt(db, "insert-down").status).toBe("compensated");

    db.failInserts = false;
    await expect(applyPlayerAdSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(cashOnHand(db)).toBe(1_000_000);
    expect(adRows(db)).toHaveLength(0);
  });

  it("blocks a raced within-window submit with no debit and no row", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A paid ad at turn 100 fills the non-patron window (24 turns, 0 free).
    db.collection("playerBannerAds").docs.set(new ObjectId().toHexString(), {
      _id: new ObjectId(),
      characterId,
      createdTurn: 100,
      costPaid: 50,
    });
    const input = spendInput({ idempotencyKey: "raced" });

    const error = await applyPlayerAdSpend(db as unknown as Db, input).catch((e) => e);
    expect(error).toBeInstanceOf(PlayerAdSlotUnavailableError);
    // 100 + 24 - 110 = 14 turns left.
    expect((error as PlayerAdSlotUnavailableError).turnsUntilEligible).toBe(14);
    expect(cashOnHand(db)).toBe(1_000_000);
    expect(adRows(db)).toHaveLength(1);
  });

  it("rejects a key reused for a different purchase", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyPlayerAdSpend(db as unknown as Db, spendInput({ idempotencyKey: "shared" }));

    await expect(
      applyPlayerAdSpend(
        db as unknown as Db,
        spendInput({ idempotencyKey: "shared", fingerprint: "char:110:paid:999:USD" })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(cashOnHand(db)).toBe(1_000_000 - 500);
    expect(adRows(db)).toHaveLength(1);
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
    const result = await applyPlayerAdSpend(
      db as unknown as Db,
      spendInput({ idempotencyKey: "tx-path" })
    );

    expect(result.duplicate).toBe(false);
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(cashOnHand(db)).toBe(1_000_000 - 500);
    expect(adRows(db)).toHaveLength(1);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });
});
