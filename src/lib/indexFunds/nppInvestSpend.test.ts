import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  applyNppInvestSpend,
  buildNppInvestFingerprint,
  buildNppInvestKey,
  buildNppInvestSteps,
  isNppInvestOutcome,
  NPP_INVEST_ACCRUE,
  NPP_INVEST_FUND,
  NPP_INVEST_POSITION,
  resumeNppInvestByKey,
  type NppInvestSpendInput,
  type NppInvestSubscription,
} from "./nppInvestSpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";

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

vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fakes honoring exactly the operators the NPP invest
// primitive and its caller emit ($inc, $push with $each+$slice key records,
// $set, _id equality, $in id lists, $ne-on-keys, $gte guards, $or turn
// guards, $exists; duplicate-key errors on insert; row deletes), so an
// injected crash between any two writes models a real process death between
// the corresponding sequential Mongo writes.
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
    if (field === "$or") {
      const branches = Array.isArray(condition) ? condition : [];
      if (!branches.some((branch) => matchesFilter(doc, branch as Record<string, unknown>))) {
        return false;
      }
      continue;
    }
    if (field === "_id" && !isOperatorObject(condition)) continue;
    const actual = field === "_id" ? doc._id : getPath(doc, field);
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
      if ("$gte" in condition) {
        if (!(typeof actual === "number" && actual >= (condition.$gte as number))) return false;
        continue;
      }
      if ("$exists" in condition) {
        if ((actual !== undefined) !== (condition.$exists as boolean)) return false;
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

  // Negative control surface: the legacy pass wrote through bulkWrite and
  // insertMany batch calls. Those methods throw here, so any test driving the
  // pass or the primitive through this fake fails loudly if the old batch
  // path ever returns.
  async bulkWrite(): Promise<never> {
    throw new Error("LEGACY_BULK_PATH");
  }

  async insertMany(): Promise<never> {
    throw new Error("LEGACY_BULK_PATH");
  }

  async deleteOne(
    filter: Record<string, unknown>,
    _opts?: Record<string, unknown>
  ): Promise<{ deletedCount: number }> {
    this.countWrite();
    const rawId = filter._id;
    if (rawId !== undefined && !isOperatorObject(rawId)) {
      return { deletedCount: this.docs.delete(docKey(rawId)) ? 1 : 0 };
    }
    for (const [key, doc] of this.docs) {
      if (matchesFilter(doc, filter)) {
        this.docs.delete(key);
        return { deletedCount: 1 };
      }
    }
    return { deletedCount: 0 };
  }
}

class FakeCursor {
  constructor(
    private readonly collection: FakeCollection,
    private readonly filter: Record<string, unknown>
  ) {}

  project(_spec: Record<string, unknown>): FakeCursor {
    return this;
  }

  sort(_spec: Record<string, unknown>): FakeCursor {
    return this;
  }

