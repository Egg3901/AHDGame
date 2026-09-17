import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  applyFundCrossTransferSpend,
  buildCrossTransferSteps,
  buildFundCrossTransferFingerprint,
  buildFundCrossTransferKey,
  FUND_CROSS_TRANSFER_CASH,
  FUND_CROSS_TRANSFER_SELLER,
  FUND_CROSS_TRANSFER_TX,
  resumeFundCrossTransferByKey,
  type FundCrossTransferSpendInput,
} from "./fundCrossTransferSpend";
import {
  executeFundCrossRebalancing,
  buildFundCrossRebalancePassKey,
  type PlannedCrossTransfer,
} from "./fundCrossRebalancing";
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
// Stateful in-memory fakes honoring exactly the operators the cross-fund
// transfer primitive emits ($inc incl. positional `shareholders.$`, $set incl.
// whole-array holdings writes, $push in single-doc and $each+$slice form plus
// key records, $pull, $elemMatch / $not-$elemMatch / dotted-array equality /
// $gte / $lte / $ne guards, duplicate-key errors on insert), so an injected
// crash between any two writes models a real process death between the
// corresponding sequential Mongo writes.
//
// The fake is STRICTER than the earlier buy/sell fakes in one place: a
// positional `shareholders.$` update whose filter names no array element
// throws (real Mongo errors "positional operator did not find the match"),
// where the older fakes silently resolved to index 0. A revert that regresses
// to a bare `{ _id }` filter fails loudly here instead of passing falsely.
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
  let node: Record<string, unknown> = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    const next = node[part];
    if (typeof next !== "object" || next === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = cloneValue(value);
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

function elemMatches(el: unknown, criteria: Record<string, unknown>): boolean {
  if (el === null || typeof el !== "object") return false;
  const record = el as Record<string, unknown>;
  return Object.entries(criteria).every(([k, v]) => {
    if (isOperatorObject(v)) {
      if ("$gte" in v) return typeof record[k] === "number" && record[k] >= (v.$gte as number);
      if ("$lte" in v) return typeof record[k] === "number" && record[k] <= (v.$lte as number);
      return false;
    }
    return valueEquals(record[k], v);
  });
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id" && !isOperatorObject(condition)) continue;
    if (field.includes(".") && !isOperatorObject(condition)) {
      // Dotted equality into an array (e.g. "shareholders.fundId"): any
      // element matching counts.
      const [head, ...rest] = field.split(".");
      const base = doc[head!];
      const values = Array.isArray(base)
        ? base.map((el) => getPath(el as Record<string, unknown>, rest.join(".")))
        : [getPath(doc, field)];
      if (!values.some((v) => valueEquals(v, condition))) return false;
      continue;
    }
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
      if ("$lte" in condition) {
        if (!(typeof actual === "number" && actual <= (condition.$lte as number))) return false;
        continue;
      }
      if ("$elemMatch" in condition) {
        if (
          !Array.isArray(actual) ||
          !actual.some((el) => elemMatches(el, condition.$elemMatch as Record<string, unknown>))
        ) {
          return false;
        }
        continue;
      }
      if ("$not" in condition) {
        const inner = condition.$not as Record<string, unknown>;
        if ("$elemMatch" in inner && Array.isArray(actual)) {
          if (actual.some((el) => elemMatches(el, inner.$elemMatch as Record<string, unknown>))) {
            return false;
          }
          continue;
        }
        return false;
      }
      return false;
    }
    if (!valueEquals(actual, condition)) return false;
  }
  return true;
}

/**
 * Resolve one positional `shareholders.$` against the array conditions in the
 * filter ($elemMatch or dotted equality on the same array). Returns null when
 * the filter names no element: real Mongo throws there instead of guessing.
 */
