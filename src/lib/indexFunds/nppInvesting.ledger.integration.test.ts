/** NPC investment cash and fund receipts must reconcile after real subscriptions. */
import { expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { collectBalances } from "@/lib/ledger/balanceSnapshot";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import { processNPPFundInvestments } from "./nppInvesting";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn().mockResolvedValue(true),
}));

it.each([
  { countryId: "US", currency: "USD", rate: 1 },
  { countryId: "UK", currency: "GBP", rate: 0.8 },
])("reconciles one subscription witness for $countryId", async ({ countryId, currency, rate }) => {
  const memory = createInMemoryDb();
  const db = memory as unknown as Db;
  vi.mocked(getDb).mockResolvedValue(db);
  resetLedgerShadowFlagCache();
  const nppId = new ObjectId(),
    fundId = new ObjectId();
  memory.seed("gameConfig", [{ _id: "default", ledgerShadow: true }]);
  memory.seed("gameState", [{ _id: "current", currentTurn: 15, preset: "2019-default" }]);
  memory.seed("exchangeRates", [{ currencyCode: currency, rate }]);
  memory.seed("npps", [
    {
      _id: nppId,
      countryId,
      retiredAt: null,
      favorability: 80,
      politicalInfluence: 80,
      nppInvestmentCashAnchor: 1000,
    },
  ]);
  memory.seed("indexFunds", [
    {
      _id: fundId,
      name: "Synthetic Fund",
      slug: "synthetic",
      status: "active",
      scope: "country",
      kind: "broad",
      countryId,
      anchorCurrencyCode: currency,
      quotedNav: 100,
      unitSupply: 10,
      cashAnchor: 1000,
    },
  ]);
  const opening = await collectBalances(db);
  const result = await processNPPFundInvestments(db, { currentTurn: 16, budgetMultiplier: 4 });
  expect(result.errors).toEqual([]);
  expect(result.totalInvested).toBeGreaterThan(0);
  const closing = await collectBalances(db);
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({ turn: 16 }).toArray();
  const report = reconcileLedger({
    turn: 16,
    entries,
    openingBalances: opening,
    closingBalances: closing,
  });
  expect(report.trialBalance.unbalancedCount).toBe(0);
  expect(report.unattributed).toEqual([]);
  expect(report.stockVsFlow.findings).toEqual([]);
  const nppKey = `npp:${nppId}:${currency}`;
  const debits = entries.flatMap((e) =>
    e.legs.filter((l) => l.role === "primary" && l.account === nppKey && l.anchorAmount < 0)
  );
  expect(debits.reduce((sum, l) => sum + l.anchorAmount, 0)).toBeCloseTo(-result.totalInvested, 8);
  const beforeRetry = { balances: closing, entries: entries.length };
  expect(
    (await processNPPFundInvestments(db, { currentTurn: 16, budgetMultiplier: 4 })).totalInvested
  ).toBe(0);
  expect(await collectBalances(db)).toEqual(beforeRetry.balances);
  expect(await db.collection("ledgerEntries").countDocuments({ turn: 16 })).toBe(
    beforeRetry.entries
  );
});
