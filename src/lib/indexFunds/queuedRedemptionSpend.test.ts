import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  applyQueuedRedemptionSpend,
  buildQueuedRedemptionFingerprint,
  buildQueuedRedemptionKey,
  isQueuedRedemptionOutcome,
  recoverQueuedRedemptionOrphans,
  resumeQueuedRedemptionByKey,
  QUEUED_REDEMPTION_FUNDS,
  QUEUED_REDEMPTION_HOLDER,
  type QueuedRedemptionSpendInput,
} from "./queuedRedemptionSpend";
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

const { resolveHolderMock, logRedeemMock } = vi.hoisted(() => ({
  resolveHolderMock: vi.fn(),
  logRedeemMock: vi.fn(),
}));

vi.mock("@/lib/indexFunds/fundTxLog", () => ({
  resolveIndexFundHolder: resolveHolderMock,
  logIndexFundRedeem: logRedeemMock,
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fakes honoring exactly the operators the queued-payout
// primitive emits ($inc incl. dotted balance fields, $push+$each+$slice key
// records, $set incl. dotted paths, $unset; _id equality, dotted-path
// equality, $ne-on-keys, $gte guards, $exists, ObjectId equality,
// duplicate-key errors on insert), so an injected crash between any two
// writes models a real process death between the corresponding sequential
// Mongo writes.
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

function cloneValue<T>(value: T): T {
  // structuredClone denatures BSON ObjectIds into plain buffers; revive them
  // so stored docs keep comparable ids.
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
    if (field === "_id") continue;
    const actual = getPath(doc, field);
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
      if ("$exists" in condition) {
        if ((actual !== undefined) !== Boolean(condition.$exists)) return false;
        continue;
      }
      return false;
    }
    if (!valueEquals(actual, condition)) return false;
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
    this.docs.set(key, cloneValue(doc));
    return { insertedId: doc._id };
  }

  async findOne(
    filter: Record<string, unknown>,
    opts?: { projection?: Record<string, unknown> }
  ): Promise<Record<string, unknown> | null> {
    const doc =
      "_id" in filter
        ? this.docs.get(docKey(filter._id))
        : [...this.docs.values()].find((d) => matchesFilter(d, filter));
    if (!doc) return null;
    if (!opts?.projection) return cloneValue(doc);
    const out: Record<string, unknown> = { _id: cloneValue(doc._id) };
    for (const field of Object.keys(opts.projection)) {
      if (field !== "_id") out[field] = cloneValue(getPath(doc, field));
    }
    return out;
  }

  find(filter: Record<string, unknown>): { toArray: () => Promise<Record<string, unknown>[]> } {
    const docs = [...this.docs.values()].filter((doc) => {
      if ("_id" in filter && docKey(doc._id) !== docKey(filter._id)) return false;
      return matchesFilter(doc, filter);
    });
    return { toArray: async () => cloneValue(docs) };
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    const doc = "_id" in filter ? this.docs.get(docKey(filter._id)) : undefined;
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
    const unset = (update.$unset ?? {}) as Record<string, unknown>;
    for (const field of Object.keys(unset)) {
      deletePath(doc, field);
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

const fundId = new ObjectId();
const charId = new ObjectId();
const nppId = new ObjectId();
const entryId = new ObjectId();
const TURN = 7;
const NAV = 100;

function seedFund(db: FakeDb, overrides?: Record<string, unknown>): void {
  db.collection("indexFunds").docs.set(fundId.toHexString(), {
    _id: fundId,
    slug: "test-fund",
    name: "Test Fund",
    tickerSymbol: "TF",
    anchorCurrencyCode: "USD",
    cashAnchor: 5_000,
    unitSupply: 100,
    ...overrides,
  });
}

function seedCharacter(db: FakeDb, overrides?: Record<string, unknown>): void {
  db.collection("characters").docs.set(charId.toHexString(), {
    _id: charId,
    cashOnHand: 0,
    ...overrides,
  });
}

function seedEntry(db: FakeDb, overrides?: Record<string, unknown>): void {
  db.collection("indexFundRedemptionQueue").docs.set(entryId.toHexString(), {
    _id: entryId,
    fundId,
    holderKind: "character",
    characterId: charId,
    units: 10,
    requestedNavAnchor: NAV,
    requestedAmountAnchor: 1_000,
    paidAmountAnchor: 0,
    unitsBurnedAtRequest: true,
    redeemFxRate: 1,
    status: "processing",
    processingStartedAt: new Date(),
    processingFlowKey: buildQueuedRedemptionKey(entryId, TURN),
    processingFromStatus: "queued",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

function baseInput(overrides?: Partial<QueuedRedemptionSpendInput>): QueuedRedemptionSpendInput {
  const input: QueuedRedemptionSpendInput = {
    fundId,
    fundSlug: "test-fund",
    fundName: "Test Fund",
    fundTicker: "TF",
    anchorCurrencyCode: "USD",
    entryId,
    holderKind: "character",
    characterId: charId,
    entryPaidBefore: 0,
    unitsRemaining: 10,
    redemptionNav: NAV,
    redeemFxRate: 1,
    forexEnabled: false,
    paidNative: 1_000,
    cashForThisEntry: 5_000,
    redeemableUnits: 10,
    paidAmount: 1_000,
    remainingAfterPay: 0,
    shouldBurnUnitsNow: false,
    turn: TURN,
    fingerprint: "",
    idempotencyKey: buildQueuedRedemptionKey(entryId, TURN),
    ...overrides,
  };
  if (!overrides?.fingerprint) {
    input.fingerprint = buildQueuedRedemptionFingerprint({
      fundId: input.fundId,
      entryId: input.entryId,
      holderKind: input.holderKind,
      holderId: input.characterId ?? input.imperialCharacterId ?? input.nppId ?? undefined,
      unitsRemaining: input.unitsRemaining,
      redemptionNav: input.redemptionNav,
      redeemFxRate: input.redeemFxRate,
      paidNative: input.paidNative,
      redeemableUnits: input.redeemableUnits,
      paidAmount: input.paidAmount,
      remainingAfterPay: input.remainingAfterPay,
      turn: input.turn,
    });
  }
  return input;
}

function readDoc(db: FakeDb, collection: string, id: ObjectId): Record<string, unknown> {
  const doc = db.collection(collection).docs.get(id.toHexString());
  if (!doc) throw new Error(`missing ${collection} doc`);
  return doc;
}

beforeEach(() => {
  vi.clearAllMocks();
  supportMock.mockResolvedValue(false);
  resolveHolderMock.mockResolvedValue(null);
  logRedeemMock.mockResolvedValue(undefined);
});

describe("applyQueuedRedemptionSpend — fresh payouts", () => {
  it("pays a character in full: fund debit, wallet credit, queue paid, one audit row", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();

    const result = await applyQueuedRedemptionSpend(db as never, input);

    expect(result.duplicate).toBe(false);
    expect(result.outcome).toEqual({
      paidAmountAnchor: 1_000,
      redeemableUnits: 10,
      remainingUnits: 0,
      entryStatus: "paid",
    });
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(4_000);
    expect(readDoc(db, "indexFunds", fundId).unitSupply).toBe(100);
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(1_000);
    const row = readDoc(db, "indexFundRedemptionQueue", entryId);
    expect(row).toMatchObject({ status: "paid", paidAmountAnchor: 1_000, units: 0 });
    const txs = [...db.collection("indexFundTransactions").docs.values()];
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      fundId,
      kind: "redemption",
      holderKind: "character",
      characterId: charId,
      units: 10,
      navAnchor: NAV,
      amountAnchor: 1_000,
      note: "Paid from queued redemption",
    });
    const receipts = [...db.collection("nonAtomicMoneyFlowReceipts").docs.values()];
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ _id: input.idempotencyKey, status: "completed" });
    expect(isQueuedRedemptionOutcome(receipts[0]!.queuedRedemptionPlan)).toBe(false);
  });

  it("credits the pinned native figure to the wallet currency field when forex is on", async () => {
    const db = new FakeDb();
    seedFund(db);
    db.collection("characters").docs.set(charId.toHexString(), {
      _id: charId,
      currencyBalances: { personal: { USD: 0 } },
    });
    seedEntry(db);
    const input = baseInput({
      forexEnabled: true,
      redeemFxRate: 2.5,
      paidNative: 2_500,
    });
    input.fingerprint = buildQueuedRedemptionFingerprint({
      fundId,
      entryId,
      holderKind: "character",
      holderId: charId,
      unitsRemaining: 10,
      redemptionNav: NAV,
      redeemFxRate: 2.5,
      paidNative: 2_500,
      redeemableUnits: 10,
      paidAmount: 1_000,
      remainingAfterPay: 0,
      turn: TURN,
    });

    const result = await applyQueuedRedemptionSpend(db as never, input);

    expect(result.outcome.paidAmountAnchor).toBe(1_000);
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(4_000);
    expect(getPath(readDoc(db, "characters", charId), "currencyBalances.personal.USD")).toBe(2_500);
  });

  it("credits NPP holders in anchor and skips the holder log", async () => {
    const db = new FakeDb();
    seedFund(db);
    db.collection("npps").docs.set(nppId.toHexString(), { _id: nppId, nppInvestmentCashAnchor: 0 });
    seedEntry(db, { holderKind: "npp", characterId: undefined, nppId });
    const input = baseInput({
      holderKind: "npp",
      characterId: undefined,
      nppId,
      forexEnabled: true,
      redeemFxRate: 2.5,
      paidNative: 2_500,
    });
    input.fingerprint = buildQueuedRedemptionFingerprint({
      fundId,
      entryId,
      holderKind: "npp",
      holderId: nppId,
      unitsRemaining: 10,
      redemptionNav: NAV,
      redeemFxRate: 2.5,
      paidNative: 2_500,
      redeemableUnits: 10,
      paidAmount: 1_000,
      remainingAfterPay: 0,
      turn: TURN,
    });

    const result = await applyQueuedRedemptionSpend(db as never, input);

    expect(result.outcome.paidAmountAnchor).toBe(1_000);
    expect(readDoc(db, "npps", nppId).nppInvestmentCashAnchor).toBe(1_000);
    expect(resolveHolderMock).not.toHaveBeenCalled();
    expect(logRedeemMock).not.toHaveBeenCalled();
  });

  it("burns supply for legacy rows that did not burn at request time", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db, { unitsBurnedAtRequest: undefined });
    const input = baseInput({ shouldBurnUnitsNow: true });

    await applyQueuedRedemptionSpend(db as never, input);

    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(4_000);
    expect(readDoc(db, "indexFunds", fundId).unitSupply).toBe(90);
  });

  it("leaves a partial remainder queued with accumulated paid and pinned requested amount", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput({
      redeemableUnits: 6,
      paidAmount: 600,
      paidNative: 600,
      remainingAfterPay: 4,
      cashForThisEntry: 600,
    });
    input.fingerprint = buildQueuedRedemptionFingerprint({
      fundId,
      entryId,
      holderKind: "character",
      holderId: charId,
      unitsRemaining: 10,
      redemptionNav: NAV,
      redeemFxRate: 1,
      paidNative: 600,
      redeemableUnits: 6,
      paidAmount: 600,
      remainingAfterPay: 4,
      turn: TURN,
    });

    const result = await applyQueuedRedemptionSpend(db as never, input);

    expect(result.outcome).toEqual({
      paidAmountAnchor: 600,
      redeemableUnits: 6,
      remainingUnits: 4,
      entryStatus: "partial",
    });
    expect(readDoc(db, "indexFundRedemptionQueue", entryId)).toMatchObject({
      status: "partial",
      paidAmountAnchor: 600,
      units: 4,
      requestedAmountAnchor: 400,
    });
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(600);
  });

  it("accumulates onto prior paid for a second slice of a partial row", async () => {
    const db = new FakeDb();
    seedFund(db, { cashAnchor: 4_400 });
    seedCharacter(db, { cashOnHand: 600 });
    seedEntry(db, { units: 4, paidAmountAnchor: 600, processingFromStatus: "partial" });
    const sliceKey = buildQueuedRedemptionKey(entryId, TURN + 1);
    const input = baseInput({
      entryPaidBefore: 600,
      unitsRemaining: 4,
      redeemableUnits: 4,
      paidAmount: 400,
      paidNative: 400,
      remainingAfterPay: 0,
      cashForThisEntry: 4_400,
      turn: TURN + 1,
      idempotencyKey: sliceKey,
    });
    input.fingerprint = buildQueuedRedemptionFingerprint({
      fundId,
      entryId,
      holderKind: "character",
      holderId: charId,
      unitsRemaining: 4,
      redemptionNav: NAV,
      redeemFxRate: 1,
      paidNative: 400,
      redeemableUnits: 4,
      paidAmount: 400,
      remainingAfterPay: 0,
      turn: TURN + 1,
    });

    const result = await applyQueuedRedemptionSpend(db as never, input);

    expect(result.outcome.entryStatus).toBe("paid");
    expect(readDoc(db, "indexFundRedemptionQueue", entryId)).toMatchObject({
      status: "paid",
      paidAmountAnchor: 1_000,
      units: 0,
    });
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(1_000);
  });

  it("notifies the holder post-commit with the cron source and remainder", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    resolveHolderMock.mockResolvedValue({
      holderKind: "character",
      holderId: charId,
      holderName: "Holder",
    });

    await applyQueuedRedemptionSpend(db as never, baseInput());
    await new Promise((resolve) => setImmediate(resolve));

    expect(logRedeemMock).toHaveBeenCalledTimes(1);
    expect(logRedeemMock.mock.calls[0]![1]).toMatchObject({
      units: 10,
      navAnchor: NAV,
      amountAnchor: 1_000,
      source: "cron_queue",
      queuedRemainder: 0,
      turn: TURN,
    });
  });

  it("pays when cash exactly covers the slice (guard boundary)", async () => {
    const db = new FakeDb();
    seedFund(db, { cashAnchor: 1_000 });
    seedCharacter(db);
    seedEntry(db);

    const result = await applyQueuedRedemptionSpend(db as never, baseInput());

    expect(result.outcome.paidAmountAnchor).toBe(1_000);
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(0);
  });
});

