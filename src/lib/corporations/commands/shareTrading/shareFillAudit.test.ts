import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Collection, type Db } from "mongodb";
import type { MoneyFlowReceipt } from "@/lib/db/nonAtomicMoneyFlow";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  claimMoneyFlowReceipt,
  keyedInsertId,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  SHARE_FILL_FUND_TX_DOMAIN,
  SHARE_FILL_HISTORY_DOMAIN,
  SHARE_FILL_TX_BUY_DOMAIN,
  SHARE_FILL_TX_SELL_DOMAIN,
  beginShareFillAttempt,
  buildShareFillClaimFilter,
  buildShareFillFingerprint,
  buildShareFillRouteClaimPipeline,
  buildShareFillTurnClaimUpdate,
  collectShareFillAuditRows,
  insertShareFillAuditRows,
  markShareFillMoneyCommitted,
  prepareShareFillClaim,
  recoverShareFillAttempt,
  recoverShareFillOrphans,
  runShareFillRecoveryPass,
  repairStrandedShareFillClaim,
  settleShareFillAttempt,
  type ShareFillAuditPlan,
} from "./shareFillAudit";
import type { ShareOrder } from "@/lib/db/types/corporation";

const { captureExceptionMock, recordAuditMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  recordAuditMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: captureExceptionMock }));
vi.mock("@/lib/audit/recordAudit", () => ({
  recordAudit: recordAuditMock,
  recordAuditBulk: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn().mockRejectedValue(new Error("no-real-db-in-share-fill-audit-tests")),
  getMongoClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fake honoring exactly the operators the share-fill audit
// module and its convergent writers emit: receipt insert/find/update with
// dotted-$set paths, shareOrders find/update, duplicate-key (11000) inserts
// on the three audit collections, and null config reads. An injected fault on
// the Nth audit insert models a process death between the corresponding
// sequential Mongo writes: the row never lands and the writer reports
// `failed`, exactly like a crash.
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>;

function docKey(id: unknown): string {
  if (id instanceof ObjectId) return `oid:${id.toHexString()}`;
  return `str:${String(id)}`;
}

function clone<T>(value: T): T {
  if (value instanceof ObjectId) return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, clone(v)])
    ) as unknown as T;
  }
  return value;
}

function getPath(doc: Doc, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], doc);
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let node: Doc = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    const next = node[part];
    if (typeof next !== "object" || next === null) node[part] = {};
    node = node[part] as Doc;
  }
  node[parts[parts.length - 1]!] = clone(value);
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (actual instanceof ObjectId && expected instanceof ObjectId) return actual.equals(expected);
  return actual === expected;
}

function matchesFilter(doc: Doc, filter: Record<string, unknown>): boolean {
  for (const [key, clause] of Object.entries(filter)) {
    if (clause !== null && typeof clause === "object" && !(clause instanceof ObjectId)) {
      const ops = clause as Record<string, unknown>;
      if ("$exists" in ops) {
        const exists = getPath(doc, key) !== undefined;
        if (exists !== ops.$exists) return false;
        continue;
      }
      if ("$gte" in ops) {
        const actual = getPath(doc, key);
        if (typeof actual !== "number" || actual < (ops.$gte as number)) return false;
        continue;
      }
      if ("$ne" in ops) {
        const actual = doc[key] ?? getPath(doc, key);
        if (valueEquals(actual, ops.$ne)) return false;
        continue;
      }
      if ("$in" in ops) {
        const actual = doc[key] ?? getPath(doc, key);
        const list = ops.$in as unknown[];
        if (!list.some((candidate) => valueEquals(actual, candidate))) return false;
        continue;
      }
      return false;
    }
    if (!valueEquals(doc[key] ?? getPath(doc, key), clause)) return false;
  }
  return true;
}

interface FakeDb {
  db: Db;
  collections: Map<string, { docs: Map<string, Doc>; insertCount: number }>;
  faults: { failAuditInsertsRemaining: number; failAtAuditInsertIndex: number | null };
  auditInsertCalls: number;
  seed: (collection: string, doc: Doc) => void;
  counts: (collection: string) => { docs: number; inserts: number };
}

const AUDIT_COLLECTIONS = new Set(["financialTxLog", "indexFundTransactions", "shareTradeHistory"]);

