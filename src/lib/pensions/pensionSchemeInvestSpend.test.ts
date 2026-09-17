import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  applyPensionSchemeInvestSpend,
  buildPensionSchemeInvestFingerprint,
  buildPensionSchemeInvestKey,
  buildPensionSchemeInvestSteps,
  isPensionSchemeInvestOutcome,
  PENSION_SCHEME_INVEST_DEBIT,
  PENSION_SCHEME_INVEST_FUND,
  PENSION_SCHEME_INVEST_POSITION,
  PENSION_SCHEME_INVEST_TX,
  recoverPensionSchemeInvestOrphans,
  resumePensionSchemeInvestByKey,
  type PensionSchemeInvestSpendInput,
} from "./pensionSchemeInvestSpend";
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

// ---------------------------------------------------------------------------
// Stateful in-memory fakes honoring exactly the operators the pension-scheme
// invest primitive emits ($inc incl. extraIncs, $set incl. dotted paths,
// $push with $each+$slice key records, _id equality, $ne-on-keys, $gte
// guards; duplicate-key errors on insert; row deletes), so an injected crash
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
      if ("$gte" in condition) {
        if (!(typeof actual === "number" && actual >= (condition.$gte as number))) return false;
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

  async deleteOne(
    filter: Record<string, unknown>,
    _opts?: Record<string, unknown>
  ): Promise<{ deletedCount: number }> {
    this.countWrite();
    const rawId = filter._id;
    if (rawId !== undefined && !isOperatorObject(rawId)) {
      // A conditional delete by _id plus field guards must honor the guards.
      const doc = this.docs.get(docKey(rawId));
      if (!doc) return { deletedCount: 0 };
      if (!matchesFilter(doc, filter)) return { deletedCount: 0 };
      this.docs.delete(docKey(rawId));
      return { deletedCount: 1 };
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

const schemeId = new ObjectId();
const fundId = new ObjectId();
const TURN = 7;
const NAV = 100;
const UNITS = 5;
const COST = UNITS * NAV;
const SCHEME_CASH = 10_000;

function seedAll(raw: FakeDb, opts?: { existingPosition?: boolean }): void {
  raw.collection("pensionSchemes").docs.set(schemeId.toHexString(), {
    _id: schemeId,
    unionId: new ObjectId(),
    countryId: "US",
    unionName: "Test Union",
    assetsAnchor: SCHEME_CASH,
    totalInvestedAnchor: 0,
    liabilitiesAnchor: 0,
    totalContributionsAnchor: SCHEME_CASH,
    totalTopUpsAnchor: 0,
  });
  raw.collection("indexFunds").docs.set(fundId.toHexString(), {
    _id: fundId,
    slug: "us-broad",
    status: "active",
    scope: "country",
    countryId: "US",
    kind: "broad",
    quotedNav: NAV,
    unitSupply: 1000,
    cashAnchor: 50_000,
  });
  if (opts?.existingPosition) {
    raw.collection("indexFundPositions").docs.set("pos-existing", {
      _id: new ObjectId(),
      fundId,
      holderKind: "pension_scheme",
      pensionSchemeId: schemeId,
      units: 10,
      avgNavAnchor: 40,
      legacyUnits: 0,
    });
  }
}

function makeInput(
  overrides?: Partial<PensionSchemeInvestSpendInput>
): PensionSchemeInvestSpendInput {
  const base = {
    schemeId,
    turn: TURN,
    fundId,
    fundSlug: "us-broad",
    schemeName: "Test Union",
    quotedNav: NAV,
    units: UNITS,
    costAnchor: COST,
    existingPosition: false,
    fingerprint: "",
    ...overrides,
  };
  if (!overrides || !("fingerprint" in overrides)) {
    base.fingerprint = buildPensionSchemeInvestFingerprint({
      schemeId: base.schemeId,
      fundId: base.fundId,
      turn: base.turn,
      quotedNav: base.quotedNav,
      units: base.units,
      costAnchor: base.costAnchor,
    });
  }
  if (!overrides || !("idempotencyKey" in overrides)) {
    base.idempotencyKey = buildPensionSchemeInvestKey(base.schemeId, base.turn);
  }
  return base as PensionSchemeInvestSpendInput;
}

function schemeCash(raw: FakeDb): { assets: number; invested: number } {
  const doc = raw.collection("pensionSchemes").docs.get(schemeId.toHexString())!;
  return { assets: doc.assetsAnchor as number, invested: (doc.totalInvestedAnchor as number) ?? 0 };
}

function fundTotals(raw: FakeDb): { units: number; cash: number } {
  const doc = raw.collection("indexFunds").docs.get(fundId.toHexString())!;
  return { units: doc.unitSupply as number, cash: doc.cashAnchor as number };
}

function positions(raw: FakeDb): Record<string, unknown>[] {
  return [...raw.collection("indexFundPositions").docs.values()];
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

describe("applyPensionSchemeInvestSpend", () => {
  it("debits, credits the fund, inserts the position, and logs the audit row exactly once", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const input = makeInput();

    const first = await applyPensionSchemeInvestSpend(db, input);
    expect(first.duplicate).toBe(false);
    expect(first.outcome).toEqual({ investedAnchor: COST, units: UNITS });
    expect(isPensionSchemeInvestOutcome(first.outcome)).toBe(true);

    // Guarded debit plus the cumulative invested counter in one atomic write.
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
    // Fund receives exactly the ₳ the units are worth.
    expect(fundTotals(raw)).toEqual({ units: 1000 + UNITS, cash: 50_000 + COST });

    // New position at the pinned NAV, post-fix (never grandfathered).
    const pos = positions(raw);
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({
      fundId,
      holderKind: "pension_scheme",
      pensionSchemeId: schemeId,
      units: UNITS,
      avgNavAnchor: NAV,
      legacyUnits: 0,
    });

    // Legacy-exact audit row, keyed so a crash-then-retry converges.
    const txs = txRows(raw);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      fundId,
      kind: "subscription",
      turn: TURN,
      holderKind: "pension_scheme",
      pensionSchemeId: schemeId,
      units: UNITS,
      navAnchor: NAV,
      amountAnchor: COST,
      note: "Test Union pension scheme",
    });

    const receipt = receipts(raw);
    expect(receipt).toHaveLength(1);
    expect(receipt[0]!.status).toBe("completed");
  });

  it("blends into an existing position with the legacy weighted average", async () => {
    const raw = new FakeDb();
    seedAll(raw, { existingPosition: true });
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];

    const first = await applyPensionSchemeInvestSpend(db, makeInput({ existingPosition: true }));
    expect(first.duplicate).toBe(false);

    const pos = positions(raw);
    expect(pos).toHaveLength(1);
    // (10 x 40 + 5 x 100) / 15 = 60.
    expect(pos[0]!.units).toBe(15);
    expect(pos[0]!.avgNavAnchor).toBeCloseTo(60, 10);
    expect(pos[0]!.legacyUnits).toBe(0);
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
  });

  it("recovers exactly-once after a crash following every durable write", async () => {
    // Durable write order: receipt claim, plan persist, debit, fund credit,
    // position write, audit insert, receipt settle, outcome persist.
    // Crashing after each of them (and before the first) must converge to one
    // investment, for both the new-position and existing-position shapes.
    for (const existingPosition of [false, true]) {
      const totalWrites = 8;
      for (let crashAfter = 0; crashAfter <= totalWrites; crashAfter += 1) {
        const raw = new FakeDb();
        seedAll(raw, { existingPosition });
        const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
        const input = makeInput({ existingPosition });
        raw.crashAfterWrites = crashAfter;
        try {
          await applyPensionSchemeInvestSpend(db, input);
        } catch (err) {
          expect((err as Error).message).toBe("INJECTED_CRASH");
        }

        raw.crashAfterWrites = Number.POSITIVE_INFINITY;
        const resumed = await applyPensionSchemeInvestSpend(db, input);
        expect(resumed.outcome).toEqual({ investedAnchor: COST, units: UNITS });
        // crashAfter = 0 dies before the claim insert, so the retry is a
        // fresh claim; every later crash leaves a receipt to reconcile.
        expect(resumed.duplicate).toBe(crashAfter > 0);
        expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
        expect(fundTotals(raw)).toEqual({ units: 1000 + UNITS, cash: 50_000 + COST });
        expect(positions(raw)).toHaveLength(1);
        expect(txRows(raw)).toHaveLength(1);
        const receipt = receipts(raw);
        expect(receipt).toHaveLength(1);
        expect(receipt[0]!.status).toBe("completed");
      }
    }
  });

  it("resumes a partial investment by key without debiting twice", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const input = makeInput();
    // Crash after claim + plan + debit: cash moved, nothing else.
    raw.crashAfterWrites = 3;
    await expect(applyPensionSchemeInvestSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
    expect(fundTotals(raw).units).toBe(1000);

    raw.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await resumePensionSchemeInvestByKey(db, input.idempotencyKey!, schemeId, TURN);
    expect(result).not.toBeNull();
    expect(result!.outcome).toEqual({ investedAnchor: COST, units: UNITS });
    // No second debit: cash is exactly seed minus cost.
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
    expect(fundTotals(raw)).toEqual({ units: 1000 + UNITS, cash: 50_000 + COST });
    expect(positions(raw)).toHaveLength(1);
    expect(txRows(raw)).toHaveLength(1);
  });

  it("replays the stored plan when prices and cash changed after the crash", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const input = makeInput();
    raw.crashAfterWrites = 3;
    await expect(applyPensionSchemeInvestSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    // The world moved on: NAV repriced and the scheme topped up.
    const fund = raw.collection("indexFunds").docs.get(fundId.toHexString())!;
    fund.quotedNav = 250;
    const scheme = raw.collection("pensionSchemes").docs.get(schemeId.toHexString())!;
    scheme.assetsAnchor = 99_999;

    const resumed = await applyPensionSchemeInvestSpend(db, input);
    expect(resumed.duplicate).toBe(true);
    expect(resumed.outcome).toEqual({ investedAnchor: COST, units: UNITS });
    // Stored units and cost land, not a repriced recompute.
    expect(fundTotals(raw)).toEqual({ units: 1000 + UNITS, cash: 50_000 + COST });
    expect(positions(raw)[0]!.units).toBe(UNITS);
    expect(txRows(raw)).toHaveLength(1);
  });

  it("fails closed when a retry recomputes the plan from changed state", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const input = makeInput();
    raw.crashAfterWrites = 3;
    await expect(applyPensionSchemeInvestSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    // Same key, different figures: a different investment, not a retry.
    const conflict = makeInput({ units: UNITS + 1, costAnchor: (UNITS + 1) * NAV });
    await expect(applyPensionSchemeInvestSpend(db, conflict)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );

    // Key-only recovery still completes the STORED plan.
    const resumed = await resumePensionSchemeInvestByKey(db, input.idempotencyKey!, schemeId, TURN);
    expect(resumed!.outcome).toEqual({ investedAnchor: COST, units: UNITS });
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
  });

  it("converges concurrent same-key retries to a single investment", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const input = makeInput();

    const [first, second] = await Promise.all([
      applyPensionSchemeInvestSpend(db, input),
      applyPensionSchemeInvestSpend(db, input),
    ]);
    expect(first.outcome).toEqual({ investedAnchor: COST, units: UNITS });
    expect(second.outcome).toEqual({ investedAnchor: COST, units: UNITS });
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
    expect(fundTotals(raw)).toEqual({ units: 1000 + UNITS, cash: 50_000 + COST });
    expect(positions(raw)).toHaveLength(1);
    expect(txRows(raw)).toHaveLength(1);
  });

  it("settles failed with nothing applied when the debit guard misses", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    // The benefit pass drained the scheme after the read: the pinned cost no
    // longer clears.
    raw.collection("pensionSchemes").docs.get(schemeId.toHexString())!.assetsAnchor = COST - 1;

    await expect(applyPensionSchemeInvestSpend(db, makeInput())).rejects.toThrow(
      `${PENSION_SCHEME_INVEST_DEBIT}:guard-rejected`
    );
    expect(schemeCash(raw)).toEqual({ assets: COST - 1, invested: 0 });
    expect(fundTotals(raw)).toEqual({ units: 1000, cash: 50_000 });
    expect(positions(raw)).toHaveLength(0);
    expect(txRows(raw)).toHaveLength(0);
    expect(receipts(raw)[0]!.status).toBe("failed");
  });

  it("compensates the debit exactly when the fund row vanished", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    raw.collection("indexFunds").docs.delete(fundId.toHexString());

    await expect(applyPensionSchemeInvestSpend(db, makeInput())).rejects.toThrow(
      `${PENSION_SCHEME_INVEST_FUND}:missing`
    );
    // The applied debit reverses to the exact seed figure, cumulative included.
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH, invested: 0 });
    expect(positions(raw)).toHaveLength(0);
    expect(txRows(raw)).toHaveLength(0);
    expect(receipts(raw)[0]!.status).toBe("compensated");
  });

  it("compensates the prefix when a planned-existing position vanished", async () => {
    const raw = new FakeDb();
    seedAll(raw, { existingPosition: true });
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    // The row the caller saw is gone between plan and apply.
    raw.collection("indexFundPositions").docs.clear();

    await expect(
      applyPensionSchemeInvestSpend(db, makeInput({ existingPosition: true }))
    ).rejects.toThrow(`${PENSION_SCHEME_INVEST_POSITION}:missing`);
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH, invested: 0 });
    expect(fundTotals(raw)).toEqual({ units: 1000, cash: 50_000 });
    expect(txRows(raw)).toHaveLength(0);
    expect(receipts(raw)[0]!.status).toBe("compensated");
  });

  it("restores an existing position image exactly on revert", async () => {
    const raw = new FakeDb();
    seedAll(raw, { existingPosition: true });
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const input = makeInput({ existingPosition: true });

    // Sabotage the terminal audit insert by pre-occupying its deterministic
    // `_id` with an unrelated row... instead sabotage via a vanished tx
    // collection is impossible; sabotage the fund on a SECOND scheme? Use the
    // exposed steps: run all but the last, then revert the prefix manually.
    const steps = buildPensionSchemeInvestSteps(db, input.idempotencyKey!, input, new Date());
    expect(steps.map((s) => s.name)).toEqual(["debit", "fund", "position", "invest-tx"]);
    for (const step of steps.slice(0, 3)) {
      expect(["applied", "already-applied"]).toContain(await step.apply());
    }
    // Blended image landed.
    expect(positions(raw)[0]!.units).toBe(15);
    // Exact inverse: revert in reverse order.
    for (const step of steps.slice(0, 3).reverse()) {
      expect(["applied", "already-applied"]).toContain(await step.revert!());
    }
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH, invested: 0 });
    expect(fundTotals(raw)).toEqual({ units: 1000, cash: 50_000 });
    const pos = positions(raw)[0]!;
    expect(pos.units).toBe(10);
    expect(pos.avgNavAnchor).toBeCloseTo(40, 10);
  });

  it("keeps the audit row at-most-once across crash, resume, and replay", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const input = makeInput();
    // Crash between the audit insert and the receipt settle.
    raw.crashAfterWrites = 6;
    await expect(applyPensionSchemeInvestSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    expect(txRows(raw)).toHaveLength(1);

    raw.crashAfterWrites = Number.POSITIVE_INFINITY;
    await applyPensionSchemeInvestSpend(db, input);
    // Applied-but-unacknowledged insert converges on its deterministic `_id`.
    expect(txRows(raw)).toHaveLength(1);

    const replay = await applyPensionSchemeInvestSpend(db, input);
    expect(replay.duplicate).toBe(true);
    expect(txRows(raw)).toHaveLength(1);
  });

  it("holds the receipt terminal after failure: same key throws, new key invests", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    raw.collection("pensionSchemes").docs.get(schemeId.toHexString())!.assetsAnchor = COST - 1;
    const input = makeInput();
    await expect(applyPensionSchemeInvestSpend(db, input)).rejects.toThrow(
      PENSION_SCHEME_INVEST_DEBIT
    );

    await expect(applyPensionSchemeInvestSpend(db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );

    // A new attempt needs a new key: topping up and retrying under the same
    // key stays terminal, a fresh key invests.
    raw.collection("pensionSchemes").docs.get(schemeId.toHexString())!.assetsAnchor = SCHEME_CASH;
    await expect(applyPensionSchemeInvestSpend(db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    const retry = await applyPensionSchemeInvestSpend(
      db,
      makeInput({ idempotencyKey: `${input.idempotencyKey}:retry:1` })
    );
    expect(retry.duplicate).toBe(false);
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
  });

  it("rejects a key reused for a genuinely different investment", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const first = await applyPensionSchemeInvestSpend(db, makeInput());
    expect(first.duplicate).toBe(false);

    await expect(
      applyPensionSchemeInvestSpend(
        db,
        makeInput({ units: UNITS + 2, costAnchor: (UNITS + 2) * NAV })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    // The conflict changed nothing.
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
  });

  it("resume by key refuses a cross-scheme or cross-turn receipt", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const input = makeInput();
    raw.crashAfterWrites = 3;
    await expect(applyPensionSchemeInvestSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    await expect(
      resumePensionSchemeInvestByKey(db, input.idempotencyKey!, new ObjectId(), TURN)
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    await expect(
      resumePensionSchemeInvestByKey(db, input.idempotencyKey!, schemeId, TURN + 1)
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    // Nothing resumed, nothing double-moved.
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
  });

  it("resume by key on a settled receipt returns null or throws terminal", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const input = makeInput();
    await applyPensionSchemeInvestSpend(db, input);
    expect(
      await resumePensionSchemeInvestByKey(db, input.idempotencyKey!, schemeId, TURN)
    ).toBeNull();
    expect(
      await resumePensionSchemeInvestByKey(db, new ObjectId().toHexString(), schemeId, TURN)
    ).toBeNull();
  });

  it("validates its pinned inputs before claiming", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];

    await expect(
      applyPensionSchemeInvestSpend(db, makeInput({ units: 0, costAnchor: 0 }))
    ).rejects.toThrow(RangeError);
    await expect(applyPensionSchemeInvestSpend(db, makeInput({ quotedNav: 0 }))).rejects.toThrow(
      RangeError
    );
    // costAnchor must equal units * quotedNav exactly: a skewed pair is a mint.
    await expect(
      applyPensionSchemeInvestSpend(db, makeInput({ costAnchor: COST + 1 }))
    ).rejects.toThrow(RangeError);
    await expect(applyPensionSchemeInvestSpend(db, makeInput({ fingerprint: "" }))).rejects.toThrow(
      TypeError
    );
    expect(receipts(raw)).toHaveLength(0);
  });

  it("builds deterministic keys and amount-covering fingerprints", async () => {
    expect(buildPensionSchemeInvestKey(schemeId, TURN)).toBe(
      `pension-scheme-invest:${schemeId.toHexString()}:turn:${TURN}`
    );
    const fp = buildPensionSchemeInvestFingerprint({
      schemeId,
      fundId,
      turn: TURN,
      quotedNav: NAV,
      units: UNITS,
      costAnchor: COST,
    });
    expect(
      buildPensionSchemeInvestFingerprint({
        schemeId,
        fundId,
        turn: TURN,
        quotedNav: NAV,
        units: UNITS + 1,
        costAnchor: (UNITS + 1) * NAV,
      })
    ).not.toBe(fp);
  });

  it("negative control: unkeyed legacy-style writes invest twice on replay", async () => {
    // The pre-migration shape (guarded debit, unkeyed position insert, fund
    // credit, random-id audit row) has no convergence: replaying it after a
    // crash moves the money again. This is the partial state the keyed flow
    // replaces.
    const raw = new FakeDb();
    seedAll(raw);
    const legacyInvest = async (): Promise<void> => {
      const schemes = raw.collection("pensionSchemes");
      const debit = await schemes.updateOne(
        { _id: schemeId, assetsAnchor: { $gte: COST } },
        { $inc: { assetsAnchor: -COST }, $set: {} }
      );
      if (debit.matchedCount === 0) return;
      await raw
        .collection("indexFunds")
        .updateOne({ _id: fundId }, { $inc: { unitSupply: UNITS, cashAnchor: COST }, $set: {} });
      await raw.collection("indexFundPositions").insertOne({
        _id: new ObjectId(),
        fundId,
        holderKind: "pension_scheme",
        pensionSchemeId: schemeId,
        units: UNITS,
        avgNavAnchor: NAV,
      });
      await raw.collection("indexFundTransactions").insertOne({
        _id: new ObjectId(),
        fundId,
        kind: "subscription",
        amountAnchor: COST,
      });
    };
    await legacyInvest();
    await legacyInvest();
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - 2 * COST, invested: 0 });
    expect(fundTotals(raw)).toEqual({ units: 1000 + 2 * UNITS, cash: 50_000 + 2 * COST });
    expect(positions(raw)).toHaveLength(2);
    expect(txRows(raw)).toHaveLength(2);
  });

  it("exposes the ordered steps for compensation tests", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const input = makeInput();
    const steps = buildPensionSchemeInvestSteps(db, input.idempotencyKey!, input, new Date());
    expect(steps.map((s) => s.name)).toEqual(["debit", "fund", "position", "invest-tx"]);
    // The terminal audit step carries no inverse: nothing runs after it.
    expect(steps[3]!.revert).toBeUndefined();
  });
});

