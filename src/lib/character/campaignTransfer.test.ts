import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { transferCharacterCampaignFunds } from "./campaignTransfer";
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
  return (id as ObjectId).toHexString();
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
    if (doc && !matchesLegFilter(doc, filter)) {
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
      (doc as Record<string, unknown>)[field] = value;
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

function matchesLegFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
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

const senderId = new ObjectId();
const targetId = new ObjectId();

function seedDb(db: FakeDb, senderFunds = 10_000, targetFunds = 500): void {
  db.collection("characters").docs.set(senderId.toHexString(), {
    _id: senderId,
    funds: senderFunds,
  });
  db.collection("characters").docs.set(targetId.toHexString(), {
    _id: targetId,
    funds: targetFunds,
  });
}

function balances(db: FakeDb): { sender: number; target: number } {
  const characters = db.collection("characters");
  return {
    sender: characters.docs.get(senderId.toHexString())?.funds as number,
    target: characters.docs.get(targetId.toHexString())?.funds as number,
  };
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

function transferInput(overrides: Record<string, unknown> = {}) {
  return {
    senderId,
    targetId,
    amountLocal: 1000,
    fundsField: "funds",
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

describe("transferCharacterCampaignFunds (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("moves funds exactly once and completes the receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = transferInput({ idempotencyKey: "happy" });

    const result = await transferCharacterCampaignFunds(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(balances(db)).toEqual({ sender: 9000, target: 1500 });
    expect(receipt(db, "happy").status).toBe("completed");
  });

  it.each([0, 1, 2, 3])(
    "reconciles a crash after %i successful writes to exactly one transfer",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = transferInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(transferCharacterCampaignFunds(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key reconciles.
      // Crash-on-write-0 left no receipt at all, so that retry is a fresh
      // attempt; every later crash reconciles an in-progress receipt.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await transferCharacterCampaignFunds(db as unknown as Db, input);

      expect(result).toEqual({ duplicate: crashAfter > 0 });
      expect(balances(db)).toEqual({ sender: 9000, target: 1500 });
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("replays a completed key without moving money again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = transferInput({ idempotencyKey: "replay" });

    await transferCharacterCampaignFunds(db as unknown as Db, input);
    const keysAfterFirst = [
      ...((db.collection("characters").docs.get(senderId.toHexString())!.appliedMoneyFlowKeys ??
        []) as string[]),
    ];
    const result = await transferCharacterCampaignFunds(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: true });
    expect(balances(db)).toEqual({ sender: 9000, target: 1500 });
    // Replay applies no leg: the recorded keys are untouched.
    expect(
      db.collection("characters").docs.get(senderId.toHexString())!.appliedMoneyFlowKeys
    ).toEqual(keysAfterFirst);
  });

  it("fails closed on insufficient funds and keeps the failure terminal", async () => {
    const db = new FakeDb();
    seedDb(db, 400, 500);
    const input = transferInput({ idempotencyKey: "poor" });

    await expect(transferCharacterCampaignFunds(db as unknown as Db, input)).rejects.toThrow(
      "INSUFFICIENT_FUNDS"
    );
    expect(balances(db)).toEqual({ sender: 400, target: 500 });
    expect(receipt(db, "poor").status).toBe("failed");

    // Same key after a terminal failure does not resurrect the transfer.
    await expect(transferCharacterCampaignFunds(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(balances(db)).toEqual({ sender: 400, target: 500 });
  });

  it("compensates the debit when the target is gone, exactly once", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("characters").docs.delete(targetId.toHexString());
    const input = transferInput({ idempotencyKey: "vanished" });

    await expect(transferCharacterCampaignFunds(db as unknown as Db, input)).rejects.toThrow(
      "TARGET_NOT_FOUND"
    );

    const senderDoc = db.collection("characters").docs.get(senderId.toHexString())!;
    expect(senderDoc.funds).toBe(10_000);
    expect(senderDoc.appliedMoneyFlowKeys).toContain("vanished");
    expect(senderDoc.appliedMoneyFlowKeys).toContain("vanished:compensate:sender-debit");
    expect(receipt(db, "vanished").status).toBe("compensated");

    await expect(transferCharacterCampaignFunds(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(
      (db.collection("characters").docs.get(senderId.toHexString()) as { funds: number }).funds
    ).toBe(10_000);
  });

  it("recovers a crash during compensation without refunding twice", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("characters").docs.delete(targetId.toHexString());
    // Writes: 1 receipt claim, 2 sender debit, 3 target credit attempt
    // (matches nothing), 4 compensating refund, 5 receipt settle. Crash on 5.
    db.crashAfterWrites = 4;
    const input = transferInput({ idempotencyKey: "crash-compensate" });

    await expect(transferCharacterCampaignFunds(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await expect(transferCharacterCampaignFunds(db as unknown as Db, input)).rejects.toThrow(
      "TARGET_NOT_FOUND"
    );

    // One debit, one refund: net zero, not a double refund.
    expect(
      (db.collection("characters").docs.get(senderId.toHexString()) as { funds: number }).funds
    ).toBe(10_000);
    expect(receipt(db, "crash-compensate").status).toBe("compensated");
  });

  it("rejects a key reused for a different transfer", async () => {
    const db = new FakeDb();
    seedDb(db);
    const first = transferInput({ idempotencyKey: "shared", amountLocal: 1000 });
    await transferCharacterCampaignFunds(db as unknown as Db, first);

    const second = transferInput({ idempotencyKey: "shared", amountLocal: 2000 });
    await expect(
      transferCharacterCampaignFunds(db as unknown as Db, second)
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(balances(db)).toEqual({ sender: 9000, target: 1500 });
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
    const input = transferInput({ idempotencyKey: "tx-path" });

    const result = await transferCharacterCampaignFunds(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(balances(db)).toEqual({ sender: 9000, target: 1500 });
    expect(receipt(db, "tx-path").status).toBe("completed");
  });

  it("applies dotted balance fields and caps stored keys", async () => {
    const db = new FakeDb();
    db.collection("characters").docs.set(senderId.toHexString(), {
      _id: senderId,
      currencyBalances: { campaign: 10_000 },
      appliedMoneyFlowKeys: Array.from({ length: 150 }, (_, i) => `old-${i}`),
    });
    db.collection("characters").docs.set(targetId.toHexString(), {
      _id: targetId,
      currencyBalances: { campaign: 500 },
    });
    const input = transferInput({
      idempotencyKey: "dotted",
      fundsField: "currencyBalances.campaign",
    });

    await transferCharacterCampaignFunds(db as unknown as Db, input);

    const senderDoc = db.collection("characters").docs.get(senderId.toHexString())!;
    expect((senderDoc.currencyBalances as { campaign: number }).campaign).toBe(9000);
    expect(
      (
        db.collection("characters").docs.get(targetId.toHexString()) as {
          currencyBalances: { campaign: number };
        }
      ).currencyBalances.campaign
    ).toBe(1500);
    const keys = senderDoc.appliedMoneyFlowKeys as string[];
    expect(keys).toContain("dotted");
    expect(keys.length).toBeLessThanOrEqual(100);
  });
});