function createFakeDb(): FakeDb {
  const collections = new Map<string, { docs: Map<string, Doc>; insertCount: number }>();
  const faults = { failAuditInsertsRemaining: 0, failAtAuditInsertIndex: null as number | null };
  const state = { auditInsertCalls: 0 };

  function coll(name: string): {
    docs: Map<string, Doc>;
    insertCount: number;
    insertOne: (doc: Doc) => Promise<{ insertedId: unknown }>;
    findOne: (filter?: Record<string, unknown>) => Promise<Doc | null>;
    updateOne: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => Promise<{ matchedCount: number; modifiedCount: number }>;
    find: (filter?: Record<string, unknown>) => {
      toArray: () => Promise<Doc[]>;
      limit: (n: number) => { toArray: () => Promise<Doc[]> };
    };
  } {
    let entry = collections.get(name);
    if (!entry) {
      entry = { docs: new Map(), insertCount: 0 };
      collections.set(name, entry);
    }
    const store = entry;
    return {
      docs: store.docs,
      get insertCount() {
        return store.insertCount;
      },
      async insertOne(doc: Doc) {
        if (AUDIT_COLLECTIONS.has(name)) {
          state.auditInsertCalls += 1;
          // Latched: a crashed process writes nothing further in this attempt.
          if (
            faults.failAtAuditInsertIndex !== null &&
            state.auditInsertCalls >= faults.failAtAuditInsertIndex
          ) {
            throw new Error("injected-crash-before-row-landed");
          }
          if (faults.failAuditInsertsRemaining > 0) {
            faults.failAuditInsertsRemaining -= 1;
            throw new Error("injected-crash-before-row-landed");
          }
        }
        const key = docKey(doc._id);
        if (store.docs.has(key)) {
          const err = new Error("duplicate key") as Error & { code: number };
          err.code = 11000;
          throw err;
        }
        store.docs.set(key, clone(doc));
        store.insertCount += 1;
        return { insertedId: doc._id };
      },
      async findOne(filter: Record<string, unknown> = {}) {
        for (const doc of store.docs.values()) {
          if (matchesFilter(doc, filter)) return clone(doc);
        }
        return null;
      },
      async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
        for (const doc of store.docs.values()) {
          if (!matchesFilter(doc, filter)) continue;
          if (update.$set) {
            for (const [path, value] of Object.entries(update.$set as Record<string, unknown>)) {
              setPath(doc, path, value);
            }
          }
          if (update.$unset) {
            for (const path of Object.keys(update.$unset as Record<string, unknown>)) {
              const parts = path.split(".");
              let node: Doc = doc;
              for (let i = 0; i < parts.length - 1; i += 1) {
                node = node[parts[i]!] as Doc;
                if (!node) break;
              }
              if (node) delete node[parts[parts.length - 1]!];
            }
          }
          return { matchedCount: 1, modifiedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0 };
      },
      find(filter: Record<string, unknown> = {}) {
        const all = [...store.docs.values()].filter((doc) => matchesFilter(doc, filter));
        return {
          async toArray() {
            return all.map(clone);
          },
          limit(n: number) {
            return {
              async toArray() {
                return all.slice(0, n).map(clone);
              },
            };
          },
        };
      },
    };
  }

  const fake: FakeDb = {
    db: { collection: (name: string) => coll(name) } as unknown as Db,
    collections,
    faults,
    get auditInsertCalls() {
      return state.auditInsertCalls;
    },
    seed(collectionName: string, doc: Doc) {
      const c = coll(collectionName);
      c.docs.set(docKey(doc._id), clone(doc));
    },
    counts(collectionName: string) {
      const entry = collections.get(collectionName);
      return { docs: entry?.docs.size ?? 0, inserts: entry?.insertCount ?? 0 };
    },
  };
  return fake;
}

let fake: FakeDb;
beforeEach(() => {
  fake = createFakeDb();
  vi.clearAllMocks();
});

const CORP_ID = new ObjectId();
const ORDER_ID = new ObjectId();
const FILLER_ID = new ObjectId();
const PLACER_ID = new ObjectId();
const FUND_ID = new ObjectId();

function basePlan(overrides: Partial<ShareFillAuditPlan> = {}): ShareFillAuditPlan {
  return {
    version: 1,
    orderIdHex: ORDER_ID.toHexString(),
    corpIdHex: CORP_ID.toHexString(),
    corpCcy: "USD",
    orderType: "sell",
    shares: 10,
    pricePerShare: 5,
    totalAnchor: 50,
    turn: 7,
    nowIso: new Date("2026-01-01T00:00:00Z").toISOString(),
    preClaimRemaining: 10,
    filler: {
      idHex: FILLER_ID.toHexString(),
      collection: "characters",
      name: "Filler",
      homeCurrency: "USD",
      imperial: false,
    },
    fillerAmount: 50,
    placerKind: "character",
    placerIdHex: PLACER_ID.toHexString(),
    placerName: "Seller",
    sellerAmount: 50,
    sellerCurrency: "USD",
    fundTx: false,
    moneyCommitted: false,
    ...overrides,
  };
}

function fundSellPlan(): ShareFillAuditPlan {
  return basePlan({
    placerKind: "fund",
    placerIdHex: FUND_ID.toHexString(),
    placerName: "Market Fund",
    sellerAmount: undefined,
    sellerCurrency: undefined,
    fundTx: true,
  });
}

function buyPlan(): ShareFillAuditPlan {
  const plan = basePlan({ orderType: "buy", placerName: "Buyer" });
  delete plan.sellerAmount;
  delete plan.sellerCurrency;
  return plan;
}

function seedOrder(overrides: Record<string, unknown> = {}): ShareOrder {
  const order = {
    _id: ORDER_ID,
    corporationId: CORP_ID,
    type: "sell",
    shares: 10,
    sharesRemaining: 10,
    pricePerShare: 5,
    escrowAmount: 50,
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as ShareOrder;
  fake.seed("shareOrders", order as unknown as Doc);
  return order;
}

function seedReceipt(key: string, plan: ShareFillAuditPlan | undefined, extra: Doc = {}): void {
  fake.seed(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
    _id: key,
    status: "in_progress",
    fingerprint: "fp",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(plan === undefined ? {} : { shareFillPlan: plan }),
    ...extra,
  });
}

