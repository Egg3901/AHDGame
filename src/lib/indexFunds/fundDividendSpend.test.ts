import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  applyFundDividendSpend,
  buildFundDividendFingerprint,
  buildFundDividendKey,
  FUND_DIVIDEND_FUND,
  FUND_DIVIDEND_HOLDER,
  isFundDividendOutcome,
  resumeFundDividendByKey,
  type FundDividendRecipient,
  type FundDividendSpendInput,
} from "./fundDividendSpend";
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

const { logDividendBulkMock } = vi.hoisted(() => ({
  logDividendBulkMock: vi.fn(),
}));

vi.mock("@/lib/indexFunds/fundTxLog", () => ({
  buildIndexFundDividendTxEntry: vi.fn((params: Record<string, unknown>) => ({
    stubEntry: true,
    ...params,
  })),
  logIndexFundDividendBulk: logDividendBulkMock,
  resolveIndexFundHolder: vi.fn(),
  logIndexFundRedeem: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fakes honoring exactly the operators the dividend
// primitive and its callers emit ($inc incl. dotted balance fields, $push with
// $each+$slice key records, $set, _id equality, $in id lists, $ne-on-keys,
// $gte guards; duplicate-key errors on insert), so an injected crash between
// any two writes models a real process death between the corresponding
// sequential Mongo writes.
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

  find(filter: Record<string, unknown>): { toArray: () => Promise<Record<string, unknown>[]> } {
    const rawId = filter._id;
    const docs = [...this.docs.values()].filter((doc) => {
      if (rawId !== undefined && !isOperatorObject(rawId) && docKey(doc._id) !== docKey(rawId)) {
        return false;
      }
      return matchesFilter(doc, filter);
    });
    return { toArray: async () => cloneValue(docs) };
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
const corpId = new ObjectId();
const charId = new ObjectId();
const imperialId = new ObjectId();
const nppId = new ObjectId();
const TURN = 42;

const CHAR_ANCHOR = 150_000;
const IMPERIAL_ANCHOR = 75_000;
const NPP_ANCHOR = 25_000;
const DISTRIBUTED = CHAR_ANCHOR + IMPERIAL_ANCHOR + NPP_ANCHOR;
const RETAINED = 750_000;

function seedAll(db: FakeDb): void {
  db.collection("indexFunds").docs.set(fundId.toHexString(), {
    _id: fundId,
    slug: "div-fund",
    name: "Dividend Fund",
    tickerSymbol: "DIV",
    anchorCurrencyCode: "USD",
    cashAnchor: 1_000,
    unitSupply: 1000,
    quotedNav: 100,
  });
  db.collection("characters").docs.set(charId.toHexString(), {
    _id: charId,
    name: "Holder One",
    cashOnHand: 0,
  });
  db.collection("imperialCharacters").docs.set(imperialId.toHexString(), {
    _id: imperialId,
    name: "Holder Two",
    cashOnHand: 0,
  });
  db.collection("npps").docs.set(nppId.toHexString(), {
    _id: nppId,
    nppInvestmentCashAnchor: 0,
  });
  db.collection("corporations").docs.set(corpId.toHexString(), {
    _id: corpId,
    name: "Payer Corp",
  });
}

function makeRecipients(): FundDividendRecipient[] {
  return [
    {
      holderKind: "character",
      holderId: charId,
      holderName: "Holder One",
      units: 600,
      amountAnchor: CHAR_ANCHOR,
      amountNative: CHAR_ANCHOR,
    },
    {
      holderKind: "imperial_character",
      holderId: imperialId,
      holderName: "Holder Two",
      units: 300,
      amountAnchor: IMPERIAL_ANCHOR,
      amountNative: IMPERIAL_ANCHOR,
    },
    {
      holderKind: "npp",
      holderId: nppId,
      holderName: "",
      units: 100,
      amountAnchor: NPP_ANCHOR,
      amountNative: NPP_ANCHOR,
    },
  ];
}

function makeInput(overrides?: Partial<FundDividendSpendInput>): FundDividendSpendInput {
  const recipients = makeRecipients();
  const base = {
    fundId,
    fundName: "Dividend Fund",
    fundSlug: "div-fund",
    fundTicker: "DIV",
    anchorCurrencyCode: "USD",
    quotedNav: 100,
    corporationId: corpId,
    corporationName: "Payer Corp",
    sharesHeld: 500,
    grossAnchor: 1_000_000,
    reinvestAnchor: 750_000,
    retainedAnchor: RETAINED,
    distributedAnchor: DISTRIBUTED,
    holdersPaid: recipients.length,
    recipients,
    fundFxRate: 1,
    forexEnabled: false,
    turn: TURN,
    fingerprint: "",
    ...overrides,
  };
  if (!overrides?.fingerprint) {
    base.fingerprint = buildFundDividendFingerprint({
      fundId: base.fundId,
      corporationId: base.corporationId,
      sharesHeld: base.sharesHeld,
      grossAnchor: base.grossAnchor,
      reinvestAnchor: base.reinvestAnchor,
      retainedAnchor: base.retainedAnchor,
      distributedAnchor: base.distributedAnchor,
      holdersPaid: base.holdersPaid,
      anchorCurrencyCode: base.anchorCurrencyCode,
      quotedNav: base.quotedNav,
      fundFxRate: base.fundFxRate,
      forexEnabled: base.forexEnabled,
      recipients: base.recipients,
      turn: base.turn,
    });
  }
  if (!overrides?.idempotencyKey) {
    base.idempotencyKey = buildFundDividendKey(
      base.fundId,
      base.corporationId,
      base.turn,
      base.grossAnchor,
      base.sharesHeld,
      0
    );
  }
  return base as FundDividendSpendInput;
}

function balances(db: FakeDb): {
  fundCash: number | undefined;
  charCash: number | undefined;
  imperialCash: number | undefined;
  nppCash: number | undefined;
} {
  const fund = db.collection("indexFunds").docs.get(fundId.toHexString());
  const char = db.collection("characters").docs.get(charId.toHexString());
  const imperial = db.collection("imperialCharacters").docs.get(imperialId.toHexString());
  const npp = db.collection("npps").docs.get(nppId.toHexString());
  return {
    fundCash: fund?.cashAnchor as number | undefined,
    charCash: char?.cashOnHand as number | undefined,
    imperialCash: imperial?.cashOnHand as number | undefined,
    nppCash: npp?.nppInvestmentCashAnchor as number | undefined,
  };
}

// The holder-audit emit is fire-and-forget behind a dynamic import, so one
// macrotask is not enough to observe it: poll until it lands or time out.
async function waitForPostCommit(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function flushPostCommit(): Promise<void> {
  await waitForPostCommit(() => logDividendBulkMock.mock.calls.length > 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  supportMock.mockResolvedValue(false);
  getMongoClientMock.mockReturnValue(undefined);
  logDividendBulkMock.mockResolvedValue(undefined);
});

describe("applyFundDividendSpend", () => {
  it("pays every pinned holder exactly once and writes both audit rows", async () => {
    const db = new FakeDb() as unknown as Parameters<typeof applyFundDividendSpend>[0];
    seedAll(db as unknown as FakeDb);
    const input = makeInput();

    const first = await applyFundDividendSpend(db, input);
    expect(first.duplicate).toBe(false);
    expect(first.outcome).toEqual({
      grossAnchor: 1_000_000,
      retainedAnchor: RETAINED,
      distributedAnchor: DISTRIBUTED,
      holdersPaid: 3,
    });
    expect(isFundDividendOutcome(first.outcome)).toBe(true);

    expect(balances(db as unknown as FakeDb)).toEqual({
      fundCash: 1_000 + RETAINED,
      charCash: CHAR_ANCHOR,
      imperialCash: IMPERIAL_ANCHOR,
      nppCash: NPP_ANCHOR,
    });

    const txRows = db
      .collection("indexFundTransactions")
      .docs.values()
      .toArray()
      .map((d) => d as unknown as { kind: string; amountAnchor: number; note: string });
    expect(txRows).toHaveLength(2);
    expect(txRows.map((r) => r.kind).sort()).toEqual([
      "dividend_pass_through",
      "dividend_reinvest",
    ]);
    expect(txRows.find((r) => r.kind === "dividend_pass_through")!.amountAnchor).toBe(DISTRIBUTED);
    expect(txRows.find((r) => r.kind === "dividend_reinvest")!.amountAnchor).toBe(RETAINED);

    await flushPostCommit();
    expect(logDividendBulkMock).toHaveBeenCalledTimes(1);
    const entries = logDividendBulkMock.mock.calls[0][1] as { amountAnchor: number }[];
    // NPP credits take no holder audit entry, only character holders do.
    expect(entries).toHaveLength(2);

    // A same-key replay converges without moving money again.
    const second = await applyFundDividendSpend(db, input);
    expect(second.duplicate).toBe(true);
    expect(second.outcome).toEqual(first.outcome);
    expect(balances(db as unknown as FakeDb)).toEqual({
      fundCash: 1_000 + RETAINED,
      charCash: CHAR_ANCHOR,
      imperialCash: IMPERIAL_ANCHOR,
      nppCash: NPP_ANCHOR,
    });
    await flushPostCommit();
    // Replays never re-emit the holder audit entries.
    expect(logDividendBulkMock).toHaveBeenCalledTimes(1);
  });

  it("recovers exactly-once after a crash following every durable write", async () => {
    // Durable write order: receipt claim, plan persist, fund leg, one leg per
    // holder in order, two audit inserts, outcome persist. Crashing after each
    // of them (and before the first) must converge to one distribution.
    const totalWrites = 2 + 1 + 3 + 2 + 1;
    for (let crashAfter = 0; crashAfter < totalWrites; crashAfter += 1) {
      const raw = new FakeDb();
      seedAll(raw);
      const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
      const input = makeInput();
      raw.crashAfterWrites = crashAfter;
      await expect(applyFundDividendSpend(db, input)).rejects.toThrow("INJECTED_CRASH");

      raw.crashAfterWrites = Number.POSITIVE_INFINITY;
      const resumed = await applyFundDividendSpend(db, input);
      expect(resumed.outcome).toEqual({
        grossAnchor: 1_000_000,
        retainedAnchor: RETAINED,
        distributedAnchor: DISTRIBUTED,
        holdersPaid: 3,
      });
      expect(balances(raw)).toEqual({
        fundCash: 1_000 + RETAINED,
        charCash: CHAR_ANCHOR,
        imperialCash: IMPERIAL_ANCHOR,
        nppCash: NPP_ANCHOR,
      });
      const txRows = [...raw.collection("indexFundTransactions").docs.values()];
      expect(txRows).toHaveLength(2);
    }
  });

  it("resumes a partial multi-holder distribution without double-paying", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    const input = makeInput();
    // Crash after claim + plan + fund leg + first holder leg: one holder paid.
    // (The counter throws BEFORE the (n+1)th write, so 4 lets the char leg land.)
    raw.crashAfterWrites = 4;
    await expect(applyFundDividendSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    expect(balances(raw).charCash).toBe(CHAR_ANCHOR);
    expect(balances(raw).imperialCash).toBe(0);

    raw.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await resumeFundDividendByKey(db, input.idempotencyKey!, fundId, corpId);
    expect(result).not.toBeNull();
    expect(result!.outcome.holdersPaid).toBe(3);
    expect(balances(raw)).toEqual({
      fundCash: 1_000 + RETAINED,
      charCash: CHAR_ANCHOR,
      imperialCash: IMPERIAL_ANCHOR,
      nppCash: NPP_ANCHOR,
    });
  });

  it("converges concurrent same-key retries to a single distribution", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    const input = makeInput();
    const [first, second] = await Promise.all([
      applyFundDividendSpend(db, input),
      applyFundDividendSpend(db, input),
    ]);
    expect(first.outcome).toEqual(second.outcome);
    expect(balances(raw)).toEqual({
      fundCash: 1_000 + RETAINED,
      charCash: CHAR_ANCHOR,
      imperialCash: IMPERIAL_ANCHOR,
      nppCash: NPP_ANCHOR,
    });
    expect([...raw.collection("indexFundTransactions").docs.values()]).toHaveLength(2);
  });

  it("fails closed when a retry recomputes recipients from changed ownership", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    const input = makeInput();
    raw.crashAfterWrites = 4;
    await expect(applyFundDividendSpend(db, input)).rejects.toThrow("INJECTED_CRASH");
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    // Ownership changed before the retry: the first holder sold out and a new
    // holder appeared. A retry presenting the recomputed recipients (hence a
    // different fingerprint) under the same key must fail closed, not pay the
    // newcomer on top of the stored plan.
    const changed = makeInput({
      recipients: [
        {
          holderKind: "character",
          holderId: new ObjectId(),
          holderName: "Newcomer",
          units: 600,
          amountAnchor: CHAR_ANCHOR,
          amountNative: CHAR_ANCHOR,
        },
      ],
      distributedAnchor: CHAR_ANCHOR,
      holdersPaid: 1,
    });
    changed.idempotencyKey = input.idempotencyKey;
    await expect(applyFundDividendSpend(db, changed)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(balances(raw).charCash).toBe(CHAR_ANCHOR);
    expect(balances(raw).imperialCash).toBe(0);

    // The same fingerprint resumes the stored plan instead: the newcomer is
    // never paid, the pinned holders land exactly once.
    const resumed = await applyFundDividendSpend(db, input);
    expect(resumed.outcome.holdersPaid).toBe(3);
    expect(balances(raw)).toEqual({
      fundCash: 1_000 + RETAINED,
      charCash: CHAR_ANCHOR,
      imperialCash: IMPERIAL_ANCHOR,
      nppCash: NPP_ANCHOR,
    });
  });

  it("rejects a key reused for a genuinely different distribution", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    const first = makeInput();
    await applyFundDividendSpend(db, first);
    const different = makeInput({ grossAnchor: 2_000_000, idempotencyKey: first.idempotencyKey });
    await expect(applyFundDividendSpend(db, different)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
  });

  it("fails terminal retries closed after a settled failure", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    // The fund row vanished between plan and apply: step zero reports
    // missing, nothing applied, receipt settles failed.
    raw.collection("indexFunds").docs.delete(fundId.toHexString());
    const input = makeInput();
    await expect(applyFundDividendSpend(db, input)).rejects.toThrow(
      new RegExp(`^${FUND_DIVIDEND_FUND}:`)
    );
    await expect(applyFundDividendSpend(db, input)).rejects.toBeInstanceOf(MoneyFlowTerminalError);
    await expect(
      resumeFundDividendByKey(db, input.idempotencyKey!, fundId, corpId)
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("compensates the applied prefix when a holder row is gone", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    // The imperial holder row vanished: fund leg + character leg applied, then
    // the imperial step reports missing and the prefix compensates.
    raw.collection("imperialCharacters").docs.delete(imperialId.toHexString());
    await expect(applyFundDividendSpend(db, makeInput())).rejects.toThrow(
      new RegExp(`^${FUND_DIVIDEND_HOLDER}:`)
    );
    expect(balances(raw)).toEqual({
      fundCash: 1_000,
      charCash: 0,
      // The imperial row is gone, so there is nothing to read back: the
      // compensation only had to reverse the fund and character legs.
      imperialCash: undefined,
      nppCash: 0,
    });
    expect([...raw.collection("indexFundTransactions").docs.values()]).toHaveLength(0);
  });

  it("negative control: unkeyed legacy-style writes double-pay on replay", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    // The old code path: two raw $incs with no idempotency guard.
    const legacyCredit = async (): Promise<void> => {
      const char = raw.collection("characters").docs.get(charId.toHexString())!;
      char.cashOnHand = (char.cashOnHand as number) + CHAR_ANCHOR;
    };
    await legacyCredit();
    await legacyCredit();
    expect(raw.collection("characters").docs.get(charId.toHexString())!.cashOnHand).toBe(
      2 * CHAR_ANCHOR
    );

    // Same double-invocation through the primitive converges to one credit.
    raw.collection("characters").docs.get(charId.toHexString())!.cashOnHand = 0;
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    const input = makeInput();
    await applyFundDividendSpend(db, input);
    await applyFundDividendSpend(db, input);
    expect(balances(raw).charCash).toBe(CHAR_ANCHOR);
  });

  it("validates its pinned inputs before claiming", async () => {
    const raw = new FakeDb();
    seedAll(raw);
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    await expect(applyFundDividendSpend(db, makeInput({ holdersPaid: 2 }))).rejects.toThrow(
      RangeError
    );
    await expect(applyFundDividendSpend(db, makeInput({ grossAnchor: 0 }))).rejects.toThrow(
      RangeError
    );
    expect([...raw.collection("nonAtomicMoneyFlowReceipts").docs.values()]).toHaveLength(0);
  });
});

describe("dividend callers over the crash-safe primitive", () => {
  async function loadCallers(): Promise<{
    processIndexFundDividend: typeof import("./dividendPassThrough").processIndexFundDividend;
    processIndexFundDividendsBatch: typeof import("./dividendPassThrough").processIndexFundDividendsBatch;
  }> {
    return import("./dividendPassThrough");
  }

  function seedCaller(raw: FakeDb, currency = "USD"): void {
    seedAll(raw);
    const fund = raw.collection("indexFunds").docs.get(fundId.toHexString())!;
    fund.anchorCurrencyCode = currency;
    raw.collection("indexFundPositions").docs.set("pos-char", {
      _id: new ObjectId(),
      fundId,
      holderKind: "character",
      characterId: charId,
      units: 1000,
    });
  }

  function walletOf(raw: FakeDb, id: ObjectId, currency = "USD"): number {
    const doc = raw.collection("characters").docs.get(id.toHexString())!;
    return (doc.currencyBalances as Record<string, Record<string, number>> | undefined)?.personal?.[
      currency
    ] as number;
  }

  it("single path pins the 75/25 split, floors, and keeps the remainder in fund cash", async () => {
    const raw = new FakeDb();
    seedCaller(raw);
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    const { processIndexFundDividend } = await loadCallers();

    const result = await processIndexFundDividend(db, fundId, 1_000_000, corpId, 500, {
      turn: TURN,
    });
    expect(result).toEqual({
      fundId,
      totalGrossAnchor: 1_000_000,
      reinvestedAnchor: 750_000,
      passedThroughAnchor: 250_000,
      holdersPaid: 1,
    });
    expect(raw.collection("indexFunds").docs.get(fundId.toHexString())!.cashAnchor).toBe(
      1_000 + 750_000
    );
    expect(walletOf(raw, charId)).toBe(250_000);
    await flushPostCommit();
    expect(logDividendBulkMock).toHaveBeenCalledTimes(1);

    // Same-turn retry resumes the stored plan: no double pay.
    await processIndexFundDividend(db, fundId, 1_000_000, corpId, 500, { turn: TURN });
    expect(walletOf(raw, charId)).toBe(250_000);
    expect(raw.collection("indexFunds").docs.get(fundId.toHexString())!.cashAnchor).toBe(
      1_000 + 750_000
    );
  });

  it("single path converts the anchor dividend at the pinned FX rate", async () => {
    const raw = new FakeDb();
    seedCaller(raw, "JPY");
    raw.collection("exchangeRates").docs.set("jpy", { currencyCode: "JPY", rate: 102.23 });
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    const { processIndexFundDividend } = await loadCallers();

    await processIndexFundDividend(db, fundId, 1_000_000, corpId, 500, { turn: TURN });
    expect(walletOf(raw, charId, "JPY")).toBeCloseTo(250_000 * 102.23, 0);
  });

  it("single path writes nothing when the fund has no unit supply", async () => {
    const raw = new FakeDb();
    seedCaller(raw);
    raw.collection("indexFunds").docs.get(fundId.toHexString())!.unitSupply = 0;
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    const { processIndexFundDividend } = await loadCallers();

    const result = await processIndexFundDividend(db, fundId, 1_000_000, corpId, 500, {
      turn: TURN,
    });
    expect(result.holdersPaid).toBe(0);
    expect(raw.writeCount).toBe(0);
  });

  it("single path throws for a missing fund; the batch skips it", async () => {
    const raw = new FakeDb();
    seedCaller(raw);
    raw.collection("indexFunds").docs.delete(fundId.toHexString());
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    const { processIndexFundDividend, processIndexFundDividendsBatch } = await loadCallers();

    await expect(
      processIndexFundDividend(db, fundId, 1_000_000, corpId, 500, { turn: TURN })
    ).rejects.toThrow(/not found for dividend processing/);
    await processIndexFundDividendsBatch(
      db,
      [{ fundId, corporationId: corpId, amountAnchor: 1_000_000, shares: 500 }],
      { turn: TURN }
    );
    expect(walletOf(raw, charId)).toBeUndefined();
  });

  it("batch keys repeated identical accruals distinctly and keeps per-corp attribution", async () => {
    const raw = new FakeDb();
    seedCaller(raw);
    const otherCorp = new ObjectId();
    raw.collection("corporations").docs.set(otherCorp.toHexString(), {
      _id: otherCorp,
      name: "Other Corp",
    });
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    const { processIndexFundDividendsBatch } = await loadCallers();

    await processIndexFundDividendsBatch(
      db,
      [
        { fundId, corporationId: corpId, amountAnchor: 1_000_000, shares: 500 },
        { fundId, corporationId: corpId, amountAnchor: 1_000_000, shares: 500 },
        { fundId, corporationId: otherCorp, amountAnchor: 2_000_000, shares: 900 },
      ],
      { turn: TURN }
    );

    // Two identical accruals are two flows (occurrence keys), not one flow run
    // twice: 2 x 750k + 1.5M retained, 2 x 250k + 500k to the sole holder.
    expect(raw.collection("indexFunds").docs.get(fundId.toHexString())!.cashAnchor).toBe(
      1_000 + 2 * 750_000 + 1_500_000
    );
    expect(walletOf(raw, charId)).toBe(2 * 250_000 + 500_000);

    const txRows = [...raw.collection("indexFundTransactions").docs.values()].map(
      (d) => d as unknown as { kind: string; corporationId: ObjectId; amountAnchor: number }
    );
    expect(txRows).toHaveLength(6);
    const byCorp = new Set(txRows.map((r) => r.corporationId.toHexString()));
    expect(byCorp).toEqual(new Set([corpId.toHexString(), otherCorp.toHexString()]));
  });

  it("batch drops invalid accruals and writes nothing when all are invalid", async () => {
    const raw = new FakeDb();
    seedCaller(raw);
    const db = raw as unknown as Parameters<typeof applyFundDividendSpend>[0];
    const { processIndexFundDividendsBatch } = await loadCallers();

    await processIndexFundDividendsBatch(
      db,
      [
        { fundId, corporationId: corpId, amountAnchor: 1_000_000, shares: 500 },
        { fundId, corporationId: corpId, amountAnchor: Number.NaN, shares: 500 },
        { fundId, corporationId: corpId, amountAnchor: 0, shares: 500 },
        { fundId, corporationId: corpId, amountAnchor: -5_000, shares: 500 },
      ],
      { turn: TURN }
    );
    expect(walletOf(raw, charId)).toBe(250_000);

    const writesBefore = raw.writeCount;
    await processIndexFundDividendsBatch(
      db,
      [{ fundId, corporationId: corpId, amountAnchor: 0, shares: 1 }],
      { turn: TURN }
    );
    expect(raw.writeCount).toBe(writesBefore);
  });
});
