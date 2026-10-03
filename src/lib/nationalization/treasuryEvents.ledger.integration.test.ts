/** Event-driven treasury flows reconcile on both sides with their counterparty rows. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { writeBalanceSnapshot, writePreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import { reconcileTurn } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  creditTreasuryProceedsFromAnchor,
  debitTreasury,
  debitTreasuryCompensation,
} from "./treasury";
import { resolveTreasuryCashOptions, witnessTreasuryCash } from "./treasuryLedger";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const nativeEnabled = process.env.AHD_TREASURY_EVENTS_REAL_MONGO === "1";
const NOW = new Date("2026-10-03T00:00:00Z");
let client: MongoClient | undefined;
afterAll(async () => {
  await client?.close();
});
beforeEach(() => {
  resetLedgerShadowFlagCache();
});

async function world(native: boolean) {
  let db: Db;
  if (native) {
    const uri = new URL(process.env.AHD_TREASURY_EVENTS_MONGO_URI ?? "mongodb://127.0.0.1:27018");
    if (
      uri.protocol !== "mongodb:" ||
      !["127.0.0.1", "localhost"].includes(uri.hostname) ||
      !["27018", "27020"].includes(uri.port) ||
      uri.username ||
      uri.password ||
      (uri.pathname && uri.pathname !== "/") ||
      uri.search
    )
      throw new Error("Native treasury fixtures require a local sandbox endpoint");
    client ??= await MongoClient.connect(uri.toString(), { maxPoolSize: 1 });
    db = client.db(`ahd_sim_fixture_trevents_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  } else db = createInMemoryDb() as unknown as Db;
  await db
    .collection<{ _id: string; ledgerShadow: boolean }>("gameConfig")
    .insertOne({ _id: "default", ledgerShadow: true });
  await db
    .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
    .insertOne({ _id: "current", currentTurn: 1, preset: "2019-default" });
  await db.collection("exchangeRates").insertMany([
    { currencyCode: "GBP", rate: 0.5 },
    { currencyCode: "USD", rate: 1 },
  ]);
  await db
    .collection("federalBudget")
    .insertOne({ countryId: "UK", currencyCode: "GBP", treasuryBalance: 1_000_000 });
  const corpId = new ObjectId();
  await db.collection("corporations").insertOne({
    _id: corpId,
    name: "Fixture Holdings",
    countryId: "US",
    liquidCapital: 50_000,
    liquidCurrencyCode: "USD",
  });
  vi.mocked(getDb).mockResolvedValue(db);
  return { db, corpId };
}

async function close(db: Db, entries: number) {
  await writePreForexBalanceCheckpoint(db, 2);
  await writeBalanceSnapshot(db, 2);
  const report = await reconcileTurn(db, 2);
  expect(report?.stockVsFlow.skipped).toBe(false);
  expect(report?.stockVsFlow.divergentCount).toBe(0);
  expect(report?.trialBalance.status).toBe("green");
  expect(report?.unattributed).toEqual([]);
  expect(report?.entriesChecked).toBe(entries);
}

async function contraAccounts(db: Db): Promise<string[]> {
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
  return entries
    .flatMap((entry) => entry.legs)
    .filter((leg) => leg.role === "contra")
    .map((leg) => leg.account)
    .sort();
}

for (const native of [false, true]) {
  describe.skipIf(native && !nativeEnabled)(
    `event-driven treasury witnesses (${native ? "native Mongo" : "memory"})`,
    () => {
      it("pairs a cross-border fine with its corporation row under one reason", async () => {
        const { db, corpId } = await world(native);
        await writeBalanceSnapshot(db, 1);
        // Caller order: debit the fined corporation, credit the treasury, log the fine.
        await db
          .collection("corporations")
          .updateOne({ _id: corpId }, { $inc: { liquidCapital: -1_000 } });
        const credited = await creditTreasuryProceedsFromAnchor(db, "UK", 1_000, NOW, {
          flow: "regulatory_fine",
        });
        await emitTx(db, {
          type: "corp_fine",
          turn: 2,
          createdAt: NOW,
          subjectType: "corporation",
          subjectId: corpId,
          subjectName: "Fixture Holdings",
          amount: -1_000,
          currencyCode: "USD",
          counterpartyType: "government",
          counterpartyName: "UK treasury",
        });
        expect(credited).toBe(500);
        await close(db, 2);
        expect(await contraAccounts(db)).toEqual([
          "mint:regulatory_fine:GBP",
          "sink:regulatory_fine:USD",
        ]);
      });

      it("pairs group loss relief with its corporation row under one reason", async () => {
        const { db, corpId } = await world(native);
        await db.collection("federalBudget").insertOne({
          countryId: "US",
          currencyCode: "USD",
          treasuryBalance: 500_000,
        });
        await writeBalanceSnapshot(db, 1);
        await db
          .collection("corporations")
          .updateOne({ _id: corpId }, { $inc: { liquidCapital: 2_500 } });
        await debitTreasury(db, "US", 2_500, NOW, { flow: "group_loss_relief" });
        await emitTx(db, {
          type: "corp_group_relief",
          turn: 2,
          createdAt: NOW,
          subjectType: "corporation",
          subjectId: corpId,
          subjectName: "Fixture Holdings",
          amount: 2_500,
          currencyCode: "USD",
          counterpartyType: "government",
          counterpartyName: "US treasury",
        });
        await close(db, 2);
        expect(await contraAccounts(db)).toEqual([
          "mint:corporate_group_transfer:USD",
          "sink:corporate_group_transfer:USD",
        ]);
      });

      it("witnesses both legs of a nationalization compensation once", async () => {
        const { db, corpId } = await world(native);
        await writeBalanceSnapshot(db, 1);
        const ledger = await resolveTreasuryCashOptions(db);
        const paid = await debitTreasuryCompensation(
          db,
          "UK",
          4_000,
          new Map([["GBP", 0.5]]),
          NOW,
          {
            flow: "nationalization_compensation",
            ledger,
          }
        );
        expect(paid).toBe(2_000);
        await db
          .collection("corporations")
          .updateOne({ _id: corpId }, { $inc: { liquidCapital: 4_000 } });
        await witnessTreasuryCash(db, ledger, {
          flow: "nationalization_compensation",
          account: { kind: "corporation", corpId: corpId.toString(), currency: "USD" },
          amount: 4_000,
          now: NOW,
          site: "test:compensation",
        });
        await close(db, 2);
        expect(await contraAccounts(db)).toEqual([
          "mint:nationalization_compensation:USD",
          "sink:nationalization_compensation:GBP",
        ]);
      });

      it("leaves already-witnessed callers single-sided", async () => {
        const { db } = await world(native);
        await creditTreasuryProceedsFromAnchor(db, "UK", 1_000, NOW);
        await debitTreasury(db, "UK", 100, NOW);
        await debitTreasuryCompensation(db, "UK", 10, new Map([["GBP", 0.5]]), NOW);
        expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
      });
    }
  );
}