async function readReceipt(key: string): Promise<Doc | null> {
  return fake.db
    .collection<MoneyFlowReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION)
    .findOne({ _id: key }) as Promise<Doc | null>;
}

describe("route claim filter and pipeline", () => {
  it("requires an open order with enough shares remaining", () => {
    expect(buildShareFillClaimFilter(ORDER_ID, 40)).toEqual({
      _id: ORDER_ID,
      status: "open",
      sharesRemaining: { $gte: 40 },
    });
  });

  it("keeps a partial fill open and stamps the attempt key", () => {
    const now = new Date();
    const pipeline = buildShareFillRouteClaimPipeline({ shares: 40, fillKey: "key-1", now });
    const set = (pipeline[0] as { $set: Record<string, unknown> }).$set;
    expect(set.status).toEqual({
      $cond: [{ $eq: [{ $subtract: ["$sharesRemaining", 40] }, 0] }, "filled", "open"],
    });
    expect(set.lastShareFillKey).toBe("key-1");
    expect(set.updatedAt).toBe(now);
  });

  it("resolves a final fill to filled through the same conditional", () => {
    const pipeline = buildShareFillRouteClaimPipeline({
      shares: 100,
      fillKey: "key-2",
      now: new Date(),
    });
    const set = (pipeline[0] as { $set: Record<string, unknown> }).$set;
    expect(set.status).toEqual({
      $cond: [{ $eq: [{ $subtract: ["$sharesRemaining", 100] }, 0] }, "filled", "open"],
    });
    expect(set.sharesRemaining).toEqual({ $subtract: ["$sharesRemaining", 100] });
  });

  it("scales buy escrow with the remaining fraction", () => {
    const pipeline = buildShareFillRouteClaimPipeline({
      shares: 40,
      fillKey: "key-3",
      now: new Date(),
    });
    const set = (pipeline[0] as { $set: Record<string, unknown> }).$set;
    expect(set.escrowAmount).toEqual({
      $cond: [
        { $eq: ["$type", "buy"] },
        { $multiply: [{ $subtract: ["$sharesRemaining", 40] }, "$pricePerShare"] },
        "$escrowAmount",
      ],
    });
  });
});

describe("turn claim update", () => {
  it("leaves a partial market-sell fill open with remaining escrow", () => {
    const now = new Date();
    const update = buildShareFillTurnClaimUpdate({
      remainingShares: 60,
      remainingEscrowLocal: 588,
      remainingEscrowAnchor: 294,
      status: "open",
      fillKey: "turn-key-1",
      now,
    });
    expect(update).toEqual({
      $set: {
        sharesRemaining: 60,
        escrowAmount: 588,
        escrowAnchor: 294,
        status: "open",
        lastShareFillKey: "turn-key-1",
        updatedAt: now,
      },
    });
  });

  it("marks a final market-sell fill filled at zero remaining", () => {
    const update = buildShareFillTurnClaimUpdate({
      remainingShares: 0,
      remainingEscrowLocal: 0,
      remainingEscrowAnchor: 0,
      status: "filled",
      fillKey: "turn-key-2",
      now: new Date(),
    });
    expect(update.$set.status).toBe("filled");
    expect(update.$set.sharesRemaining).toBe(0);
    expect(update.$set.lastShareFillKey).toBe("turn-key-2");
  });
});

describe("fingerprints and deterministic ids", () => {
  const input = { orderId: ORDER_ID, fillerId: FILLER_ID, shares: 10, pricePerShare: 5 };

  it("is stable for the same attempt", () => {
    expect(buildShareFillFingerprint(input)).toBe(buildShareFillFingerprint(input));
  });

  it("separates shares, price, filler, and order", () => {
    const base = buildShareFillFingerprint(input);
    expect(buildShareFillFingerprint({ ...input, shares: 11 })).not.toBe(base);
    expect(buildShareFillFingerprint({ ...input, pricePerShare: 6 })).not.toBe(base);
    expect(buildShareFillFingerprint({ ...input, fillerId: new ObjectId() })).not.toBe(base);
    expect(buildShareFillFingerprint({ ...input, orderId: new ObjectId() })).not.toBe(base);
  });

  it("derives stable per-domain insert ids that separate keys and domains", () => {
    const key = "attempt-key";
    expect(
      keyedInsertId(key, SHARE_FILL_TX_BUY_DOMAIN).equals(
        keyedInsertId(key, SHARE_FILL_TX_BUY_DOMAIN)
      )
    ).toBe(true);
    expect(
      keyedInsertId(key, SHARE_FILL_TX_BUY_DOMAIN).equals(
        keyedInsertId(key, SHARE_FILL_TX_SELL_DOMAIN)
      )
    ).toBe(false);
    expect(
      keyedInsertId(key, SHARE_FILL_HISTORY_DOMAIN).equals(
        keyedInsertId("other-key", SHARE_FILL_HISTORY_DOMAIN)
      )
    ).toBe(false);
    expect(
      keyedInsertId(key, SHARE_FILL_FUND_TX_DOMAIN).equals(
        keyedInsertId(key, SHARE_FILL_FUND_TX_DOMAIN)
      )
    ).toBe(true);
  });
});

