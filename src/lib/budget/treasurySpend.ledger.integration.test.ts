/**
 * Crisis, settlement, peace-term and world-event treasury flows reconcile end to
 * end: the real writers witness exactly the movement that landed, and the real
 * reconciler finds no divergence, a green trial balance and nothing unattributed.
 * GBP is valued at 0.5 anchor per unit.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { writeBalanceSnapshot, writePreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import { reconcileTurn } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import type { CrisisDecisionOption } from "@/lib/db/types/crisis";
import { creditTreasury, spendFromTreasury } from "./treasurySpend";
import { spendGlobalResponseCost } from "@/lib/livingConflict/globalResponse";
import { levyMobilisation } from "@/lib/settlement/mobilisation";
import { applyPeaceTerm } from "@/lib/military/applyPeaceTerm";
import { applyCountryTreasuryDelta } from "@/lib/events/substrate/applyEffects";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { CountryId } from "@/lib/constants/countries";
vi.mock("@/lib/mongodb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mongodb")>()),
  getDb: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
// The fixture database is not the app client's, so a negotiated indemnity takes
// its sequential path, where the per-treasury receipt makes a replay a no-op.
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: <T>(_inTransaction: unknown, sequential: () => Promise<T>) =>
    sequential(),
}));

const nativeEnabled = process.env.AHD_TREASURY_SPEND_REAL_MONGO === "1";
let client: MongoClient | undefined;
afterAll(async () => {
  await client?.close();
});
beforeEach(() => {
  resetLedgerShadowFlagCache();
});

async function world(native: boolean, shadow = true, cashLedger = false) {
  let db: Db;
  if (native) {
    const uri = new URL(process.env.AHD_TREASURY_SPEND_MONGO_URI ?? "mongodb://127.0.0.1:27018");
    if (
      uri.protocol !== "mongodb:" ||
      !["127.0.0.1", "localhost"].includes(uri.hostname) ||
      !["27018", "27020"].includes(uri.port) ||
      uri.username ||
      uri.password ||
      (uri.pathname && uri.pathname !== "/") ||
      uri.search
    )
      throw new Error("Native treasury spend fixtures require a local sandbox endpoint");
    client ??= await MongoClient.connect(uri.toString(), { maxPoolSize: 1 });
    db = client.db(`ahd_sim_fixture_trspend_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  } else db = createInMemoryDb() as unknown as Db;
  await db
    .collection<{
      _id: string;
      ledgerShadow: boolean;
      treasuryCashLedgerEnabled?: boolean;
    }>("gameConfig")
    .insertOne({ _id: "default", ledgerShadow: shadow, treasuryCashLedgerEnabled: cashLedger });
  // Turn 1 is processed; turn 2 is accumulating, as between turns in production.
  await db
    .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
    .insertOne({ _id: "current", currentTurn: 1, preset: "2019-default" });
  await db.collection("exchangeRates").insertMany([
    { currencyCode: "GBP", rate: 0.5 },
    { currencyCode: "USD", rate: 1 },
    { currencyCode: "SUR", rate: 2 },
    { currencyCode: "DDM", rate: 4 },
  ]);
  await db.collection<{ _id: string; countryId: CountryId }>("federalBudget").insertMany(
    (["UK", "US", "RU", "DD"] as CountryId[]).map((countryId) => ({
      // The national id, so the indemnity's budget heal finds the document.
      _id: getNationalBudgetId(countryId),
      countryId,
      ...(countryId === "UK" ? { currencyCode: "GBP" } : {}),
      ...(countryId === "US" ? { currencyCode: "USD" } : {}),
      treasuryBalance: 1_000_000,
      ...(cashLedger ? { treasuryCashLocal: 1_000_000 } : {}),
      gdp: 2_000_000,
    }))
  );
  vi.mocked(getDb).mockResolvedValue(db);
  return db;
}

async function close(db: Db, entries: number) {
  await writePreForexBalanceCheckpoint(db, 2);
  await writeBalanceSnapshot(db, 2);
  const report = await reconcileTurn(db, 2);
  expect(report?.stockVsFlow.skipped).toBe(false);
  expect(report?.stockVsFlow.findings ?? []).toEqual([]);
  expect(report?.trialBalance.status).toBe("green");
  expect(report?.unattributed).toEqual([]);
  expect(report?.entriesChecked).toBe(entries);
}

async function contraReasons(db: Db): Promise<string[]> {
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
  return entries
    .flatMap((entry) => entry.legs)
    .filter((leg) => leg.role === "contra")
    .map((leg) => leg.account)
    .sort();
}

const treasury = async (db: Db, countryId: string) =>
  (await db.collection("federalBudget").findOne({ countryId }))?.treasuryBalance as number;

for (const native of [false, true]) {
  describe.skipIf(native && !nativeEnabled)(
    `treasury spend witnesses (${native ? "native Mongo" : "memory"})`,
    () => {
      it("sinks a crisis response cost", async () => {
        const db = await world(native);
        await writeBalanceSnapshot(db, 1);
        const spent = await spendGlobalResponseCost(db, "UK", {
          treasuryCostPctGdp: 0.01,
        } as CrisisDecisionOption);
        expect(spent).toBe(20_000);
        await close(db, 1);
        expect(await contraReasons(db)).toEqual(["sink:crisis_response:GBP"]);
      });

      it("nets emergency aid against its clawback under one reason", async () => {
        const db = await world(native);
        await writeBalanceSnapshot(db, 1);
        const witness = { flow: "crisis_aid" as const, site: "test/aid" };
        await spendFromTreasury(db, "UK", 5_000, { witness });
        await creditTreasury(db, "UK", 5_000, { witness });
        await close(db, 2);
        expect(await contraReasons(db)).toEqual(["mint:crisis_aid:GBP", "sink:crisis_aid:GBP"]);
      });

      it("witnesses the landed movement when the balance rounds", async () => {
        const db = await world(native);
        await writeBalanceSnapshot(db, 1);
        await spendFromTreasury(db, "UK", 1_234.6, {
          witness: { flow: "settlement_play", site: "test/play" },
        });
        expect(await treasury(db, "UK")).toBe(998_765);
        await close(db, 1);
        const [entry] = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
        expect(entry.legs[0].amount).toBe(-1_235);
      });

      it("levies mobilisation on every seat in one batch", async () => {
        const db = await world(native);
        await writeBalanceSnapshot(db, 1);
        const result = await levyMobilisation(db, { armed: true, turn: 2 });
        expect(result.countriesLevied).toBe(4);
        expect(result.totalLocalSpent).toBe(80_000);
        await close(db, 4);
        expect(
          (await contraReasons(db)).every((a) => a.startsWith("sink:settlement_mobilisation:"))
        ).toBe(true);
      });

      it("pairs an imposed peace indemnity across currencies", async () => {
        const db = await world(native);
        await writeBalanceSnapshot(db, 1);
        await applyPeaceTerm(
          db,
          { kind: "indemnity", payer: "UK", amount: 10_000 },
          { imposer: "US", target: "UK", conflictId: "fixture-war", currentTurn: 2 }
        );
        expect(await treasury(db, "UK")).toBe(990_000);
        await close(db, 2);
        expect(await contraReasons(db)).toEqual([
          "mint:peace_indemnity:USD",
          "sink:peace_indemnity:GBP",
        ]);
      });

      // The memory store has no $addToSet, which the per-treasury receipt needs.
      it.skipIf(!native)("witnesses a negotiated indemnity once, after it commits", async () => {
        const db = await world(native);
        const peaceOfferId = new ObjectId();
        await db.collection("peaceOffers").insertOne({
          _id: peaceOfferId,
          status: "accepted",
          application: { phase: "claimed" },
        });
        await writeBalanceSnapshot(db, 1);
        const ctx = {
          imposer: "US" as const,
          target: "UK" as const,
          conflictId: "fixture-war",
          currentTurn: 2,
          peaceOfferId,
        };
        await applyPeaceTerm(db, { kind: "indemnity", payer: "UK", amount: 10_000 }, ctx);
        // A replay applies nothing and witnesses nothing.
        await applyPeaceTerm(db, { kind: "indemnity", payer: "UK", amount: 10_000 }, ctx);
        expect(await treasury(db, "UK")).toBe(990_000);
        await close(db, 2);
      });

      it("names world event treasury payouts", async () => {
        const db = await world(native);
        await writeBalanceSnapshot(db, 1);
        await applyCountryTreasuryDelta(db, "UK", 2, 2_500, { eventId: "fixture" });
        await close(db, 1);
        expect(await contraReasons(db)).toEqual(["mint:world_event:GBP"]);
      });

      it("writes no ledger rows with shadow accounting off", async () => {
        const db = await world(native, false);
        await spendGlobalResponseCost(db, "UK", {
          treasuryCostPctGdp: 0.01,
        } as CrisisDecisionOption);
        await levyMobilisation(db, { armed: true, turn: 2 });
        expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
      });

      it("settles funded Treasury spending once and replays the frozen receipt", async () => {
        const db = await world(native, false, true);
        const witness = {
          flow: "crisis_response" as const,
          key: "fixture-crisis-response:UK:option-a",
          site: "test/funded-expense",
        };
        const first = await spendFromTreasury(db, "UK", 125, { witness });
        const replay = await spendFromTreasury(db, "UK", 125, { witness });

        expect(first.newTreasuryBalance).toBe(999_875);
        expect(replay.newTreasuryBalance).toBe(999_875);
        expect(await db.collection("federalBudget").findOne({ countryId: "UK" })).toMatchObject({
          treasuryCashLocal: 999_875,
          treasuryBalance: 999_875,
        });
        expect(
          await db
            .collection<{ _id: string }>("bankMoneyMoves")
            .findOne({ _id: "treasury-spend:fixture-crisis-response:UK:option-a" })
        ).toMatchObject({
          status: "applied",
          event: { command: "test/funded-expense", amount: 125 },
        });
        expect(await db.collection("bankMoneyMoves").countDocuments()).toBe(1);
      });
    }
  );
}
