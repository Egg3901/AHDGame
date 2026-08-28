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

import { emitTxBulk } from "@/lib/financialTxLog/emit";
import { executeCorporationBondDefaultDissolution } from "./executeCorporationBondDefaultDissolution";
import type { Corporation, Bond } from "@/lib/db/types";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

function mkCursor(docs: unknown[]) {
  const cursor = {
    project: () => cursor,
    sort: () => cursor,
    toArray: async () => docs,
  };
  return cursor;
}

function makeDb(opts: { corp: Record<string, unknown>; issuerBonds: Record<string, unknown>[] }) {
  const { corp, issuerBonds } = opts;
  const collections: Record<string, unknown> = {
    bonds: {
      find: (q: Record<string, unknown>) =>
        mkCursor("holders.corporationId" in q ? [] : issuerBonds),
      updateOne: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
    },
    corporations: {
      findOne: async () => corp,
      find: () => mkCursor([]),
      updateOne: vi.fn().mockResolvedValue({}),
      bulkWrite: vi.fn().mockResolvedValue({}),
      deleteOne: vi.fn().mockResolvedValue({}),
    },
    corporateSectors: { find: () => mkCursor([]) },
    centralBanks: {
      find: () => mkCursor([]),
      updateOne: vi.fn().mockResolvedValue({}),
    },
    exchangeRates: { find: () => mkCursor([]) },
    bondHistory: { deleteMany: vi.fn().mockResolvedValue({}) },
    characters: {
      find: () => mkCursor([{ _id: CHAR_ID, name: "Holder", countryId: "US" }]),
      bulkWrite: vi.fn().mockResolvedValue({}),
    },
    imperialCharacters: {
      find: () => mkCursor([]),
      bulkWrite: vi.fn().mockResolvedValue({}),
    },
    // Market tier resolution (D11 book-vs-NPV settlement basis). Absent doc ⇒
    // mode "off", i.e. the legacy NPV path these assertions were written for.
    gameConfig: {
      findOne: vi.fn().mockResolvedValue(null),
    },
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
});
