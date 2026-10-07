/**
 * Conserved v2 department authority (#3381) on a native replica-set Mongo.
 * Drives real version-stamped v2 countries (US, UK, JP and the GBP successor
 * SCO) through settleResetTreasuryCashTurn with the funded Treasury balance
 * as the only cash, the real settlement journal, and injected interruptions.
 *
 * Opt-in: AHD_CONSERVED_V2_MONGO_TEST_URI=mongodb://127.0.0.1:27020/?replicaSet=ahdSimRs
 * Each run uses its own disposable ahd_test_* database and drops it.
 */
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import type { GameState } from "@/lib/db/types/gameState";
import type { BondTurnResult } from "@/lib/turn/bondTurn";
import { householdMoneyBankId } from "@/lib/budget/conservedFiscalCash";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import { openingNationalTreasurySnapshots } from "./rules/treasurySnapshot";
import type { ResetNationalTreasurySnapshot } from "./rules/treasurySnapshot";
import type { ResetDepartmentAccountSnapshot } from "./rules/liveDepartmentAccount";
import { settleResetTreasuryCashTurn } from "./settleCashTurn";

const mongoUri = process.env.AHD_CONSERVED_V2_MONGO_TEST_URI;
const COUNTRIES = ["US", "UK", "JP", "SCO"] as const;
type Country = (typeof COUNTRIES)[number];
const CURRENCY: Record<Country, string> = { US: "USD", UK: "GBP", JP: "JPY", SCO: "GBP" };
const ready = { metrics: true, legislation: true, cabinet: true };
/** 480 a year is 10 a turn per department. */
const PER_TURN = 10;

function fixtureClient(uri: string): MongoClient {
  const parsed = new URL(uri);
  if (
    parsed.protocol !== "mongodb:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.port !== "27020" ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  )
    throw new Error("Conserved v2 fixtures require the isolated local sim replica set");
  return new MongoClient(uri);
}

function gameState(currentTurn: number): GameState {
  return {
    currentTurn,
    resetWorldId: "world",
    metricsSystemVersion: "v2",
    cabinetSystemVersion: "v2",
    resetVersionSeeds: Object.fromEntries(
      Object.entries(RESET_V2_SEED_REVISION).map(([system, revision]) => [
        system,
        {
          worldId: "world",
          revision,
          sourceTurn: 1,
          completedAt: "done",
          verificationHash: "verified",
          countries: [...COUNTRIES],
        },
      ])
    ),
  } as GameState;
}

const noFlows = {
  sovereignCashProceedsByCountry: {},
  sovereignDebtFaceIssuedByCountry: {},
  sovereignCouponPaidByCountry: {},
  sovereignMaturityCashPaidByCountry: {},
  sovereignDebtFaceRetiredByCountry: {},
} as BondTurnResult;

async function seed(db: Db, fundedCash: Record<Country, number>) {
  const treasuries = openingNationalTreasurySnapshots(
    "world",
    1,
    Object.fromEntries(COUNTRIES.map((c) => [c, { debt: 100, debtCeiling: 10_000 }]))
  ).filter((t) => (COUNTRIES as readonly string[]).includes(t.countryId));
  for (const treasury of treasuries) {
    treasury.departmentAccountIds = [`${treasury.countryId}:health`];
    // Synthetic legacy book cash must never become spendable money.
    treasury.cash = 1_000_000;
  }
  await db.collection("resetNationalTreasuries").insertMany(treasuries as never[]);
  await db.collection("resetDepartmentAccounts").insertMany(
    COUNTRIES.map((countryId) => ({
      _id: `${countryId}:health`,
      worldId: "world",
      countryId,
      departmentId: "health",
      sourceTurn: 1,
      accruedThroughTurn: 1,
      lastAuthorityPaid: 0,
      annualAuthority: 480,
      grantReservation: 0,
      controllingSeatId: "health",
      openingAgencyNames: ["Health"],
      grossAnnualClaim: 480,
      familyGrossAnnualDemand: { L18: 480 },
      familyGrantReservation: {},
      balance: 0,
      encumbered: 0,
      arrears: 0,
      externallySettled: false,
      familyAnnualDemand: { L18: 480 },
      programAllocationPercents: {},
      lastProgramDelivery: {},
    })) as never[]
  );
  await db.collection("resetDepartmentContinuity").insertMany(
    COUNTRIES.map((countryId) => ({
      _id: countryId,
      countryId,
      worldId: "world",
      sourceTurn: 1,
      annualAuthority: 0,
      grantReservation: 0,
    })) as never[]
  );
  await db.collection("federalBudget").insertMany(
    COUNTRIES.map((countryId) => ({
      _id: `budget-${countryId}`,
      countryId,
      currencyCode: CURRENCY[countryId],
      treasuryCashLocal: fundedCash[countryId],
      revenue: { total: 1_000_000 },
      debt: { ceiling: 10_000 },
    })) as never[]
  );
  const banks = [...new Set(Object.values(CURRENCY))].map((currency) => ({
    _id: householdMoneyBankId(currency),
    externalBroadMoney: 5_000,
  }));
  await db.collection("centralBanks").insertMany(banks as never[]);
}

async function money(db: Db) {
  const budgets = await db
    .collection<{ countryId: Country; treasuryCashLocal: number }>("federalBudget")
    .find({})
    .toArray();
  const banks = await db
    .collection<{ _id: string; externalBroadMoney: number }>("centralBanks")
    .find({})
    .toArray();
  return {
    cash: Object.fromEntries(budgets.map((b) => [b.countryId, b.treasuryCashLocal])) as Record<
      Country,
      number
    >,
    household: Object.fromEntries(banks.map((b) => [b._id, b.externalBroadMoney])),
    total:
      budgets.reduce((s, b) => s + b.treasuryCashLocal, 0) +
      banks.reduce((s, b) => s + b.externalBroadMoney, 0),
  };
}

const book = (db: Db, id: Country) =>
  db.collection<ResetNationalTreasurySnapshot>("resetNationalTreasuries").findOne({ _id: id });
const account = (db: Db, id: Country) =>
  db
    .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
    .findOne({ _id: `${id}:health` });

/** Wrap one collection method; the hook runs once, then the real call proceeds. */
function intercept(
  db: Db,
  name: string,
  method: string,
  hook: (call: () => Promise<unknown>) => Promise<unknown>
): Db {
  let fired = false;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "collection") return Reflect.get(target, prop, receiver);
      return (collectionName: string, ...rest: unknown[]) => {
        const collection = target.collection(collectionName, ...(rest as []));
        if (collectionName !== name) return collection;
        return new Proxy(collection, {
          get(c, p, r) {
            const value = Reflect.get(c, p, r);
            if (p !== method || typeof value !== "function") return value;
            return (...args: unknown[]) => {
              const call = () => value.apply(c, args);
              if (fired) return call();
              fired = true;
              return hook(call);
            };
          },
        });
      };
    },
  });
}

