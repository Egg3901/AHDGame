import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { IndexFundHolding } from "@/lib/db/types";
import {
  applyHoldingWriteOffSpend,
  buildHoldingWriteOffFingerprint,
  buildHoldingWriteOffKey,
  buildHoldingWriteOffSteps,
  hashFlaggedHoldings,
  HOLDING_WRITEOFF_PULL,
  HOLDING_WRITEOFF_TX,
  isHoldingWriteOffOutcome,
  recoverHoldingWriteOffOrphans,
  resumeHoldingWriteOffByKey,
  type HoldingWriteOffSpendInput,
} from "./fundHoldingWriteOffSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  keyedInsertId,
} from "@/lib/db/nonAtomicMoneyFlow";
import { selectDeadHoldingIds, writeOffDeadConstituentHoldings } from "./fundHoldingWriteOff";

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

vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(async (_inside: unknown, fallback: () => Promise<unknown>) => fallback()),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fakes honoring exactly the operators the write-off
// primitive emits (corporation `_id` reads, one `$pull` + `$set` + key-record
// `$push` holdings write, deterministic `_id` inserts with duplicate-key
// convergence, receipt claim/plan/settle writes), so an injected crash
// between any two writes models a real process death between the
// corresponding sequential Mongo writes.
// ---------------------------------------------------------------------------

function docKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id instanceof ObjectId) return id.toHexString();
  return String(id);
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (actual instanceof ObjectId && expected instanceof ObjectId) {
    return actual.equals(expected);
  }
  return actual === expected;
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof ObjectId) &&
    !(value instanceof Date) &&
    !Array.isArray(value)
  );
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id" && !isOperatorObject(condition)) continue;
    const actual = field === "_id" ? doc._id : doc[field];
    if (isOperatorObject(condition)) {
      if ("$ne" in condition) {
        const values = Array.isArray(actual) ? actual : actual === undefined ? [] : [actual];
        if (values.some((v) => valueEquals(v, condition.$ne))) return false;
        continue;
      }
      if ("$in" in condition) {
        const candidates = Array.isArray(condition.$in) ? condition.$in : [];
        const values = Array.isArray(actual) ? actual : [actual];
        if (!values.some((v) => candidates.some((c) => valueEquals(v, c)))) return false;
        continue;
      }
      return false;
    }
    if (!valueEquals(actual, condition)) return false;
  }
  return true;
}

function cloneValue<T>(value: T): T {
  if (value instanceof ObjectId) return new ObjectId(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cloneValue(v)])
    ) as T;
  }
  return value;
}

class FakeCollection {
  readonly docs = new Map<string, Record<string, unknown>>();
  failNextInsert = false;

  constructor(private readonly db: FakeDb) {}

  private countWrite(): void {
    this.db.writeCount += 1;
    if (this.db.writeCount > this.db.crashAfterWrites) {
      throw new Error("INJECTED_CRASH");
    }
  }

