/**
 * An index listing petition reconciles on both branches: paid to a seated
 * holder, or to the treasury when nobody holds the seat. The treasury branch
 * witnesses what the treasury actually received, in its own currency.
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
import type { Corporation } from "@/lib/db/types";
import { resolveMergerAuthority } from "@/lib/corporations/mergerReview/authority";
import { fileListingPetition } from "./service";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/corporations/mergerReview/authority", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/corporations/mergerReview/authority")>()),
  resolveMergerAuthority: vi.fn(),
}));

const nativeEnabled = process.env.AHD_PETITION_CASH_REAL_MONGO === "1";
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
    const uri = new URL(process.env.AHD_PETITION_CASH_MONGO_URI ?? "mongodb://127.0.0.1:27018");
    if (
      uri.protocol !== "mongodb:" ||
      !["127.0.0.1", "localhost"].includes(uri.hostname) ||
      !["27018", "27020"].includes(uri.port) ||
      uri.username ||
      uri.password ||
      (uri.pathname && uri.pathname !== "/") ||
      uri.search
    )
      throw new Error("Native petition fixtures require a local sandbox endpoint");
    client ??= await MongoClient.connect(uri.toString(), { maxPoolSize: 1 });
    db = client.db(`ahd_sim_fixture_petition_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  } else db = createInMemoryDb() as unknown as Db;
  await db
    .collection<{ _id: string; ledgerShadow: boolean }>("gameConfig")
    .insertOne({ _id: "default", ledgerShadow: true });
  // Turn 1 is processed; turn 2 is accumulating.
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
  const corporation = {
    _id: new ObjectId(),
    name: "Fixture Listed",
    countryId: "UK",
    isPrivate: false,
    liquidCapital: 100_000,
    liquidCurrencyCode: "GBP",
  } as unknown as Corporation;
  await db.collection("corporations").insertOne(corporation);
  vi.mocked(getDb).mockResolvedValue(db);
  return { db, corporation };
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

async function contraAccounts(db: Db): Promise<string[]> {
  const entries = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
  return entries
    .flatMap((entry) => entry.legs)
    .filter((leg) => leg.role === "contra")
    .map((leg) => leg.account)
    .sort();
}

const file = (db: Db, corporation: Corporation) =>
  fileListingPetition({
    db,
    corporation,
    filedByCharacterId: new ObjectId(),
    contributionAnchor: 1_000,
    currentTurn: 2,
    currentYear: 2019,
  });

for (const native of [false, true]) {
  describe.skipIf(native && !nativeEnabled)(
    `index listing petition cash (${native ? "native Mongo" : "memory"})`,
    () => {
      it("witnesses the treasury's receipt in its own currency when nobody holds the seat", async () => {
        const { db, corporation } = await world(native);
        vi.mocked(resolveMergerAuthority).mockResolvedValue({
          seatId: "fixture-seat",
          seatName: "Fixture Authority",
        } as never);
        await writeBalanceSnapshot(db, 1);
        expect((await file(db, corporation)).ok).toBe(true);
        // The corporation's row and the treasury witness; the treasury row is the record.
        await close(db, 2);
        expect(await contraAccounts(db)).toEqual([
          "mint:index_listing_lobbying:GBP",
          "sink:index_listing_lobbying:GBP",
        ]);
        const row = await db
          .collection("financialTxLog")
          .findOne({ type: "index_listing_lobbying", subjectType: "government" });
        expect(row?.amount).toBe(500);
        expect(row?.currencyCode).toBe("GBP");
        // 1,000 anchor at 0.5 GBP per anchor: the corporation pays 500 GBP (#3042).
        const payer = await db.collection("corporations").findOne({ _id: corporation._id });
        expect(payer?.liquidCapital).toBe(99_500);
      });

      it("pays a seated holder through two linked rows", async () => {
        const { db, corporation } = await world(native);
        const holder = new ObjectId();
        await db.collection("characters").insertOne({
          _id: holder,
          name: "Fixture Holder",
          countryId: "UK",
          currencyBalances: { personal: { GBP: 0 } },
        });
        vi.mocked(resolveMergerAuthority).mockResolvedValue({
          seatId: "fixture-seat",
          seatName: "Fixture Authority",
          holderCharacterId: holder,
          holderName: "Fixture Holder",
        } as never);
        await writeBalanceSnapshot(db, 1);
        expect((await file(db, corporation)).ok).toBe(true);
        await close(db, 2);
        expect(await contraAccounts(db)).toEqual([
          `character:${holder.toString()}:GBP`,
          `corporation:${corporation._id.toString()}:GBP`,
        ]);
        // The holder receives exactly what the corporation paid, in its currency.
        const paid = await db.collection("characters").findOne({ _id: holder });
        expect(paid?.currencyBalances?.personal?.GBP).toBe(500);
        const payer = await db.collection("corporations").findOne({ _id: corporation._id });
        expect(payer?.liquidCapital).toBe(99_500);
      });
    }
  );
}