describe.skipIf(!mongoUri)("conserved v2 department authority on native Mongo", () => {
  it("pays from funded cash only, records arrears, survives interruption and refusal", async () => {
    const client = fixtureClient(mongoUri!);
    const db = client.db(`ahd_test_v2cash_${randomUUID().replaceAll("-", "")}`);
    try {
      await client.connect();
      // US funded, JP short, UK to be raced by a concurrent spend, SCO shares GBP.
      await seed(db, { US: 1_000, UK: 50, JP: 4, SCO: 30 });
      const before = await money(db);
      const run = (target: Db, turn: number, bondFlows = noFlows) =>
        settleResetTreasuryCashTurn({
          db: target,
          gameState: gameState(turn - 1),
          turn,
          bondFlows,
          ready,
          conserved: true,
        });
      // Bond proceeds already landed in US cash before this phase: they are
      // passed as captured flows and must NOT be counted again.
      const turn2Flows = {
        ...noFlows,
        sovereignCashProceedsByCountry: { US: 900 },
        sovereignDebtFaceIssuedByCountry: { US: 900 },
      } as BondTurnResult;

      // 1. Interruption before the first cash leg claims its journal key.
      const crashBeforeClaim = intercept(db, MONEY_MOVE_COLLECTION, "insertOne", async () => {
        throw new Error("injected crash before claim");
      });
      await expect(run(crashBeforeClaim, 2, turn2Flows)).rejects.toThrow("injected crash");
      expect((await book(db, "US"))?.conservedFunding?.status).toBe("planned");
      expect((await money(db)).total).toBe(before.total);

      // 2. A concurrent Treasury spend drains UK below its frozen plan before
      //    its leg runs, and the department write is interrupted once.
      const raced = intercept(db, "resetDepartmentAccounts", "bulkWrite", async () => {
        throw new Error("injected account crash");
      });
      await db
        .collection("federalBudget")
        .updateOne({ countryId: "UK" }, { $inc: { treasuryCashLocal: -45 } });
      await expect(run(raced, 2, turn2Flows)).rejects.toThrow("injected account crash");
      const afterRetry = await run(db, 2, turn2Flows);
      expect(afterRetry).toMatchObject({ countries: 4, accounts: 4, advanced: 4 });

      const m2 = await money(db);
      // UK spent 45 elsewhere (outside this test's ledger); everything else conserved.
      expect(m2.total).toBe(before.total - 45);
      expect(m2.cash).toEqual({ US: 990, UK: 5, JP: 0, SCO: 20 });
      expect(m2.household[householdMoneyBankId("USD")]).toBe(5_010);
      expect(m2.household[householdMoneyBankId("JPY")]).toBe(5_004);
      // Shared GBP stock: only SCO's 10 landed; UK's refused leg moved nothing.
      expect(m2.household[householdMoneyBankId("GBP")]).toBe(5_010);

      const us = (await book(db, "US"))!;
      expect(us.conservedFunding).toMatchObject({ status: "settled", paidTotal: 10 });
      expect(us.cash).toBe(990);
      expect(us.debt).toBe(1_000);
      const jp = (await book(db, "JP"))!;
      expect(jp.claimArrears?.["JP:health"]).toBe(6);
      expect((await account(db, "JP"))?.unpaidAuthority).toBe(6);
      const uk = (await book(db, "UK"))!;
      expect(uk.conservedFunding).toMatchObject({
        status: "refused",
        paidTotal: 0,
        plannedTotal: 10,
      });
      expect(uk.cash).toBe(5);
      expect(uk.claimArrears?.["UK:health"]).toBe(PER_TURN);
      expect(await account(db, "UK")).toMatchObject({
        accruedThroughTurn: 2,
        lastAuthorityPaid: 0,
        unpaidAuthority: PER_TURN,
      });
      expect(await account(db, "US")).toMatchObject({ lastAuthorityPaid: PER_TURN });

      // 3. Replaying the same turn is a no-op: no recompute from advanced arrears.
      expect(await run(db, 2, turn2Flows)).toMatchObject({ advanced: 0, replayed: 4 });
      expect((await money(db)).total).toBe(m2.total);
      expect((await book(db, "JP"))?.claimArrears?.["JP:health"]).toBe(6);

      // 4. Next turn: UK recovers its arrears from fresh funded cash.
      await db
        .collection("federalBudget")
        .updateOne({ countryId: "UK" }, { $inc: { treasuryCashLocal: 100 } });
      await db
        .collection("federalBudget")
        .updateOne({ countryId: "JP" }, { $inc: { treasuryCashLocal: 100 } });
      expect(await run(db, 3)).toMatchObject({ advanced: 4 });
      const m3 = await money(db);
      expect(m3.cash.UK).toBe(105 - 2 * PER_TURN);
      expect(m3.cash.JP).toBe(100 - (6 + PER_TURN));
      expect((await book(db, "UK"))?.claimArrears?.["UK:health"]).toBe(0);
      expect((await account(db, "JP"))?.unpaidAuthority).toBe(0);
      expect(m3.total).toBe(m2.total + 200);
    } finally {
      await db.dropDatabase().catch(() => undefined);
      await client.close();
    }
  }, 120_000);

  it("resumes a partial cash leg with its original plan, never the fallback", async () => {
    const client = fixtureClient(mongoUri!);
    const db = client.db(`ahd_test_v2cash_${randomUUID().replaceAll("-", "")}`);
    try {
      await client.connect();
      await seed(db, { US: 100, UK: 100, JP: 100, SCO: 100 });
      const before = await money(db);
      const run = (target: Db) =>
        settleResetTreasuryCashTurn({
          db: target,
          gameState: gameState(1),
          turn: 2,
          bondFlows: noFlows,
          ready,
          conserved: true,
        });
      // Treasury debit lands, then the household credit write crashes.
      const crashCredit = intercept(db, "centralBanks", "updateOne", async () => {
        throw new Error("injected credit crash");
      });
      await expect(run(crashCredit)).rejects.toThrow("injected credit crash");
      const journal = await db
        .collection<{ _id: string; status: string; legs: { applied: boolean }[] }>(
          MONEY_MOVE_COLLECTION
        )
        .findOne({ _id: "conserved-fiscal:2:US:v2authority" });
      expect(journal?.status).toBe("partial");
      expect(journal?.legs.map((leg) => leg.applied)).toEqual([true, false]);
      // Funded cash was moved and cannot be spent again for this receipt.
      await db
        .collection("federalBudget")
        .updateOne({ countryId: "US" }, { $set: { treasuryCashLocal: 0 } });
      await run(db);
      expect((await book(db, "US"))?.conservedFunding).toMatchObject({
        status: "settled",
        paidTotal: PER_TURN,
      });
      expect((await book(db, "US"))?.cash).toBe(0);
      const after = await money(db);
      expect(after.household[householdMoneyBankId("USD")]).toBe(5_000 + PER_TURN);
      expect(after.total).toBe(before.total - (100 - PER_TURN));
    } finally {
      await db.dropDatabase().catch(() => undefined);
      await client.close();
    }
  }, 120_000);
});