describe("recoverPensionSchemeInvestOrphans", () => {
  it("resumes a crashed turn's receipts and settles plan-less claims", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    const input = makeInput();
    raw.crashAfterWrites = 3;
    await expect(applyPensionSchemeInvestSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    // A plan-less claim under this turn's key shape: crashed between claim
    // insert and plan write, nothing applied.
    const planlessKey = `pension-scheme-invest:${new ObjectId().toHexString()}:turn:${TURN}`;
    await raw.collection("nonAtomicMoneyFlowReceipts").insertOne({
      _id: planlessKey,
      status: "in_progress",
      fingerprint: "fp",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const recovered = await recoverPensionSchemeInvestOrphans(db, TURN);
    expect(recovered).toEqual({ resumed: 1, investedAnchor: COST });
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
    expect(fundTotals(raw)).toEqual({ units: 1000 + UNITS, cash: 50_000 + COST });
    const planless = await raw
      .collection("nonAtomicMoneyFlowReceipts")
      .findOne({ _id: planlessKey });
    expect(planless!.status).toBe("failed");
  });

  it("ignores other turns and completed receipts", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyPensionSchemeInvestSpend>[0];
    await applyPensionSchemeInvestSpend(db, makeInput());
    const recovered = await recoverPensionSchemeInvestOrphans(db, TURN + 1);
    expect(recovered).toEqual({ resumed: 0, investedAnchor: 0 });
    expect(schemeCash(raw)).toEqual({ assets: SCHEME_CASH - COST, invested: COST });
  });
});