  async insertOne(doc: Record<string, unknown>): Promise<{ insertedId: unknown }> {
    this.countWrite();
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("INJECTED_TX_FAILURE");
    }
    const key = docKey(doc._id);
    if (this.docs.has(key)) {
      const error = new Error("E11000 duplicate key error") as Error & { code: number };
      error.code = 11000;
      throw error;
    }
    this.docs.set(key, cloneValue(doc));
    return { insertedId: doc._id };
  }

  async findOne(
    filter: Record<string, unknown>,
    _opts?: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const rawId = filter._id;
    const doc =
      rawId !== undefined && !isOperatorObject(rawId)
        ? this.docs.get(docKey(rawId))
        : [...this.docs.values()].find((d) => matchesFilter(d, filter));
    if (!doc) return null;
    return cloneValue(doc);
  }

  find(filter: Record<string, unknown>): FakeCursor {
    return new FakeCursor(this, filter);
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    _opts?: Record<string, unknown>
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    const rawId = filter._id;
    const doc =
      rawId !== undefined && !isOperatorObject(rawId)
        ? this.docs.get(docKey(rawId))
        : [...this.docs.values()].find((d) => matchesFilter(d, filter));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    if (!matchesFilter(doc, filter)) return { matchedCount: 0, modifiedCount: 0 };

    const pull = update.$pull as Record<string, Record<string, unknown>> | undefined;
    if (pull?.holdings) {
      const spec = pull.holdings as { corporationId?: { $in: unknown[] } };
      const ids = new Set((spec.corporationId?.$in ?? []).map((id) => String(id)));
      doc.holdings = ((doc.holdings as Record<string, unknown>[]) ?? []).filter(
        (h) => !ids.has(String(h.corporationId))
      );
    }
    const push = update.$push as Record<string, unknown> | undefined;
    if (push?.holdings && typeof push.holdings === "object" && push.holdings !== null) {
      const each = (push.holdings as { $each?: unknown[] }).$each ?? [];
      doc.holdings = [...((doc.holdings as unknown[]) ?? []), ...cloneValue(each)];
    }
    if (push?.appliedMoneyFlowKeys && typeof push.appliedMoneyFlowKeys === "object") {
      const spec = push.appliedMoneyFlowKeys as { $each: unknown[]; $slice: number };
      const current = (doc.appliedMoneyFlowKeys as unknown[] | undefined) ?? [];
      const next = [...current, ...spec.$each];
      doc.appliedMoneyFlowKeys = spec.$slice < 0 ? next.slice(spec.$slice) : next;
    }
    const set = (update.$set ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(set)) {
      doc[field] = cloneValue(value);
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

class FakeCursor {
  constructor(
    private readonly collection: FakeCollection,
    private readonly filter: Record<string, unknown>
  ) {}

  async toArray(): Promise<Record<string, unknown>[]> {
    const rawId = this.filter._id;
    const docs = [...this.collection.docs.values()].filter((doc) => {
      if (rawId !== undefined) {
        if (isOperatorObject(rawId)) {
          if (!matchesFilter(doc, this.filter)) return false;
        } else if (docKey(doc._id) !== docKey(rawId)) {
          return false;
        }
      }
      return matchesFilter(doc, this.filter);
    });
    return cloneValue(docs);
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

const fundId = new ObjectId();
const deadCorpId = new ObjectId();
const liveCorpId = new ObjectId();
const untouchedCorpId = new ObjectId();
const TURN = 9;
const NAV = 100;

const holding = (id: ObjectId, value: number, shares = 100): IndexFundHolding => ({
  corporationId: id,
  shares,
  avgCostPerShareAnchor: value / shares,
  lastValueAnchor: value,
});

function seedAll(raw: FakeDb, holdings: IndexFundHolding[]): void {
  raw.collection("indexFunds").docs.set(fundId.toHexString(), {
    _id: fundId,
    slug: "test-fund",
    status: "active",
    quotedNav: NAV,
    cashAnchor: 0,
    unitSupply: 1000,
    holdings: holdings.map((h) => ({ ...h })),
  });
  // Only the live and untouched corporations still exist.
  raw.collection("corporations").docs.set(liveCorpId.toHexString(), { _id: liveCorpId });
  raw.collection("corporations").docs.set(untouchedCorpId.toHexString(), {
    _id: untouchedCorpId,
  });
}

function makeInput(overrides?: Partial<HoldingWriteOffSpendInput>): HoldingWriteOffSpendInput {
  const flagged = [holding(deadCorpId, 500), holding(liveCorpId, 900)];
  const base = {
    fundId,
    quotedNav: NAV,
    flagged,
    turn: TURN,
    fingerprint: "",
    ...overrides,
  };
  if (!overrides || !("fingerprint" in overrides)) {
    base.fingerprint = buildHoldingWriteOffFingerprint({
      fundId: base.fundId,
      turn: base.turn,
      flagged: base.flagged,
      quotedNav: base.quotedNav,
    });
  }
  if (!overrides || !("idempotencyKey" in overrides)) {
    base.idempotencyKey = buildHoldingWriteOffKey(base.fundId, base.turn, base.flagged);
  }
  return base as HoldingWriteOffSpendInput;
}

function fundHoldings(raw: FakeDb): Record<string, unknown>[] {
  return raw.collection("indexFunds").docs.get(fundId.toHexString())!.holdings as Record<
    string,
    unknown
  >[];
}

function txRows(raw: FakeDb): Record<string, unknown>[] {
  return [...raw.collection("indexFundTransactions").docs.values()];
}

function receipts(raw: FakeDb): Record<string, unknown>[] {
  return [...raw.collection("nonAtomicMoneyFlowReceipts").docs.values()];
}

beforeEach(() => {
  vi.clearAllMocks();
  supportMock.mockResolvedValue(false);
  getMongoClientMock.mockReturnValue(undefined);
});

describe("applyHoldingWriteOffSpend", () => {
  it("pulls exactly the dead rows and logs the legacy-exact audit row once", async () => {
    const raw = new FakeDb();
    seedAll(raw, [
      holding(deadCorpId, 500),
      holding(liveCorpId, 900),
      holding(untouchedCorpId, 700),
    ]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];

    const first = await applyHoldingWriteOffSpend(db, makeInput());
    expect(first.duplicate).toBe(false);
    expect(first.outcome).toEqual({
      writtenOffCount: 1,
      writtenOffValueAnchor: 500,
      unsellableCount: 1,
      unsellableValueAnchor: 900,
    });
    expect(isHoldingWriteOffOutcome(first.outcome)).toBe(true);

    // Only the dead row left the book; live and untouched rows are intact.
    expect(fundHoldings(raw).map((h) => String(h.corporationId))).toEqual([
      liveCorpId.toHexString(),
      untouchedCorpId.toHexString(),
    ]);
    // No cash or supply moved: a write-off recognizes a loss, it transfers
    // nothing.
    const fund = raw.collection("indexFunds").docs.get(fundId.toHexString())!;
    expect(fund.cashAnchor).toBe(0);
    expect(fund.unitSupply).toBe(1000);

    const txs = txRows(raw);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      fundId,
      kind: "holding_writeoff",
      navAnchor: NAV,
      amountAnchor: -500,
    });

    expect(receipts(raw)).toHaveLength(1);
    expect(receipts(raw)[0]!.status).toBe("completed");
  });

  it("recovers exactly-once after a crash following every durable write", async () => {
    // Durable write order: receipt claim, plan persist, pull, audit insert,
    // receipt settle, outcome persist. Crashing after each of them (and
    // before the first) must converge to one write-off.
    const totalWrites = 6;
    for (let crashAfter = 0; crashAfter <= totalWrites; crashAfter += 1) {
      const raw = new FakeDb();
      seedAll(raw, [holding(deadCorpId, 500), holding(liveCorpId, 900)]);
      const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
      const input = makeInput();
      raw.crashAfterWrites = crashAfter;
      try {
        await applyHoldingWriteOffSpend(db, input);
      } catch (err) {
        expect((err as Error).message).toBe("INJECTED_CRASH");
      }

      raw.crashAfterWrites = Number.POSITIVE_INFINITY;
      const resumed = await applyHoldingWriteOffSpend(db, input);
      expect(resumed.outcome).toEqual({
        writtenOffCount: 1,
        writtenOffValueAnchor: 500,
        unsellableCount: 1,
        unsellableValueAnchor: 900,
      });
      // crashAfter = 0 dies before the claim insert, so the retry is fresh.
      expect(resumed.duplicate).toBe(crashAfter > 0);
      expect(fundHoldings(raw).map((h) => String(h.corporationId))).toEqual([
        liveCorpId.toHexString(),
      ]);
      expect(txRows(raw)).toHaveLength(1);
      expect(txRows(raw)[0]).toMatchObject({ amountAnchor: -500 });
      expect(receipts(raw)).toHaveLength(1);
      expect(receipts(raw)[0]!.status).toBe("completed");
    }
  });

  it("resumes a pulled-but-unaudited write-off by key without repeating the loss", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500), holding(liveCorpId, 900)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    const input = makeInput();
    // Crash after claim + plan + pull: the row is gone, the audit missing.
    // (The liveness read is not a write, so 3 lands the pull.)
    raw.crashAfterWrites = 3;
    await expect(applyHoldingWriteOffSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    expect(fundHoldings(raw)).toHaveLength(1);
    expect(txRows(raw)).toHaveLength(0);

    raw.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await resumeHoldingWriteOffByKey(db, input.idempotencyKey!, fundId, TURN);
    expect(result).not.toBeNull();
    expect(result!.outcome.writtenOffCount).toBe(1);
    // The pull converged (row still gone exactly once) and the audit landed.
    expect(fundHoldings(raw)).toHaveLength(1);
    expect(txRows(raw)).toHaveLength(1);
    expect(txRows(raw)[0]).toMatchObject({ amountAnchor: -500 });
  });

  it("replays the stored split when the book changed after the crash", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500), holding(liveCorpId, 900)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    const input = makeInput();
    raw.crashAfterWrites = 2;
    await expect(applyHoldingWriteOffSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    // A concurrent float buy landed a fresh holding after the crash. The
    // retry must replay the STORED dead set, never recompute liveness from
    // post-pull state, and must not clobber the new row (the legacy
    // full-array `$set` rewrite would have erased it).
    const fund = raw.collection("indexFunds").docs.get(fundId.toHexString())!;
    (fund.holdings as Record<string, unknown>[]).push({
      corporationId: untouchedCorpId,
      shares: 10,
      avgCostPerShareAnchor: 5,
      lastValueAnchor: 50,
    });

    const resumed = await applyHoldingWriteOffSpend(db, input);
    expect(resumed.duplicate).toBe(true);
    expect(resumed.outcome.writtenOffCount).toBe(1);
    const ids = fundHoldings(raw).map((h) => String(h.corporationId));
    expect(ids).toContain(liveCorpId.toHexString());
    expect(ids).toContain(untouchedCorpId.toHexString());
    expect(ids).not.toContain(deadCorpId.toHexString());
    expect(txRows(raw)).toHaveLength(1);
  });

  it("converges concurrent same-key retries to a single pull and audit row", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    const input = makeInput({ flagged: [holding(deadCorpId, 500)] });

    const [first, second] = await Promise.all([
      applyHoldingWriteOffSpend(db, input),
      applyHoldingWriteOffSpend(db, input),
    ]);
    expect(first.outcome.writtenOffCount).toBe(1);
    expect(second.outcome.writtenOffCount).toBe(1);
    expect(fundHoldings(raw)).toHaveLength(0);
    expect(txRows(raw)).toHaveLength(1);
  });

  it("keeps the audit row at-most-once across crash, resume, and replay", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    const input = makeInput({ flagged: [holding(deadCorpId, 500)] });
    // Crash between the audit insert and the receipt settle.
    raw.crashAfterWrites = 4;
    await expect(applyHoldingWriteOffSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    expect(txRows(raw)).toHaveLength(1);

    raw.crashAfterWrites = Number.POSITIVE_INFINITY;
    await applyHoldingWriteOffSpend(db, input);
    // Applied-but-unacknowledged insert converges on its deterministic `_id`.
    expect(txRows(raw)).toHaveLength(1);

    const replay = await applyHoldingWriteOffSpend(db, input);
    expect(replay.duplicate).toBe(true);
    expect(txRows(raw)).toHaveLength(1);
  });

  it("compensates the pull exactly when the audit insert fails", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500, 100), holding(liveCorpId, 900)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    raw.collection("indexFundTransactions").failNextInsert = true;

    await expect(applyHoldingWriteOffSpend(db, makeInput())).rejects.toThrow(
      `${HOLDING_WRITEOFF_TX}:guard-rejected`
    );
    // The exact removed image is pushed back: shares, average, and mark.
    expect(fundHoldings(raw)).toEqual([
      expect.objectContaining({
        corporationId: liveCorpId,
        shares: 100,
        avgCostPerShareAnchor: 9,
        lastValueAnchor: 900,
      }),
      expect.objectContaining({
        corporationId: deadCorpId,
        shares: 100,
        avgCostPerShareAnchor: 5,
        lastValueAnchor: 500,
      }),
    ]);
    expect(txRows(raw)).toHaveLength(0);
    expect(receipts(raw)[0]!.status).toBe("compensated");
  });

  it("fails closed with nothing applied when the fund row is gone", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    raw.collection("indexFunds").docs.delete(fundId.toHexString());

    await expect(
      applyHoldingWriteOffSpend(db, makeInput({ flagged: [holding(deadCorpId, 500)] }))
    ).rejects.toThrow(`${HOLDING_WRITEOFF_PULL}:missing`);
    // Refuses to audit a removal that never landed.
    expect(txRows(raw)).toHaveLength(0);
    expect(receipts(raw)[0]!.status).toBe("failed");
  });

  it("settles a live-only book completed with zero counts and no audit row", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(liveCorpId, 900)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];

    const result = await applyHoldingWriteOffSpend(
      db,
      makeInput({ flagged: [holding(liveCorpId, 900)] })
    );
    expect(result.duplicate).toBe(false);
    expect(result.outcome).toEqual({
      writtenOffCount: 0,
      writtenOffValueAnchor: 0,
      unsellableCount: 1,
      unsellableValueAnchor: 900,
    });
    expect(fundHoldings(raw)).toHaveLength(1);
    expect(txRows(raw)).toHaveLength(0);
    expect(receipts(raw)[0]!.status).toBe("completed");
  });

  it("fails closed when a retry names a different removal list or NAV", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    const input = makeInput({ flagged: [holding(deadCorpId, 500)] });
    raw.crashAfterWrites = 2;
    await expect(applyHoldingWriteOffSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    // Same key shape cannot arise from a different flagged list (the key
    // binds it), so force the collision: same key, different fingerprint.
    const conflict = { ...makeInput({ flagged: [holding(deadCorpId, 500)] }), quotedNav: NAV + 1 };
    conflict.fingerprint = buildHoldingWriteOffFingerprint({
      fundId,
      turn: TURN,
      flagged: conflict.flagged,
      quotedNav: NAV + 1,
    });
    await expect(applyHoldingWriteOffSpend(db, conflict)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );

    // Key-only recovery still completes the STORED split.
    const resumed = await resumeHoldingWriteOffByKey(db, input.idempotencyKey!, fundId, TURN);
    expect(resumed!.outcome.writtenOffCount).toBe(1);
    expect(fundHoldings(raw)).toHaveLength(0);
  });

  it("holds the receipt terminal after compensation: same key throws, new key works", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500, 100)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    const input = makeInput({ flagged: [holding(deadCorpId, 500, 100)] });
    raw.collection("indexFundTransactions").failNextInsert = true;
    await expect(applyHoldingWriteOffSpend(db, input)).rejects.toThrow(HOLDING_WRITEOFF_TX);
    raw.collection("indexFundTransactions").failNextInsert = false;

    await expect(applyHoldingWriteOffSpend(db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    await expect(
      resumeHoldingWriteOffByKey(db, input.idempotencyKey!, fundId, TURN)
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);

    // A new attempt needs a new key (next turn's removal list re-flags).
    const retry = await applyHoldingWriteOffSpend(
      db,
      makeInput({
        flagged: [holding(deadCorpId, 500, 100)],
        turn: TURN + 1,
      })
    );
    expect(retry.duplicate).toBe(false);
    expect(retry.outcome.writtenOffCount).toBe(1);
    expect(fundHoldings(raw)).toHaveLength(0);
    expect(txRows(raw)).toHaveLength(1);
  });

  it("resume by key refuses cross-fund and cross-turn receipts", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    const input = makeInput({ flagged: [holding(deadCorpId, 500)] });
    raw.crashAfterWrites = 2;
    await expect(applyHoldingWriteOffSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    await expect(
      resumeHoldingWriteOffByKey(db, input.idempotencyKey!, new ObjectId(), TURN)
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    await expect(
      resumeHoldingWriteOffByKey(db, input.idempotencyKey!, fundId, TURN + 1)
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(fundHoldings(raw)).toHaveLength(1);
  });

  it("resume by key on settled or absent receipts returns null", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    const input = makeInput({ flagged: [holding(deadCorpId, 500)] });
    await applyHoldingWriteOffSpend(db, input);
    expect(await resumeHoldingWriteOffByKey(db, input.idempotencyKey!, fundId, TURN)).toBeNull();
    expect(
      await resumeHoldingWriteOffByKey(db, new ObjectId().toHexString(), fundId, TURN)
    ).toBeNull();
  });

  it("validates its pinned inputs before claiming", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];

    await expect(
      applyHoldingWriteOffSpend(
        db,
        makeInput({
          flagged: "nope" as unknown as IndexFundHolding[],
          fingerprint: "validation-probe",
          idempotencyKey: "validation-probe-key",
        })
      )
    ).rejects.toThrow(TypeError);
    await expect(applyHoldingWriteOffSpend(db, makeInput({ turn: 1.5 }))).rejects.toThrow(
      TypeError
    );
    await expect(applyHoldingWriteOffSpend(db, makeInput({ fingerprint: "" }))).rejects.toThrow(
      TypeError
    );
    expect(receipts(raw)).toHaveLength(0);
  });

  it("builds deterministic keys insensitive to flagged order", async () => {
    const a = holding(deadCorpId, 500);
    const b = holding(liveCorpId, 900);
    expect(hashFlaggedHoldings([a, b])).toBe(hashFlaggedHoldings([b, a]));
    expect(buildHoldingWriteOffKey(fundId, TURN, [a, b])).toBe(
      buildHoldingWriteOffKey(fundId, TURN, [b, a])
    );
    expect(buildHoldingWriteOffKey(fundId, TURN, [a])).not.toBe(
      buildHoldingWriteOffKey(fundId, TURN, [a, b])
    );
    expect(buildHoldingWriteOffKey(fundId, TURN + 1, [a, b])).not.toBe(
      buildHoldingWriteOffKey(fundId, TURN, [a, b])
    );
  });

  it("negative control: the legacy full-array rewrite clobbers a concurrent buy", async () => {
    // The pre-migration shape (read holdings, `$set` the filtered array)
    // loses a row a concurrent float buy pushed in between: the loss is real
    // money-out-of-the-book with no audit row either. The surgical `$pull`
    // above commutes with the `$push` instead.
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500), holding(liveCorpId, 900)]);
    const before = fundHoldings(raw);
    const concurrentBuy = holding(untouchedCorpId, 50, 10);
    const remaining = before.filter((h) => String(h.corporationId) !== deadCorpId.toHexString());
    // Buy lands after the read...
    remaining.push({ ...concurrentBuy } as Record<string, unknown>);
    // ...but the legacy `$set` was computed from the stale read.
    const staleRewrite = before.filter((h) => String(h.corporationId) !== deadCorpId.toHexString());
    raw.collection("indexFunds").docs.get(fundId.toHexString())!.holdings = staleRewrite;
    const ids = (
      raw.collection("indexFunds").docs.get(fundId.toHexString())!.holdings as Record<
        string,
        unknown
      >[]
    ).map((h) => String(h.corporationId));
    expect(ids).not.toContain(untouchedCorpId.toHexString());
  });

  it("exposes the ordered steps for compensation tests", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    const input = makeInput({ flagged: [holding(deadCorpId, 500)] });
    const { dead } = {
      dead: [{ corporationId: deadCorpId, shares: 100, lastValueAnchor: 500 }],
    };
    const steps = buildHoldingWriteOffSteps(db, input.idempotencyKey!, {
      fundId,
      quotedNav: NAV,
      turn: TURN,
      flaggedHexes: [deadCorpId.toHexString()],
      dead,
      valueAnchor: 500,
      stillHeldCount: 1,
      stillHeldValueAnchor: 500,
      now: new Date(),
    });
    expect(steps.map((s) => s.name)).toEqual(["pull", "writeoff-tx"]);
    expect(steps[1]!.revert).toBeUndefined();
  });
});

