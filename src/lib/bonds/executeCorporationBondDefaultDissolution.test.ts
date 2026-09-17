import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

/**
 * Ledger-shape tests for executeCorporationBondDefaultDissolution (#3237):
 *   - a bond-less insolvency wind-down must NOT emit a "bond_default" ledger
 *     row (those were the misleading amount-0 "Bond default settlement"
 *     entries flooding the 1953 sims);
 *   - a real bond default emits exactly one bond_default row whose amount
 *     mirrors the bondholder payouts, so the liquidation legs sum to zero.
 *
 * The settlement math (previewDissolveSettlement / allocateShareholderPool)
 * is intentionally left REAL — conservation is the point of the test. All
 * side-effecting collaborators are stubbed.
 */

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/currency/characterFunds", () => ({
  buildPersonalBalanceInc: (amt: number) => ({ cashOnHand: amt }),
  getHomeCurrency: () => "USD",
}));
vi.mock("@/lib/centralBank/helpers", () => ({
  getBankId: () => "cb-US",
  buildPrimeRateByCountry: () => new Map(),
}));
vi.mock("@/lib/currency/govBudgetFields", () => ({
  writeGovBudgetLocal: (v: number) => v,
}));
vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCorporations: vi.fn().mockResolvedValue(undefined),
  cleanupShareMarketActivityForCorporationTargets: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineCorpDissolved: () => "",
}));
vi.mock("@/lib/api/errors", () => ({
  badRequest: (m: string) => new Error(m),
}));
vi.mock("@/lib/corporations/releaseHeldSharesToFloat", () => ({
  releaseCorporationHeldSharesToFloat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/corporations/distributeCrossEquityInKind", () => ({
  distributeCrossEquityInKind: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/corporations/restoreSectorsToUnowned", () => ({
  restoreSectorsToUnowned: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/financialTxLog/stampDeleted", () => ({
  stampSubjectDeleted: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn().mockResolvedValue(251),
}));
// Force the standalone (non-atomic) path: the keyed flow is what makes the
// dissolution crash-safe there, so these tests run the REAL
// bondDissolutionSpend primitive against the stateful fakes below instead of
// mocking it away.
vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn().mockResolvedValue(false),
}));

import { emitTxBulk } from "@/lib/financialTxLog/emit";
import {
  executeCorporationBondDefaultDissolution,
  bondDissolutionKeyForVote,
  bondDissolutionKeyForCascade,
  bondDissolutionKeyForNpp,
} from "./executeCorporationBondDefaultDissolution";
import type { Corporation, Bond } from "@/lib/db/types";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
} from "@/lib/db/nonAtomicMoneyFlow";

function mkCursor(docs: unknown[]) {
  const cursor = {
    project: () => cursor,
    sort: () => cursor,
    toArray: async () => docs,
  };
  return cursor;
}

function docKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id instanceof ObjectId) return id.toHexString();
  return String(id);
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (actual instanceof ObjectId && expected instanceof ObjectId) return actual.equals(expected);
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

function applyTestUpdate(doc: Record<string, unknown>, update: Record<string, unknown>): void {
  for (const [path, delta] of Object.entries(update.$inc ?? {})) {
    setPath(doc, path, ((getPath(doc, path) as number) ?? 0) + (delta as number));
  }
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    setPath(doc, path, value);
  }
  const push = update.$push as Record<string, { $each: unknown[]; $slice: number }> | undefined;
  if (push?.appliedMoneyFlowKeys) {
    const keys = (doc.appliedMoneyFlowKeys ?? []) as unknown[];
    keys.push(...push.appliedMoneyFlowKeys.$each);
    doc.appliedMoneyFlowKeys = keys.slice(push.appliedMoneyFlowKeys.$slice);
  }
  const pull = update.$pull as
    | { holdings: { corporationId: unknown } }
    | undefined;
  if (pull?.holdings) {
    const holdings = (doc.holdings ?? []) as Record<string, unknown>[];
    doc.holdings = holdings.filter(
      (h) => !valueEquals(h.corporationId, pull.holdings.corporationId)
    );
  }
}

/**
 * Stateful in-memory collection honoring exactly the operators the keyed
 * dissolution flow emits: `_id` + `$ne`-on-keys guarded `updateOne` ($inc
 * with dotted balance fields, $set, key-record $push, holdings $pull),
 * `findOne` by `_id`, and `insertOne` with duplicate-key errors — so the
 * REAL primitive runs here with real receipt semantics.
 */
