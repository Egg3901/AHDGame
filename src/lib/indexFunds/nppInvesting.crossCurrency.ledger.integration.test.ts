/** An NPP buying a fund in another currency reconciles both cash sides. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { collectBalances } from "@/lib/ledger/balanceSnapshot";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import { deriveLedgerEntries, fundMirrorAccount } from "@/lib/ledger/deriveFromTx";
import type { LedgerEntry } from "@/lib/ledger/types";
import { processNPPFundInvestments } from "./nppInvesting";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn().mockResolvedValue(true),
}));

const nativeEnabled = process.env.AHD_NPP_FUND_MIRROR_REAL_MONGO === "1";
let client: MongoClient | undefined;
afterAll(async () => {
  await client?.close();
});
beforeEach(() => {
  resetLedgerShadowFlagCache();
});

async function database(native: boolean): Promise<Db> {
  if (!native) return createInMemoryDb() as unknown as Db;
  const uri = new URL(process.env.AHD_NPP_FUND_MIRROR_MONGO_URI ?? "mongodb://127.0.0.1:27018");
  if (
    uri.protocol !== "mongodb:" ||
    !["127.0.0.1", "localhost"].includes(uri.hostname) ||
    !["27018", "27020"].includes(uri.port) ||
    uri.username ||
    uri.password ||
    (uri.pathname && uri.pathname !== "/") ||
    uri.search
  )
    throw new Error("Native fund fixtures require a local sandbox endpoint");
  client ??= await MongoClient.connect(uri.toString(), { maxPoolSize: 1 });
  return client.db(`ahd_sim_fixture_fundmirror_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
}

for (const native of [false, true]) {
  describe.skipIf(native && !nativeEnabled)(
    `cross-currency NPP fund subscriptions (${native ? "native Mongo" : "memory"})`,
    () => {
      it("mirrors a UK NPP's USD fund purchase exactly and reconciles both accounts", async () => {
        const db = await database(native);
        vi.mocked(getDb).mockResolvedValue(db);
        const nppId = new ObjectId(),
          fundId = new ObjectId();
        await db
          .collection<{ _id: string; ledgerShadow: boolean }>("gameConfig")
          .insertOne({ _id: "default", ledgerShadow: true });
        await db
          .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
          .insertOne({ _id: "current", currentTurn: 16, preset: "2019-default" });
        await db.collection("exchangeRates").insertMany([
          { currencyCode: "GBP", rate: 0.8 },
          { currencyCode: "USD", rate: 1 },
        ]);
        await db.collection("npps").insertOne({
          _id: nppId,
          countryId: "UK",
          retiredAt: null,
          favorability: 80,
          politicalInfluence: 80,
          nppInvestmentCashAnchor: 1000,
        });
        await db.collection("indexFunds").insertOne({
          _id: fundId,
          name: "Synthetic Global Fund",
          slug: "synthetic-global",
          status: "active",
          scope: "global",
          kind: "broad",
          anchorCurrencyCode: "USD",
          quotedNav: 100,
          unitSupply: 10,
          cashAnchor: 1000,
        });
        const opening = await collectBalances(db);
        const result = await processNPPFundInvestments(db, {
          currentTurn: 16,
          budgetMultiplier: 4,
        });
        expect(result.errors).toEqual([]);
        expect(result.totalInvested).toBeGreaterThan(0);
        const closing = await collectBalances(db);
        const entries = await db
          .collection<LedgerEntry>("ledgerEntries")
          .find({ turn: 16 })
          .toArray();
        const report = reconcileLedger({
          turn: 16,
          entries,
          openingBalances: opening,
          closingBalances: closing,
        });
        expect(report.trialBalance.unbalancedCount).toBe(0);
        expect(report.unattributed).toEqual([]);
        expect(report.stockVsFlow.findings).toEqual([]);
        const fundKey = `fund:${fundId}:USD`;
        const credits = entries.flatMap((entry) =>
          entry.legs.filter((leg) => leg.role === "primary" && leg.account === fundKey)
        );
        expect(credits.every((leg) => leg.currencyCode === "USD")).toBe(true);
        expect(credits.reduce((sum, leg) => sum + leg.anchorAmount, 0)).toBeCloseTo(
          result.totalInvested,
          8
        );
      });
    }
  );
}

it("still refuses to mirror a native-currency holder across currencies", () => {
  const row = {
    type: "index_fund_subscribe" as const,
    turn: 16,
    createdAt: new Date(),
    subjectType: "character" as const,
    subjectId: new ObjectId(),
    amount: -800,
    anchorAmount: -1000,
    currencyCode: "GBP" as const,
    meta: { fundId: new ObjectId().toString(), fundCurrency: "USD" },
  };
  expect(fundMirrorAccount(row)).toBeNull();
  expect(deriveLedgerEntries([row])).toHaveLength(1);
});
