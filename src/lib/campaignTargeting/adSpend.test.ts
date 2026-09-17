import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyStandingAdSpend,
  applyTargetedAdSpend,
  AD_SPEND_CONFLICT,
  AD_SPEND_INSUFFICIENT,
  type AdSpendInput,
} from "./adSpend";
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
// Stateful in-memory fakes honoring the operators the ad-spend flow emits
// ($inc / $set / $push+$each+$slice; _id equality, $ne, $gte, $exists and
// scalar-equality filters; duplicate-key errors on insert), so an injected
// crash between any two writes models a real process death.
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

function matchesAdFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    const value = getPath(doc, field);
    if (condition !== null && typeof condition === "object" && !Array.isArray(condition)) {
      const ops = condition as Record<string, unknown>;
      if ("$ne" in ops) {
        const banned = ops.$ne;
        if (Array.isArray(value) ? value.includes(banned) : value === banned) return false;
        continue;
      }
      if ("$gte" in ops) {
        const balance = (value as number | undefined) ?? Number.NEGATIVE_INFINITY;
        if (!(balance >= (ops.$gte as number))) return false;
        continue;
      }
      if ("$exists" in ops) {
        if ((value !== undefined) !== (ops.$exists as boolean)) return false;
        continue;
      }
      return false;
    }
    if (JSON.stringify(value) !== JSON.stringify(condition)) return false;
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
    if (doc && !matchesAdFilter(doc, filter)) {
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
      setPath(doc, field, structuredClone(value));
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

const payerId = new ObjectId();
const candidateId = new ObjectId();
const ownerId = new ObjectId();

const purchasedAds = [
  {
    stateId: "IA",
    dimension: "age",
    bucket: "18-29",
    bonus: 3,
    expiresTurn: 20,
    purchasedAtTurn: 10,
  },
];

function seedDb(db: FakeDb): void {
  db.collection("characters").docs.set(payerId.toHexString(), {
    _id: payerId,
    actions: 10,
    currencyBalances: { campaign: 1000 },
  });
  db.collection("characters").docs.set(ownerId.toHexString(), {
    _id: ownerId,
    targetedAds: [],
    targetedAdsRevision: 4,
  });
  db.collection("electionCandidates").docs.set(candidateId.toHexString(), {
    _id: candidateId,
    status: "active",
    targetedAds: [],
    targetedAdsRevision: 7,
  });
}

function targetedInput(overrides: Record<string, unknown> = {}): AdSpendInput {
  return {
    target: {
      kind: "candidate",
      ownerDocId: candidateId,
      ads: purchasedAds as AdSpendInput["target"]["ads"],
      guardFilter: {
        status: "active" as const,
        campaignSuspended: { $ne: true },
        targetedAdsRevision: 7,
      },
    },
    payerId,
    costFunds: 200,
    costActions: 2,
    fundsField: "currencyBalances.campaign",
    fingerprint: `payer:${candidateId.toHexString()}:IA:age:18-29:2:10:200:7`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function standingInput(overrides: Record<string, unknown> = {}): AdSpendInput {
  return {
    target: {
      kind: "character",
      ownerDocId: ownerId,
      ads: purchasedAds as AdSpendInput["target"]["ads"],
      guardFilter: { targetedAdsRevision: 4 },
    },
    payerId,
    costFunds: 200,
    costActions: 2,
    fundsField: "currencyBalances.campaign",
    fingerprint: `payer:${ownerId.toHexString()}:IA:age:18-29:2:10:200:4`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function payerDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("characters").docs.get(payerId.toHexString())!;
}

function candidateDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("electionCandidates").docs.get(candidateId.toHexString())!;
}

function ownerDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("characters").docs.get(ownerId.toHexString())!;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyTargetedAdSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("charges the payer once, writes the candidate inventory, completes the receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = targetedInput({ idempotencyKey: "targeted-happy" });

    const result = await applyTargetedAdSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(payerDoc(db).actions).toBe(8);
    expect((payerDoc(db).currencyBalances as { campaign: number }).campaign).toBe(800);
    expect(candidateDoc(db).targetedAdsRevision).toBe(8);
    expect(candidateDoc(db).targetedAds).toHaveLength(1);
    expect(receipt(db, "targeted-happy").status).toBe("completed");
  });

  // Writes per attempt: 1 receipt claim, 2 payer debit, 3 inventory write,
  // 4 receipt settle. A throw from the fake models a real process death ONLY
  // where no cleanup code runs for it: the claim and the debit leg propagate
  // untouched, so the retry reconciles. The write step converts a survived
  // error into a compensatable failure, covered by the write-failure test.
  it.each([0, 1])(
    "reconciles a crash after %i successful writes to exactly one charged purchase",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = targetedInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyTargetedAdSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyTargetedAdSpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      expect(payerDoc(db).actions).toBe(8);
      expect(candidateDoc(db).targetedAdsRevision).toBe(8);
      expect(candidateDoc(db).targetedAds).toHaveLength(1);
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged purchase", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 3;
    const input = targetedInput({ idempotencyKey: "crash-settle" });

    await expect(applyTargetedAdSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyTargetedAdSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(true);
    expect(payerDoc(db).actions).toBe(8);
    expect(candidateDoc(db).targetedAds).toHaveLength(1);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("refunds the payer when the candidate inventory raced", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A concurrent purchase moved the revision between quote and spend.
    candidateDoc(db).targetedAdsRevision = 8;
    const input = targetedInput({ idempotencyKey: "raced-revision" });

    await expect(applyTargetedAdSpend(db as unknown as Db, input)).rejects.toThrow(
      AD_SPEND_CONFLICT
    );

    // Debit refunded, inventory untouched, receipt compensated.
    expect(payerDoc(db).actions).toBe(10);
    expect((payerDoc(db).currencyBalances as { campaign: number }).campaign).toBe(1000);
    expect(candidateDoc(db).targetedAds).toHaveLength(0);
    expect(receipt(db, "raced-revision").status).toBe("compensated");
  });

  it("fails closed on insufficient payer funds and keeps the failure terminal", async () => {
    const db = new FakeDb();
    seedDb(db);
    payerDoc(db).actions = 1;
    const input = targetedInput({ idempotencyKey: "poor-payer" });

    await expect(applyTargetedAdSpend(db as unknown as Db, input)).rejects.toThrow(
      AD_SPEND_INSUFFICIENT
    );
    expect(payerDoc(db).actions).toBe(1);
    expect(candidateDoc(db).targetedAds).toHaveLength(0);
    expect(receipt(db, "poor-payer").status).toBe("failed");

    await expect(applyTargetedAdSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(payerDoc(db).actions).toBe(1);
  });

  it("replays a completed key without charging or writing again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = targetedInput({ idempotencyKey: "replay" });

    const first = await applyTargetedAdSpend(db as unknown as Db, input);
    const second = await applyTargetedAdSpend(db as unknown as Db, input);

    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ duplicate: true });
    expect(payerDoc(db).actions).toBe(8);
    expect(candidateDoc(db).targetedAds).toHaveLength(1);
  });

  it("rejects a key reused for a different purchase", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyTargetedAdSpend(db as unknown as Db, targetedInput({ idempotencyKey: "shared" }));

    await expect(
      applyTargetedAdSpend(
        db as unknown as Db,
        targetedInput({
          idempotencyKey: "shared",
          costFunds: 300,
          fingerprint: `payer:${candidateId.toHexString()}:IA:age:18-29:2:10:300:7`,
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(payerDoc(db).actions).toBe(8);
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

    const result = await applyTargetedAdSpend(
      db as unknown as Db,
      targetedInput({ idempotencyKey: "tx-path" })
    );

    expect(result.duplicate).toBe(false);
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(payerDoc(db).actions).toBe(8);
    expect(candidateDoc(db).targetedAds).toHaveLength(1);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });
});

describe("applyStandingAdSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("charges the payer once and writes the other character's inventory", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = standingInput({ idempotencyKey: "standing-happy" });

    const result = await applyStandingAdSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(payerDoc(db).actions).toBe(8);
    expect(ownerDoc(db).targetedAdsRevision).toBe(5);
    expect(ownerDoc(db).targetedAds).toHaveLength(1);
    expect(receipt(db, "standing-happy").status).toBe("completed");
  });

  it("reconciles a crash between the debit and the owner write", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 2;
    const input = standingInput({ idempotencyKey: "standing-crash" });

    await expect(applyStandingAdSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyStandingAdSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(true);
    expect(payerDoc(db).actions).toBe(8);
    expect(ownerDoc(db).targetedAds).toHaveLength(1);
    expect(receipt(db, "standing-crash").status).toBe("completed");
  });

  it("refunds the payer and restores the prior inventory when the owner write races", async () => {
    const db = new FakeDb();
    seedDb(db);
    ownerDoc(db).targetedAdsRevision = 5;
    const input = standingInput({ idempotencyKey: "standing-raced" });

    await expect(applyStandingAdSpend(db as unknown as Db, input)).rejects.toThrow(
      AD_SPEND_CONFLICT
    );

    expect(payerDoc(db).actions).toBe(10);
    expect(ownerDoc(db).targetedAds).toHaveLength(0);
    expect(ownerDoc(db).targetedAdsRevision).toBe(5);
    expect(receipt(db, "standing-raced").status).toBe("compensated");
  });

  it("replays a completed key without charging or writing again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = standingInput({ idempotencyKey: "standing-replay" });

    await applyStandingAdSpend(db as unknown as Db, input);
    const second = await applyStandingAdSpend(db as unknown as Db, input);

    expect(second).toEqual({ duplicate: true });
    expect(payerDoc(db).actions).toBe(8);
    expect(ownerDoc(db).targetedAds).toHaveLength(1);
  });

  it("leaves a concurrent purchase's inventory untouched when the write races", async () => {
    const db = new FakeDb();
    seedDb(db);
    const concurrent = [
      {
        stateId: "NH",
        dimension: "age",
        bucket: "65+",
        bonus: 1,
        expiresTurn: 30,
        purchasedAtTurn: 5,
      },
    ];
    // A concurrent purchase landed its own array and moved the revision; our
    // guarded write never applied, so compensation refunds the debit and
    // touches neither the array nor the revision.
    ownerDoc(db).targetedAds = structuredClone(concurrent);
    ownerDoc(db).targetedAdsRevision = 5;
    const input = standingInput({ idempotencyKey: "standing-prior" });

    await expect(applyStandingAdSpend(db as unknown as Db, input)).rejects.toThrow(
      AD_SPEND_CONFLICT
    );

    expect(payerDoc(db).actions).toBe(10);
    expect(ownerDoc(db).targetedAds).toEqual(concurrent);
    expect(ownerDoc(db).targetedAdsRevision).toBe(5);
    expect(receipt(db, "standing-prior").status).toBe("compensated");
  });
});
