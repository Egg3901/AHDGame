import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyOrganizeSectorSpend,
  ORGANIZE_ACTIONS_CHANGED,
  ORGANIZE_SECTOR_CHANGED,
  ORGANIZE_TREASURY_CHANGED,
} from "./organizeSectorSpend";
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
// primitive and the drive steps emit ($inc / $set / $push+$each+$slice
// writes; _id equality, $ne-on-keys, $gte-on-balance guards), so an injected
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
const unionId = new ObjectId();
const sectorId = new ObjectId();
const now = new Date("2026-02-01T00:00:00Z");
const ACTION_COST = 10;
const TREASURY_COST = 1_000;

function seedDb(db: FakeDb): void {
  db.collection("characters").docs.set(characterId.toHexString(), {
    _id: characterId,
    actions: 100,
    updatedAt: new Date("2026-01-10T00:00:00Z"),
  });
  db.collection("unions").docs.set(unionId.toHexString(), {
    _id: unionId,
    treasury: 10_000,
    updatedAt: new Date("2026-01-10T00:00:00Z"),
  });
  db.collection("corporateSectors").docs.set(sectorId.toHexString(), {
    _id: sectorId,
    unionization: 10,
    representingUnionId: null,
    updatedAt: new Date("2026-01-10T00:00:00Z"),
  });
}

function driveInput(overrides: Record<string, unknown> = {}) {
  return {
    characterId,
    unionId,
    sectorId,
    actionCost: ACTION_COST,
    treasuryCost: TREASURY_COST,
    priorUnionization: 10,
    priorRepresentingUnionId: null,
    nextUnionization: 13,
    nextRepresentingUnionId: unionId,
    now,
    applySector: true,
    fingerprint: `organize-sector:${unionId.toHexString()}:${sectorId.toHexString()}`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function characterDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("characters").docs.get(characterId.toHexString())!;
}

function unionDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("unions").docs.get(unionId.toHexString())!;
}

function sectorDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("corporateSectors").docs.get(sectorId.toHexString())!;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    | MoneyFlowReceipt
    | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyOrganizeSectorSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("charges one drive: actions and treasury debit, sector transitions", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = driveInput({ idempotencyKey: "drive-happy" });

    const result = await applyOrganizeSectorSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(characterDoc(db).actions).toBe(90);
    expect(unionDoc(db).treasury).toBe(9_000);
    expect(sectorDoc(db).unionization).toBe(13);
    expect((sectorDoc(db).representingUnionId as ObjectId).toHexString()).toBe(
      unionId.toHexString()
    );
    expect(receipt(db, "drive-happy").status).toBe("completed");
  });

  it("a lost raid still spends actions and treasury but leaves the sector untouched", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = driveInput({ idempotencyKey: "drive-lost-raid", applySector: false });

    const result = await applyOrganizeSectorSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(characterDoc(db).actions).toBe(90);
    expect(unionDoc(db).treasury).toBe(9_000);
    expect(sectorDoc(db).unionization).toBe(10);
    expect(sectorDoc(db).representingUnionId).toBeNull();
    expect(receipt(db, "drive-lost-raid").status).toBe("completed");
  });

  it("fails closed with ACTIONS_CHANGED when the pool races, spending nothing", async () => {
    const db = new FakeDb();
    seedDb(db);
    characterDoc(db).actions = 1;
    const input = driveInput({ idempotencyKey: "drive-no-ap" });

    await expect(applyOrganizeSectorSpend(db as unknown as Db, input)).rejects.toThrow(
      ORGANIZE_ACTIONS_CHANGED
    );

    expect(characterDoc(db).actions).toBe(1);
    expect(unionDoc(db).treasury).toBe(10_000);
    expect(sectorDoc(db).unionization).toBe(10);
    expect(receipt(db, "drive-no-ap").status).toBe("failed");
  });

  it("refunds actions when the treasury races, leaving the sector untouched", async () => {
    const db = new FakeDb();
    seedDb(db);
    unionDoc(db).treasury = 10;
    const input = driveInput({ idempotencyKey: "drive-poor" });

    await expect(applyOrganizeSectorSpend(db as unknown as Db, input)).rejects.toThrow(
      ORGANIZE_TREASURY_CHANGED
    );

    expect(characterDoc(db).actions).toBe(100);
    expect(unionDoc(db).treasury).toBe(10);
    expect(sectorDoc(db).unionization).toBe(10);
    expect(receipt(db, "drive-poor").status).toBe("compensated");
  });

  it("refunds both spends when the sector moves under the drive", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A rival drive lands first and pushes unionization past our snapshot.
    sectorDoc(db).unionization = 40;
    const input = driveInput({ idempotencyKey: "drive-moved" });

    await expect(applyOrganizeSectorSpend(db as unknown as Db, input)).rejects.toThrow(
      ORGANIZE_SECTOR_CHANGED
    );

    expect(characterDoc(db).actions).toBe(100);
    expect(unionDoc(db).treasury).toBe(10_000);
    expect(sectorDoc(db).unionization).toBe(40);
    expect(receipt(db, "drive-moved").status).toBe("compensated");
  });

  it("refunds both spends when the sector row is gone", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("corporateSectors").docs.delete(sectorId.toHexString());
    const input = driveInput({ idempotencyKey: "drive-ghost" });

    await expect(applyOrganizeSectorSpend(db as unknown as Db, input)).rejects.toThrow(
      ORGANIZE_SECTOR_CHANGED
    );

    expect(characterDoc(db).actions).toBe(100);
    expect(unionDoc(db).treasury).toBe(10_000);
    expect(receipt(db, "drive-ghost").status).toBe("compensated");
  });

  // Writes per attempt: 1 receipt claim, 2 actions debit, 3 treasury debit,
  // 4 sector write, 5 receipt settle. A throw from the fake models a real
  // process death ONLY where no cleanup code runs for it, so the retry
  // reconciles to exactly one charged drive.
  it.each([0, 1, 2, 3])(
    "reconciles a crash after %i successful writes to exactly one charged drive",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = driveInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyOrganizeSectorSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key reconciles.
      // Crash-on-write-0 left no receipt at all, so that retry is a fresh
      // attempt; a later crash reconciles an in-progress receipt.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyOrganizeSectorSpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      expect(characterDoc(db).actions).toBe(90);
      expect(unionDoc(db).treasury).toBe(9_000);
      expect(sectorDoc(db).unionization).toBe(13);
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged drive", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 4;
    const input = driveInput({ idempotencyKey: "crash-settle" });

    await expect(applyOrganizeSectorSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // Every step survived; the retry replays them as already-applied and
    // settles completed.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyOrganizeSectorSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: true });
    expect(characterDoc(db).actions).toBe(90);
    expect(unionDoc(db).treasury).toBe(9_000);
    expect(sectorDoc(db).unionization).toBe(13);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("replays a completed key without charging or pushing again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = driveInput({ idempotencyKey: "replay" });

    const first = await applyOrganizeSectorSpend(db as unknown as Db, input);
    const second = await applyOrganizeSectorSpend(db as unknown as Db, input);

    expect(first).toEqual({ duplicate: false });
    expect(second).toEqual({ duplicate: true });
    expect(characterDoc(db).actions).toBe(90);
    expect(unionDoc(db).treasury).toBe(9_000);
    expect(sectorDoc(db).unionization).toBe(13);
  });

  it("rejects a key reused for a different sector", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyOrganizeSectorSpend(db as unknown as Db, driveInput({ idempotencyKey: "shared" }));

    const otherSector = new ObjectId();
    await expect(
      applyOrganizeSectorSpend(
        db as unknown as Db,
        driveInput({
          idempotencyKey: "shared",
          sectorId: otherSector,
          fingerprint: `organize-sector:${unionId.toHexString()}:${otherSector.toHexString()}`,
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(characterDoc(db).actions).toBe(90);
    expect(unionDoc(db).treasury).toBe(9_000);
  });

  it("keeps a terminal failure terminal across retries", async () => {
    const db = new FakeDb();
    seedDb(db);
    characterDoc(db).actions = 1;
    const input = driveInput({ idempotencyKey: "poor-retry" });

    await expect(applyOrganizeSectorSpend(db as unknown as Db, input)).rejects.toThrow(
      ORGANIZE_ACTIONS_CHANGED
    );
    await expect(applyOrganizeSectorSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(unionDoc(db).treasury).toBe(10_000);
    expect(sectorDoc(db).unionization).toBe(10);
  });

  it("leaves the prefix stranded-but-visible when compensation itself crashes", async () => {
    const db = new FakeDb();
    seedDb(db);
    // The sector moves, so both debits must compensate; the crash lands on
    // the first compensation write (the treasury revert, run before the
    // actions revert in reverse order).
    sectorDoc(db).unionization = 40;
    const input = driveInput({ idempotencyKey: "comp-crash" });
    const unions = db.collection("unions");
    const realUpdate = unions.updateOne.bind(unions);
    let calls = 0;
    unions.updateOne = (async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => {
      calls += 1;
      // Call 1 is the treasury debit leg; call 2 is its compensation revert.
      if (calls === 2) throw new Error("INJECTED_CRASH");
      return realUpdate(filter, update);
    }) as typeof unions.updateOne;

    await expect(applyOrganizeSectorSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // The treasury debit applied and was never reversed: the receipt rests
    // in_progress (fail open by crash, TTL-visible) rather than pretending
    // the prefix was reversed.
    expect(unionDoc(db).treasury).toBe(9_000);
    expect(characterDoc(db).actions).toBe(90);
    expect(receipt(db, "comp-crash").status).toBe("in_progress");
  });

  it("rejects bad costs and bad keys before touching storage", async () => {
    const db = new FakeDb();
    seedDb(db);

    await expect(
      applyOrganizeSectorSpend(db as unknown as Db, driveInput({ actionCost: 0 }))
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      applyOrganizeSectorSpend(db as unknown as Db, driveInput({ idempotencyKey: "" }))
    ).rejects.toBeInstanceOf(RangeError);
    expect(characterDoc(db).actions).toBe(100);
    expect(unionDoc(db).treasury).toBe(10_000);
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

    const result = await applyOrganizeSectorSpend(
      db as unknown as Db,
      driveInput({ idempotencyKey: "tx-path" })
    );

    expect(result).toEqual({ duplicate: false });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(characterDoc(db).actions).toBe(90);
    expect(unionDoc(db).treasury).toBe(9_000);
    expect(sectorDoc(db).unionization).toBe(13);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });
});
