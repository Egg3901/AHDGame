import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

/**
 * Crash-boundary, resume, and terminal tests for
 * executeCorporationBondDefaultDissolution (issue #1672), plus the
 * deterministic key-builder contract the vote/cascade/NPP callers pin their
 * propagation assertions against.
 *
 * The settlement math stays REAL; the keyed money flow runs for real against
 * the strict stateful fakes below (same operator surface as the primitive's
 * own suite), so an injected crash between any two writes models a real
 * process death. All other side-effecting collaborators are stubbed.
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
// Standalone path: the keyed flow is what makes the dissolution crash-safe
// there, so these tests run the REAL bondDissolutionSpend primitive.
vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn().mockResolvedValue(false),
}));

import {
  executeCorporationBondDefaultDissolution,
  bondDissolutionKeyForVote,
  bondDissolutionKeyForCascade,
  bondDissolutionKeyForNpp,
} from "./executeCorporationBondDefaultDissolution";
import type { Corporation, Bond } from "@/lib/db/types";
import { MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";

function mkCursor(docs: unknown[]) {
  return {
    project: () => mkCursor(docs),
    sort: () => mkCursor(docs),
    toArray: async () => docs,
  };
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
  const pull = update.$pull as { holdings: { corporationId: unknown } } | undefined;
  if (pull?.holdings) {
    const holdings = (doc.holdings ?? []) as Record<string, unknown>[];
    doc.holdings = holdings.filter(
      (h) => !valueEquals(h.corporationId, pull.holdings.corporationId)
    );
  }
}

interface CrashState {
  writeCount: number;
  crashAfterWrites: number;
}

/**
 * Stateful keyed collection with a shared crash counter: every `updateOne`
 * / `insertOne` counts, and past the armed limit the write throws
 * INJECTED_CRASH instead of landing — a real process death between two
 * sequential Mongo writes.
 */
function makeKeyedCollection(seedDocs: Record<string, unknown>[] = [], crash?: CrashState) {
  const store = new Map<string, Record<string, unknown>>();
  for (const seed of seedDocs) {
    store.set(docKey(seed._id), {
      ...seed,
      appliedMoneyFlowKeys: [...((seed.appliedMoneyFlowKeys as unknown[] | undefined) ?? [])],
      holdings: Array.isArray(seed.holdings)
        ? [...(seed.holdings as unknown[])]
        : seed.holdings,
    });
  }
  const countWrite = () => {
    if (!crash) return;
    crash.writeCount += 1;
    if (crash.writeCount > crash.crashAfterWrites) throw new Error("INJECTED_CRASH");
  };
  const updateOne = vi.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    countWrite();
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
    countWrite();
    const key = docKey(doc._id);
    if (store.has(key)) {
      throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
    }
    store.set(key, {
      ...doc,
      appliedMoneyFlowKeys: [...((doc.appliedMoneyFlowKeys as unknown[] | undefined) ?? [])],
    });
    return { insertedId: doc._id };
  });
  return { updateOne, findOne, insertOne, __store: store };
}

type KeyedCollection = ReturnType<typeof makeKeyedCollection>;

const CHAR_BOND = new ObjectId();
const CHAR_SHARE = new ObjectId();
const FUND_ID = new ObjectId();

/**
 * Corp with 2M liquid capital and one defaulted 1M-claim bond: 800k of
 * character-held units plus 200k of public float. The 1M surplus funds the
 * shareholder pool, split 50/50 between a character and an index fund — so
 * the flow covers a pool credit, two holder credits, and a fund credit.
 */
function baseCorp() {
  const corpId = new ObjectId();
  const corp = {
    _id: corpId,
    name: "Doomed Corp",
    countryId: "US",
    liquidCapital: 2_000_000,
    totalShares: 100,
    shareholders: [{ characterId: CHAR_SHARE, shares: 50 }, { fundId: FUND_ID, shares: 50 }],
  } as unknown as Corporation;
  const bond = {
    _id: new ObjectId(),
    corporationId: corpId,
    issuerType: "corporation",
    matured: false,
    defaulted: true,
    totalIssued: 1_000_000,
    couponRate: 5,
    holders: [{ characterId: CHAR_BOND, units: 800 }],
    publicFloat: 200,
  } as unknown as Bond;
  return { corp, bond };
}