  async toArray(): Promise<Record<string, unknown>[]> {
    const rawId = this.filter._id;
    const docs = [...this.collection.docs.values()].filter((doc) => {
      if (rawId !== undefined && !isOperatorObject(rawId) && docKey(doc._id) !== docKey(rawId)) {
        return false;
      }
      return matchesFilter(doc, this.filter);
    });
    return cloneValue(docs);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Record<string, unknown>> {
    const docs = await this.toArray();
    for (const doc of docs) yield doc;
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

const nppId = new ObjectId();
const domesticFundId = new ObjectId();
const sectorFundId = new ObjectId();
const TURN = 12;

const DOMESTIC_NAV = 100;
const SECTOR_NAV = 25;
const BUDGET = 666;
const DOMESTIC_UNITS = 5;
const DOMESTIC_COST = DOMESTIC_UNITS * DOMESTIC_NAV;
const SECTOR_UNITS = 4;
const SECTOR_COST = SECTOR_UNITS * SECTOR_NAV;
const INVESTED = DOMESTIC_COST + SECTOR_COST;

function seedAll(db: FakeDb): void {
  db.collection("npps").docs.set(nppId.toHexString(), {
    _id: nppId,
    countryId: "US",
    favorability: 80,
    politicalInfluence: 80,
    nppInvestmentCashAnchor: 0,
  });
  db.collection("indexFunds").docs.set(domesticFundId.toHexString(), {
    _id: domesticFundId,
    slug: "us-broad",
    status: "active",
    scope: "country",
    countryId: "US",
    kind: "broad",
    quotedNav: DOMESTIC_NAV,
    unitSupply: 1000,
    cashAnchor: 10_000,
  });
  db.collection("indexFunds").docs.set(sectorFundId.toHexString(), {
    _id: sectorFundId,
    slug: "global-tech",
    status: "active",
    scope: "global",
    kind: "sector",
    quotedNav: SECTOR_NAV,
    unitSupply: 2000,
    cashAnchor: 20_000,
  });
  db.collection("indexFundPositions").docs.set("pos-existing", {
    _id: new ObjectId(),
    fundId: sectorFundId,
    holderKind: "npp",
    nppId,
    units: 10,
    avgNavAnchor: 40,
  });
}

function makeSubscriptions(): NppInvestSubscription[] {
  return [
    {
      fundId: domesticFundId,
      fundSlug: "us-broad",
      quotedNav: DOMESTIC_NAV,
      units: DOMESTIC_UNITS,
      costAnchor: DOMESTIC_COST,
      existingPosition: false,
    },
    {
      fundId: sectorFundId,
      fundSlug: "global-tech",
      quotedNav: SECTOR_NAV,
      units: SECTOR_UNITS,
      costAnchor: SECTOR_COST,
      existingPosition: true,
    },
  ];
}

function makeInput(overrides?: Partial<NppInvestSpendInput>): NppInvestSpendInput {
  const subscriptions = makeSubscriptions();
  const base = {
    nppId,
    turn: TURN,
    budget: BUDGET,
    investedAnchor: INVESTED,
    archetype: "conservative" as const,
    subscriptions,
    canarySkipped: false,
    fingerprint: "",
    ...overrides,
  };
  if (!overrides?.fingerprint) {
    base.fingerprint = buildNppInvestFingerprint({
      nppId: base.nppId,
      turn: base.turn,
      budget: base.budget,
      investedAnchor: base.investedAnchor,
      archetype: base.archetype,
      canarySkipped: base.canarySkipped,
      subscriptions: base.subscriptions,
    });
  }
  if (!overrides?.idempotencyKey) {
    base.idempotencyKey = buildNppInvestKey(base.nppId, base.turn);
  }
  return base as NppInvestSpendInput;
}

function nppCash(db: FakeDb): number {
  return db.collection("npps").docs.get(nppId.toHexString())!.nppInvestmentCashAnchor as number;
}

function fundTotals(db: FakeDb, fund: ObjectId): { units: number; cash: number } {
  const doc = db.collection("indexFunds").docs.get(fund.toHexString())!;
  return { units: doc.unitSupply as number, cash: doc.cashAnchor as number };
}

function positions(db: FakeDb): { fundId: ObjectId; units: number; avg: number }[] {
  return [...db.collection("indexFundPositions").docs.values()].map((d) => ({
    fundId: d.fundId as ObjectId,
    units: d.units as number,
    avg: d.avgNavAnchor as number,
  }));
}

function txRows(db: FakeDb): Record<string, unknown>[] {
  return [...db.collection("indexFundTransactions").docs.values()];
}

function receipts(db: FakeDb): Record<string, unknown>[] {
  return [...db.collection("nonAtomicMoneyFlowReceipts").docs.values()];
}

beforeEach(() => {
  vi.clearAllMocks();
  supportMock.mockResolvedValue(false);
  getMongoClientMock.mockReturnValue(undefined);
});

describe("applyNppInvestSpend", () => {
  it("accrues, debits, credits funds, writes positions, and logs audit rows exactly once", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    const input = makeInput();

    const first = await applyNppInvestSpend(db, input);
    expect(first.duplicate).toBe(false);
    expect(first.outcome).toEqual({ budget: BUDGET, investedAnchor: INVESTED, subscriptions: 2 });
    expect(isNppInvestOutcome(first.outcome)).toBe(true);

    // Accrual minus the pinned debit stays as NPP cash; the turn stamp lands.
    expect(nppCash(raw)).toBe(BUDGET - INVESTED);
    expect(raw.collection("npps").docs.get(nppId.toHexString())!.lastIndexFundInvestmentTurn).toBe(
      TURN
    );

    expect(fundTotals(raw, domesticFundId)).toEqual({
      units: 1000 + DOMESTIC_UNITS,
      cash: 10_000 + DOMESTIC_COST,
    });
    expect(fundTotals(raw, sectorFundId)).toEqual({
      units: 2000 + SECTOR_UNITS,
      cash: 20_000 + SECTOR_COST,
    });

    // New position inserted at the pinned NAV; existing position blended with
    // the legacy weighted average: (10 x 40 + 4 x 25) / 14.
    const pos = positions(raw);
    expect(pos).toHaveLength(2);
    const domestic = pos.find((p) => (p.fundId as ObjectId).equals(domesticFundId))!;
    expect(domestic).toMatchObject({ units: DOMESTIC_UNITS, avg: DOMESTIC_NAV });
    const sector = pos.find((p) => (p.fundId as ObjectId).equals(sectorFundId))!;
    expect(sector.units).toBe(14);
    expect(sector.avg).toBeCloseTo((10 * 40 + SECTOR_COST) / 14, 10);

    // Legacy-exact audit rows, one per subscription.
    const txs = txRows(raw);
    expect(txs).toHaveLength(2);
    for (const tx of txs) {
      expect(tx).toMatchObject({
        kind: "subscription",
        holderKind: "npp",
        note: `NPP ${nppId.toHexString()} subscription (conservative)`,
      });
    }
    const domesticTx = txs.find((t) => (t.fundId as ObjectId).equals(domesticFundId))!;
    expect(domesticTx).toMatchObject({
      units: DOMESTIC_UNITS,
      navAnchor: DOMESTIC_NAV,
      amountAnchor: DOMESTIC_COST,
    });

    // A same-key replay converges without moving money again.
    const second = await applyNppInvestSpend(db, input);
    expect(second.duplicate).toBe(true);
    expect(second.outcome).toEqual(first.outcome);
    expect(nppCash(raw)).toBe(BUDGET - INVESTED);
    expect(fundTotals(raw, domesticFundId)).toEqual({
      units: 1000 + DOMESTIC_UNITS,
      cash: 10_000 + DOMESTIC_COST,
    });
    expect(positions(raw)).toHaveLength(2);
    expect(txRows(raw)).toHaveLength(2);
  });

  it("recovers exactly-once after a crash following every durable write", async () => {
    // Durable write order: receipt claim, plan persist, accrue, debit, one
    // fund leg per subscription in order, one position write per subscription
    // in order, one audit insert per subscription in order, receipt settle,
    // outcome persist. Crashing after each of them (and before the first)
    // must converge to one investment.
    const totalWrites = 2 + 2 + 2 + 2 + 2 + 2;
    for (let crashAfter = 0; crashAfter < totalWrites; crashAfter += 1) {
      const raw = new FakeDb();
      seedAll(raw);
      const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
      const input = makeInput();
      raw.crashAfterWrites = crashAfter;
      await expect(applyNppInvestSpend(db, input)).rejects.toThrow("INJECTED_CRASH");

      raw.crashAfterWrites = Number.POSITIVE_INFINITY;
      const resumed = await applyNppInvestSpend(db, input);
      expect(resumed.outcome).toEqual({
        budget: BUDGET,
        investedAnchor: INVESTED,
        subscriptions: 2,
      });
      expect(nppCash(raw)).toBe(BUDGET - INVESTED);
      expect(fundTotals(raw, domesticFundId)).toEqual({
        units: 1000 + DOMESTIC_UNITS,
        cash: 10_000 + DOMESTIC_COST,
      });
      expect(fundTotals(raw, sectorFundId)).toEqual({
        units: 2000 + SECTOR_UNITS,
        cash: 20_000 + SECTOR_COST,
      });
      expect(positions(raw)).toHaveLength(2);
      expect(txRows(raw)).toHaveLength(2);
      const receipt = receipts(raw);
      expect(receipt).toHaveLength(1);
      expect(receipt[0]!.status).toBe("completed");
    }
  });

  it("resumes a partial investment without accruing or investing twice", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    const input = makeInput();
    // Crash after claim + plan + accrue + debit: cash moved, nothing else.
    // (The counter throws BEFORE the (n+1)th write, so 4 lets the debit land.)
    raw.crashAfterWrites = 4;
    await expect(applyNppInvestSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    expect(nppCash(raw)).toBe(BUDGET - INVESTED);
    expect(fundTotals(raw, domesticFundId).units).toBe(1000);

    raw.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await resumeNppInvestByKey(db, input.idempotencyKey!, nppId, TURN);
    expect(result).not.toBeNull();
    expect(result!.outcome).toEqual({ budget: BUDGET, investedAnchor: INVESTED, subscriptions: 2 });
    // No second accrual and no second debit: cash is exactly budget - invested.
    expect(nppCash(raw)).toBe(BUDGET - INVESTED);
    expect(fundTotals(raw, domesticFundId)).toEqual({
      units: 1000 + DOMESTIC_UNITS,
      cash: 10_000 + DOMESTIC_COST,
    });
    expect(positions(raw)).toHaveLength(2);
    expect(txRows(raw)).toHaveLength(2);
  });

  it("replays the stored plan when prices and cash changed after the crash", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    const input = makeInput();
    raw.crashAfterWrites = 4;
    await expect(applyNppInvestSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    // Prices moved and outside cash moved before the retry: the stored plan
    // still settles at the pinned NAVs with no second accrual.
    raw.collection("indexFunds").docs.get(domesticFundId.toHexString())!.quotedNav = 1000;
    raw.collection("npps").docs.get(nppId.toHexString())!.nppInvestmentCashAnchor = 999_999;
    const resumed = await applyNppInvestSpend(db, input);
    expect(resumed.duplicate).toBe(true);
    expect(resumed.outcome.investedAnchor).toBe(INVESTED);
    // Fund credited at the pinned NAV (units and cost), not repriced.
    expect(fundTotals(raw, domesticFundId)).toEqual({
      units: 1000 + DOMESTIC_UNITS,
      cash: 10_000 + DOMESTIC_COST,
    });
    // The debit already applied in the first attempt, so the retry reconciles
    // it as already-applied and never debits the tampered balance again:
    // exactly one debit ran across both attempts.
    expect(nppCash(raw)).toBe(999_999);
    const domestic = positions(raw).find((p) => (p.fundId as ObjectId).equals(domesticFundId))!;
    expect(domestic).toMatchObject({ units: DOMESTIC_UNITS, avg: DOMESTIC_NAV });
  });

  it("fails closed when a retry recomputes the plan from changed state", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    const input = makeInput();
    raw.crashAfterWrites = 4;
    await expect(applyNppInvestSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    // A retry presenting a recomputed plan (hence a different fingerprint)
    // under the same key must fail closed, not invest the newcomer figures on
    // top of the stored plan.
    const changed = makeInput({
      subscriptions: [
        {
          fundId: domesticFundId,
          fundSlug: "us-broad",
          quotedNav: 1000,
          units: 1,
          costAnchor: 1000,
          existingPosition: false,
        },
      ],
      investedAnchor: 1000,
      budget: 1000,
    });
    changed.idempotencyKey = input.idempotencyKey;
    await expect(applyNppInvestSpend(db, changed)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(nppCash(raw)).toBe(BUDGET - INVESTED);

    // The same fingerprint resumes the stored plan instead.
    const resumed = await applyNppInvestSpend(db, input);
    expect(resumed.outcome.investedAnchor).toBe(INVESTED);
    expect(nppCash(raw)).toBe(BUDGET - INVESTED);
  });

  it("converges concurrent same-key retries to a single investment", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    const input = makeInput();
    const [first, second] = await Promise.all([
      applyNppInvestSpend(db, input),
      applyNppInvestSpend(db, input),
    ]);
    expect(first.outcome).toEqual(second.outcome);
    expect(nppCash(raw)).toBe(BUDGET - INVESTED);
    expect(fundTotals(raw, domesticFundId).cash).toBe(10_000 + DOMESTIC_COST);
    expect(positions(raw)).toHaveLength(2);
    expect(txRows(raw)).toHaveLength(2);
  });

  it("compensates the applied prefix when a fund row is gone", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    // The sector fund vanished between plan and apply: accrue + debit +
    // domestic leg + domestic position applied, then the sector fund step
    // reports missing and the prefix compensates.
    raw.collection("indexFunds").docs.delete(sectorFundId.toHexString());
    await expect(applyNppInvestSpend(db, makeInput())).rejects.toThrow(
      new RegExp(`^${NPP_INVEST_FUND}:`)
    );
    // Accrual and debit reversed: cash back to zero. The turn stamp stays on
    // the compensated attempt (the keyed compensation keeps the $set while
    // negating the $inc), so this turn cannot accrue again under any key.
    expect(nppCash(raw)).toBe(0);
    expect(fundTotals(raw, domesticFundId)).toEqual({ units: 1000, cash: 10_000 });
    expect(positions(raw)).toHaveLength(1);
    expect(txRows(raw)).toHaveLength(0);
    expect(receipts(raw)[0]!.status).toBe("compensated");

    // A retry under the same key fails terminal-closed.
    await expect(applyNppInvestSpend(db, makeInput())).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    await expect(
      resumeNppInvestByKey(db, makeInput().idempotencyKey!, nppId, TURN)
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("compensates the applied prefix when a planned-existing position is gone", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    // The sector position the caller saw vanished between plan and apply: the
    // legacy bulk update silently no-matched here and stranded fund units with
    // no owner row. The keyed step reports missing and the prefix compensates.
    raw.collection("indexFundPositions").docs.delete("pos-existing");
    await expect(applyNppInvestSpend(db, makeInput())).rejects.toThrow(
      new RegExp(`^${NPP_INVEST_POSITION}:`)
    );
    expect(nppCash(raw)).toBe(0);
    expect(fundTotals(raw, domesticFundId)).toEqual({ units: 1000, cash: 10_000 });
    expect(fundTotals(raw, sectorFundId)).toEqual({ units: 2000, cash: 20_000 });
    // The new domestic position insert was reverted exactly.
    expect(positions(raw)).toHaveLength(0);
    expect(txRows(raw)).toHaveLength(0);
  });

  it("restores an existing position image exactly on revert", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    const input = makeInput();
    // Drive the built steps directly: apply the sector position update, then
    // revert it, and assert the prior image returns byte-exact.
    const steps = buildNppInvestSteps(db, input.idempotencyKey!, input, new Date());
    const sectorStep = steps.find((s) => s.name === `position:${sectorFundId.toHexString()}`)!;
    expect(await sectorStep.apply({})).toBe("applied");
    const after = positions(raw).find((p) => (p.fundId as ObjectId).equals(sectorFundId))!;
    expect(after.units).toBe(14);
    expect(await sectorStep.revert!({})).toBe("applied");
    const restored = positions(raw).find((p) => (p.fundId as ObjectId).equals(sectorFundId))!;
    expect(restored.units).toBe(10);
    expect(restored.avg).toBeCloseTo(40, 10);
  });

  it("leaves an untouched position alone when an earlier fund step fails", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    raw.collection("indexFunds").docs.delete(domesticFundId.toHexString());
    await expect(applyNppInvestSpend(db, makeInput())).rejects.toThrow(
      new RegExp(`^${NPP_INVEST_FUND}:`)
    );
    // Nothing applied (the domestic fund leg is the first fund step), so the
    // pre-existing sector position is untouched.
    const sector = positions(raw).find((p) => (p.fundId as ObjectId).equals(sectorFundId))!;
    expect(sector).toMatchObject({ units: 10, avg: 40 });
    expect(nppCash(raw)).toBe(0);
  });

  it("accrues only when the canary drops the subscriptions", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    const input = makeInput({
      investedAnchor: 0,
      subscriptions: [],
      canarySkipped: true,
    });
    const result = await applyNppInvestSpend(db, input);
    expect(result.duplicate).toBe(false);
    expect(result.outcome).toEqual({ budget: BUDGET, investedAnchor: 0, subscriptions: 0 });
    expect(nppCash(raw)).toBe(BUDGET);
    expect(fundTotals(raw, domesticFundId)).toEqual({ units: 1000, cash: 10_000 });
    expect(positions(raw)).toHaveLength(1);
    expect(txRows(raw)).toHaveLength(0);

    const replay = await applyNppInvestSpend(db, input);
    expect(replay.duplicate).toBe(true);
    expect(nppCash(raw)).toBe(BUDGET);
  });

  it("refuses a same-turn second attempt under a fresh key", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    await applyNppInvestSpend(db, makeInput());
    // A new key for the same NPP and turn hits the accrual turn guard with
    // nothing applied: the receipt settles failed and cash never moves again.
    const retry = makeInput({ idempotencyKey: "npp-invest-second-attempt" });
    await expect(applyNppInvestSpend(db, retry)).rejects.toThrow(
      new RegExp(`^${NPP_INVEST_ACCRUE}:`)
    );
    expect(nppCash(raw)).toBe(BUDGET - INVESTED);
  });