describe("applyQueuedRedemptionSpend — replay, conflicts, terminal", () => {
  it("replays the stored outcome on same-key retry without moving money twice", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();

    const first = await applyQueuedRedemptionSpend(db as never, input);
    const replay = await applyQueuedRedemptionSpend(db as never, input);

    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.outcome).toEqual(first.outcome);
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(4_000);
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(1_000);
    expect(db.collection("indexFundTransactions").docs.size).toBe(1);
  });

  it("fails closed when the same key is reused for a different payout", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();

    await applyQueuedRedemptionSpend(db as never, input);

    const other = baseInput({ paidAmount: 500, paidNative: 500 });
    await expect(applyQueuedRedemptionSpend(db as never, other)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(4_000);
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(1_000);
  });

  it("fails the second slice of a crashed pass closed until it resumes under the stored key", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();

    db.crashAfterWrites = 4;
    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const other = baseInput({ paidAmount: 500, paidNative: 500 });
    await expect(applyQueuedRedemptionSpend(db as never, other)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    const resumed = await applyQueuedRedemptionSpend(db as never, input);
    expect(resumed.duplicate).toBe(true);
    expect(resumed.outcome.paidAmountAnchor).toBe(1_000);
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(1_000);
  });

  it("compensates a gone holder and fails a same-key retry closed (terminal)", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedEntry(db);
    const input = baseInput();

    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow(
      `${QUEUED_REDEMPTION_HOLDER}:missing`
    );
    // Prefix reversed: the fund is whole and the holder untouched.
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(5_000);
    expect(db.collection("characters").docs.size).toBe(0);
    const receipts = [...db.collection("nonAtomicMoneyFlowReceipts").docs.values()];
    expect(receipts[0]).toMatchObject({ status: "compensated" });

    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });

  it("compensates an unknown-holder row instead of stranding paid-but-unowned cash", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedEntry(db, { characterId: undefined, holderKind: "character" });
    const input = baseInput({ holderKind: "unknown", characterId: undefined });

    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow(
      `${QUEUED_REDEMPTION_HOLDER}:guard-rejected`
    );
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(5_000);
    expect(readDoc(db, "indexFunds", fundId).unitSupply).toBe(100);
  });

  it("settles failed on a cash race and fails the retry closed", async () => {
    const db = new FakeDb();
    seedFund(db, { cashAnchor: 999 });
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();

    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow(
      `${QUEUED_REDEMPTION_FUNDS}:guard-rejected`
    );
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(0);
    const receipts = [...db.collection("nonAtomicMoneyFlowReceipts").docs.values()];
    expect(receipts[0]).toMatchObject({ status: "failed" });

    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });

  it("pins every amount: a retry with live-looking smaller figures still replays the stored plan", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();

    db.crashAfterWrites = 3;
    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    // The fund was debited before the crash; the retry must not debit again.
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(4_000);
    const resumed = await applyQueuedRedemptionSpend(db as never, input);
    expect(resumed.outcome.paidAmountAnchor).toBe(1_000);
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(4_000);
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(1_000);
    expect(readDoc(db, "indexFundRedemptionQueue", entryId).status).toBe("paid");
  });

  it("converges concurrent same-key processors to exactly one payout", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();

    const [first, second] = await Promise.all([
      applyQueuedRedemptionSpend(db as never, input),
      applyQueuedRedemptionSpend(db as never, input),
    ]);

    expect(first.outcome).toEqual(second.outcome);
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(4_000);
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(1_000);
    expect(db.collection("indexFundTransactions").docs.size).toBe(1);
  });

  it("rejects slices that do not partition the remaining units", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);

    await expect(
      applyQueuedRedemptionSpend(
        db as never,
        baseInput({ redeemableUnits: 6, remainingAfterPay: 3 })
      )
    ).rejects.toThrow("must partition the remaining units");
    await expect(
      applyQueuedRedemptionSpend(
        db as never,
        baseInput({ redeemableUnits: 0, remainingAfterPay: 10 })
      )
    ).rejects.toThrow("redeemableUnits must be a positive integer");
  });
});