describe("attempt lifecycle and key contract", () => {
  it("begins an attempt with the plan stored, marks money committed, settles completed", async () => {
    const plan = basePlan();
    const key = await beginShareFillAttempt(
      fake.db,
      plan,
      buildShareFillFingerprint({
        orderId: ORDER_ID,
        fillerId: FILLER_ID,
        shares: 10,
        pricePerShare: 5,
      })
    );
    expect(typeof key).toBe("string");
    let receipt = await readReceipt(key);
    expect(receipt?.status).toBe("in_progress");

    await markShareFillMoneyCommitted(fake.db, key, 123.5);
    receipt = await readReceipt(key);
    expect((receipt?.shareFillPlan as Doc)?.moneyCommitted).toBe(true);
    expect((receipt?.shareFillPlan as Doc)?.fillerBalanceAfter).toBe(123.5);

    await settleShareFillAttempt(fake.db, key, "completed");
    receipt = await readReceipt(key);
    expect(receipt?.status).toBe("completed");
  });

  it("fails closed on key reuse with a different fingerprint", async () => {
    const receipts = fake.db.collection(
      NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION
    ) as unknown as Collection<MoneyFlowReceipt>;
    expect(await claimMoneyFlowReceipt(receipts, "reuse-key", "fp-a")).toBe("fresh");
    await expect(claimMoneyFlowReceipt(receipts, "reuse-key", "fp-b")).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
  });

  it("reports in-progress for a same-key retry and terminal for a settled key", async () => {
    const receipts = fake.db.collection(
      NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION
    ) as unknown as Collection<MoneyFlowReceipt>;
    expect(await claimMoneyFlowReceipt(receipts, "retry-key", "fp")).toBe("fresh");
    expect(await claimMoneyFlowReceipt(receipts, "retry-key", "fp")).toBe("in-progress");
    await settleShareFillAttempt(fake.db, "retry-key", "failed", "boom");
    await expect(claimMoneyFlowReceipt(receipts, "retry-key", "fp")).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });
});

describe("audit rows per placer variant", () => {
  it("writes seller proceeds and filler cost for a sell fill against a character", async () => {
    const rows = collectShareFillAuditRows(basePlan());
    expect(rows.txs).toHaveLength(2);
    expect(rows.txDomains).toEqual([SHARE_FILL_TX_SELL_DOMAIN, SHARE_FILL_TX_BUY_DOMAIN]);
    expect(rows.txs[0]).toMatchObject({
      type: "stock_trade_sell",
      subjectType: "character",
      subjectId: PLACER_ID,
      amount: 50,
      currencyCode: "USD",
    });
    expect(rows.txs[1]).toMatchObject({
      type: "stock_trade_buy",
      subjectType: "character",
      subjectId: FILLER_ID,
      amount: -50,
      currencyCode: "USD",
    });
    expect(rows.fundTx).toBeNull();
    expect(rows.history).toMatchObject({ kind: "peer_fill", shares: 10 });

    const outcome = await insertShareFillAuditRows(fake.db, "variant-sell-char", rows);
    expect(outcome).toBe("applied");
    expect(fake.counts("financialTxLog").docs).toBe(2);
    expect(fake.counts("indexFundTransactions").docs).toBe(0);
    expect(fake.counts("shareTradeHistory").docs).toBe(1);
  });

  it("writes no seller tx and a fund-transaction row for a sell fill against a fund", async () => {
    const rows = collectShareFillAuditRows(fundSellPlan());
    expect(rows.txs).toHaveLength(1);
    expect(rows.txDomains).toEqual([SHARE_FILL_TX_BUY_DOMAIN]);
    expect(rows.txs[0]).toMatchObject({
      type: "stock_trade_buy",
      subjectId: FILLER_ID,
      amount: -50,
    });
    expect(rows.fundTx).toMatchObject({
      fundId: FUND_ID,
      kind: "liquidity_quote_sell",
      corporationId: CORP_ID,
      shares: 10,
      amountAnchor: 50,
    });
    expect(rows.history.to).toMatchObject({ name: "Filler" });

    const outcome = await insertShareFillAuditRows(fake.db, "variant-sell-fund", rows);
    expect(outcome).toBe("applied");
    expect(fake.counts("financialTxLog").docs).toBe(1);
    expect(fake.counts("indexFundTransactions").docs).toBe(1);
    expect(fake.counts("shareTradeHistory").docs).toBe(1);
  });

  it("writes a single seller-proceeds row for a buy fill with a corporation filler", async () => {
    const plan = buyPlan();
    plan.filler = {
      idHex: PLACER_ID.toHexString(),
      collection: "corporations",
      name: "Buyer Corp",
      homeCurrency: "USD",
      imperial: false,
    };
    const rows = collectShareFillAuditRows(plan);
    expect(rows.txs).toHaveLength(1);
    expect(rows.txDomains).toEqual([SHARE_FILL_TX_SELL_DOMAIN]);
    expect(rows.txs[0]).toMatchObject({
      type: "stock_trade_sell",
      subjectType: "corporation",
      amount: 50,
    });
    expect(rows.fundTx).toBeNull();

    const outcome = await insertShareFillAuditRows(fake.db, "variant-buy-corp", rows);
    expect(outcome).toBe("applied");
    expect(fake.counts("financialTxLog").docs).toBe(1);
    expect(fake.counts("shareTradeHistory").docs).toBe(1);
  });

  it("pins the filler balance-after on the buyer row after the money commit", async () => {
    const plan = basePlan();
    const key = await beginShareFillAttempt(
      fake.db,
      plan,
      buildShareFillFingerprint({
        orderId: ORDER_ID,
        fillerId: FILLER_ID,
        shares: 10,
        pricePerShare: 5,
      })
    );
    await markShareFillMoneyCommitted(fake.db, key, 910.25);
    const stored = (await readReceipt(key))?.shareFillPlan as ShareFillAuditPlan;
    const outcome = await insertShareFillAuditRows(
      fake.db,
      key,
      collectShareFillAuditRows({ ...plan, fillerBalanceAfter: stored.fillerBalanceAfter })
    );
    expect(outcome).toBe("applied");
    const txDocs = [...(fake.collections.get("financialTxLog")?.docs.values() ?? [])];
    const buyerRow = txDocs.find((d) => d.type === "stock_trade_buy");
    expect(buyerRow?.balanceAfter).toBe(910.25);
  });
});

