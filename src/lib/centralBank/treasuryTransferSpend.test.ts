import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { applyTreasuryTransferSpend, TreasuryTransferBusyError } from "./treasuryTransferSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";
import type { TreasuryTransferRecord } from "@/lib/db/types/centralBank";

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
// Stateful in-memory fakes. They honor exactly the operators the spend flow
// emits ($inc / $set / $push+$each+$slice / $pull / $unset writes; _id
// equality, $or, $ne-on-keys, $gte-on-balance and $exists filters; duplicate
// key errors on insert), so an injected crash between any two writes models a
// real process death between the corresponding sequential Mongo writes.
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

function deletePath(doc: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = node[parts[i]!] as Record<string, unknown> | undefined;
    if (typeof next !== "object" || next === null) return;
    node = next;
  }
  delete node[parts[parts.length - 1]!];
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_, entry) =>
    entry instanceof Date ? `date:${entry.toISOString()}` : entry
  );
}

function matchesClause(doc: Record<string, unknown>, field: string, condition: unknown): boolean {
  if (condition !== null && typeof condition === "object" && !Array.isArray(condition)) {
    const ops = condition as Record<string, unknown>;
    if ("$ne" in ops) {
      const keys = doc[field] as string[] | undefined;
      if (keys?.includes(ops.$ne as string)) return false;
      return true;
    }
    if ("$gte" in ops) {
      const balance = getPath(doc, field) as number | undefined;
      return (balance ?? Number.NEGATIVE_INFINITY) >= (ops.$gte as number);
    }
    if ("$exists" in ops) {
      const exists = getPath(doc, field) !== undefined;
      return exists === (ops.$exists as boolean);
    }
    return stable(getPath(doc, field)) === stable(condition);
  }
  return stable(getPath(doc, field)) === stable(condition);
}

function matchesFlowFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    if (field === "$or") {
      const branches = condition as Record<string, unknown>[];
      if (!branches.some((branch) => matchesFlowFilter(doc, branch))) return false;
      continue;
    }
    if (!matchesClause(doc, field, condition)) return false;
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
    _opts?: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return null;
    return structuredClone(doc);
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    _opts?: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    this.countWrite();
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return null;
    if (!matchesFlowFilter(doc, filter)) return null;
    const before = structuredClone(doc);
    applyUpdate(doc, update);
    return before;
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    if (!matchesFlowFilter(doc, filter)) return { matchedCount: 0, modifiedCount: 0 };
    applyUpdate(doc, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>): void {
  const inc = (update.$inc ?? {}) as Record<string, number>;
  for (const [field, delta] of Object.entries(inc)) {
    setPath(doc, field, ((getPath(doc, field) as number | undefined) ?? 0) + delta);
  }
  const push = (update.$push ?? {}) as Record<string, { $each: unknown[]; $slice: number }>;
  for (const [field, spec] of Object.entries(push)) {
    if (field === "appliedMoneyFlowKeys") {
      const current = (doc.appliedMoneyFlowKeys as string[] | undefined) ?? [];
      const next = [...current, ...(spec.$each as string[])];
      doc.appliedMoneyFlowKeys = spec.$slice < 0 ? next.slice(spec.$slice) : next;
    } else {
      const current = (getPath(doc, field) as unknown[] | undefined) ?? [];
      const next = [...current, ...spec.$each.map((entry) => structuredClone(entry))];
      setPath(doc, field, spec.$slice < 0 ? next.slice(spec.$slice) : next);
    }
  }
  const pull = (update.$pull ?? {}) as Record<string, unknown>;
  for (const [field, match] of Object.entries(pull)) {
    const current = (getPath(doc, field) as unknown[] | undefined) ?? [];
    setPath(
      doc,
      field,
      current.filter((entry) => stable(entry) !== stable(match))
    );
  }
  const unset = (update.$unset ?? {}) as Record<string, unknown>;
  for (const field of Object.keys(unset)) deletePath(doc, field);
  const set = (update.$set ?? {}) as Record<string, unknown>;
  for (const [field, value] of Object.entries(set)) {
    setPath(doc, field, value);
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

const actorId = new ObjectId();

function seedDb(db: FakeDb, surplus = 100_000, reserve = 5_000): void {
  db.collection("federalBudget").docs.set("federal", {
    _id: "federal",
    surplus,
    spending: { byCategory: {}, total: 900_000 },
  });
  db.collection("centralBanks").docs.set("US", {
    _id: "US",
    reserveBalance: reserve,
    treasuryTransferHistory: [],
  });
}

function spendInput(overrides: Record<string, unknown> = {}) {
  const record: TreasuryTransferRecord = {
    turn: 100,
    transferredBy: actorId,
    transferredByName: "Secretary Character",
    amount: 1_000,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  return {
    budgetId: "federal",
    bankId: "US",
    amount: 1_000,
    debtCeiling: 10_000_000,
    currentTurn: 100,
    isAdmin: false,
    record,
    fingerprint: `US:federal:1000:100:${actorId.toHexString()}`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function money(db: FakeDb): { surplus: number; reserve: number } {
  return {
    surplus: db.collection("federalBudget").docs.get("federal")?.surplus as number,
    reserve: db.collection("centralBanks").docs.get("US")?.reserveBalance as number,
  };
}

function bankDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("centralBanks").docs.get("US")!;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyTreasuryTransferSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("moves surplus to reserves, pushes one history entry, and completes the receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "happy" });

    const result = await applyTreasuryTransferSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(result.adopted).toBe(false);
    expect(money(db)).toEqual({ surplus: 99_000, reserve: 6_000 });
    const history = bankDoc(db).treasuryTransferHistory as TreasuryTransferRecord[];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ turn: 100, amount: 1_000 });
    // The success path releases the mutex in the same write as the credit.
    expect(bankDoc(db).treasuryTransferInProgressAt).toBeUndefined();
    expect(bankDoc(db).treasuryTransferClaimKey).toBeUndefined();
    expect(receipt(db, "happy").status).toBe("completed");
  });

  // Writes per attempt: 1 receipt claim, 2 mutex claim, 3 budget debit,
  // 4 reserve credit (+ history push + mutex release), 5 receipt settle. A
  // throw from the fake models a process death ONLY where no cleanup code
  // runs for it, so the retry with the same key reconciles.
  it.each([0, 1, 2, 3])(
    "reconciles a crash after %i successful writes to exactly one transfer",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = spendInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyTreasuryTransferSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key re-adopts its own
      // stale claim (crash-on-write-0/1 left no claim at all, so that retry
      // is a fresh claim) and converges instead of moving money twice.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyTreasuryTransferSpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      // Crash-on-write-0/1 left no claim behind (fresh claim on retry); any
      // later crash left this key's claim held, which the retry adopts.
      expect(result.adopted).toBe(crashAfter >= 2);
      expect(money(db)).toEqual({ surplus: 99_000, reserve: 6_000 });
      expect(bankDoc(db).treasuryTransferHistory as unknown[]).toHaveLength(1);
      expect(bankDoc(db).treasuryTransferInProgressAt).toBeUndefined();
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one transfer", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 4;
    const input = spendInput({ idempotencyKey: "crash-settle" });

    await expect(applyTreasuryTransferSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // Debit, credit, history push, and mutex release all survived; the retry
    // replays both steps as already-applied and settles completed. The claim
    // itself was released by the survived bank write, so the retry takes a
    // fresh claim rather than adopting a stale one.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyTreasuryTransferSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(true);
    expect(result.adopted).toBe(false);
    expect(money(db)).toEqual({ surplus: 99_000, reserve: 6_000 });
    expect(bankDoc(db).treasuryTransferHistory as unknown[]).toHaveLength(1);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("holds the mutex against a second key while a claim is live", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A live claim owned by another attempt.
    const live = bankDoc(db);
    live.treasuryTransferInProgressAt = new Date("2026-01-01T00:00:00Z");
    live.treasuryTransferClaimKey = "other-key";

    await expect(
      applyTreasuryTransferSpend(db as unknown as Db, spendInput())
    ).rejects.toBeInstanceOf(TreasuryTransferBusyError);
    expect(money(db)).toEqual({ surplus: 100_000, reserve: 5_000 });
  });

  it("rejects a same-turn second transfer for non-admins and allows admins", async () => {
    const db = new FakeDb();
    seedDb(db);
    bankDoc(db).treasuryTransferHistory = [
      {
        turn: 100,
        transferredBy: actorId,
        transferredByName: "Secretary Character",
        amount: 500,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    await expect(
      applyTreasuryTransferSpend(db as unknown as Db, spendInput({ idempotencyKey: "second" }))
    ).rejects.toBeInstanceOf(TreasuryTransferBusyError);
    expect(money(db)).toEqual({ surplus: 100_000, reserve: 5_000 });

    const adminResult = await applyTreasuryTransferSpend(
      db as unknown as Db,
      spendInput({ idempotencyKey: "admin-second", isAdmin: true })
    );
    expect(adminResult.duplicate).toBe(false);
    expect(money(db)).toEqual({ surplus: 99_000, reserve: 6_000 });
  });

  it("replays a completed key without moving money or pushing history again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "replay" });

    const first = await applyTreasuryTransferSpend(db as unknown as Db, input);
    const second = await applyTreasuryTransferSpend(db as unknown as Db, input);

    expect(second.duplicate).toBe(true);
    expect(second.record).toEqual(first.record);
    expect(money(db)).toEqual({ surplus: 99_000, reserve: 6_000 });
    expect(bankDoc(db).treasuryTransferHistory as unknown[]).toHaveLength(1);
  });

  it("fails closed on a debt-ceiling breach and releases its own claim", async () => {
    const db = new FakeDb();
    // Surplus -9.8M, ceiling 10M, amount 500K: floor is -9.5M, so the guarded
    // debit rejects.
    seedDb(db, -9_800_000, 5_000);
    const input = spendInput({
      idempotencyKey: "breach",
      amount: 500_000,
      record: {
        turn: 100,
        transferredBy: actorId,
        transferredByName: "Secretary Character",
        amount: 500_000,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      fingerprint: `US:federal:500000:100:${actorId.toHexString()}`,
    });

    await expect(applyTreasuryTransferSpend(db as unknown as Db, input)).rejects.toThrow(
      "Transfer would breach the federal debt ceiling."
    );
    expect(money(db)).toEqual({ surplus: -9_800_000, reserve: 5_000 });
    expect(bankDoc(db).treasuryTransferHistory as unknown[]).toHaveLength(0);
    // Nothing applied: receipt failed, and the claim is released so the next
    // attempt is not stuck behind this one's mutex.
    expect(receipt(db, "breach").status).toBe("failed");
    expect(bankDoc(db).treasuryTransferInProgressAt).toBeUndefined();

    await expect(applyTreasuryTransferSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });

  it("compensates the budget debit when the bank settlement cannot land", async () => {
    const db = new FakeDb();
    seedDb(db);
    // The bank row vanishes after the claim: the reserve-credit step reports
    // missing, so the applied budget prefix is refunded, not stranded.
    const banks = db.collection("centralBanks");
    const realUpdateOne = banks.updateOne.bind(banks);
    let claimSeen = false;
    banks.updateOne = (async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      // The bank step's filter carries no claim key (the release does): that
      // is the write the row vanishes under.
      if (!claimSeen && filter.treasuryTransferClaimKey === undefined) {
        claimSeen = true;
        banks.docs.delete("US");
      }
      return realUpdateOne(filter, update);
    }) as typeof banks.updateOne;
    const input = spendInput({ idempotencyKey: "bank-lost" });

    await expect(applyTreasuryTransferSpend(db as unknown as Db, input)).rejects.toThrow(
      "TREASURY_TRANSFER_CLAIM_LOST"
    );

    // Budget refunded (debit plus spending lines), receipt compensated. The
    // key-scoped release finds no bank row, which is itself a no-op.
    expect(db.collection("federalBudget").docs.get("federal")?.surplus).toBe(100_000);
    expect(receipt(db, "bank-lost").status).toBe("compensated");

    await expect(applyTreasuryTransferSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(db.collection("federalBudget").docs.get("federal")?.surplus).toBe(100_000);
  });

  it("recovers a crash during compensation without refunding twice", async () => {
    const db = new FakeDb();
    seedDb(db);
    // The bank row vanishes exactly at the reserve-credit write (and is
    // restored right after, so later claims and disambiguation reads still
    // see it): the step reports guard-rejected, so the applied budget prefix
    // is refunded. The failure recurs deterministically, so the retry
    // converges instead of diverging.
    const banks = db.collection("centralBanks");
    const realUpdateOne = banks.updateOne.bind(banks);
    banks.updateOne = (async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const isBankStep = filter._id === "US" && !("treasuryTransferClaimKey" in filter);
      if (!isBankStep) return realUpdateOne(filter, update);
      const saved = banks.docs.get("US");
      banks.docs.delete("US");
      const result = await realUpdateOne(filter, update);
      banks.docs.set("US", saved!);
      return result;
    }) as typeof banks.updateOne;
    // Writes: 1 receipt claim, 2 mutex claim, 3 budget debit, 4 bank attempt
    // (miss), 5 compensating refund, 6 receipt settle. Crash on 6.
    db.crashAfterWrites = 5;
    const input = spendInput({ idempotencyKey: "crash-compensate" });

    await expect(applyTreasuryTransferSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await expect(applyTreasuryTransferSpend(db as unknown as Db, input)).rejects.toThrow(
      "TREASURY_TRANSFER_CLAIM_LOST"
    );

    // One debit, one refund: net zero, not a double refund.
    expect(db.collection("federalBudget").docs.get("federal")?.surplus).toBe(100_000);
    expect(receipt(db, "crash-compensate").status).toBe("compensated");
  });

  it("rejects a key reused for a different transfer", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyTreasuryTransferSpend(db as unknown as Db, spendInput({ idempotencyKey: "shared" }));

    await expect(
      applyTreasuryTransferSpend(
        db as unknown as Db,
        spendInput({
          idempotencyKey: "shared",
          amount: 2_000,
          fingerprint: `US:federal:2000:100:${actorId.toHexString()}`,
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(money(db)).toEqual({ surplus: 99_000, reserve: 6_000 });
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
    const result = await applyTreasuryTransferSpend(
      db as unknown as Db,
      spendInput({ idempotencyKey: "tx-path" })
    );

    expect(result.duplicate).toBe(false);
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(money(db)).toEqual({ surplus: 99_000, reserve: 6_000 });
    expect(bankDoc(db).treasuryTransferHistory as unknown[]).toHaveLength(1);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });

  it("caps history at the ring-buffer maximum", async () => {
    const db = new FakeDb();
    seedDb(db);
    const { TREASURY_TRANSFER_HISTORY_MAX } = await import("@/lib/constants/currencies");
    bankDoc(db).treasuryTransferHistory = Array.from(
      { length: TREASURY_TRANSFER_HISTORY_MAX + 5 },
      (_, index) => ({
        turn: 90 + index,
        transferredBy: actorId,
        transferredByName: "Secretary Character",
        amount: 100,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      })
    );

    await applyTreasuryTransferSpend(
      db as unknown as Db,
      spendInput({ idempotencyKey: "ring", isAdmin: true, currentTurn: 200 })
    );

    const history = bankDoc(db).treasuryTransferHistory as TreasuryTransferRecord[];
    expect(history).toHaveLength(TREASURY_TRANSFER_HISTORY_MAX);
    expect(history[history.length - 1]).toMatchObject({ turn: 100, amount: 1_000 });
  });
});
