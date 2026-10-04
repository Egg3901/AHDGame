/**
 * Whole-corporation nationalization, privatization IPOs and privatization
 * auctions reconcile end to end: the real writers witness every cash leg once,
 * and the real reconciler finds no divergence, a green trial balance and nothing
 * unattributed. GBP is valued at 0.5 anchor per unit, so every flow crosses a
 * non-anchor currency.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { writeBalanceSnapshot, writePreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import { reconcileTurn } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import type { NationalizationAuction } from "@/lib/db/types";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { nationalizeSector, nationalizeWholeCorp } from "./ownershipTransition";
import { nationalizeSectorWide } from "./nationalizeSectorWide";
import { privatizeAsset } from "./privatizeAsset";
import { placeAuctionBid, resolveNationalizationAuction } from "./privatizationAuction";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
// Politics, notices, order-book cleanup and CEO selection move no cash here.
vi.mock("./consequences/apply", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./consequences/apply")>()),
  applyNationalizationConsequences: vi.fn().mockResolvedValue({}),
  applyPrivatizationConsequences: vi.fn().mockResolvedValue({}),
}));
vi.mock("./ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ledger")>()),
  recordNationalizationLedger: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./privatizationNotifications", () => ({
  notifyCountryResidents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wireEvent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/wireEvent")>()),
  logWireEvent: vi.fn(),
}));
vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCorporations: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/corporations/releaseHeldBondsToFloat", () => ({
  releaseCorporationHeldBondsToFloat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/economy/queries/privateEnterpriseGate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/economy/queries/privateEnterpriseGate")>()),
  assertPrivateEnterprisePermitted: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/corporations/marketShare", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/corporations/marketShare")>()),
  fetchSectorMarketSharePercent: vi.fn().mockResolvedValue(10),
}));
vi.mock("@/lib/corporations/subsidiaries/nppCeoSelection", () => ({
  pickOrCreateNppCeoForNewCorp: vi.fn(async () => new ObjectId()),
}));
vi.mock("@/lib/db/sequentialId", () => ({ getNextSequentialId: vi.fn().mockResolvedValue(7) }));

const nativeEnabled = process.env.AHD_STATE_OWNERSHIP_CASH_REAL_MONGO === "1";
let client: MongoClient | undefined;
afterAll(async () => {
  await client?.close();
});
beforeEach(() => {
  resetLedgerShadowFlagCache();
  resetCorpFxRateCacheForTests();
});

async function world(native: boolean, shadow = true, treasuryCashLedger = false) {
  let db: Db;
  if (native) {
    const uri = new URL(
      process.env.AHD_STATE_OWNERSHIP_CASH_MONGO_URI ?? "mongodb://127.0.0.1:27018"
    );
    if (
      uri.protocol !== "mongodb:" ||
      !["127.0.0.1", "localhost"].includes(uri.hostname) ||
      !["27018", "27020"].includes(uri.port) ||
      uri.username ||
      uri.password ||
      (uri.pathname && uri.pathname !== "/") ||
      uri.search
    )
      throw new Error("Native state ownership fixtures require a local sandbox endpoint");
    client ??= await MongoClient.connect(uri.toString(), { maxPoolSize: 1 });
    db = client.db(`ahd_sim_fixture_natcash_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  } else db = createInMemoryDb() as unknown as Db;
  await db
    .collection<{ _id: string; ledgerShadow: boolean; treasuryCashLedgerEnabled?: boolean }>(
      "gameConfig"
    )
    .insertOne({
      _id: "default",
      ledgerShadow: shadow,
      treasuryCashLedgerEnabled: treasuryCashLedger,
    });
  await db
    .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
    .insertOne({ _id: "current", currentTurn: 1, preset: "2019-default" });
  await db.collection("exchangeRates").insertMany([
    { currencyCode: "GBP", rate: 0.5 },
    { currencyCode: "USD", rate: 1 },
  ]);
  await db.collection("federalBudget").insertMany([
    {
      countryId: "UK",
      currencyCode: "GBP",
      treasuryBalance: 1_000_000,
      treasuryCashLocal: 1_000_000,
    },
    {
      countryId: "US",
      currencyCode: "USD",
      treasuryBalance: 1_000_000,
      treasuryCashLocal: 1_000_000,
    },
  ]);
  const natCorpId = new ObjectId();
  await db.collection("corporations").insertOne({
    _id: natCorpId,
    name: "Fixture National Corporation",
    countryId: "UK",
    countryOwnerId: "UK",
    isPrimaryNationalCorporation: true,
    ownershipState: "stateOwned",
    liquidCapital: 10_000,
    liquidCurrencyCode: "GBP",
    totalShares: 1_000,
    sharePrice: 1,
    shareholders: [],
  });
  vi.mocked(getDb).mockResolvedValue(db);
  return { db, natCorpId };
}

async function close(db: Db, entries: number) {
  await writePreForexBalanceCheckpoint(db, 2);
  await writeBalanceSnapshot(db, 2);
  const report = await reconcileTurn(db, 2);
  expect(report?.stockVsFlow.skipped).toBe(false);
  expect(report?.stockVsFlow.findings ?? []).toEqual([]);
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

async function seizable(db: Db) {
  const ids = {
    target: new ObjectId(),
    ceo: new ObjectId(),
    holder: new ObjectId(),
    investor: new ObjectId(),
    fund: new ObjectId(),
    holding: new ObjectId(),
  };
  await db.collection("characters").insertMany([
    {
      _id: ids.ceo,
      name: "Fixture CEO",
      countryId: "UK",
      currencyBalances: { personal: { GBP: 1_000 } },
    },
    {
      _id: ids.holder,
      name: "Fixture Holder",
      countryId: "UK",
      currencyBalances: { personal: { GBP: 2_000 } },
    },
  ]);
  await db.collection("indexFunds").insertOne({
    _id: ids.fund,
    name: "Fixture Fund",
    anchorCurrencyCode: "USD",
    cashAnchor: 5_000,
    holdings: [{ corporationId: ids.target, shares: 100 }],
  });
  await db.collection("corporations").insertMany([
    {
      _id: ids.target,
      name: "Fixture Target",
      countryId: "UK",
      ceoId: ids.ceo,
      ceoVacant: false,
      ownershipState: "private",
      liquidCapital: 40_000,
      liquidCurrencyCode: "GBP",
      totalShares: 1_000,
      sharePrice: 1,
      publicFloat: 400,
      sequentialId: 11,
      shareholders: [
        { characterId: ids.holder, shares: 300 },
        { corporationId: ids.investor, shares: 200 },
        { fundId: ids.fund, shares: 100 },
      ],
    },
    {
      _id: ids.investor,
      name: "Fixture Investor",
      countryId: "US",
      liquidCapital: 3_000,
      liquidCurrencyCode: "USD",
      totalShares: 100,
      sharePrice: 1,
      shareholders: [],
    },
    {
      _id: ids.holding,
      name: "Fixture Holding",
      countryId: "US",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
      totalShares: 100,
      sharePrice: 10,
      shareholders: [{ corporationId: ids.target, shares: 50, avgCostPerShare: 8 }],
    },
  ]);
  // Debt makes the buyout smaller than the cash, so the CEO receives a surplus.
  await db.collection("bonds").insertOne({
    corporationId: ids.target,
    matured: false,
    totalIssued: 35_000,
    currencyCode: "GBP",
  });
  return ids;
}

async function openAuction(db: Db, natCorpId: ObjectId, shellCash: number) {
  const shellId = new ObjectId();
  const auctionId = new ObjectId();
  await db.collection("corporations").insertOne({
    _id: shellId,
    name: "Fixture Shell",
    countryId: "UK",
    ownershipState: "private",
    liquidCapital: shellCash,
    liquidCurrencyCode: "GBP",
    totalShares: 1_000,
    sharePrice: 1,
    shareholders: [{ corporationId: natCorpId, shares: 1_000 }],
    publicFloat: 0,
    suspended: true,
    hiddenFromExchange: true,
    isPrivate: true,
    sequentialId: 12,
  });
  await db.collection<NationalizationAuction>("nationalizationAuctions").insertOne({
    _id: auctionId,
    corporationId: shellId,
    countryId: "UK",
    primaryNationalCorporationId: natCorpId,
    openedAtTurn: 1,
    closesAtTurn: 2,
    reservePrice: 1_000,
    reserveCurrency: "GBP",
    goldenSharePercent: 0.1,
    status: "open",
    bids: [],
    bidHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { shellId, auctionId };
}

async function auctionDoc(db: Db, auctionId: ObjectId) {
  const doc = await db
    .collection<NationalizationAuction>("nationalizationAuctions")
    .findOne({ _id: auctionId });
  if (!doc) throw new Error("fixture auction missing");
  return doc;
}

for (const native of [false, true]) {
  describe.skipIf(native && !nativeEnabled)(
    `state ownership cash (${native ? "native Mongo" : "memory"})`,
    () => {
      it("settles a whole-corporation nationalization through the seized corporation", async () => {
        const { db, natCorpId } = await world(native);
        const ids = await seizable(db);
        await writeBalanceSnapshot(db, 1);
        const result = await nationalizeWholeCorp(db, {
          countryId: "UK",
          corporationId: ids.target,
          tier: "discounted",
          consequence: { method: "executive", triggers: [], turn: 2 },
        });
        // Valuation: 80,000 cash + 500 held shares - 70,000 debt, discounted (0.5) at
        // the 5x buyout premium. The held shares are paid for in the buyout (#3041).
        expect(result.shareholderPayoutAnchor).toBeCloseTo(26_250, 6);
        expect(await db.collection("corporations").countDocuments({ _id: ids.target })).toBe(0);
        // Pool, three holder rows, float, CEO surplus, recoup, dissolution.
        await close(db, 8);
        const contras = await contraAccounts(db);
        expect(contras.filter((a) => !a.startsWith("corporation:"))).toEqual([
          "mint:corporation_liquidation:GBP",
          "mint:corporation_liquidation:GBP",
          "sink:corporation_liquidation:GBP",
        ]);
        // Every other contra is the seized corporation the buyout passes through.
        const target = ids.target.toString();
        expect(
          contras.filter((a) => a.startsWith("corporation:")).map((a) => a.split(":")[1])
        ).toEqual(Array(5).fill(target));
        // The National Corporation takes the shares and no cash for them.
        const natCorp = await db.collection("corporations").findOne({ _id: natCorpId });
        expect(natCorp?.liquidCapital).toBe(10_000);
        const holding = await db.collection("corporations").findOne({ _id: ids.holding });
        expect(holding?.shareholders).toEqual([
          { corporationId: natCorpId, shares: 50, avgCostPerShare: 8 },
        ]);
      });

      it.skipIf(native)(
        "reports the original funded compensation when retry valuation has fallen to zero",
        async () => {
          const { db, natCorpId } = await world(false, true, true);
          const donorId = new ObjectId();
          const sectorId = new ObjectId();
          await db.collection("corporations").insertOne({
            _id: donorId,
            name: "Fixture Sector Donor",
            countryId: "UK",
            liquidCapital: 10_000,
            liquidCurrencyCode: "GBP",
            totalShares: 100,
            sharePrice: 100,
            shareholders: [],
          });
          await db.collection("corporateSectors").insertOne({
            _id: sectorId,
            corporationId: donorId,
            countryId: "UK",
            stateId: "LON",
            sectorType: "energy",
            revenue: 1_000_000,
            profitMargin: 0.5,
            workers: 10,
            currentGrowthCost: 0,
          });
          const params = {
            countryId: "UK" as const,
            sectorId,
            tier: "fair" as const,
            consequence: { method: "executive" as const, triggers: [] as [], turn: 2 },
          };
          const crashing = withInjectedCrash(db as unknown as InMemoryDb, {
            collection: "federalBudget",
            op: "updateOne",
            onCall: 1,
            afterWrite: true,
          });

          await expect(nationalizeSector(crashing.db, params)).rejects.toBeInstanceOf(
            InjectedCrash
          );
          const receipt = await db
            .collection<{
              _id: string;
              legs: { kind: string; amount: number; collection?: string; path?: string }[];
              event?: { meta?: { payoutAnchor?: number } };
            }>("bankMoneyMoves")
            .findOne({
              _id: `treasury-nationalization-compensation:nationalize-sector:UK:${sectorId.toHexString()}:1`,
            });
          const originalAnchor = receipt?.event?.meta?.payoutAnchor;
          const originalDonorCredit = receipt?.legs.find(
            (leg) => leg.kind === "credit" && leg.collection === "corporations"
          )?.amount;
          expect(originalAnchor).toBeGreaterThan(0);
          expect(originalDonorCredit).toBeGreaterThan(0);

          const treasuryAfterCrash = await db
            .collection("federalBudget")
            .findOne({ countryId: "UK" });
          await db
            .collection<{ _id: string; treasuryCashLedgerEnabled?: boolean }>("gameConfig")
            .updateOne({ _id: "default" }, { $set: { treasuryCashLedgerEnabled: false } });
          await expect(nationalizeSector(db, params)).rejects.toThrow(
            "Funded nationalization retry requires its original Treasury cash mode"
          );
          expect(
            (await db.collection("federalBudget").findOne({ countryId: "UK" }))?.treasuryCashLocal
          ).toBe(treasuryAfterCrash?.treasuryCashLocal);
          await db
            .collection<{ _id: string; treasuryCashLedgerEnabled?: boolean }>("gameConfig")
            .updateOne({ _id: "default" }, { $set: { treasuryCashLedgerEnabled: true } });

          await db
            .collection("corporateSectors")
            .updateOne({ _id: sectorId }, { $set: { revenue: 0, profitMargin: 0 } });
          const result = await nationalizeSector(db, params);

          expect(result.nationalCorporationId).toEqual(natCorpId);
          expect(result.compensationPaid).toBe(originalDonorCredit);
          const { applyNationalizationConsequences } = await import("./consequences/apply");
          expect(vi.mocked(applyNationalizationConsequences)).toHaveBeenLastCalledWith(
            db,
            expect.objectContaining({ compensationAnchor: originalAnchor })
          );
        }
      );

      it.skipIf(native)(
        "retries a funded whole-corp taking with its original property reservation and frozen holder cohort",
        async () => {
          const { db, natCorpId } = await world(false, true, true);
          const ids = await seizable(db);
          const sectorId = new ObjectId();
          await db.collection("corporateSectors").insertOne({
            _id: sectorId,
            corporationId: ids.target,
            countryId: "UK",
            stateId: "LON",
            sectorType: "energy",
            revenue: 10_000,
            profitMargin: 0.2,
            workers: 10,
            currentGrowthCost: 0,
          });
          const params = {
            countryId: "UK" as const,
            corporationId: ids.target,
            tier: "discounted" as const,
            consequence: { method: "executive" as const, triggers: [] as [], turn: 2 },
          };
          const budget = db.collection("federalBudget");
          const before = await budget.findOne({ countryId: "UK" });
          const crashing = withInjectedCrash(db as unknown as InMemoryDb, {
            collection: "corporateSectors",
            op: "updateOne",
            onCall: 2,
          });

          await expect(nationalizeWholeCorp(crashing.db, params)).rejects.toBeInstanceOf(
            InjectedCrash
          );
          const afterFirstAttempt = await budget.findOne({ countryId: "UK" });
          expect(afterFirstAttempt?.treasuryCashLocal).not.toBe(before?.treasuryCashLocal);
          expect(await db.collection("corporations").countDocuments({ _id: ids.target })).toBe(1);
          const heldSector = await db
            .collection("corporateSectors")
            .findOne({ corporationId: ids.target });
          expect(heldSector?.constructionPropertyTransition?.key).toContain(
            `nationalize:UK:${ids.target.toHexString()}:2:`
          );

          await nationalizeWholeCorp(db, params);
          const afterRetry = await budget.findOne({ countryId: "UK" });
          expect(afterRetry?.treasuryCashLocal).toBe(afterFirstAttempt?.treasuryCashLocal);
          expect(await db.collection("corporations").countDocuments({ _id: ids.target })).toBe(0);
          expect(
            await db
              .collection("corporateSectors")
              .countDocuments({ corporationId: natCorpId, nationalizedAtTurn: 2 })
          ).toBe(1);
          const buyout = await db
            .collection<{ _id: string; status?: string }>("bankMoneyMoves")
            .findOne({
              _id: `treasury-nationalization-buyout:nationalize-corporation:UK:${ids.target.toHexString()}:2`,
            });
          expect(buyout?.status).toBe("applied");
        }
      );

      it.skipIf(native)(
        "fails closed when a funded whole-corp retry sees the cash ledger disabled",
        async () => {
          const { db } = await world(false, true, true);
          const ids = await seizable(db);
          const sectorId = new ObjectId();
          await db.collection("corporateSectors").insertOne({
            _id: sectorId,
            corporationId: ids.target,
            countryId: "UK",
            stateId: "LON",
            sectorType: "energy",
            revenue: 10_000,
            profitMargin: 0.2,
            workers: 10,
            currentGrowthCost: 0,
          });
          const params = {
            countryId: "UK" as const,
            corporationId: ids.target,
            tier: "discounted" as const,
            consequence: { method: "executive" as const, triggers: [] as [], turn: 2 },
          };
          const budget = db.collection("federalBudget");
          const crashing = withInjectedCrash(db as unknown as InMemoryDb, {
            collection: "corporateSectors",
            op: "updateOne",
            onCall: 2,
          });

          await expect(nationalizeWholeCorp(crashing.db, params)).rejects.toBeInstanceOf(
            InjectedCrash
          );
          const afterFunding = await budget.findOne({ countryId: "UK" });
          const holder = await db.collection("characters").findOne({ _id: ids.holder });
          const holderCashAfterFunding = holder?.currencyBalances?.personal?.GBP;
          await db
            .collection<{ _id: string; treasuryCashLedgerEnabled?: boolean }>("gameConfig")
            .updateOne({ _id: "default" }, { $set: { treasuryCashLedgerEnabled: false } });

          await expect(nationalizeWholeCorp(db, params)).rejects.toThrow(
            "Funded nationalization retry requires Treasury cash"
          );

          expect((await budget.findOne({ countryId: "UK" }))?.treasuryCashLocal).toBe(
            afterFunding?.treasuryCashLocal
          );
          expect(
            (await db.collection("characters").findOne({ _id: ids.holder }))?.currencyBalances
              ?.personal?.GBP
          ).toBe(holderCashAfterFunding);
          expect(await db.collection("corporations").countDocuments({ _id: ids.target })).toBe(1);
        }
      );

      it.skipIf(native)(
        "fails closed when a funded sector-sweep retry sees the cash ledger disabled",
        async () => {
          const { db } = await world(false, true, true);
          const donorId = new ObjectId();
          const sectorId = new ObjectId();
          await db.collection("corporations").insertOne({
            _id: donorId,
            name: "Fixture Sweep Donor",
            countryId: "UK",
            liquidCapital: 10_000,
            liquidCurrencyCode: "GBP",
            totalShares: 100,
            sharePrice: 100,
            shareholders: [],
          });
          await db.collection("corporateSectors").insertOne({
            _id: sectorId,
            corporationId: donorId,
            countryId: "UK",
            stateId: "LON",
            sectorType: "energy",
            revenue: 1_000_000,
            profitMargin: 0.5,
            workers: 10,
            currentGrowthCost: 0,
          });
          const params = {
            countryId: "UK" as const,
            sectorType: "energy",
            carveFraction: 1,
            scope: "corporations" as const,
            tier: "fair" as const,
            consequence: { method: "executive" as const, triggers: [] as [], turn: 2 },
          };
          const crashing = withInjectedCrash(db as unknown as InMemoryDb, {
            collection: "federalBudget",
            op: "updateOne",
            onCall: 1,
            afterWrite: true,
          });

          await expect(nationalizeSectorWide(crashing.db, params)).rejects.toBeInstanceOf(
            InjectedCrash
          );
          const afterFunding = await db.collection("federalBudget").findOne({ countryId: "UK" });
          const heldSector = await db.collection("corporateSectors").findOne({ _id: sectorId });
          expect(heldSector?.pendingFundedNationalization?.operationKey).toContain(
            "nationalize-sector-wide:UK:"
          );
          await db
            .collection<{ _id: string; treasuryCashLedgerEnabled?: boolean }>("gameConfig")
            .updateOne({ _id: "default" }, { $set: { treasuryCashLedgerEnabled: false } });

          await expect(nationalizeSectorWide(db, params)).rejects.toThrow(
            "Funded nationalization retry requires its original Treasury cash mode"
          );

          expect(
            (await db.collection("federalBudget").findOne({ countryId: "UK" }))?.treasuryCashLocal
          ).toBe(afterFunding?.treasuryCashLocal);
          expect(await db.collection("corporations").countDocuments({ _id: donorId })).toBe(1);
        }
      );

      it("names the IPO float proceeds as a mint", async () => {
        const { db, natCorpId } = await world(native);
        const sectorId = new ObjectId();
        await db.collection("corporateSectors").insertOne({
          _id: sectorId,
          corporationId: natCorpId,
          countryId: "UK",
          stateId: "LON",
          sectorType: "energy",
          revenue: 100_000,
          profitMargin: 0.2,
          workers: 100,
          currentGrowthCost: 0,
          currentGrowthRate: 0,
          targetGrowthRate: 0,
        });
        await writeBalanceSnapshot(db, 1);
        const result = await privatizeAsset(db, {
          countryId: "UK",
          sourceNationalCorporationId: natCorpId,
          selections: [{ sectorId, carveFraction: 0.5 }],
          newCorpName: "Fixture Spinout",
          goldenSharePercent: 0,
          method: "ipo",
          turn: 2,
        });
        expect(result.proceedsLocal).toBeGreaterThan(0);
        await close(db, 1);
        expect(await contraAccounts(db)).toEqual(["mint:privatization_ipo:GBP"]);
      });

      it("pairs auction escrow, the outbid refund and the sale proceeds", async () => {
        const { db, natCorpId } = await world(native);
        const { auctionId } = await openAuction(db, natCorpId, 0);
        const bidder = new ObjectId();
        const buyerCeo = new ObjectId();
        const buyer = new ObjectId();
        await db.collection("characters").insertMany([
          { _id: bidder, countryId: "UK", currencyBalances: { personal: { GBP: 10_000 } } },
          { _id: buyerCeo, countryId: "UK", currencyBalances: { personal: { GBP: 0 } } },
        ]);
        await db.collection("corporations").insertOne({
          _id: buyer,
          name: "Fixture Buyer",
          countryId: "UK",
          ceoId: buyerCeo,
          ceoVacant: false,
          liquidCapital: 20_000,
          liquidCurrencyCode: "GBP",
          totalShares: 100,
          sharePrice: 1,
          shareholders: [],
        });
        await writeBalanceSnapshot(db, 1);
        await placeAuctionBid(db, { auctionId, characterId: bidder, amount: 3_000, turn: 2 });
        await placeAuctionBid(db, {
          auctionId,
          characterId: buyerCeo,
          asCorporationId: buyer,
          amount: 5_000,
          turn: 2,
        });
        expect(await resolveNationalizationAuction(db, await auctionDoc(db, auctionId), 2)).toBe(
          "sold"
        );
        // Two escrows, the outbid refund and the treasury's proceeds.
        await close(db, 4);
        expect(await contraAccounts(db)).toEqual([
          "mint:privatization_auction_escrow:GBP",
          "mint:privatization_auction_escrow:GBP",
          "sink:privatization_auction_escrow:GBP",
          "sink:privatization_auction_escrow:GBP",
        ]);
        const budget = await db.collection("federalBudget").findOne({ countryId: "UK" });
        expect(budget?.treasuryBalance).toBe(1_005_000);
      });

      it("returns a passed-in shell's cash to the National Corporation", async () => {
        const { db, natCorpId } = await world(native);
        const { auctionId, shellId } = await openAuction(db, natCorpId, 700);
        await writeBalanceSnapshot(db, 1);
        expect(await resolveNationalizationAuction(db, await auctionDoc(db, auctionId), 2)).toBe(
          "passedIn"
        );
        expect(await db.collection("corporations").countDocuments({ _id: shellId })).toBe(0);
        await close(db, 2);
        expect(await contraAccounts(db)).toEqual([
          "mint:corporation_liquidation:GBP",
          "sink:corporation_liquidation:GBP",
        ]);
      });

      it("writes no ledger rows with shadow accounting off", async () => {
        const { db } = await world(native, false);
        const ids = await seizable(db);
        await nationalizeWholeCorp(db, {
          countryId: "UK",
          corporationId: ids.target,
          tier: "discounted",
          consequence: { method: "executive", triggers: [], turn: 2 },
        });
        expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
      });
    }
  );
}