describe("retry convergence: no double audit", () => {
  it.each([
    ["sell-vs-character", basePlan()],
    ["sell-vs-fund", fundSellPlan()],
    ["buy-vs-character", buyPlan()],
  ])("converges a full retry for %s without duplicating rows", async (_name, plan) => {
    const key = `converge-${(_name as string).replace(/[^a-z-]/g, "")}`;
    const rows = collectShareFillAuditRows(plan);
    expect(await insertShareFillAuditRows(fake.db, key, rows)).toBe("applied");
    const before = {
      tx: fake.counts("financialTxLog").docs,
      fund: fake.counts("indexFundTransactions").docs,
      history: fake.counts("shareTradeHistory").docs,
    };
    expect(await insertShareFillAuditRows(fake.db, key, rows)).toBe("already-applied");
    expect(fake.counts("financialTxLog").docs).toBe(before.tx);
    expect(fake.counts("indexFundTransactions").docs).toBe(before.fund);
    expect(fake.counts("shareTradeHistory").docs).toBe(before.history);
  });
});

describe("crash after every audit write", () => {
  const variants: [string, () => ShareFillAuditPlan, { tx: number; fund: number }][] = [
    ["sell-vs-character", basePlan, { tx: 2, fund: 0 }],
    ["sell-vs-fund", fundSellPlan, { tx: 1, fund: 1 }],
    ["buy-vs-character", buyPlan, { tx: 1, fund: 0 }],
  ];

  it.each(variants)(
    "recovers %s with exactly the planned rows and no duplicates",
    async (_name, makePlan, expected) => {
      const totalWrites = expected.tx + expected.fund + 1;
      for (let crashAt = 1; crashAt <= totalWrites; crashAt += 1) {
        const attempt = createFakeDb();
        const plan = makePlan();
        const orderId = new ObjectId();
        const key = `crash-${(_name as string).replace(/[^a-z-]/g, "")}-${crashAt}`;
        plan.orderIdHex = orderId.toHexString();
        plan.preClaimRemaining = 10;
        attempt.seed("shareOrders", {
          _id: orderId,
          status: "open",
          sharesRemaining: 0,
        });
        attempt.seed(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
          _id: key,
          status: "in_progress",
          fingerprint: "fp",
          createdAt: new Date(),
          updatedAt: new Date(),
          shareFillPlan: { ...plan, moneyCommitted: true, fillerBalanceAfter: 100 },
        });
        const realDb = attempt.db;
        const failing = attempt;
        failing.faults.failAtAuditInsertIndex = crashAt;
        const outcome = await insertShareFillAuditRows(
          realDb,
          key,
          collectShareFillAuditRows({ ...plan, moneyCommitted: true, fillerBalanceAfter: 100 })
        );
        expect(outcome).toBe("failed");
        expect(attempt.counts("financialTxLog").docs).toBe(Math.min(crashAt - 1, expected.tx));

        failing.faults.failAtAuditInsertIndex = null;
        const recovery = await recoverShareFillAttempt(realDb, key);
        expect(recovery).toEqual({ key, action: "audit-recovered" });
        expect(attempt.counts("financialTxLog").docs).toBe(expected.tx);
        expect(attempt.counts("indexFundTransactions").docs).toBe(expected.fund);
        expect(attempt.counts("shareTradeHistory").docs).toBe(1);
        const receipt = (await realDb
          .collection<MoneyFlowReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION)
          .findOne({ _id: key })) as Doc | null;
        expect(receipt?.status).toBe("completed");

        const again = await recoverShareFillAttempt(realDb, key);
        expect(again).toEqual({ key, action: "skipped-settled" });
        expect(attempt.counts("financialTxLog").docs).toBe(expected.tx);
      }
    }
  );
});