describe("applyQueuedRedemptionSpend — crash after every durable write", () => {
  // Fresh-run write order: receipt claim, plan persist, fund debit, holder
  // credit, queue settle, audit-row insert, receipt completion, outcome row.
  // A crash after the 8th (last) write is the plain same-key replay below.
  it.each([1, 2, 3, 4, 5, 6, 7])(
    "converges after a crash following write %i",
    async (crashAfter) => {
      const db = new FakeDb();
      seedFund(db);
      seedCharacter(db);
      seedEntry(db);
      const input = baseInput();

      db.crashAfterWrites = crashAfter;
      await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );
      db.crashAfterWrites = Number.POSITIVE_INFINITY;

      const resumed = await applyQueuedRedemptionSpend(db as never, input);
      expect(resumed.outcome).toEqual({
        paidAmountAnchor: 1_000,
        redeemableUnits: 10,
        remainingUnits: 0,
        entryStatus: "paid",
      });
      expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(4_000);
      expect(readDoc(db, "characters", charId).cashOnHand).toBe(1_000);
      expect(readDoc(db, "indexFundRedemptionQueue", entryId)).toMatchObject({
        status: "paid",
        paidAmountAnchor: 1_000,
        units: 0,
      });
      expect(db.collection("indexFundTransactions").docs.size).toBe(1);
      const receipts = [...db.collection("nonAtomicMoneyFlowReceipts").docs.values()];
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ status: "completed" });
    }
  );

  it("converges a legacy burn-now row crashed between debit and credit", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db, { unitsBurnedAtRequest: undefined });
    const input = baseInput({ shouldBurnUnitsNow: true });

    db.crashAfterWrites = 3;
    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    await applyQueuedRedemptionSpend(db as never, input);
    expect(readDoc(db, "indexFunds", fundId)).toMatchObject({ cashAnchor: 4_000, unitSupply: 90 });
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(1_000);
  });

  it("compensates instead of stranding when the audit-row insert keeps failing", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();
    const txs = db.collection("indexFundTransactions");
    const failingInsert = txs.insertOne.bind(txs);
    let calls = 0;
    txs.insertOne = async (doc: Record<string, unknown>) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("disk full") as Error & { code?: number };
        throw error;
      }
      return failingInsert(doc);
    };

    // A survived insert error reverses the applied prefix (the historical
    // unwind-and-throw left money moved with no audit row; the flow refuses
    // that strand and settles compensated for ops instead).
    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow(
      "QUEUED_REDEMPTION_TX:guard-rejected"
    );
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(5_000);
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(0);
    const receipts = [...db.collection("nonAtomicMoneyFlowReceipts").docs.values()];
    expect(receipts[0]).toMatchObject({ status: "compensated" });
  });
});

