/**
 * Conserved sovereign financing (#3381) across both cash phases on a native
 * replica-set Mongo. One turn of a version-stamped Cabinet-v2 world runs the
 * real SOE remittance, the real `processTreasuryTurn` (household tax net of
 * funded receipts, funded public-float coupons) and then the real
 * `settleResetTreasuryCashTurn` (department authority from what is left). No
 * cash is written between phases. The bond phase itself is not executed:
 * bonds are seeded outstanding and settlement gets no bond flows.
 *
 * Opt-in: AHD_CONSERVED_V2_MONGO_TEST_URI=mongodb://127.0.0.1:27020/?replicaSet=ahdSimRs
 * Each run uses its own disposable ahd_test_* database and drops it.
 */
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import type { GameState } from "@/lib/db/types/gameState";
import type { BondTurnResult } from "@/lib/turn/bondTurn";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getSeedCurrencyCode } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE, perTurnCouponPayment } from "@/lib/constants/bonds";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { householdMoneyBankId } from "@/lib/budget/conservedFiscalCash";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { SOVEREIGN_COUPON_CLAIMS_COLLECTION } from "@/lib/banking/fundedSovereignCoupons";
import { remitToTreasury } from "@/lib/nationalization/treasury";
import { processTreasuryTurn } from "@/lib/turn/treasuryTurn";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import { openingNationalTreasurySnapshots } from "./rules/treasurySnapshot";
import type { ResetNationalTreasurySnapshot } from "./rules/treasurySnapshot";
import type { ResetDepartmentAccountSnapshot } from "./rules/liveDepartmentAccount";
import { settleResetTreasuryCashTurn } from "./settleCashTurn";

const mongoUri = process.env.AHD_CONSERVED_V2_MONGO_TEST_URI;
const PRESET = "1991-default";
const COUNTRIES = ["US", "UK", "JP", "IE", "SCO", "WAL"] as const;
type Country = (typeof COUNTRIES)[number];
const currencyOf = (c: Country) => getSeedCurrencyCode(c as CountryId, PRESET);
const TURN = 2;
const HOUSEHOLD = 100_000;
/** Tax slice per turn: annual revenue spread evenly over the year. */
const TAX = 1_000;
const BOND_UNITS = 160;
const COUPON = perTurnCouponPayment(6, BOND_UNIT_FACE_VALUE) * BOND_UNITS;
const SOE_CAPITAL = 1_000;
const SOE_REMIT = 300;
/** Department authority per turn; JP's exceeds what the coupon leaves it. */
const AUTHORITY: Record<Country, number> = {
  US: 500,
  UK: 500,
  JP: 1_000,
  IE: 500,
  SCO: 500,
  WAL: 500,
};
const ready = { metrics: true, legislation: true, cabinet: true };
const noFlows = {
  sovereignCashProceedsByCountry: {},
  sovereignDebtFaceIssuedByCountry: {},
  sovereignCouponPaidByCountry: {},
  sovereignMaturityCashPaidByCountry: {},
  sovereignDebtFaceRetiredByCountry: {},
} as BondTurnResult;

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
    _id: "current",
    currentTurn,
    preset: PRESET,
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
  } as unknown as GameState;
}

const currencies = () => [...new Set(COUNTRIES.map(currencyOf))];