describe("recovery boundaries", () => {
  it("skips a receipt that never existed", async () => {
    await expect(recoverShareFillAttempt(fake.db, "ghost-key")).resolves.toEqual({
      key: "ghost-key",
      action: "skipped-missing",
    });
  });

  it("settles failed when the plan was never stored", async () => {
    seedOrder();
    seedReceipt("no-plan-key", undefined);
    await expect(recoverShareFillAttempt(fake.db, "no-plan-key")).resolves.toEqual({
      key: "no-plan-key",
      action: "settled-failed-no-plan",
    });
    expect((await readReceipt("no-plan-key"))?.status).toBe("failed");
  });

  it("settles failed on a malformed plan instead of guessing", async () => {
    seedOrder();
    fake.seed(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "malformed-key",
      status: "in_progress",
      fingerprint: "fp",
      createdAt: new Date(),
      updatedAt: new Date(),
      shareFillPlan: { version: 999 },
    });
    await expect(recoverShareFillAttempt(fake.db, "malformed-key")).resolves.toEqual({
      key: "malformed-key",
      action: "settled-failed-no-plan",
    });
  });

  it("settles failed when the order is gone", async () => {
    seedReceipt("order-gone-key", basePlan());
    await expect(recoverShareFillAttempt(fake.db, "order-gone-key")).resolves.toEqual({
      key: "order-gone-key",
      action: "settled-failed-order-missing",
    });
  });

  it("settles failed when the claim provably never landed", async () => {
    seedOrder({ sharesRemaining: 10 });
    seedReceipt("claim-never-landed-key", basePlan({ preClaimRemaining: 10 }));
    await expect(recoverShareFillAttempt(fake.db, "claim-never-landed-key")).resolves.toEqual({
      key: "claim-never-landed-key",
      action: "settled-failed-claim-never-landed",
    });
    expect((await readReceipt("claim-never-landed-key"))?.status).toBe("failed");
  });

  it("stays in_progress when the claim landed but money is unproven", async () => {
    seedOrder({ sharesRemaining: 0 });
    seedReceipt("uncommitted-key", basePlan({ preClaimRemaining: 10 }));
    await expect(recoverShareFillAttempt(fake.db, "uncommitted-key")).resolves.toEqual({
      key: "uncommitted-key",
      action: "left-in-progress-uncommitted",
    });
    expect((await readReceipt("uncommitted-key"))?.status).toBe("in_progress");
    expect(fake.counts("financialTxLog").docs).toBe(0);
  });

  it("recovers committed audit and reports already-complete when rows exist", async () => {
    seedOrder({ sharesRemaining: 0 });
    const plan = { ...basePlan(), moneyCommitted: true, fillerBalanceAfter: 100 };
    seedReceipt("committed-key", plan);
    await expect(recoverShareFillAttempt(fake.db, "committed-key")).resolves.toEqual({
      key: "committed-key",
      action: "audit-recovered",
    });
    await expect(recoverShareFillAttempt(fake.db, "committed-key")).resolves.toEqual({
      key: "committed-key",
      action: "skipped-settled",
    });
  });

  it("reports audit-already-complete when a replay converged before the settle", async () => {
    seedOrder({ sharesRemaining: 0 });
    const plan = { ...basePlan(), moneyCommitted: true, fillerBalanceAfter: 100 };
    seedReceipt("preconverged-key", plan);
    expect(
      await insertShareFillAuditRows(fake.db, "preconverged-key", collectShareFillAuditRows(plan))
    ).toBe("applied");
    await expect(recoverShareFillAttempt(fake.db, "preconverged-key")).resolves.toEqual({
      key: "preconverged-key",
      action: "audit-already-complete",
    });
  });

  it("leaves the receipt in_progress when audit inserts keep failing", async () => {
    seedOrder({ sharesRemaining: 0 });
    seedReceipt("audit-down-key", { ...basePlan(), moneyCommitted: true, fillerBalanceAfter: 100 });
    fake.faults.failAuditInsertsRemaining = 100;
    await expect(recoverShareFillAttempt(fake.db, "audit-down-key")).resolves.toEqual({
      key: "audit-down-key",
      action: "audit-incomplete",
    });
    expect((await readReceipt("audit-down-key"))?.status).toBe("in_progress");
  });

  it("skips an already-settled receipt without touching audit", async () => {
    seedOrder({ sharesRemaining: 0 });
    seedReceipt("settled-key", basePlan(), { status: "completed" });
    await expect(recoverShareFillAttempt(fake.db, "settled-key")).resolves.toEqual({
      key: "settled-key",
      action: "skipped-settled",
    });
    expect(fake.counts("financialTxLog").docs).toBe(0);
  });
});