  it("rejects a key reused for a genuinely different investment", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    const first = makeInput();
    await applyNppInvestSpend(db, first);
    const different = makeInput({ budget: 999, idempotencyKey: first.idempotencyKey });
    await expect(applyNppInvestSpend(db, different)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
  });

  it("validates its pinned inputs before claiming", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    await expect(applyNppInvestSpend(db, makeInput({ budget: 0 }))).rejects.toThrow(RangeError);
    await expect(
      applyNppInvestSpend(db, makeInput({ investedAnchor: INVESTED + 1 }))
    ).rejects.toThrow(RangeError);
    await expect(
      applyNppInvestSpend(db, makeInput({ investedAnchor: BUDGET + 1 }))
    ).rejects.toThrow(RangeError);
    await expect(
      applyNppInvestSpend(db, makeInput({ subscriptions: [], investedAnchor: INVESTED }))
    ).rejects.toThrow(RangeError);
    expect(receipts(raw)).toHaveLength(0);
  });

  it("builds deterministic keys and order-sensitive fingerprints", async () => {
    const keyA = buildNppInvestKey(nppId, TURN);
    expect(keyA).toBe(buildNppInvestKey(new ObjectId(nppId.toHexString()), TURN));
    expect(keyA).toContain(`turn:${TURN}`);
    expect(buildNppInvestKey(nppId, TURN + 1)).not.toBe(keyA);

    const fpA = buildNppInvestFingerprint({
      nppId,
      turn: TURN,
      budget: BUDGET,
      investedAnchor: INVESTED,
      archetype: "conservative",
      canarySkipped: false,
      subscriptions: makeSubscriptions(),
    });
    const reordered = makeSubscriptions().reverse();
    const fpReordered = buildNppInvestFingerprint({
      nppId,
      turn: TURN,
      budget: BUDGET,
      investedAnchor: INVESTED,
      archetype: "conservative",
      canarySkipped: false,
      subscriptions: reordered,
    });
    expect(fpReordered).not.toBe(fpA);
  });

  it("negative control: unkeyed legacy-style writes accrue twice on replay", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    // The old code path: two raw $incs with no idempotency guard.
    const legacyAccrueAndDebit = async (): Promise<void> => {
      const npp = raw.collection("npps").docs.get(nppId.toHexString())!;
      npp.nppInvestmentCashAnchor = (npp.nppInvestmentCashAnchor as number) + BUDGET;
      npp.nppInvestmentCashAnchor = (npp.nppInvestmentCashAnchor as number) - INVESTED;
    };
    await legacyAccrueAndDebit();
    await legacyAccrueAndDebit();
    expect(nppCash(raw)).toBe(2 * (BUDGET - INVESTED));

    // Same double-invocation through the primitive converges to one accrual.
    raw.collection("npps").docs.get(nppId.toHexString())!.nppInvestmentCashAnchor = 0;
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    const input = makeInput();
    await applyNppInvestSpend(db, input);
    await applyNppInvestSpend(db, input);
    expect(nppCash(raw)).toBe(BUDGET - INVESTED);
  });

  it("exposes the ordered steps for compensation tests", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyNppInvestSpend>[0];
    const input = makeInput();
    const steps = buildNppInvestSteps(db, input.idempotencyKey!, input, new Date());
    // accrue + debit + 2 fund legs + 2 position steps + 2 audit rows.
    expect(steps.map((s) => s.name)).toEqual([
      "accrue",
      "debit",
      `fund:${domesticFundId.toHexString()}`,
      `fund:${sectorFundId.toHexString()}`,
      `position:${domesticFundId.toHexString()}`,
      `position:${sectorFundId.toHexString()}`,
      `invest-tx:${domesticFundId.toHexString()}`,
      `invest-tx:${sectorFundId.toHexString()}`,
    ]);
  });
});