describe("resumeQueuedRedemptionByKey", () => {
  it("resumes an in-progress payout from the stored plan", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();
    const key = input.idempotencyKey!;

    db.crashAfterWrites = 5;
    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const result = await resumeQueuedRedemptionByKey(db as never, key, fundId, entryId);
    expect(result?.outcome).toEqual({
      paidAmountAnchor: 1_000,
      redeemableUnits: 10,
      remainingUnits: 0,
      entryStatus: "paid",
    });
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(1_000);
    expect(readDoc(db, "indexFundRedemptionQueue", entryId).status).toBe("paid");
  });

  it("returns null for completed, missing, or plan-less receipts", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();
    const key = input.idempotencyKey!;

    expect(await resumeQueuedRedemptionByKey(db as never, "nope", fundId, entryId)).toBeNull();

    await applyQueuedRedemptionSpend(db as never, input);
    expect(await resumeQueuedRedemptionByKey(db as never, key, fundId, entryId)).toBeNull();
  });

  it("throws terminal for settled receipts and conflict for foreign fund/entry", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedEntry(db);
    const input = baseInput();
    const key = input.idempotencyKey!;

    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow(
      QUEUED_REDEMPTION_HOLDER
    );
    await expect(
      resumeQueuedRedemptionByKey(db as never, key, fundId, entryId)
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
    await expect(
      resumeQueuedRedemptionByKey(db as never, key, new ObjectId(), entryId)
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("throws conflict when the stored plan names a different entry", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();
    const key = input.idempotencyKey!;

    db.crashAfterWrites = 4;
    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    await expect(
      resumeQueuedRedemptionByKey(db as never, key, fundId, new ObjectId())
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    // The conflicting resume moved nothing; the true key still converges.
    const result = await resumeQueuedRedemptionByKey(db as never, key, fundId, entryId);
    expect(result?.outcome.paidAmountAnchor).toBe(1_000);
  });
});

describe("recoverQueuedRedemptionOrphans", () => {
  it("resumes a crashed payout and counts it", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();

    db.crashAfterWrites = 5;
    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const resumed = await recoverQueuedRedemptionOrphans(db as never, fundId);
    expect(resumed).toBe(1);
    expect(readDoc(db, "indexFundRedemptionQueue", entryId).status).toBe("paid");
    expect(readDoc(db, "characters", charId).cashOnHand).toBe(1_000);
  });

  it("settles a plan-less receipt and restores the exact prior status", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db, { units: 4, paidAmountAnchor: 600, processingFromStatus: "partial" });
    const key = buildQueuedRedemptionKey(entryId, TURN);
    db.collection("nonAtomicMoneyFlowReceipts").docs.set(key, {
      _id: key,
      status: "in_progress",
      fingerprint: "stale",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const resumed = await recoverQueuedRedemptionOrphans(db as never, fundId);

    expect(resumed).toBe(0);
    expect(db.collection("nonAtomicMoneyFlowReceipts").docs.get(key)).toMatchObject({
      status: "failed",
    });
    // Prior status is restored exactly (partial stays partial), claim cleared.
    expect(readDoc(db, "indexFundRedemptionQueue", entryId)).toMatchObject({
      status: "partial",
      units: 4,
      paidAmountAnchor: 600,
    });
    expect(readDoc(db, "indexFundRedemptionQueue", entryId).processingFlowKey).toBeUndefined();
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(5_000);
  });

  it("restores a claimed row whose receipt never landed", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedEntry(db);

    const resumed = await recoverQueuedRedemptionOrphans(db as never, fundId);

    expect(resumed).toBe(0);
    expect(readDoc(db, "indexFundRedemptionQueue", entryId)).toMatchObject({ status: "queued" });
    expect(readDoc(db, "indexFundRedemptionQueue", entryId).processingFlowKey).toBeUndefined();
  });

  it("restores a row whose receipt settled terminal (money is whole by invariant)", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedEntry(db);
    const input = baseInput();

    await expect(applyQueuedRedemptionSpend(db as never, input)).rejects.toThrow(
      QUEUED_REDEMPTION_HOLDER
    );
    // Holder gone: compensated, but the queue row is still processing.
    expect(readDoc(db, "indexFundRedemptionQueue", entryId).status).toBe("processing");

    const resumed = await recoverQueuedRedemptionOrphans(db as never, fundId);

    expect(resumed).toBe(0);
    expect(readDoc(db, "indexFundRedemptionQueue", entryId)).toMatchObject({ status: "queued" });
    expect(readDoc(db, "indexFunds", fundId).cashAnchor).toBe(5_000);
  });

  it("leaves settled rows, keyless rows, cancelled rows, and foreign funds alone", async () => {
    const db = new FakeDb();
    seedFund(db);
    seedCharacter(db);
    seedEntry(db);
    const input = baseInput();
    await applyQueuedRedemptionSpend(db as never, input);

    const otherEntry = new ObjectId();
    db.collection("indexFundRedemptionQueue").docs.set(otherEntry.toHexString(), {
      _id: otherEntry,
      fundId,
      holderKind: "character",
      characterId: charId,
      units: 5,
      requestedNavAnchor: NAV,
      requestedAmountAnchor: 500,
      paidAmountAnchor: 0,
      status: "cancelled",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const keylessEntry = new ObjectId();
    db.collection("indexFundRedemptionQueue").docs.set(keylessEntry.toHexString(), {
      _id: keylessEntry,
      fundId,
      holderKind: "character",
      characterId: charId,
      units: 5,
      requestedNavAnchor: NAV,
      requestedAmountAnchor: 500,
      paidAmountAnchor: 0,
      status: "processing",
      processingStartedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const resumed = await recoverQueuedRedemptionOrphans(db as never, fundId);

    expect(resumed).toBe(0);
    expect(
      db.collection("indexFundRedemptionQueue").docs.get(otherEntry.toHexString())?.status
    ).toBe("cancelled");
    expect(
      db.collection("indexFundRedemptionQueue").docs.get(keylessEntry.toHexString())?.status
    ).toBe("processing");
    // Other funds are never scanned.
    expect(await recoverQueuedRedemptionOrphans(db as never, new ObjectId())).toBe(0);
  });
});