describe("stranded legacy claim repair", () => {
  it("reopens a legacy stuck filled order that still has shares remaining", async () => {
    const order = seedOrder({ status: "filled", sharesRemaining: 40 });
    await expect(repairStrandedShareFillClaim(fake.db, order)).resolves.toBe(true);
    const stored = (await fake.db
      .collection("shareOrders")
      .findOne({ _id: ORDER_ID })) as Doc | null;
    expect(stored?.status).toBe("open");
  });

  it("leaves full fills and open orders alone", async () => {
    const filled = seedOrder({ status: "filled", sharesRemaining: 0 });
    await expect(repairStrandedShareFillClaim(fake.db, filled)).resolves.toBe(false);
    const openId = new ObjectId();
    fake.seed("shareOrders", { _id: openId, status: "open", sharesRemaining: 40 });
    const open = (await fake.db.collection("shareOrders").findOne({ _id: openId })) as ShareOrder;
    await expect(repairStrandedShareFillClaim(fake.db, open)).resolves.toBe(false);
  });

  it("prepareShareFillClaim repairs the strand and recovers the stamped attempt", async () => {
    const plan = { ...basePlan(), moneyCommitted: true, fillerBalanceAfter: 100 };
    const stranded = seedOrder({
      status: "filled",
      sharesRemaining: 0,
      lastShareFillKey: "stamped-key",
    });
    seedReceipt("stamped-key", { ...plan, preClaimRemaining: 10 });
    const prepared = await prepareShareFillClaim(fake.db, {
      ...stranded,
      status: "filled",
      sharesRemaining: 5,
    });
    expect(prepared.repaired).toBe(true);
    expect(prepared.order.status).toBe("open");
    expect(prepared.recovery).toEqual({ key: "stamped-key", action: "audit-recovered" });
  });
});

describe("orphan scan", () => {
  it("recovers every stuck receipt within a bounded limit", async () => {
    const keys: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const orderId = new ObjectId();
      const key = `orphan-${i}`;
      keys.push(key);
      const plan = basePlan({ orderIdHex: orderId.toHexString(), preClaimRemaining: 10 });
      fake.seed("shareOrders", { _id: orderId, status: "filled", sharesRemaining: 0 });
      seedReceipt(key, { ...plan, moneyCommitted: true, fillerBalanceAfter: 100 });
    }
    seedReceipt("orphan-uncommitted", basePlan({ preClaimRemaining: 10 }));
    fake.seed("shareOrders", { _id: ORDER_ID, status: "open", sharesRemaining: 0 });

    const results = await recoverShareFillOrphans(fake.db, 2);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.action)).toEqual(["audit-recovered", "audit-recovered"]);
    const remaining = await recoverShareFillOrphans(fake.db, 50);
    expect(remaining.map((r) => r.key).sort()).toEqual([keys[2], "orphan-uncommitted"].sort());
    expect(remaining.find((r) => r.key === "orphan-uncommitted")?.action).toBe(
      "left-in-progress-uncommitted"
    );
  });

  it("settles a claim-before-plan receipt failed without touching the order", async () => {
    // The claim insert landed but the plan store crashed, so the order
    // claim never ran: the receipt carries no plan and no order stamps
    // this key. Failing is truthful and the order is untouched.
    const order = seedOrder({ sharesRemaining: 10 });
    fake.seed(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "claim-before-plan",
      status: "in_progress",
      fingerprint: "share-fill:order:filler:shares:10:price:5",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Foreign-domain plan-less receipts (other flows, money legs) stay out.
    for (const [id, fingerprint] of [
      ["bond-planless", "bond-payoff:corp:100"],
      ["money-planless", "share-fill-money:corp:order:sell-fill:shares:10"],
    ] as const) {
      fake.seed(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
        _id: id,
        status: "in_progress",
        fingerprint,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const results = await recoverShareFillOrphans(fake.db, 50);
    expect(results).toEqual([{ key: "claim-before-plan", action: "settled-failed-no-plan" }]);
    expect((await readReceipt("claim-before-plan"))?.status).toBe("failed");
    expect((await readReceipt("bond-planless"))?.status).toBe("in_progress");
    expect((await readReceipt("money-planless"))?.status).toBe("in_progress");
    const stored = (await fake.db
      .collection("shareOrders")
      .findOne({ _id: ORDER_ID })) as Doc | null;
    expect(stored?.sharesRemaining).toBe(order.sharesRemaining);
    expect(stored?.status).toBe("open");
    expect(fake.counts("financialTxLog").docs).toBe(0);
  });
});

describe("orphan scan fairness", () => {
  it("reaches committed receipts stranded behind persistent uncommitted ones", async () => {
    // Starvation regression (issue #1672): uncommitted receipts never settle,
    // so a head-of-queue scan burns its whole budget on them and never reaches
    // later receipts. Committed plans are visited first, so one bounded pass
    // still recovers the actionable tail.
    for (let i = 0; i < 55; i += 1) {
      const orderId = new ObjectId();
      fake.seed("shareOrders", { _id: orderId, status: "filled", sharesRemaining: 0 });
      seedReceipt(
        `stuck-uncommitted-${i}`,
        basePlan({ orderIdHex: orderId.toHexString(), preClaimRemaining: 10 })
      );
    }
    const committedKeys: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const orderId = new ObjectId();
      const key = `late-committed-${i}`;
      committedKeys.push(key);
      fake.seed("shareOrders", { _id: orderId, status: "filled", sharesRemaining: 0 });
      seedReceipt(
        key,
        basePlan({
          orderIdHex: orderId.toHexString(),
          preClaimRemaining: 10,
          moneyCommitted: true,
          fillerBalanceAfter: 100,
        })
      );
    }

    const results = await recoverShareFillOrphans(fake.db, 50);
    expect(results).toHaveLength(50);
    const recovered = results.filter((r) => r.action === "audit-recovered").map((r) => r.key);
    expect(recovered.sort()).toEqual(committedKeys.sort());
    for (const key of committedKeys) {
      expect((await readReceipt(key))?.status).toBe("completed");
    }
    expect((await readReceipt("stuck-uncommitted-0"))?.status).toBe("in_progress");
  });

  it("drains more committed receipts than one pass budget across passes", async () => {
    const keys: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      const orderId = new ObjectId();
      const key = `drain-${i}`;
      keys.push(key);
      fake.seed("shareOrders", { _id: orderId, status: "filled", sharesRemaining: 0 });
      seedReceipt(
        key,
        basePlan({
          orderIdHex: orderId.toHexString(),
          preClaimRemaining: 10,
          moneyCommitted: true,
          fillerBalanceAfter: 100,
        })
      );
    }

    const first = await recoverShareFillOrphans(fake.db, 50);
    expect(first).toHaveLength(50);
    expect(first.every((r) => r.action === "audit-recovered")).toBe(true);
    const second = await recoverShareFillOrphans(fake.db, 50);
    expect(second.map((r) => r.key).sort()).toEqual(keys.slice(50).sort());
    expect(second.every((r) => r.action === "audit-recovered")).toBe(true);
    const third = await recoverShareFillOrphans(fake.db, 50);
    expect(third).toHaveLength(0);
  });
});