function makeKeyedCollection(seedDocs: Record<string, unknown>[] = []) {
  const store = new Map<string, Record<string, unknown>>();
  for (const seed of seedDocs) {
    store.set(docKey(seed._id), {
      ...seed,
      appliedMoneyFlowKeys: [...((seed.appliedMoneyFlowKeys as unknown[] | undefined) ?? [])],
    });
  }
  const updateOne = vi.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    const doc = store.get(docKey(filter._id));
    const guard = filter.appliedMoneyFlowKeys as { $ne?: string } | undefined;
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    if (guard?.$ne !== undefined && (doc.appliedMoneyFlowKeys as string[]).includes(guard.$ne)) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    applyTestUpdate(doc, update);
    return { matchedCount: 1, modifiedCount: 1 };
  });
  const findOne = vi.fn(async (filter: Record<string, unknown>) => {
    if (filter._id === undefined) return null;
    return store.get(docKey(filter._id)) ?? null;
  });
  const insertOne = vi.fn(async (doc: Record<string, unknown>) => {
    const key = docKey(doc._id);
    if (store.has(key)) {
      throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
    }
    store.set(key, { ...doc, appliedMoneyFlowKeys: [...((doc.appliedMoneyFlowKeys as unknown[] | undefined) ?? [])] });
    return { insertedId: doc._id };
  });
  return { updateOne, findOne, insertOne, __store: store };
}

type KeyedCollection = ReturnType<typeof makeKeyedCollection>;

function readStore(db: Db, name: string): Map<string, Record<string, unknown>> {
  return (db.collection(name) as unknown as KeyedCollection).__store;
}

function makeDb(opts: {
  corp: Record<string, unknown>;
  issuerBonds: Record<string, unknown>[];
  characters?: Record<string, unknown>[];
  imperials?: Record<string, unknown>[];
  extraCorps?: Record<string, unknown>[];
  centralBanks?: Record<string, unknown>[];
  indexFunds?: Record<string, unknown>[];
  pools?: Record<string, unknown>[];
}) {
  const { corp, issuerBonds } = opts;
  const characters = makeKeyedCollection(
    opts.characters ?? [{ _id: CHAR_ID, name: "Holder", countryId: "US", cashOnHand: 0 }]
  );
  const imperials = makeKeyedCollection(opts.imperials ?? []);
  const corporations = makeKeyedCollection([corp, ...(opts.extraCorps ?? [])]);
  const centralBanks = makeKeyedCollection(opts.centralBanks ?? []);
  const indexFunds = makeKeyedCollection(opts.indexFunds ?? []);
  const pools = makeKeyedCollection(opts.pools ?? []);
  const receipts = makeKeyedCollection([]);
  const charDocs = [...characters.__store.values()].map((d) => ({
    _id: d._id,
    name: (d.name as string) ?? "Holder",
    countryId: (d.countryId as string) ?? "US",
  }));
  const imperialDocs = [...imperials.__store.values()].map((d) => ({
    _id: d._id,
    name: (d.name as string) ?? "Imperial holder",
    countryId: (d.countryId as string) ?? "US",
  }));
  const corpDocs = [...corporations.__store.values()]
    .filter((d) => d._id !== corp._id)
    .map((d) => ({
      _id: d._id,
      name: (d.name as string) ?? "Corp holder",
      liquidCurrencyCode: d.liquidCurrencyCode,
      countryId: (d.countryId as string) ?? "US",
    }));
  const collections: Record<string, unknown> = {
    bonds: {
      find: (q: Record<string, unknown>) =>
        mkCursor("holders.corporationId" in q ? [] : issuerBonds),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      deleteMany: vi.fn().mockResolvedValue({}),
    },
    corporations: {
      ...corporations,
      // Equity-shareholder lookup ({ _id: { $in } }) serves every corp
      // except the dissolving one.
      find: (q: Record<string, unknown>) => {
        const inIds = (q._id as { $in?: unknown[] } | undefined)?.$in;
        const docs = inIds
          ? corpDocs.filter((d) => inIds.some((id) => valueEquals(id, d._id)))
          : corpDocs;
        return mkCursor(docs);
      },
      bulkWrite: vi.fn().mockResolvedValue({}),
      deleteOne: vi.fn(async (filter: Record<string, unknown>) => {
        const existed = corporations.__store.delete(docKey(filter._id));
        return { deletedCount: existed ? 1 : 0 };
      }),
    },
    corporateSectors: { find: () => mkCursor([]) },
    centralBanks: {
      ...centralBanks,
      find: () => mkCursor([]),
    },
    exchangeRates: { find: () => mkCursor([]) },
    bondHistory: { deleteMany: vi.fn().mockResolvedValue({}) },
    characters: {
      ...characters,
      find: () => mkCursor(charDocs),
    },
    imperialCharacters: {
      ...imperials,
      find: () => mkCursor(imperialDocs),
    },
    // Market tier resolution (D11 book-vs-NPV settlement basis). Absent doc ⇒
    // mode "off", i.e. the legacy NPV path these assertions were written for.
    gameConfig: {
      findOne: vi.fn().mockResolvedValue(null),
    },
    indexFunds,
    bondMarketPools: pools,
    nonAtomicMoneyFlowReceipts: receipts,
  };
  return {
    collection: (name: string) => {
      const c = collections[name];
      if (!c) throw new Error(`unexpected collection in test: ${name}`);
      return c;
    },
  } as unknown as Db;
}

const CHAR_ID = new ObjectId();

function baseCorp(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    name: "Doomed Corp",
    countryId: "US",
    liquidCapital: 500_000,
    totalShares: 100,
    shareholders: [],
    ...overrides,
  } as unknown as Corporation;
}