async function seed(db: Db, soeId: ObjectId) {
  await db.collection("gameConfig").insertOne({
    _id: "default" as never,
    treasuryCashLedgerEnabled: true,
    conservedSovereignFinancingEnabled: true,
    ledgerShadow: false,
  });
  await db.collection("gameState").insertOne(gameState(TURN - 1) as never);
  // SCO and WAL are activated extras; the rest are in the base registry.
  await db.collection("countryGameStates").insertMany(
    (["SCO", "WAL"] as const).map((id) => ({
      _id: id as never,
      status: "active",
      enabledForPlayers: true,
    }))
  );
  await db
    .collection("exchangeRates")
    .insertMany(currencies().map((c) => ({ _id: c as never, currencyCode: c, rate: 1 })));
  await db.collection("centralBanks").insertMany(
    currencies().map((c) => ({
      _id: householdMoneyBankId(c) as never,
      countryId: COUNTRIES.find((id) => currencyOf(id) === c),
      primeRate: 5,
      externalBroadMoney: HOUSEHOLD,
    }))
  );
  await db
    .collection("bondMarketPools")
    .insertMany(
      currencies().map((c) => ({ _id: c as never, cashLocal: 0, targetCashLocal: 0, lifetime: {} }))
    );
  await db.collection("federalBudget").insertMany(
    COUNTRIES.map((id) => ({
      _id: getNationalBudgetId(id as CountryId) as never,
      countryId: id,
      currencyCode: currencyOf(id),
      gdp: 0,
      revenue: { total: TAX * TURNS_PER_YEAR },
      spending: { total: TAX * TURNS_PER_YEAR, debtInterest: 0 },
      debt: { principal: 0, interestRate: 0, ceiling: 1_000_000 },
      treasuryBalance: 0,
      treasuryCashLocal: 0,
    }))
  );
  await db.collection("bonds").insertMany(
    COUNTRIES.map((id) => ({
      _id: new ObjectId(),
      issuerType: "sovereign",
      countryId: id,
      currencyCode: currencyOf(id),
      couponRate: 6,
      maturityTurn: 10_000,
      matured: false,
      defaulted: false,
      publicFloat: BOND_UNITS,
      holders: [],
    }))
  );
  await db.collection("corporations").insertOne({
    _id: soeId,
    countryId: "US",
    liquidCapital: SOE_CAPITAL,
    liquidCurrencyCode: "USD",
  });

  const treasuries = openingNationalTreasurySnapshots(
    "world",
    1,
    Object.fromEntries(COUNTRIES.map((c) => [c, { debt: 0, debtCeiling: 1_000_000 }]))
  ).filter((t) => (COUNTRIES as readonly string[]).includes(t.countryId));
  expect(treasuries.map((t) => t.countryId).sort()).toEqual([...COUNTRIES].sort());
  for (const treasury of treasuries) {
    treasury.departmentAccountIds = [`${treasury.countryId}:health`];
    // Synthetic legacy book cash must never become spendable money.
    treasury.cash = 1_000_000;
  }
  await db.collection("resetNationalTreasuries").insertMany(treasuries as never[]);
  await db.collection("resetDepartmentAccounts").insertMany(
    COUNTRIES.map((countryId) => {
      const annual = AUTHORITY[countryId] * TURNS_PER_YEAR;
      return {
        _id: `${countryId}:health`,
        worldId: "world",
        countryId,
        departmentId: "health",
        sourceTurn: 1,
        accruedThroughTurn: 1,
        lastAuthorityPaid: 0,
        annualAuthority: annual,
        grantReservation: 0,
        controllingSeatId: "health",
        openingAgencyNames: ["Health"],
        grossAnnualClaim: annual,
        familyGrossAnnualDemand: { L18: annual },
        familyGrantReservation: {},
        balance: 0,
        encumbered: 0,
        arrears: 0,
        externallySettled: false,
        familyAnnualDemand: { L18: annual },
        programAllocationPercents: {},
        lastProgramDelivery: {},
      };
    }) as never[]
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
}

/** Every holder of each currency: households, Treasuries, the bond pool, the SOE. */
async function money(db: Db) {
  const [banks, budgets, pools, corps, journal] = await Promise.all([
    db.collection<{ _id: string; externalBroadMoney: number }>("centralBanks").find({}).toArray(),
    db
      .collection<{ countryId: Country; treasuryCashLocal: number }>("federalBudget")
      .find({})
      .toArray(),
    db.collection<{ _id: string; cashLocal: number }>("bondMarketPools").find({}).toArray(),
    db.collection<{ liquidCapital: number }>("corporations").find({}).toArray(),
    db.collection(MONEY_MOVE_COLLECTION).countDocuments({}),
  ]);
  const stock: Record<string, number> = {};
  const add = (currency: string, v: number) => (stock[currency] = (stock[currency] ?? 0) + v);
  for (const c of currencies()) {
    add(c, banks.find((b) => b._id === householdMoneyBankId(c))?.externalBroadMoney ?? 0);
    add(c, pools.find((p) => p._id === c)?.cashLocal ?? 0);
  }
  for (const b of budgets) add(currencyOf(b.countryId), b.treasuryCashLocal);
  for (const corp of corps) add("USD", corp.liquidCapital);
  return {
    stock,
    journal,
    cash: Object.fromEntries(budgets.map((b) => [b.countryId, b.treasuryCashLocal])) as Record<
      Country,
      number
    >,
    household: Object.fromEntries(banks.map((b) => [b._id, b.externalBroadMoney])),
    pool: Object.fromEntries(pools.map((p) => [p._id, p.cashLocal])),
  };
}

describe.skipIf(!mongoUri)("conserved v2 financing chain on native Mongo", () => {
  it("collects tax once net of SOE cash, pays coupons first, then authority from what is left", async () => {
    const client = fixtureClient(mongoUri!);
    const dbName = `ahd_test_v2chain_${randomUUID().replaceAll("-", "")}`;
    const db = client.db(dbName);
    const g = globalThis as { _mongoClientPromise?: Promise<MongoClient> };
    const priorClient = g._mongoClientPromise;
    const priorDb = process.env.MONGODB_DB;
    const priorUri = process.env.MONGODB_URI;
    try {
      await client.connect();
      // The engine's getDb() resolves to this client and this disposable database.
      g._mongoClientPromise = Promise.resolve(client);
      process.env.MONGODB_DB = dbName;
      process.env.MONGODB_URI = mongoUri;
      expect(currencyOf("SCO")).toBe("GBP");
      expect(currencyOf("WAL")).toBe("GBP");
      expect(currencyOf("UK")).toBe("GBP");
      const soeId = new ObjectId();
      await seed(db, soeId);
      const opening = await money(db);

      const rates = new Map(currencies().map((c) => [c, 1]));
      const remit = () =>
        remitToTreasury(
          db,
          { countryId: "US", corpId: soeId, amountLocal: SOE_REMIT, corpCurrency: "USD" },
          new Date(),
          {
            context: {
              turn: TURN,
              preset: PRESET,
              treasuryCashLedgerEnabled: true,
              rates,
              treasuryCurrencies: new Map(COUNTRIES.map((c) => [c, currencyOf(c) as CurrencyCode])),
            },
          }
        );
      const settle = () =>
        settleResetTreasuryCashTurn({
          db,
          gameState: gameState(TURN - 1),
          turn: TURN,
          bondFlows: noFlows,
          ready,
          conserved: true,
        });

      expect(await remit()).toBe(SOE_REMIT);
      expect(await processTreasuryTurn(TURN)).toEqual({ countriesProcessed: COUNTRIES.length });

      // After the Treasury phase: tax landed once, the US slice net of the
      // real SOE receipt, and every public-float coupon is paid to the pool.
      const afterTreasury = await money(db);
      expect(afterTreasury.cash.US).toBe(TAX - COUPON);
      for (const c of COUNTRIES) expect(afterTreasury.cash[c]).toBe(TAX - COUPON);
      expect(afterTreasury.household[householdMoneyBankId("USD")]).toBe(
        HOUSEHOLD - (TAX - SOE_REMIT)
      );
      expect(afterTreasury.household[householdMoneyBankId("GBP")]).toBe(HOUSEHOLD - 3 * TAX);
      expect(afterTreasury.pool.GBP).toBe(3 * COUPON);
      expect(afterTreasury.pool.USD).toBe(COUPON);
      expect(
        await db
          .collection(SOVEREIGN_COUPON_CLAIMS_COLLECTION)
          .countDocuments({ settledTurn: { $exists: false } })
      ).toBe(0);
      expect(afterTreasury.stock).toEqual(opening.stock);

      // Department authority pays only from the cash the coupons left.
      expect(await settle()).toMatchObject({ countries: COUNTRIES.length, advanced: 6 });
      const settled = await money(db);
      const left = TAX - COUPON;
      for (const c of COUNTRIES) {
        const paid = Math.min(AUTHORITY[c], left);
        expect(settled.cash[c]).toBe(left - paid);
        const book = await db
          .collection<ResetNationalTreasurySnapshot>("resetNationalTreasuries")
          .findOne({ _id: c });
        expect(book?.cash).toBe(left - paid);
        expect(book?.conservedFunding).toMatchObject({ status: "settled", paidTotal: paid });
        const account = await db
          .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
          .findOne({ _id: `${c}:health` });
        expect(account).toMatchObject({ accruedThroughTurn: TURN, lastAuthorityPaid: paid });
        expect(account?.unpaidAuthority ?? 0).toBe(AUTHORITY[c] - paid);
        expect(book?.claimArrears?.[`${c}:health`] ?? 0).toBe(AUTHORITY[c] - paid);
      }
      expect(AUTHORITY.JP - left).toBeGreaterThan(0);
      // Shared GBP stock: UK, SCO and WAL each took tax and returned authority.
      expect(settled.household[householdMoneyBankId("GBP")]).toBe(
        HOUSEHOLD - 3 * TAX + 3 * AUTHORITY.UK
      );
      expect(settled.household[householdMoneyBankId("USD")]).toBe(
        HOUSEHOLD - (TAX - SOE_REMIT) + AUTHORITY.US
      );
      expect(settled.stock).toEqual(opening.stock);

      // Replaying every phase of the same turn moves nothing.
      expect(await remit()).toBe(0);
      await processTreasuryTurn(TURN);
      expect(await settle()).toMatchObject({ advanced: 0, replayed: COUNTRIES.length });
      const replayed = await money(db);
      expect(replayed.stock).toEqual(settled.stock);
      expect(replayed.cash).toEqual(settled.cash);
      expect(replayed.household).toEqual(settled.household);
      expect(replayed.pool).toEqual(settled.pool);
      expect(replayed.journal).toBe(settled.journal);
    } finally {
      g._mongoClientPromise = priorClient;
      if (priorDb === undefined) delete process.env.MONGODB_DB;
      else process.env.MONGODB_DB = priorDb;
      if (priorUri === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = priorUri;
      await db.dropDatabase().catch(() => undefined);
      await client.close();
    }
  }, 120_000);
});
