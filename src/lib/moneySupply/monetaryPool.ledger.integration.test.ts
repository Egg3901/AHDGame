/** QE and QT pool cash reconcile through the actual monetary operation journal. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { writeBalanceSnapshot, writePreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import { reconcileTurn } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import { executeMonetaryOperation } from "./operations";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const nativeEnabled = process.env.AHD_MONETARY_POOL_REAL_MONGO === "1";
let client: MongoClient | undefined;
afterAll(async () => {
  await client?.close();
});
beforeEach(() => {
  resetLedgerShadowFlagCache();
});

async function world(native: boolean, options: { shadow?: boolean; poolCash?: number } = {}) {
  let db: Db;
  if (native) {
    const uri = new URL(process.env.AHD_MONETARY_POOL_MONGO_URI ?? "mongodb://127.0.0.1:27018");
    if (
      uri.protocol !== "mongodb:" ||
      !["127.0.0.1", "localhost"].includes(uri.hostname) ||
      !["27018", "27020"].includes(uri.port) ||
      uri.username ||
      uri.password ||
      (uri.pathname && uri.pathname !== "/") ||
      uri.search
    )
      throw new Error("Native monetary fixtures require a local sandbox endpoint");
    client ??= await MongoClient.connect(uri.toString(), { maxPoolSize: 1 });
    db = client.db(`ahd_sim_fixture_monetary_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  } else db = createInMemoryDb() as unknown as Db;
  await db.collection<{ _id: string }>("gameConfig").insertOne({
    _id: "default",
    moneySupplyEnabled: true,
    privateBankingEnabled: true,
    ledgerShadow: options.shadow ?? true,
  } as never);
  await db
    .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
    .insertOne({ _id: "current", currentTurn: 1, preset: "2019-default" });
  await db.collection("exchangeRates").insertMany([
    { currencyCode: "GBP", rate: 0.5 },
    { currencyCode: "USD", rate: 1 },
  ]);
  await db.collection<{ _id: string }>("centralBanks").insertOne({
    _id: "UK",
    countryId: "UK",
    externalBroadMoney: 1000,
    netMoneyCreatedLifetime: 0,
  } as never);
  await db.collection<{ _id: string }>("federalBudget").insertOne({
    _id: "UK",
    countryId: "UK",
    currencyCode: "GBP",
    treasuryBalance: 100,
    gdp: 100000,
    debt: { principal: 0 },
  } as never);
  const bondId = new ObjectId();
  await db.collection("bonds").insertOne({
    _id: bondId,
    issuerType: "sovereign",
    countryId: "UK",
    currencyCode: "GBP",
    matured: false,
    defaulted: false,
    publicFloat: 10,
    centralBankHoldings: 5,
    totalIssued: 10000,
    marketPrice: 1,
  });
  await db.collection<{ _id: string }>("bondMarketPools").insertOne({
    _id: "GBP",
    cashLocal: options.poolCash ?? 1_000_000,
    targetCashLocal: 1_000_000,
  } as never);
  vi.mocked(getDb).mockResolvedValue(db);
  return { db, bondId };
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

async function poolCash(db: Db): Promise<number> {
  const pool = await db
    .collection<{ _id: string; cashLocal: number }>("bondMarketPools")
    .findOne({ _id: "GBP" });
  return pool?.cashLocal ?? NaN;
}

function operation(type: "qe" | "qt", bondId: ObjectId) {
  return {
    countryId: "UK" as const,
    type,
    turn: 2,
    actorName: "Fixture chair",
    bondId: bondId.toHexString(),
    units: 1,
  };
}

for (const native of [false, true]) {
  describe.skipIf(native && !nativeEnabled)(
    `central-bank pool cash witnesses (${native ? "native Mongo" : "memory"})`,
    () => {
      it("witnesses the cash QE pays the GBP pool", async () => {
        const { db, bondId } = await world(native);
        await writeBalanceSnapshot(db, 1);
        const result = await executeMonetaryOperation(db, operation("qe", bondId));
        expect(result.amount).toBeGreaterThan(0);
        expect(await poolCash(db)).toBeCloseTo(1_000_000 + result.amount, 6);
        await close(db, 1);
        const [entry] = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
        expect(entry.legs.map((leg) => [leg.account, leg.anchorAmount])).toEqual([
          ["bond_pool:GBP:GBP", result.amount / 0.5],
          ["mint:central_bank_qe:GBP", -result.amount / 0.5],
        ]);
      });

      it("witnesses the cash QT withdraws from the GBP pool", async () => {
        const { db, bondId } = await world(native);
        await writeBalanceSnapshot(db, 1);
        const result = await executeMonetaryOperation(db, operation("qt", bondId));
        expect(await poolCash(db)).toBeCloseTo(1_000_000 - result.amount, 6);
        await close(db, 1);
        const accounts = (await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray())
          .flatMap((entry) => entry.legs)
          .map((leg) => leg.account);
        expect(accounts).toEqual(["bond_pool:GBP:GBP", "sink:central_bank_qt:GBP"]);
      });

      it("publishes nothing when QT is refused or shadow accounting is off", async () => {
        const refused = await world(native, { poolCash: 0 });
        await expect(
          executeMonetaryOperation(refused.db, operation("qt", refused.bondId))
        ).rejects.toThrow();
        expect(await poolCash(refused.db)).toBe(0);
        expect(await refused.db.collection("ledgerEntries").countDocuments()).toBe(0);
        const quiet = await world(native, { shadow: false });
        const result = await executeMonetaryOperation(quiet.db, operation("qe", quiet.bondId));
        expect(await poolCash(quiet.db)).toBeCloseTo(1_000_000 + result.amount, 6);
        expect(await quiet.db.collection("ledgerEntries").countDocuments()).toBe(0);
      });
    }
  );
}