describe("recoverHoldingWriteOffOrphans", () => {
  it("resumes a crashed turn's receipt and settles plan-less claims", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500), holding(liveCorpId, 900)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    const input = makeInput();
    raw.crashAfterWrites = 3;
    await expect(applyHoldingWriteOffSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    // A plan-less claim under this fund and turn: crashed between claim
    // insert and plan write, nothing applied.
    const planlessKey = `holding-writeoff:${fundId.toHexString()}:turn:${TURN}:flagged:abcdef0123456789`;
    await raw.collection("nonAtomicMoneyFlowReceipts").insertOne({
      _id: planlessKey,
      status: "in_progress",
      fingerprint: "fp",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const recovered = await recoverHoldingWriteOffOrphans(db, fundId, TURN);
    expect(recovered).toMatchObject({ writtenOffCount: 1, writtenOffValueAnchor: 500 });
    expect(fundHoldings(raw).map((h) => String(h.corporationId))).toEqual([
      liveCorpId.toHexString(),
    ]);
    expect(txRows(raw)).toHaveLength(1);
    const planless = await raw
      .collection("nonAtomicMoneyFlowReceipts")
      .findOne({ _id: planlessKey });
    expect(planless!.status).toBe("failed");
  });

  it("ignores other funds and other turns", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500)]);
    const db = raw as unknown as Parameters<typeof applyHoldingWriteOffSpend>[0];
    await applyHoldingWriteOffSpend(db, makeInput({ flagged: [holding(deadCorpId, 500)] }));
    expect(await recoverHoldingWriteOffOrphans(db, new ObjectId(), TURN)).toBeNull();
    expect(await recoverHoldingWriteOffOrphans(db, fundId, TURN + 1)).toBeNull();
    expect(fundHoldings(raw)).toHaveLength(0);
    expect(txRows(raw)).toHaveLength(1);
  });
});