describe("recovery pass driver", () => {
  it("summarizes a mixed pass and settles provably-dead uncommitted claims", async () => {
    const goodOrderId = new ObjectId();
    fake.seed("shareOrders", { _id: goodOrderId, status: "filled", sharesRemaining: 0 });
    seedReceipt(
      "pass-committed",
      basePlan({
        orderIdHex: goodOrderId.toHexString(),
        preClaimRemaining: 10,
        moneyCommitted: true,
        fillerBalanceAfter: 100,
      })
    );
    // Claim never landed and money never moved: truthful `failed` settlement.
    seedOrder({ sharesRemaining: 10 });
    seedReceipt("pass-dead", basePlan({ preClaimRemaining: 10 }));

    const summary = await runShareFillRecoveryPass(fake.db);
    expect(summary.status).toBe("completed");
    expect(summary.examined).toBe(2);
    expect(summary.recovered).toBe(1);
    expect(summary.settledFailed).toBe(1);
    expect((await readReceipt("pass-committed"))?.status).toBe("completed");
    expect((await readReceipt("pass-dead"))?.status).toBe("failed");
  });

  it("collapses a concurrent invocation instead of running twice", async () => {
    const first = runShareFillRecoveryPass(fake.db);
    const second = runShareFillRecoveryPass(fake.db);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.status).toBe("completed");
    expect(secondResult.status).toBe("skipped-concurrent");
    expect(secondResult.examined).toBe(0);
  });

  it("reports failed without throwing and without leaking plan contents", async () => {
    const broken = {
      collection: () => {
        throw new Error("no-database-here");
      },
    } as unknown as Db;
    const summary = await runShareFillRecoveryPass(broken);
    expect(summary.status).toBe("failed");
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(captureExceptionMock.mock.calls[0]);
    expect(payload).not.toContain("Filler");
    expect(payload).not.toContain("Seller");
  });
});

describe("turn matcher orphan scan removed", () => {
  it("leaves a lonely committed orphan for the periodic driver", async () => {
    // The turn matcher must not scan receipts (query-per-row N+1 on the turn
    // path, issue #1672). Lonely orphans stay `in_progress` through the
    // matcher; the periodic `runShareFillRecoveryPass` driver recovers them.
    const { fillPendingShareOrders } = await import("@/lib/turn/corporation/shareOrders");
    const orderId = new ObjectId();
    const key = "lonely-orphan";
    const plan = basePlan({ orderIdHex: orderId.toHexString(), preClaimRemaining: 10 });
    fake.seed("shareOrders", { _id: orderId, status: "filled", sharesRemaining: 0 });
    seedReceipt(key, { ...plan, moneyCommitted: true, fillerBalanceAfter: 100 });

    await fillPendingShareOrders(fake.db, new Date("2026-01-02T00:00:00Z"), 8);
    expect((await readReceipt(key))?.status).toBe("in_progress");
    expect(fake.counts("financialTxLog").docs).toBe(0);
    expect(fake.counts("shareTradeHistory").docs).toBe(0);

    const summary = await runShareFillRecoveryPass(fake.db);
    expect(summary.status).toBe("completed");
    expect(summary.recovered).toBe(1);
    expect((await readReceipt(key))?.status).toBe("completed");
    expect(fake.counts("financialTxLog").docs).toBe(2);
    expect(fake.counts("shareTradeHistory").docs).toBe(1);
  });
});
