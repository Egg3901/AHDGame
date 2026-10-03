/** State-enterprise treasury cash reconciles through the actual writers and phases. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { writeBalanceSnapshot, writePreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import { reconcileTurn } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import { debitTreasurySoeCapex, drawFromTreasury, remitToTreasury } from "./treasury";
import { loadTreasuryCashContext, withTreasuryCashBatch } from "./treasuryLedger";
import { processSoeOperations } from "./soeOperations";
import { runSoeBackingSweep } from "@/lib/turn/corporation/soeBackingSweep";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const nativeEnabled = process.env.AHD_TREASURY_CASH_REAL_MONGO === "1";
const NOW = new Date("2026-10-03T00:00:00Z");
let client: MongoClient | undefined;
afterAll(async () => {
  await client?.close();
});
beforeEach(() => {
  resetLedgerShadowFlagCache();
});

interface World {
  db: Db;
  corpId: ObjectId;
}

async function world(
  native: boolean,
  options: {
    shadow?: boolean;
    corpCurrency?: "GBP" | "USD";
    liquidCapital?: number;
    clock?: number;
  } = {}
): Promise<World> {
  let db: Db;
  if (native) {
    const uri = new URL(process.env.AHD_TREASURY_CASH_MONGO_URI ?? "mongodb://127.0.0.1:27018");
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
    db = client.db(`ahd_sim_fixture_treasury_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  } else db = createInMemoryDb() as unknown as Db;
  await db
    .collection<{ _id: string; ledgerShadow: boolean }>("gameConfig")
    .insertOne({ _id: "default", ledgerShadow: options.shadow ?? true });
  // Direct writers stamp the game clock; phases pass their processing turn.
  await db
    .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
    .insertOne({ _id: "current", currentTurn: options.clock ?? 2, preset: "1991-default" });
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
    name: "Fixture enterprise",
    countryId: "UK",
    countryOwnerId: "UK",
    isNationalized: true,
    liquidCapital: options.liquidCapital ?? 200_000,
    liquidCurrencyCode: options.corpCurrency ?? "GBP",
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
  return report;
}

async function ledgerAccounts(db: Db): Promise<string[]> {
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
  return entries.flatMap((entry) => entry.legs.map((leg) => leg.account)).sort();
}

async function cash(db: Db, corpId: ObjectId) {
  const corp = await db.collection("corporations").findOne({ _id: corpId });
  const budget = await db.collection("federalBudget").findOne({ countryId: "UK" });
  return { corp: corp?.liquidCapital, treasury: budget?.treasuryBalance };
}

for (const native of [false, true]) {
  describe.skipIf(native && !nativeEnabled)(
    `treasury cash witnesses (${native ? "native Mongo" : "memory"})`,
    () => {
      it("nets a remittance from the enterprise into the treasury in GBP", async () => {
        const { db, corpId } = await world(native, { clock: 9 });
        await writeBalanceSnapshot(db, 1);
        const context = await loadTreasuryCashContext(db, 2);
        await withTreasuryCashBatch(db, context, (ledger) =>
          remitToTreasury(
            db,
            { countryId: "UK", corpId, amountLocal: 150_000.4, corpCurrency: "GBP" },
            NOW,
            ledger
          )
        );
        expect(await cash(db, corpId)).toEqual({ corp: 50_000, treasury: 1_150_000 });
        await close(db, 2);
        const id = corpId.toString();
        expect(await ledgerAccounts(db)).toEqual(
          [
            `corporation:${id}:GBP`,
            "sink:soe_remittance:GBP",
            "government:UK:GBP",
            "mint:soe_remittance:GBP",
          ].sort()
        );
        const entries = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
        expect(entries.every((entry) => entry.turn === 2)).toBe(true);
      });

      it("reconciles a CEO draw into an enterprise held in another currency", async () => {
        const { db, corpId } = await world(native, { corpCurrency: "USD" });
        await writeBalanceSnapshot(db, 1);
        await drawFromTreasury(
          db,
          { countryId: "UK", corpId, amountLocal: 1_000, corpCurrency: "USD" },
          NOW
        );
        expect(await cash(db, corpId)).toEqual({ corp: 201_000, treasury: 999_000 });
        await close(db, 2);
        const legs = (await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray()).map(
          (entry) => entry.legs[0]
        );
        expect(legs.map((leg) => [leg.account, leg.anchorAmount]).sort()).toEqual(
          [
            [`corporation:${corpId.toString()}:USD`, 1_000],
            ["government:UK:GBP", -2_000],
          ].sort()
        );
      });

      it("reconciles loss backing through the actual operations pass", async () => {
        const { db, corpId } = await world(native, { liquidCapital: -4_321.5 });
        await writeBalanceSnapshot(db, 1);
        const context = await loadTreasuryCashContext(db, 2);
        const result = await withTreasuryCashBatch(db, context, (ledger) =>
          processSoeOperations(db, NOW, 1991, undefined, ledger)
        );
        expect(result.backing).toHaveLength(1);
        expect(await cash(db, corpId)).toEqual({ corp: 0, treasury: 995_678 });
        await close(db, 2);
      });

      it("sinks a state capex grant into the plant it buys", async () => {
        const { db } = await world(native);
        await writeBalanceSnapshot(db, 1);
        await debitTreasurySoeCapex(db, "UK", 30_000, new Map([["GBP", 0.5]]), NOW);
        await close(db, 1);
        expect(await ledgerAccounts(db)).toEqual(["government:UK:GBP", "sink:soe_capex_grant:GBP"]);
      });

      it("publishes only the legs that landed when a counterparty is missing", async () => {
        const { db, corpId } = await world(native);
        await writeBalanceSnapshot(db, 1);
        const missingCorp = new ObjectId();
        await drawFromTreasury(
          db,
          { countryId: "UK", corpId: missingCorp, amountLocal: 500, corpCurrency: "GBP" },
          NOW
        );
        await remitToTreasury(
          db,
          { countryId: "FR", corpId, amountLocal: 700, corpCurrency: "GBP" },
          NOW
        );
        expect(await cash(db, corpId)).toEqual({ corp: 199_300, treasury: 999_500 });
        await close(db, 2);
        expect(await ledgerAccounts(db)).not.toContain(`corporation:${missingCorp.toString()}:GBP`);
      });

      it("keeps cash outcomes and writes no ledger rows with shadow accounting off", async () => {
        const { db, corpId } = await world(native, { shadow: false });
        await remitToTreasury(
          db,
          { countryId: "UK", corpId, amountLocal: 1_200, corpCurrency: "GBP" },
          NOW
        );
        await drawFromTreasury(
          db,
          { countryId: "UK", corpId, amountLocal: 200, corpCurrency: "GBP" },
          NOW
        );
        await debitTreasurySoeCapex(db, "UK", 100, new Map([["GBP", 0.5]]), NOW);
        expect(await cash(db, corpId)).toEqual({ corp: 199_000, treasury: 1_000_950 });
        expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
      });

      it("flushes landed cash when later phase work fails", async () => {
        const { db, corpId } = await world(native);
        await writeBalanceSnapshot(db, 1);
        const context = await loadTreasuryCashContext(db, 2);
        await expect(
          withTreasuryCashBatch(db, context, async (ledger) => {
            await remitToTreasury(
              db,
              { countryId: "UK", corpId, amountLocal: 10_000, corpCurrency: "GBP" },
              NOW,
              ledger
            );
            throw new Error("later work failed");
          })
        ).rejects.toThrow("later work failed");
        await close(db, 2);
      });

      it("the corporation sweep witnesses backing at the processing turn", async () => {
        const { db, corpId } = await world(native, { liquidCapital: -800, clock: 9 });
        await writeBalanceSnapshot(db, 1);
        await runSoeBackingSweep({
          db,
          now: NOW,
          turn: 2,
          currentYear: 1991,
          corpSnapshots: [],
          corpById: new Map(),
          mark: () => {},
        });
        expect((await cash(db, corpId)).corp).toBe(0);
        await close(db, 2);
        const turns = await db.collection<LedgerEntry>("ledgerEntries").distinct("turn");
        expect(turns).toEqual([2]);
      });
    }
  );
}