function emittedEntries(): Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] {
  const calls = vi.mocked(emitTxBulk).mock.calls;
  return calls.flatMap((c) => c[1] as Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[]);
}

describe("executeCorporationBondDefaultDissolution ledger rows (#3237)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not finish the dissolution before its ledger-bearing transaction batch", async () => {
    let releaseTxBatch: (() => void) | undefined;
    vi.mocked(emitTxBulk).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseTxBatch = resolve;
        })
    );
    const corp = baseCorp({
      shareholders: [{ characterId: CHAR_ID, shares: 100 }],
    });
    const db = makeDb({ corp: corp as unknown as Record<string, unknown>, issuerBonds: [] });

    let settled = false;
    const dissolution = executeCorporationBondDefaultDissolution(db, corp, {
      requireDefaultedBonds: false,
    }).then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(releaseTxBatch).toBeTypeOf("function"));
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseTxBatch!();
    await dissolution;
    expect(settled).toBe(true);
  });

  it("bond-less insolvency wind-down emits NO bond_default row (no amount-0 noise)", async () => {
    const corp = baseCorp({
      shareholders: [{ characterId: CHAR_ID, shares: 100 }],
    });
    const db = makeDb({ corp: corp as unknown as Record<string, unknown>, issuerBonds: [] });

    await executeCorporationBondDefaultDissolution(db, corp, { requireDefaultedBonds: false });

    const entries = emittedEntries();
    expect(entries.length).toBeGreaterThan(0); // distribution rows still logged
    expect(entries.filter((e) => e.type === "bond_default")).toHaveLength(0);
    // The wind-down is still fully described by the distribution rows.
    const dist = entries.filter((e) => e.type === "corp_dissolution_distribution");
    expect(dist).toHaveLength(1);
    expect(dist[0].amount).toBe(500_000); // whole pool → sole shareholder
  });

  it("real bond default emits exactly one bond_default row and the liquidation legs sum to zero", async () => {
    const corp = baseCorp(); // no shareholders → all assets go to bondholders
    const bond = {
      _id: new ObjectId(),
      corporationId: corp._id,
      issuerType: "corporation",
      matured: false,
      defaulted: true,
      totalIssued: 1_000_000, // claims (₳ at rate 1) — assets only cover half
      couponRate: 5,
      holders: [{ characterId: CHAR_ID, units: 1_000 }], // 1000 × $1k face
      publicFloat: 0,
    } as unknown as Bond;
    const db = makeDb({
      corp: corp as unknown as Record<string, unknown>,
      issuerBonds: [bond as unknown as Record<string, unknown>],
    });

    const result = await executeCorporationBondDefaultDissolution(db, corp, {
      requireDefaultedBonds: true,
    });

    // 50% recovery: pool capped at assets (500k of 1M claims) — no minting.
    expect(result.bondRecoveryPool).toBe(500_000);
    expect(result.shareholderPool).toBe(0);

    const entries = emittedEntries();
    const defaults = entries.filter((e) => e.type === "bond_default");
    expect(defaults).toHaveLength(1);
    expect(defaults[0].amount).toBe(-500_000);
    expect(defaults[0].meta).toMatchObject({ totalBondClaimsAnchor: 1_000_000 });

    const payouts = entries.filter((e) => e.type === "bond_dissolution_payout");
    expect(payouts).toHaveLength(1);
    expect(payouts[0].amount).toBe(500_000);

    // Conservation: the liquidation ledger legs net to zero.
    const sum = entries.reduce((s, e) => s + (e.amount ?? 0), 0);
    expect(sum).toBe(0);
  });

  it("pays an index-fund shareholder its pool slice and drops the dangling holding", async () => {
    // Regression for the ghost-holding leak: allocateShareholderPool counts a
    // fund's shares in the payout denominator, but before this fix the
    // bond-default path never consumed allocation.fundRows — so the fund was
    // paid nothing and its holding survived the corp's deletion as a ghost.
    const FUND_ID = new ObjectId();
    const corp = baseCorp({
      shareholders: [{ fundId: FUND_ID, shares: 100 }], // sole shareholder
    });
    const db = makeDb({
      corp: corp as unknown as Record<string, unknown>,
      issuerBonds: [],
      indexFunds: [
        { _id: FUND_ID, cashAnchor: 0, holdings: [{ corporationId: corp._id }] },
      ],
    });

    await executeCorporationBondDefaultDissolution(db, corp, {
      requireDefaultedBonds: false,
    });

    const fundUpdate = vi.mocked(db.collection("indexFunds").updateOne);
    expect(fundUpdate).toHaveBeenCalledTimes(1);
    const [filter, update] = fundUpdate.mock.calls[0];
    // Keyed fund step: same _id match plus the exactly-once $ne key guard.
    expect(filter._id).toEqual(FUND_ID);
    expect(filter).toHaveProperty("appliedMoneyFlowKeys.$ne");
    // Whole 500k pool → sole fund shareholder, credited to cashAnchor.
    expect(update).toMatchObject({
      $inc: { cashAnchor: 500_000 },
      $pull: { holdings: { corporationId: corp._id } },
    });
  });
});