describe("writeOffDeadConstituentHoldings shell", () => {
  const makeFund = (holdings: IndexFundHolding[]) =>
    ({
      _id: fundId,
      slug: "test-fund",
      status: "active",
      quotedNav: NAV,
      cashAnchor: 0,
      unitSupply: 1000,
      holdings,
      targetConstituents: [],
    }) as unknown as Parameters<typeof writeOffDeadConstituentHoldings>[1];

  it("removes a holding whose corporation no longer exists", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500)]);
    const db = raw as unknown as Parameters<typeof writeOffDeadConstituentHoldings>[0];
    const fund = makeFund([holding(deadCorpId, 500)]);

    const result = await writeOffDeadConstituentHoldings(db, fund, fund.holdings, TURN);
    expect(result.writtenOffCount).toBe(1);
    expect(result.writtenOffValueAnchor).toBe(500);
    expect(fundHoldings(raw)).toHaveLength(0);
    // The write-off is backing leaving the fund, so it must not read as income.
    expect(txRows(raw)[0]).toMatchObject({ kind: "holding_writeoff", amountAnchor: -500 });
  });

  it("leaves a live corporation's holding alone and reports it as unsellable", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(liveCorpId, 900)]);
    const db = raw as unknown as Parameters<typeof writeOffDeadConstituentHoldings>[0];
    const fund = makeFund([holding(liveCorpId, 900)]);

    const result = await writeOffDeadConstituentHoldings(db, fund, fund.holdings, TURN);
    expect(result.writtenOffCount).toBe(0);
    expect(result.unsellableCount).toBe(1);
    expect(result.unsellableValueAnchor).toBe(900);
    // Zeroing a live position would destroy real holder value: the book and
    // the audit log stay untouched.
    expect(fundHoldings(raw)).toHaveLength(1);
    expect(txRows(raw)).toHaveLength(0);
  });

  it("writes off only the dead holdings in a mixed book", async () => {
    const raw = new FakeDb();
    seedAll(raw, [
      holding(deadCorpId, 300),
      holding(liveCorpId, 400),
      holding(untouchedCorpId, 700),
    ]);
    const db = raw as unknown as Parameters<typeof writeOffDeadConstituentHoldings>[0];
    const fund = makeFund([
      holding(deadCorpId, 300),
      holding(liveCorpId, 400),
      holding(untouchedCorpId, 700),
    ]);

    // Only the first two were flagged for removal; the third stays regardless.
    const result = await writeOffDeadConstituentHoldings(
      db,
      fund,
      [fund.holdings[0]!, fund.holdings[1]!],
      TURN
    );
    expect(result.writtenOffCount).toBe(1);
    expect(result.writtenOffValueAnchor).toBe(300);
    expect(fundHoldings(raw).map((h) => String(h.corporationId))).toEqual([
      liveCorpId.toHexString(),
      untouchedCorpId.toHexString(),
    ]);
  });

  it("does not re-write-off a holding the sale already cleared", async () => {
    const raw = new FakeDb();
    seedAll(raw, []);
    const db = raw as unknown as Parameters<typeof writeOffDeadConstituentHoldings>[0];
    // Flagged for removal, but the sale succeeded so it is gone from the book.
    const fund = makeFund([]);

    const result = await writeOffDeadConstituentHoldings(
      db,
      fund,
      [holding(deadCorpId, 500)],
      TURN
    );
    expect(result.writtenOffCount).toBe(0);
    expect(receipts(raw)).toHaveLength(0);
  });

  it("ignores holdings already at zero shares", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 0, 0)]);
    const db = raw as unknown as Parameters<typeof writeOffDeadConstituentHoldings>[0];
    const fund = makeFund([holding(deadCorpId, 0, 0)]);

    const result = await writeOffDeadConstituentHoldings(db, fund, fund.holdings, TURN);
    expect(result.writtenOffCount).toBe(0);
    expect(receipts(raw)).toHaveLength(0);
  });

  it("does nothing when the rebalance flagged nothing", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 100)]);
    const db = raw as unknown as Parameters<typeof writeOffDeadConstituentHoldings>[0];
    const fund = makeFund([holding(deadCorpId, 100)]);

    const result = await writeOffDeadConstituentHoldings(db, fund, [], TURN);
    expect(result).toMatchObject({ writtenOffCount: 0, unsellableCount: 0 });
    expect(receipts(raw)).toHaveLength(0);
  });

  it("reports the stored outcome on a same-key retry without re-pulling", async () => {
    const raw = new FakeDb();
    seedAll(raw, [holding(deadCorpId, 500)]);
    const db = raw as unknown as Parameters<typeof writeOffDeadConstituentHoldings>[0];
    const fund = makeFund([holding(deadCorpId, 500)]);
    const first = await writeOffDeadConstituentHoldings(db, fund, fund.holdings, TURN);
    expect(first.writtenOffCount).toBe(1);

    // Same flagged list, same turn: the receipt is terminal-completed, so the
    // retry reports the stored outcome and repeats neither the pull nor the
    // audit row. (The deterministic audit `_id` is a second net.)
    const key = buildHoldingWriteOffKey(fundId, TURN, fund.holdings);
    const expectedTxId = keyedInsertId(key, "holding-writeoff-tx");
    const second = await writeOffDeadConstituentHoldings(db, fund, fund.holdings, TURN);
    expect(second).toEqual(first);
    expect(txRows(raw)).toHaveLength(1);
    expect(String(txRows(raw)[0]!._id)).toBe(String(expectedTxId));
  });
});

describe("selectDeadHoldingIds", () => {
  it("picks exactly the holdings with no live corporation", () => {
    const dead = new ObjectId();
    const live = new ObjectId();
    const ids = selectDeadHoldingIds([holding(dead, 100), holding(live, 100)], [live]);
    expect(ids).toEqual([dead]);
  });

  it("accepts string ids for the live set", () => {
    const dead = new ObjectId();
    const live = new ObjectId();
    const ids = selectDeadHoldingIds([holding(dead, 100), holding(live, 100)], [live.toString()]);
    expect(ids).toEqual([dead]);
  });
});