function resolvePositionalPath(
  doc: Record<string, unknown>,
  path: string,
  filter: Record<string, unknown>
): string | null {
  const dollar = path.indexOf(".$.");
  if (dollar < 0) return path;
  const arr = path.slice(0, dollar);
  const rest = path.slice(dollar + 3);
  const list = getPath(doc, arr);
  if (!Array.isArray(list)) return null;
  const rows = list as Record<string, unknown>[];
  const em = (filter[arr] as Record<string, unknown> | undefined) ?? {};
  if (isOperatorObject(em) && "$elemMatch" in em) {
    const idx = rows.findIndex((el) => elemMatches(el, em.$elemMatch as Record<string, unknown>));
    return idx < 0 ? null : `${arr}.${idx}.${rest}`;
  }
  const dotKey = `${arr}.fundId`;
  if (dotKey in filter && !isOperatorObject(filter[dotKey])) {
    const idx = rows.findIndex((el) => valueEquals(el.fundId, filter[dotKey]));
    return idx < 0 ? null : `${arr}.${idx}.${rest}`;
  }
  return null;
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
    const id = (doc._id as unknown) ?? new ObjectId();
    const key = docKey(id);
    if (this.docs.has(key)) {
      const error = new Error("E11000 duplicate key error") as Error & { code: number };
      error.code = 11000;
      throw error;
    }
    this.docs.set(key, cloneValue({ ...doc, _id: id }));
    return { insertedId: id };
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
      const resolved = resolvePositionalPath(doc, field, filter);
      if (resolved === null) throw new Error("NO_POSITIONAL_MATCH");
      setPath(doc, resolved, ((getPath(doc, resolved) as number | undefined) ?? 0) + delta);
    }
    const push = (update.$push ?? {}) as Record<string, unknown>;
    for (const [field, spec] of Object.entries(push)) {
      if (isOperatorObject(spec) && "$each" in spec) {
        const current = (doc[field] as unknown[] | undefined) ?? [];
        const next = [...current, ...(spec.$each as unknown[])];
        doc[field] = (spec.$slice as number) < 0 ? next.slice(spec.$slice as number) : next;
      } else {
        const current = (doc[field] as unknown[] | undefined) ?? [];
        current.push(cloneValue(spec));
        doc[field] = current;
      }
    }
    const pull = (update.$pull ?? {}) as Record<string, Record<string, unknown>>;
    for (const [field, criteria] of Object.entries(pull)) {
      const current = doc[field];
      if (!Array.isArray(current)) continue;
      doc[field] = current.filter((el) => !elemMatches(el, criteria));
    }
    const set = (update.$set ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(set)) {
      const resolved = resolvePositionalPath(doc, field, filter);
      if (resolved === null) throw new Error("NO_POSITIONAL_MATCH");
      setPath(doc, resolved, value);
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }

  // Negative control surface: the legacy cross-fund path wrote through
  // bulkWrite batch calls. Those methods throw here, so any test driving the
  // primitive through this fake fails loudly if the old batch path returns.
  async bulkWrite(): Promise<never> {
    throw new Error("LEGACY_BULK_PATH");
  }

  async insertMany(): Promise<never> {
    throw new Error("LEGACY_BULK_PATH");
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

const sellerFundId = new ObjectId();
const buyerFundId = new ObjectId();
const corpId = new ObjectId();
const TURN = 5;
const KEY = "xfer-test-key-1";

const SHARES = 20;
const PRICE = 10;
const VALUE = SHARES * PRICE;
const EXEC_LOCAL = 10;
const SELLER_AVG = 7;

function fingerprintFor(input: {
  shares: number;
  pricePerShareAnchor: number;
  valueAnchor: number;
  executionPriceLocal: number;
}): string {
  return buildFundCrossTransferFingerprint({
    sellerFundId,
    buyerFundId,
    corpId,
    shares: input.shares,
    pricePerShareAnchor: input.pricePerShareAnchor,
    valueAnchor: input.valueAnchor,
    executionPriceLocal: input.executionPriceLocal,
    turn: TURN,
  });
}

function makeInput(
  overrides: Partial<FundCrossTransferSpendInput> = {}
): FundCrossTransferSpendInput {
  const base = {
    shares: SHARES,
    pricePerShareAnchor: PRICE,
    valueAnchor: VALUE,
    executionPriceLocal: EXEC_LOCAL,
  };
  return {
    sellerFundId,
    buyerFundId,
    corpId,
    ...base,
    sellerFundName: "Seller Fund",
    buyerFundName: "Buyer Fund",
    anchorCurrencyCode: "USD",
    sellerAvgCostAnchor: SELLER_AVG,
    turn: TURN,
    fingerprint: fingerprintFor({ ...base, ...overrides }),
    idempotencyKey: KEY,
    ...overrides,
  };
}

/** Buyer already holds the corp (increment path, exact-average revert). */
function seedIncrement(raw: FakeDb): void {
  raw.collection("indexFunds").docs.set(sellerFundId.toHexString(), {
    _id: sellerFundId,
    name: "Seller Fund",
    anchorCurrencyCode: "USD",
    status: "active",
    cashAnchor: 1_000,
    holdings: [
      {
        corporationId: corpId,
        shares: 100,
        avgCostPerShareAnchor: SELLER_AVG,
        lastValueAnchor: 1000,
      },
    ],
  });
  raw.collection("indexFunds").docs.set(buyerFundId.toHexString(), {
    _id: buyerFundId,
    name: "Buyer Fund",
    anchorCurrencyCode: "USD",
    status: "active",
    cashAnchor: 10_000,
    holdings: [
      { corporationId: corpId, shares: 50, avgCostPerShareAnchor: 6, lastValueAnchor: 500 },
    ],
  });
  raw.collection("corporations").docs.set(corpId.toHexString(), {
    _id: corpId,
    sharePrice: 10,
    fundamentalSharePrice: 10,
    totalShares: 1000,
    publicFloat: 500,
    liquidCurrencyCode: "USD",
    shareholders: [
      { fundId: sellerFundId, shares: 100, avgCostPerShare: 10 },
      { fundId: buyerFundId, shares: 50, avgCostPerShare: 6 },
    ],
  });
}

/** Buyer is new to the corp (push path, pull revert). */
function seedPush(raw: FakeDb): void {
  raw.collection("indexFunds").docs.set(sellerFundId.toHexString(), {
    _id: sellerFundId,
    name: "Seller Fund",
    anchorCurrencyCode: "USD",
    status: "active",
    cashAnchor: 1_000,
    holdings: [
      {
        corporationId: corpId,
        shares: 100,
        avgCostPerShareAnchor: SELLER_AVG,
        lastValueAnchor: 1000,
      },
    ],
  });
  raw.collection("indexFunds").docs.set(buyerFundId.toHexString(), {
    _id: buyerFundId,
    name: "Buyer Fund",
    anchorCurrencyCode: "USD",
    status: "active",
    cashAnchor: 10_000,
    holdings: [],
  });
  raw.collection("corporations").docs.set(corpId.toHexString(), {
    _id: corpId,
    sharePrice: 10,
    fundamentalSharePrice: 10,
    totalShares: 1000,
    publicFloat: 500,
    liquidCurrencyCode: "USD",
    shareholders: [{ fundId: sellerFundId, shares: 100, avgCostPerShare: 10 }],
  });
}

/** Seller holdings hold exactly the sale size: the sale removes the row. */
function seedEmptiedSeller(raw: FakeDb): void {
  seedIncrement(raw);
  const seller = raw.collection("indexFunds").docs.get(sellerFundId.toHexString())!;
  seller.holdings = [
    {
      corporationId: corpId,
      shares: SHARES,
      avgCostPerShareAnchor: SELLER_AVG,
      lastValueAnchor: 200,
    },
  ];
}

function fundDoc(raw: FakeDb, id: ObjectId): Record<string, unknown> {
  return raw.collection("indexFunds").docs.get(id.toHexString())!;
}

function corpShareholders(raw: FakeDb): Array<Record<string, unknown>> {
  return raw.collection("corporations").docs.get(corpId.toHexString())!.shareholders as Array<
    Record<string, unknown>
  >;
}

function capEntry(raw: FakeDb, fundId: ObjectId): Record<string, unknown> | undefined {
  return corpShareholders(raw).find((e) => (e.fundId as ObjectId).toString() === fundId.toString());
}

function holdingOf(raw: FakeDb, fundId: ObjectId): Record<string, unknown> | undefined {
  const holdings = fundDoc(raw, fundId).holdings as Array<Record<string, unknown>>;
  return holdings.find((h) => (h.corporationId as ObjectId).toString() === corpId.toString());
}

function txRows(raw: FakeDb): Array<Record<string, unknown>> {
  return [...raw.collection("indexFundTransactions").docs.values()];
}

function receipts(raw: FakeDb): Array<Record<string, unknown>> {
  return [...raw.collection("nonAtomicMoneyFlowReceipts").docs.values()];
}

function asDb(raw: FakeDb): Parameters<typeof applyFundCrossTransferSpend>[0] {
  return raw as unknown as Parameters<typeof applyFundCrossTransferSpend>[0];
}

beforeEach(() => {
  supportMock.mockReset();
});

describe("fund cross-transfer spend", () => {
  it("moves shares and cash exactly once with exact holdings images", async () => {
    const raw = new FakeDb();
    seedIncrement(raw);
    const input = makeInput();
    const first = await applyFundCrossTransferSpend(asDb(raw), input);
    expect(first.duplicate).toBe(false);
    expect(first.outcome).toEqual({ sharesTransferred: SHARES, valueTransferred: VALUE });

    expect(capEntry(raw, sellerFundId)!.shares).toBe(80);
    const buyerCap = capEntry(raw, buyerFundId)!;
    expect(buyerCap.shares).toBe(70);
    expect(buyerCap.avgCostPerShare).toBeCloseTo((50 * 6 + SHARES * EXEC_LOCAL) / 70, 12);
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000 - VALUE);
    expect(fundDoc(raw, sellerFundId).cashAnchor).toBe(1_000 + VALUE);
    expect(holdingOf(raw, sellerFundId)).toMatchObject({ shares: 80, avgCostPerShareAnchor: 7 });
    const buyerHolding = holdingOf(raw, buyerFundId)!;
    expect(buyerHolding.shares).toBe(70);
    expect(buyerHolding.avgCostPerShareAnchor).toBeCloseTo((50 * 6 + SHARES * PRICE) / 70, 12);
    expect(txRows(raw)).toHaveLength(2);
    const receipt = receipts(raw);
    expect(receipt).toHaveLength(1);
    expect(receipt[0]!.status).toBe("completed");

    // A same-key replay converges without moving money again.
    const second = await applyFundCrossTransferSpend(asDb(raw), input);
    expect(second.duplicate).toBe(true);
    expect(second.outcome).toEqual(first.outcome);
    expect(capEntry(raw, sellerFundId)!.shares).toBe(80);
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000 - VALUE);
    expect(txRows(raw)).toHaveLength(2);
  });

  it("pushes a buyer row for a first-time holder and converges on replay", async () => {
    const raw = new FakeDb();
    seedPush(raw);
    const input = makeInput();
    const first = await applyFundCrossTransferSpend(asDb(raw), input);
    expect(first.duplicate).toBe(false);
    const buyerCap = capEntry(raw, buyerFundId)!;
    expect(buyerCap.shares).toBe(SHARES);
    expect(buyerCap.avgCostPerShare).toBe(EXEC_LOCAL);
    expect(holdingOf(raw, buyerFundId)).toMatchObject({ shares: SHARES });

    const second = await applyFundCrossTransferSpend(asDb(raw), input);
    expect(second.duplicate).toBe(true);
    expect(corpShareholders(raw).filter((e) => valueEquals(e.fundId, buyerFundId))).toHaveLength(1);
    expect(capEntry(raw, buyerFundId)!.shares).toBe(SHARES);
    expect(txRows(raw)).toHaveLength(2);
  });

  it("recovers exactly-once after a crash following every durable write", async () => {
    // Durable write order (increment path): receipt claim, plan persist,
    // seller cap debit, buyer cap credit, buyer cash debit, seller cash
    // credit, seller holdings, buyer holdings, two audit inserts, receipt
    // settle, outcome persist. Crashing before each of them must converge.
    const probe = new FakeDb();
    seedIncrement(probe);
    await applyFundCrossTransferSpend(asDb(probe), makeInput());
    const totalWrites = probe.writeCount;
    expect(totalWrites).toBeGreaterThan(8);

    for (let crashAfter = 0; crashAfter < totalWrites; crashAfter += 1) {
      const raw = new FakeDb();
      seedIncrement(raw);
      raw.crashAfterWrites = crashAfter;
      await expect(applyFundCrossTransferSpend(asDb(raw), makeInput())).rejects.toThrow(
        "INJECTED_CRASH"
      );

      raw.crashAfterWrites = Number.POSITIVE_INFINITY;
      const resumed = await applyFundCrossTransferSpend(asDb(raw), makeInput());
      expect(resumed.outcome).toEqual({ sharesTransferred: SHARES, valueTransferred: VALUE });
      expect(capEntry(raw, sellerFundId)!.shares).toBe(80);
      expect(capEntry(raw, buyerFundId)!.shares).toBe(70);
      expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000 - VALUE);
      expect(fundDoc(raw, sellerFundId).cashAnchor).toBe(1_000 + VALUE);
      expect(holdingOf(raw, sellerFundId)).toMatchObject({ shares: 80 });
      expect(holdingOf(raw, buyerFundId)).toMatchObject({ shares: 70 });
      expect(txRows(raw)).toHaveLength(2);
      const receipt = receipts(raw);
      expect(receipt).toHaveLength(1);
      expect(receipt[0]!.status).toBe("completed");
    }
  });

  it("recovers the push path after a mid-flow crash", async () => {
    const raw = new FakeDb();
    seedPush(raw);
    // Claim + plan + seller debit land; the buyer push attempt throws.
    raw.crashAfterWrites = 3;
    await expect(applyFundCrossTransferSpend(asDb(raw), makeInput())).rejects.toThrow(
      "INJECTED_CRASH"
    );

    raw.crashAfterWrites = Number.POSITIVE_INFINITY;
    const resumed = await applyFundCrossTransferSpend(asDb(raw), makeInput());
    expect(resumed.outcome).toEqual({ sharesTransferred: SHARES, valueTransferred: VALUE });
    expect(capEntry(raw, sellerFundId)!.shares).toBe(80);
    expect(capEntry(raw, buyerFundId)!.shares).toBe(SHARES);
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000 - VALUE);
    expect(txRows(raw)).toHaveLength(2);
  });

  it("replays the stored plan when live figures changed after the crash", async () => {
    const raw = new FakeDb();
    seedIncrement(raw);
    // Claim + plan persist land; the first money write throws.
    raw.crashAfterWrites = 2;
    await expect(applyFundCrossTransferSpend(asDb(raw), makeInput())).rejects.toThrow(
      "INJECTED_CRASH"
    );
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    // Stale caller: same key and fingerprint, but repriced amounts computed
    // from post-debit reads. The resume must ignore them and replay the pins.
    const stale: FundCrossTransferSpendInput = {
      ...makeInput(),
      shares: 30,
      pricePerShareAnchor: 15,
      valueAnchor: 450,
    };
    const resumed = await applyFundCrossTransferSpend(asDb(raw), stale);
    expect(resumed.outcome).toEqual({ sharesTransferred: SHARES, valueTransferred: VALUE });
    expect(capEntry(raw, sellerFundId)!.shares).toBe(80);
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000 - VALUE);
    expect(txRows(raw)).toHaveLength(2);
  });

  it("resumes by key through the resume helper without double-applying", async () => {
    const raw = new FakeDb();
    seedIncrement(raw);
    raw.crashAfterWrites = 5;
    await expect(applyFundCrossTransferSpend(asDb(raw), makeInput())).rejects.toThrow(
      "INJECTED_CRASH"
    );
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    const resumed = await resumeFundCrossTransferByKey(asDb(raw), KEY, makeInput().fingerprint, {
      ...makeInput(),
      idempotencyKey: undefined,
    });
    expect(resumed.outcome).toEqual({ sharesTransferred: SHARES, valueTransferred: VALUE });
    expect(capEntry(raw, sellerFundId)!.shares).toBe(80);
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000 - VALUE);
  });

  it("fails closed on key reuse with a different fingerprint", async () => {
    const raw = new FakeDb();
    seedIncrement(raw);
    await applyFundCrossTransferSpend(asDb(raw), makeInput());
    const other = makeInput({
      shares: 25,
      fingerprint: fingerprintFor({
        shares: 25,
        pricePerShareAnchor: PRICE,
        valueAnchor: 250,
        executionPriceLocal: EXEC_LOCAL,
      }),
    });
    await expect(applyFundCrossTransferSpend(asDb(raw), other)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    // The conflicting attempt moved nothing.
    expect(capEntry(raw, sellerFundId)!.shares).toBe(80);
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000 - VALUE);
  });

  it("settles failed when the seller lost its race, moving nothing", async () => {
    const raw = new FakeDb();
    seedIncrement(raw);
    // Seller holds fewer than the transfer size: first-step guard miss.
    const corp = raw.collection("corporations").docs.get(corpId.toHexString())!;
    (corp.shareholders as Array<Record<string, unknown>>)[0]!.shares = 5;
    const err = await applyFundCrossTransferSpend(asDb(raw), makeInput()).catch((e) => e);
    expect(String(err.message)).toContain(FUND_CROSS_TRANSFER_SELLER);
    expect(capEntry(raw, buyerFundId)!.shares).toBe(50);
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000);
    expect(fundDoc(raw, sellerFundId).cashAnchor).toBe(1_000);
    expect(txRows(raw)).toHaveLength(0);
    expect(receipts(raw)[0]!.status).toBe("failed");

    // A settled key stays terminal: same-key retry throws instead of acting.
    await expect(applyFundCrossTransferSpend(asDb(raw), makeInput())).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });

  it("compensates the prefix exactly when buyer cash falls short", async () => {
    const raw = new FakeDb();
    seedIncrement(raw);
    fundDoc(raw, buyerFundId).cashAnchor = 50;
    const before = JSON.stringify({
      caps: corpShareholders(raw),
      sellerCash: fundDoc(raw, sellerFundId).cashAnchor,
      sellerHoldings: fundDoc(raw, sellerFundId).holdings,
      buyerHoldings: fundDoc(raw, buyerFundId).holdings,
    });
    const err = await applyFundCrossTransferSpend(asDb(raw), makeInput()).catch((e) => e);
    expect(String(err.message)).toContain(FUND_CROSS_TRANSFER_CASH);
    // Cap rows, averages, cash, and holdings images are all back to seed.
    expect(
      JSON.stringify({
        caps: corpShareholders(raw),
        sellerCash: fundDoc(raw, sellerFundId).cashAnchor,
        sellerHoldings: fundDoc(raw, sellerFundId).holdings,
        buyerHoldings: fundDoc(raw, buyerFundId).holdings,
      })
    ).toBe(
      JSON.stringify({
        caps: JSON.parse(before).caps,
        sellerCash: 1_000,
        sellerHoldings: JSON.parse(before).sellerHoldings,
        buyerHoldings: JSON.parse(before).buyerHoldings,
      })
    );
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(50);
    expect(txRows(raw)).toHaveLength(0);
    expect(receipts(raw)[0]!.status).toBe("compensated");
    await expect(applyFundCrossTransferSpend(asDb(raw), makeInput())).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });

  it("restores an emptied seller position with the pinned average on stored-plan compensation", async () => {
    // Regression: the stored-plan resume once dropped `sellerAvgCostAnchor`,
    // so compensating an emptied position rebuilt the row at the sale price
    // instead of the pinned pre-sale average.
    const raw = new FakeDb();
    seedEmptiedSeller(raw);
    // Crash after every money/holdings write landed, before the audit rows.
    raw.crashAfterWrites = 8;
    await expect(applyFundCrossTransferSpend(asDb(raw), makeInput())).rejects.toThrow(
      "INJECTED_CRASH"
    );
    expect(holdingOf(raw, sellerFundId)).toBeUndefined();
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;

    // Survive the audit insert instead of crashing: the prefix must reverse
    // from the STORED plan, not the live input.
    const txs = raw.collection("indexFundTransactions");
    txs.insertOne = async () => {
      throw new Error("DISK_FAIL");
    };
    const err = await applyFundCrossTransferSpend(asDb(raw), makeInput()).catch((e) => e);
    expect(String(err.message)).toContain(FUND_CROSS_TRANSFER_TX);
    const restored = holdingOf(raw, sellerFundId)!;
    expect(restored.shares).toBe(SHARES);
    expect(restored.avgCostPerShareAnchor).toBe(SELLER_AVG);
    expect(capEntry(raw, sellerFundId)!.shares).toBe(100);
    const buyerCap = capEntry(raw, buyerFundId)!;
    expect(buyerCap.shares).toBe(50);
    expect(buyerCap.avgCostPerShare).toBe(6);
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000);
    expect(fundDoc(raw, sellerFundId).cashAnchor).toBe(1_000);
    expect(receipts(raw)[0]!.status).toBe("compensated");
    await expect(applyFundCrossTransferSpend(asDb(raw), makeInput())).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });

  it("pulls a pushed buyer row exactly on compensation", async () => {
    const raw = new FakeDb();
    seedPush(raw);
    fundDoc(raw, buyerFundId).cashAnchor = 50;
    const err = await applyFundCrossTransferSpend(asDb(raw), makeInput()).catch((e) => e);
    expect(String(err.message)).toContain(FUND_CROSS_TRANSFER_CASH);
    // The pushed buyer row is gone (not left as a zero-share row).
    expect(capEntry(raw, buyerFundId)).toBeUndefined();
    expect(capEntry(raw, sellerFundId)!.shares).toBe(100);
    expect(holdingOf(raw, buyerFundId)).toBeUndefined();
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(50);
    expect(txRows(raw)).toHaveLength(0);
    expect(receipts(raw)[0]!.status).toBe("compensated");
  });

  it("converges concurrent same-key attempts to one transfer", async () => {
    const raw = new FakeDb();
    seedIncrement(raw);
    const input = makeInput();
    const [a, b] = await Promise.all([
      applyFundCrossTransferSpend(asDb(raw), input),
      applyFundCrossTransferSpend(asDb(raw), input),
    ]);
    expect(a.outcome).toEqual({ sharesTransferred: SHARES, valueTransferred: VALUE });
    expect(b.outcome).toEqual(a.outcome);
    expect(capEntry(raw, sellerFundId)!.shares).toBe(80);
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000 - VALUE);
    expect(txRows(raw)).toHaveLength(2);
    expect(receipts(raw)).toHaveLength(1);
  });

  it("builds deterministic keys, fingerprints, and ordered steps", async () => {
    expect(buildFundCrossTransferKey(sellerFundId, buyerFundId, corpId, TURN, SHARES)).toBe(
      `fund-cross-transfer:${sellerFundId.toHexString()}:${buyerFundId.toHexString()}:${corpId.toHexString()}:turn:${TURN}:shares:${SHARES}`
    );
    const fp = fingerprintFor({
      shares: SHARES,
      pricePerShareAnchor: PRICE,
      valueAnchor: VALUE,
      executionPriceLocal: EXEC_LOCAL,
    });
    expect(fp).toBe(makeInput().fingerprint);
    expect(
      fingerprintFor({
        shares: 21,
        pricePerShareAnchor: PRICE,
        valueAnchor: 210,
        executionPriceLocal: EXEC_LOCAL,
      })
    ).not.toBe(fp);

    const raw = new FakeDb();
    seedIncrement(raw);
    const steps = buildCrossTransferSteps(asDb(raw), KEY, makeInput(), new Date());
    expect(steps.map((s) => s.name)).toEqual([
      "seller-cap-debit",
      "buyer-cap-credit",
      "buyer-cash-debit",
      "seller-cash-credit",
      "seller-holdings",
      "buyer-holdings",
      "cross-tx-sell",
      "cross-tx-buy",
    ]);
  });

  it("negative control: unkeyed legacy-style writes move cash twice on replay", async () => {
    const raw = new FakeDb();
    seedIncrement(raw);
    // The old shape: raw sequential writes with no idempotency guard.
    const legacyMove = (): void => {
      fundDoc(raw, buyerFundId).cashAnchor =
        (fundDoc(raw, buyerFundId).cashAnchor as number) - VALUE;
      fundDoc(raw, sellerFundId).cashAnchor =
        (fundDoc(raw, sellerFundId).cashAnchor as number) + VALUE;
    };
    legacyMove();
    legacyMove();
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000 - 2 * VALUE);

    // Same double-invocation through the primitive moves cash once.
    fundDoc(raw, buyerFundId).cashAnchor = 10_000;
    fundDoc(raw, sellerFundId).cashAnchor = 1_000;
    const input = makeInput();
    await applyFundCrossTransferSpend(asDb(raw), input);
    await applyFundCrossTransferSpend(asDb(raw), input);
    expect(fundDoc(raw, buyerFundId).cashAnchor).toBe(10_000 - VALUE);
  });

  it("negative control: the legacy batch path is gone", async () => {
    const raw = new FakeDb();
    await expect(raw.collection("indexFunds").bulkWrite([])).rejects.toThrow("LEGACY_BULK_PATH");
    await expect(raw.collection("indexFunds").insertMany([])).rejects.toThrow("LEGACY_BULK_PATH");
    // Driving the primitive through this fake proves it never batch-writes:
    // any bulkWrite/insertMany call would throw LEGACY_BULK_PATH above.
    seedIncrement(raw);
    await applyFundCrossTransferSpend(asDb(raw), makeInput());
    expect(txRows(raw)).toHaveLength(2);
  });

  it("reverts a pre-existing buyer row through the positional write", async () => {
    // Regression: the revert once used a bare `{ _id }` filter with a
    // positional `shareholders.$` update, which real Mongo rejects (no array
    // element named). This strict fake throws NO_POSITIONAL_MATCH there, so
    // this test fails on the old filter and passes on the fixed one.
    const raw = new FakeDb();
    seedIncrement(raw);
    const steps = buildCrossTransferSteps(asDb(raw), KEY, makeInput(), new Date());
    expect(await steps[0]!.apply()).toBe("applied");
    expect(await steps[1]!.apply()).toBe("applied");
    expect(await steps[1]!.revert!()).toBe("applied");
    const buyerCap = capEntry(raw, buyerFundId)!;
    expect(buyerCap.shares).toBe(50);
    expect(buyerCap.avgCostPerShare).toBe(6);
    // A vanished buyer row means the effect is already gone: converge.
    const corp = raw.collection("corporations").docs.get(corpId.toHexString())!;
    corp.shareholders = (corp.shareholders as Array<Record<string, unknown>>).filter(
      (e) => !(e.fundId as ObjectId).equals(buyerFundId)
    );
    expect(await steps[1]!.revert!()).toBe("already-applied");
  });
});