describe("NPP pass over the crash-safe primitive", () => {
  // US conservative NPP: floor(80000/48 x 0.4) = 666/turn budget at zero
  // wealth. Conservative split of 666: domestic floor(666 x 0.7) = 466,
  // global floor(666 x 0.175) = 116, sector remainder 84. Single fund per
  // bucket keeps the selection deterministic: 4 x 100 + 2 x 50 + 3 x 25.
  const PASS_BUDGET = 666;
  const PASS_INVESTED = 400 + 100 + 75;

  const passDomesticId = new ObjectId();
  const passGlobalId = new ObjectId();
  const passSectorId = new ObjectId();

  function seedPassFund(raw: FakeDb, id: ObjectId, fund: Record<string, unknown>): void {
    raw.collection("indexFunds").docs.set(id.toHexString(), {
      _id: id,
      status: "active",
      unitSupply: 1000,
      cashAnchor: 10_000,
      ...fund,
    });
  }

  function seedPassNpp(raw: FakeDb, id: ObjectId, cash = 0): void {
    raw.collection("npps").docs.set(id.toHexString(), {
      _id: id,
      countryId: "US",
      favorability: 80,
      politicalInfluence: 80,
      retiredAt: null,
      nppInvestmentCashAnchor: cash,
    });
  }

  function seedPassWorld(raw: FakeDb, nppIds: ObjectId[]): void {
    seedPassFund(raw, passDomesticId, {
      slug: "us-broad",
      scope: "country",
      countryId: "US",
      kind: "broad",
      quotedNav: 100,
    });
    seedPassFund(raw, passGlobalId, {
      slug: "global-broad",
      scope: "global",
      kind: "broad",
      quotedNav: 50,
    });
    seedPassFund(raw, passSectorId, {
      slug: "global-tech",
      scope: "global",
      kind: "sector",
      quotedNav: 25,
    });
    for (const id of nppIds) seedPassNpp(raw, id);
  }

  async function runPass(raw: FakeDb, turn = TURN) {
    const { processNPPFundInvestments } = await import("./nppInvesting");
    return processNPPFundInvestments(
      raw as unknown as Parameters<typeof processNPPFundInvestments>[0],
      { currentTurn: turn }
    );
  }

  function passPositions(raw: FakeDb, npp: ObjectId): Record<string, unknown>[] {
    return [...raw.collection("indexFundPositions").docs.values()].filter((d) =>
      (d.nppId as ObjectId).equals(npp)
    );
  }

  it("invests the damped budget with legacy-exact splits, prices, and audit rows", async () => {
    const raw = new FakeDb();
    const npp = new ObjectId();
    seedPassWorld(raw, [npp]);

    const result = await runPass(raw);
    expect(result.errors).toEqual([]);
    expect(result.nppsProcessed).toBe(1);
    expect(result.totalInvested).toBe(PASS_INVESTED);

    const doc = raw.collection("npps").docs.get(npp.toHexString())!;
    expect(doc.nppInvestmentCashAnchor).toBe(PASS_BUDGET - PASS_INVESTED);
    expect(doc.lastIndexFundInvestmentTurn).toBe(TURN);

    const pos = passPositions(raw, npp);
    expect(pos).toHaveLength(3);
    const byFund = new Map(pos.map((p) => [(p.fundId as ObjectId).toHexString(), p]));
    expect(byFund.get(passDomesticId.toHexString())).toMatchObject({ units: 4, avgNavAnchor: 100 });
    expect(byFund.get(passGlobalId.toHexString())).toMatchObject({ units: 2, avgNavAnchor: 50 });
    expect(byFund.get(passSectorId.toHexString())).toMatchObject({ units: 3, avgNavAnchor: 25 });

    expect(raw.collection("indexFunds").docs.get(passDomesticId.toHexString())).toMatchObject({
      unitSupply: 1004,
      cashAnchor: 10_400,
    });

    const txs = [...raw.collection("indexFundTransactions").docs.values()].filter((t) =>
      (t.nppId as ObjectId).equals(npp)
    );
    expect(txs).toHaveLength(3);
    for (const tx of txs) {
      expect(tx).toMatchObject({
        kind: "subscription",
        holderKind: "npp",
        note: `NPP ${npp.toHexString()} subscription (conservative)`,
      });
    }
  });

  it("skips a saturated NPP with zero writes", async () => {
    const raw = new FakeDb();
    const npp = new ObjectId();
    seedPassWorld(raw, [npp]);
    raw.collection("npps").docs.get(npp.toHexString())!.nppInvestmentCashAnchor = 200_000;

    const result = await runPass(raw);
    expect(result.nppsProcessed).toBe(0);
    expect(result.totalInvested).toBe(0);
    expect(result.errors).toEqual([]);
    expect(raw.writeCount).toBe(0);
  });

  it("counts fund-position value toward saturation, not just cash", async () => {
    const raw = new FakeDb();
    const npp = new ObjectId();
    seedPassWorld(raw, [npp]);
    raw.collection("indexFundPositions").docs.set("rich-pos", {
      _id: new ObjectId(),
      fundId: passDomesticId,
      holderKind: "npp",
      nppId: npp,
      units: 2000,
      avgNavAnchor: 100,
    });

    const result = await runPass(raw);
    expect(result.nppsProcessed).toBe(0);
    expect(raw.writeCount).toBe(0);
  });

  it("values wealth only from NPP-held positions (players are structurally exempt)", async () => {
    const raw = new FakeDb();
    const npp = new ObjectId();
    seedPassWorld(raw, [npp]);
    // A character position worth far more than the saturation cap must not
    // damp this NPP: the valuation is scoped holderKind "npp".
    raw.collection("indexFundPositions").docs.set("char-pos", {
      _id: new ObjectId(),
      fundId: passDomesticId,
      holderKind: "character",
      characterId: new ObjectId(),
      units: 100_000,
      avgNavAnchor: 100,
    });

    const result = await runPass(raw);
    expect(result.nppsProcessed).toBe(1);
    expect(result.totalInvested).toBe(PASS_INVESTED);
  });

  it("never debits more than the damped accrual", async () => {
    const raw = new FakeDb();
    const npp = new ObjectId();
    seedPassWorld(raw, [npp]);
    raw.collection("npps").docs.get(npp.toHexString())!.nppInvestmentCashAnchor = 80_000;

    const result = await runPass(raw);
    expect(result.errors).toEqual([]);
    expect(result.nppsProcessed).toBe(1);
    // Half the saturation cap halves the accrual: floor(666 x 0.5) = 333.
    const doc = raw.collection("npps").docs.get(npp.toHexString())!;
    expect(doc.nppInvestmentCashAnchor as number).toBeGreaterThanOrEqual(80_000);
    expect(result.totalInvested).toBeLessThanOrEqual(333);
  });

  it("re-running the pass in the same turn is a no-op", async () => {
    const raw = new FakeDb();
    const npp = new ObjectId();
    seedPassWorld(raw, [npp]);

    const first = await runPass(raw);
    expect(first.nppsProcessed).toBe(1);
    const writesAfterFirst = raw.writeCount;

    const second = await runPass(raw);
    expect(second).toEqual({ nppsProcessed: 0, totalInvested: 0, errors: [] });
    expect(raw.writeCount).toBe(writesAfterFirst);
    expect(raw.collection("npps").docs.get(npp.toHexString())!.nppInvestmentCashAnchor).toBe(
      PASS_BUDGET - PASS_INVESTED
    );
    expect(passPositions(raw, npp)).toHaveLength(3);
  });

  it("resumes a crashed pass without double-accruing: stored prices for resumed, live prices for fresh", async () => {
    const raw = new FakeDb();
    const nppA = new ObjectId();
    const nppB = new ObjectId();
    seedPassWorld(raw, [nppA, nppB]);

    // One NPP flow is 14 durable writes (claim, plan, accrue, debit, 3 fund
    // legs, 3 position writes, 3 audit rows, outcome). Crash NPP B after its
    // claim + plan: nothing applied for B, and the pass records the error and
    // keeps going instead of aborting the turn.
    // One NPP flow is 15 durable writes (claim, plan, accrue, debit, 3 fund
    // legs, 3 position writes, 3 audit rows, settle, outcome). Crash NPP B
    // during its accrual (claim + plan landed, nothing applied): the pass
    // records the error and keeps going instead of aborting the turn.
    raw.crashAfterWrites = 17;
    const crashed = await runPass(raw);
    expect(crashed.nppsProcessed).toBe(1);
    expect(crashed.totalInvested).toBe(PASS_INVESTED);
    expect(crashed.errors).toHaveLength(1);

    // Prices move and a new NPP arrives before the retry.
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;
    raw.collection("indexFunds").docs.get(passDomesticId.toHexString())!.quotedNav = 200;
    const nppC = new ObjectId();
    seedPassNpp(raw, nppC);

    const resumed = await runPass(raw);
    expect(resumed.errors).toEqual([]);
    // The orphan driver resumed B (counted here); the fresh loop skipped A
    // and B via their turn stamps and invested C fresh.
    expect(resumed.nppsProcessed).toBe(2);
    expect(resumed.totalInvested).toBe(2 * PASS_INVESTED);

    // A and B invested at the stored NAV; C invested at the live NAV (its
    // domestic slice reprices to floor(466/200) = 2 units at 200, same totals
    // by arithmetic coincidence: 400 + 100 + 75).
    for (const npp of [nppA, nppB]) {
      expect(raw.collection("npps").docs.get(npp.toHexString())!.nppInvestmentCashAnchor).toBe(
        PASS_BUDGET - PASS_INVESTED
      );
      const domestic = passPositions(raw, npp).find((p) =>
        (p.fundId as ObjectId).equals(passDomesticId)
      )!;
      expect(domestic).toMatchObject({ units: 4, avgNavAnchor: 100 });
    }
    expect(raw.collection("npps").docs.get(nppC.toHexString())!.nppInvestmentCashAnchor).toBe(
      PASS_BUDGET - PASS_INVESTED
    );
    const domesticC = passPositions(raw, nppC).find((p) =>
      (p.fundId as ObjectId).equals(passDomesticId)
    )!;
    expect(domesticC).toMatchObject({ units: 2, avgNavAnchor: 200 });
    expect(passPositions(raw, nppC)).toHaveLength(3);
    expect([...raw.collection("nonAtomicMoneyFlowReceipts").docs.values()]).toHaveLength(3);
  });

  it("fails one NPP closed without breaking the rest of the pass", async () => {
    const raw = new FakeDb();
    const nppA = new ObjectId();
    const nppB = new ObjectId();
    seedPassWorld(raw, [nppA, nppB]);
    // B starts deeply negative, so its pinned debit guard cannot match after
    // its accrual: B's prefix compensates while A invests untouched.
    raw.collection("npps").docs.get(nppB.toHexString())!.nppInvestmentCashAnchor = -1000;

    const result = await runPass(raw);
    expect(result.nppsProcessed).toBe(1);
    expect(result.totalInvested).toBe(PASS_INVESTED);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(nppB.toHexString());
    expect(passPositions(raw, nppA)).toHaveLength(3);
    expect(passPositions(raw, nppB)).toHaveLength(0);
    // Accrual refunded exactly: B keeps its pre-pass negative balance.
    expect(raw.collection("npps").docs.get(nppB.toHexString())!.nppInvestmentCashAnchor).toBe(
      -1000
    );
  });
});