function makeDb(
  corp: Record<string, unknown>,
  issuerBonds: Record<string, unknown>[],
  crash?: CrashState,
  opts: { dropChars?: ObjectId[] } = {}
) {
  const characters = makeKeyedCollection(
    [
      { _id: CHAR_BOND, name: "Bond Holder", countryId: "US", cashOnHand: 0 },
      { _id: CHAR_SHARE, name: "Share Holder", countryId: "US", cashOnHand: 0 },
    ].filter((d) => !opts.dropChars?.some((id) => (d._id as ObjectId).equals(id))),
    crash
  );
  const imperials = makeKeyedCollection([], crash);
  const corporations = makeKeyedCollection([corp], crash);
  const centralBanks = makeKeyedCollection([], crash);
  const indexFunds = makeKeyedCollection(
    [{ _id: FUND_ID, cashAnchor: 0, holdings: [{ corporationId: corp._id }] }],
    crash
  );
  const pools = makeKeyedCollection(
    [{ _id: "USD", cashLocal: 5_000, targetCashLocal: 0, lifetime: { recoveriesIn: 0 } }],
    crash
  );
  const receipts = makeKeyedCollection([], crash);
  const charDocs = [...characters.__store.values()].map((d) => ({
    _id: d._id,
    name: (d.name as string) ?? "Holder",
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
      find: () => mkCursor([]),
      bulkWrite: vi.fn().mockResolvedValue({}),
      deleteOne: vi.fn(async (filter: Record<string, unknown>) => {
        const existed = corporations.__store.delete(docKey(filter._id));
        return { deletedCount: existed ? 1 : 0 };
      }),
    },
    corporateSectors: { find: () => mkCursor([]) },
    centralBanks: { ...centralBanks, find: () => mkCursor([]) },
    exchangeRates: { find: () => mkCursor([]) },
    bondHistory: { deleteMany: vi.fn().mockResolvedValue({}) },
    characters: { ...characters, find: () => mkCursor(charDocs) },
    imperialCharacters: { ...imperials, find: () => mkCursor([]) },
    gameConfig: { findOne: vi.fn().mockResolvedValue(null) },
    indexFunds,
    bondMarketPools: pools,
    nonAtomicMoneyFlowReceipts: receipts,
  };
  const db = {
    collection: (name: string) => {
      const c = collections[name];
      if (!c) throw new Error(`unexpected collection in test: ${name}`);
      return c;
    },
  } as unknown as Db;
  return {
    db,
    stores: { characters, corporations, indexFunds, pools, receipts },
  };
}

function charCash(stores: { characters: KeyedCollection }, id: ObjectId): number {
  return stores.characters.__store.get(id.toHexString())!.cashOnHand as number;
}

describe("executeCorporationBondDefaultDissolution crash boundary (issue #1672)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("converges to exactly one payout set when a crash interrupts any durable write", async () => {
    // Probe the happy-path write count, then crash after every prefix.
    const { corp, bond } = baseCorp();
    const probeCrash: CrashState = { writeCount: 0, crashAfterWrites: Number.POSITIVE_INFINITY };
    const probe = makeDb(corp as unknown as Record<string, unknown>, [
      bond as unknown as Record<string, unknown>,
    ], probeCrash);
    const key = "exec-crash-probe";
    const first = await executeCorporationBondDefaultDissolution(probe.db, corp, {
      requireDefaultedBonds: true,
      idempotencyKey: key,
    });
    expect(first.bondRecoveryPool).toBe(1_000_000);
    expect(first.shareholderPool).toBe(1_000_000);
    const totalWrites = probeCrash.writeCount;
    expect(totalWrites).toBeGreaterThan(3);

    for (let crashAfter = 1; crashAfter < totalWrites; crashAfter += 1) {
      const { corp: retryCorp, bond: retryBond } = baseCorp();
      const crash: CrashState = { writeCount: 0, crashAfterWrites: crashAfter };
      const fixture = makeDb(retryCorp as unknown as Record<string, unknown>, [
        retryBond as unknown as Record<string, unknown>,
      ], crash);
      const retryKey = `exec-crash-${crashAfter}`;
      await expect(
        executeCorporationBondDefaultDissolution(fixture.db, retryCorp, {
          requireDefaultedBonds: true,
          idempotencyKey: retryKey,
        })
      ).rejects.toThrow("INJECTED_CRASH");

      crash.crashAfterWrites = Number.POSITIVE_INFINITY;
      crash.writeCount = 0;
      const result = await executeCorporationBondDefaultDissolution(fixture.db, retryCorp, {
        requireDefaultedBonds: true,
        idempotencyKey: retryKey,
      });

      // Full recovery pool, full shareholder pool, each payee exactly once.
      expect(result.bondRecoveryPool).toBe(1_000_000);
      expect(result.shareholderPool).toBe(1_000_000);
      expect(charCash(fixture.stores, CHAR_BOND)).toBe(800_000);
      expect(charCash(fixture.stores, CHAR_SHARE)).toBe(500_000);
      const fund = fixture.stores.indexFunds.__store.get(FUND_ID.toHexString())!;
      expect(fund.cashAnchor).toBe(500_000);
      expect(fund.holdings).toEqual([]);
      const pool = fixture.stores.pools.__store.get("USD")!;
      expect(pool.cashLocal).toBe(5_000 + 200_000);
      // Terminal cleanup re-ran: the corp is gone.
      expect(fixture.stores.corporations.__store.has(retryCorp._id.toHexString())).toBe(false);
      expect(
        (fixture.stores.receipts.__store.get(retryKey) as { status: string }).status
      ).toBe("completed");
    }
  });

  it("recovers the stored outcome on the empty-remainder path after the corp is gone", async () => {
    // A crash after the terminal cleanup started leaves no bonds behind with
    // an in_progress receipt: the next retry under the same key rebuilds an
    // empty live set and must report the stored outcome, not refuse.
    const { corp, bond } = baseCorp();
    const liveBonds: Record<string, unknown>[] = [bond as unknown as Record<string, unknown>];
    const crash: CrashState = { writeCount: 0, crashAfterWrites: Number.POSITIVE_INFINITY };
    const fixture = makeDb(corp as unknown as Record<string, unknown>, liveBonds, crash);
    const key = "exec-empty-remainder";

    const first = await executeCorporationBondDefaultDissolution(fixture.db, corp, {
      requireDefaultedBonds: true,
      idempotencyKey: key,
    });
    expect(charCash(fixture.stores, CHAR_BOND)).toBe(800_000);

    // The terminal cleanup deleted the corp; the live bond set now reads
    // empty (bonds deleted with it).
    liveBonds.length = 0;
    const retry = await executeCorporationBondDefaultDissolution(fixture.db, corp, {
      requireDefaultedBonds: true,
      idempotencyKey: key,
    });
    expect(retry).toEqual(first);
    // Still exactly-once: no second payout wave.
    expect(charCash(fixture.stores, CHAR_BOND)).toBe(800_000);
    expect(charCash(fixture.stores, CHAR_SHARE)).toBe(500_000);
  });

  it("holds a vanished-holder key terminal: first the 500 surface, then fail closed", async () => {
    const { corp, bond } = baseCorp();
    const fixture = makeDb(
      corp as unknown as Record<string, unknown>,
      [bond as unknown as Record<string, unknown>],
      undefined,
      { dropChars: [CHAR_BOND] }
    );
    const key = "exec-terminal";

    await expect(
      executeCorporationBondDefaultDissolution(fixture.db, corp, {
        requireDefaultedBonds: true,
        idempotencyKey: key,
      })
    ).rejects.toThrow(/^BOND_DISSOLUTION_HOLDER/);

    // Pool prefix compensated; the share holder never paid.
    const pool = fixture.stores.pools.__store.get("USD")!;
    expect(pool.cashLocal).toBe(5_000);
    expect(charCash(fixture.stores, CHAR_SHARE)).toBe(0);

    await expect(
      executeCorporationBondDefaultDissolution(fixture.db, corp, {
        requireDefaultedBonds: true,
        idempotencyKey: key,
      })
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("settles under a minted key when the caller passes none", async () => {
    const { corp, bond } = baseCorp();
    const fixture = makeDb(corp as unknown as Record<string, unknown>, [
      bond as unknown as Record<string, unknown>,
    ]);

    const result = await executeCorporationBondDefaultDissolution(fixture.db, corp, {
      requireDefaultedBonds: true,
    });

    expect(result.bondRecoveryPool).toBe(1_000_000);
    expect(fixture.stores.receipts.__store.size).toBe(1);
    const [[receiptKey, receipt]] = [...fixture.stores.receipts.__store.entries()];
    expect(typeof receiptKey).toBe("string");
    expect(receiptKey.length).toBeGreaterThan(0);
    expect((receipt as { status: string }).status).toBe("completed");
  });
});

describe("bond dissolution deterministic keys (issue #1672)", () => {
  it("builds stable per-event keys in distinct namespaces", () => {
    const voteId = new ObjectId();
    const corpId = new ObjectId();

    expect(bondDissolutionKeyForVote(voteId)).toBe(`bond-dissolution:vote:${voteId.toHexString()}`);
    expect(bondDissolutionKeyForCascade(corpId)).toBe(
      `bond-dissolution:cascade:${corpId.toHexString()}`
    );
    expect(bondDissolutionKeyForNpp(corpId)).toBe(`bond-dissolution:npp:${corpId.toHexString()}`);

    // Stable: the same event re-derives the same key, so a re-drive resumes
    // the stored plan instead of paying again.
    expect(bondDissolutionKeyForVote(voteId)).toBe(bondDissolutionKeyForVote(voteId));
    expect(bondDissolutionKeyForCascade(corpId)).toBe(bondDissolutionKeyForCascade(corpId));
    expect(bondDissolutionKeyForNpp(corpId)).toBe(bondDissolutionKeyForNpp(corpId));
  });

  it("never collides across events or namespaces", () => {
    const corpId = new ObjectId();
    // Distinct votes never share a key.
    expect(bondDissolutionKeyForVote(new ObjectId())).not.toBe(
      bondDissolutionKeyForVote(new ObjectId())
    );
    // One corp id in three namespaces yields three keys: a cascade retry
    // can never replay a vote's receipt or an NPP turn's.
    const keys = new Set([
      bondDissolutionKeyForVote(corpId),
      bondDissolutionKeyForCascade(corpId),
      bondDissolutionKeyForNpp(corpId),
    ]);
    expect(keys.size).toBe(3);
  });
});