describe("fund cross-rebalance pass driver", () => {
  const sellerAId = new ObjectId();
  const sellerBId = new ObjectId();
  const passBuyerId = new ObjectId();
  const corpAId = new ObjectId();
  const corpBId = new ObjectId();
  const PASS_TURN = 5;

  function seedPassFund(
    raw: FakeDb,
    id: ObjectId,
    name: string,
    corp: ObjectId,
    cash: number
  ): void {
    raw.collection("indexFunds").docs.set(id.toHexString(), {
      _id: id,
      name,
      anchorCurrencyCode: "USD",
      status: "active",
      cashAnchor: cash,
      targetConstituents: [],
      holdings: [
        { corporationId: corp, shares: 100, avgCostPerShareAnchor: 7, lastValueAnchor: 1000 },
      ],
    });
  }

  function seedPassCorp(raw: FakeDb, corp: ObjectId, seller: ObjectId): void {
    raw.collection("corporations").docs.set(corp.toHexString(), {
      _id: corp,
      sharePrice: 10,
      fundamentalSharePrice: 10,
      totalShares: 1000,
      publicFloat: 500,
      liquidCurrencyCode: "USD",
      shareholders: [
        { fundId: seller, shares: 100, avgCostPerShare: 10 },
        { fundId: passBuyerId, shares: 50, avgCostPerShare: 6 },
      ],
    });
  }

  function seedPass(raw: FakeDb): void {
    seedPassFund(raw, sellerAId, "Seller A", corpAId, 1_000);
    seedPassFund(raw, sellerBId, "Seller B", corpBId, 1_000);
    raw.collection("indexFunds").docs.set(passBuyerId.toHexString(), {
      _id: passBuyerId,
      name: "Buyer",
      anchorCurrencyCode: "USD",
      status: "active",
      cashAnchor: 100_000,
      targetConstituents: [],
      holdings: [
        { corporationId: corpAId, shares: 50, avgCostPerShareAnchor: 6, lastValueAnchor: 500 },
        { corporationId: corpBId, shares: 50, avgCostPerShareAnchor: 6, lastValueAnchor: 500 },
      ],
    });
    seedPassCorp(raw, corpAId, sellerAId);
    seedPassCorp(raw, corpBId, sellerBId);
  }

  function passContext(raw: FakeDb): {
    funds: Array<Record<string, unknown>>;
    corps: Array<Record<string, unknown>>;
    exchangeRates: Record<string, number>;
  } {
    const funds = [sellerAId, sellerBId, passBuyerId].map((id) =>
      raw.collection("indexFunds").docs.get(id.toHexString())!
    );
    const corps = [corpAId, corpBId].map((id) =>
      raw.collection("corporations").docs.get(id.toHexString())!
    );
    return { funds, corps, exchangeRates: {} };
  }

  function passPlans(): PlannedCrossTransfer[] {
    return [
      {
        corporationId: corpAId,
        sellerFundId: sellerAId,
        buyerFundId: passBuyerId,
        shares: 20,
        pricePerShareAnchor: 10,
        valueAnchor: 200,
      },
      {
        corporationId: corpBId,
        sellerFundId: sellerBId,
        buyerFundId: passBuyerId,
        shares: 20,
        pricePerShareAnchor: 10,
        valueAnchor: 200,
      },
    ];
  }

  function passCap(raw: FakeDb, corp: ObjectId, fund: ObjectId): number {
    const doc = raw.collection("corporations").docs.get(corp.toHexString())!;
    const rows = doc.shareholders as Array<Record<string, unknown>>;
    return rows.find((e) => (e.fundId as ObjectId).toString() === fund.toString())!
      .shares as number;
  }

  it("runs every leg once and replays the stored outcome on a same-key retry", async () => {
    const raw = new FakeDb();
    seedPass(raw);
    const db = raw as unknown as Parameters<typeof executeFundCrossRebalancing>[0];
    const first = await executeFundCrossRebalancing(db, passPlans(), PASS_TURN, {
      context: passContext(raw) as never,
    });
    expect(first).toEqual({
      transfers: 2,
      sharesTransferred: 40,
      valueTransferred: 400,
      errors: [],
    });
    expect(passCap(raw, corpAId, sellerAId)).toBe(80);
    expect(passCap(raw, corpBId, sellerBId)).toBe(80);
    expect(
      raw.collection("indexFunds").docs.get(passBuyerId.toHexString())!.cashAnchor as number
    ).toBe(100_000 - 400);

    // Same-turn retry replays the stored legs instead of rebalancing twice.
    const second = await executeFundCrossRebalancing(db, passPlans(), PASS_TURN, {
      context: passContext(raw) as never,
    });
    expect(second).toEqual(first);
    expect(passCap(raw, corpAId, sellerAId)).toBe(80);
    expect(
      raw.collection("indexFunds").docs.get(passBuyerId.toHexString())!.cashAnchor as number
    ).toBe(100_000 - 400);
  });

  it("resumes a pass crashed before the first transfer", async () => {
    const raw = new FakeDb();
    seedPass(raw);
    const db = raw as unknown as Parameters<typeof executeFundCrossRebalancing>[0];
    // The parent claim insert throws: nothing applied, retry owns the pass.
    raw.crashAfterWrites = 0;
    await expect(
      executeFundCrossRebalancing(db, passPlans(), PASS_TURN, {
        context: passContext(raw) as never,
      })
    ).rejects.toThrow("INJECTED_CRASH");

    raw.crashAfterWrites = Number.POSITIVE_INFINITY;
    const resumed = await executeFundCrossRebalancing(db, passPlans(), PASS_TURN, {
      context: passContext(raw) as never,
    });
    expect(resumed).toEqual({
      transfers: 2,
      sharesTransferred: 40,
      valueTransferred: 400,
      errors: [],
    });
    expect(passCap(raw, corpAId, sellerAId)).toBe(80);
    expect(passCap(raw, corpBId, sellerBId)).toBe(80);
  });

  it("resumes a pass crashed mid-market to two transfers", async () => {
    const raw = new FakeDb();
    seedPass(raw);
    const db = raw as unknown as Parameters<typeof executeFundCrossRebalancing>[0];
    // Writes 1-17 land (parent claim + plan, leg 1 incl. post-commit); the
    // 18th write (leg 2's child claim insert) throws, the driver loop catches
    // it, and the verdict persist for the failed leg throws past the loop: a
    // true process-death shape. The stored leg 2 stays pending, so a same-key
    // resume re-drives it instead of stranding half a market.
    raw.crashAfterWrites = 17;
    await expect(
      executeFundCrossRebalancing(db, passPlans(), PASS_TURN, {
        context: passContext(raw) as never,
      })
    ).rejects.toThrow("INJECTED_CRASH");

    raw.crashAfterWrites = Number.POSITIVE_INFINITY;
    const resumed = await executeFundCrossRebalancing(db, passPlans(), PASS_TURN, {
      context: passContext(raw) as never,
    });
    expect(resumed).toEqual({
      transfers: 2,
      sharesTransferred: 40,
      valueTransferred: 400,
      errors: [],
    });
    expect(passCap(raw, corpAId, sellerAId)).toBe(80);
    expect(passCap(raw, corpBId, sellerBId)).toBe(80);
  });

  it("keeps a settled leg failure verdict on resume instead of re-driving", async () => {
    const raw = new FakeDb();
    seedPass(raw);
    // Leg 2 moves everything, then survives its buyer audit-row insert: the
    // prefix compensates and the child receipt settles compensated. The pass
    // records the failure and moves on, exactly like the legacy
    // per-transfer catch. (A seller/buyer/cash race instead settles the leg
    // skipped, also like the legacy guarded writes.)
    const txs = raw.collection("indexFundTransactions");
    const origInsert = txs.insertOne.bind(txs);
    txs.insertOne = async (doc: Record<string, unknown>) => {
      if ((doc.corporationId as ObjectId)?.toString() === corpBId.toString()) {
        throw new Error("DISK_FAIL");
      }
      return origInsert(doc);
    };
    const db = raw as unknown as Parameters<typeof executeFundCrossRebalancing>[0];
    const partial = await executeFundCrossRebalancing(db, passPlans(), PASS_TURN, {
      context: passContext(raw) as never,
    });
    expect(partial.transfers).toBe(1);
    expect(partial.sharesTransferred).toBe(20);
    expect(partial.errors).toHaveLength(1);
    expect(partial.errors[0]).toContain("Cross-rebalance");
    expect(passCap(raw, corpAId, sellerAId)).toBe(80);
    // Leg 2 compensated: its seller cap row is back and the buyer paid once.
    expect(passCap(raw, corpBId, sellerBId)).toBe(100);
    expect(
      raw.collection("indexFunds").docs.get(passBuyerId.toHexString())!.cashAnchor as number
    ).toBe(100_000 - 200);

    // A same-key resume replays the stored legs: leg 1 tallies without
    // re-invoking, leg 2 keeps its settled verdict (fail closed, recorded in
    // errors) instead of re-running a leg whose child receipt is terminal.
    txs.insertOne = origInsert;
    raw.crashAfterWrites = Number.POSITIVE_INFINITY;
    const resumed = await executeFundCrossRebalancing(db, passPlans(), PASS_TURN, {
      context: passContext(raw) as never,
    });
    expect(resumed.transfers).toBe(1);
    expect(resumed.errors).toHaveLength(1);
    expect(passCap(raw, corpBId, sellerBId)).toBe(100);
    const receipt = raw
      .collection("nonAtomicMoneyFlowReceipts")
      .docs.get(buildFundCrossRebalancePassKey(PASS_TURN))!;
    expect(receipt.status).toBe("completed");
  });
});
