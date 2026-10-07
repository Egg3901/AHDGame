/**
 * Bounded financing simulation for conserved sovereign financing (#3381).
 *
 * Runs the real Treasury phase (`processTreasuryTurn`) and the real bond-pool
 * phase (`processBondMarketPoolTurn`) for TURNS_PER_YEAR turns against a
 * disposable database on a transaction-capable replica set, at 23-country
 * volume with uniform cash fixtures and 32 public-float sovereign bonds each. Counts
 * every Mongo command per phase and checks money conservation per household
 * stock (household + Treasury cash + bond pool) every turn.
 *
 * This is NOT a full world engine run. Only the Treasury and bond-pool phases
 * execute; macro revenue and spending are fixed fixtures, not the economy
 * model, and bank-held coupon claims are not exercised.
 *
 *   MONGODB_URI=<replica set uri> MONGODB_DB=ahd_test_<name> \
 *     NODE_ENV=test npx tsx scripts/sim/conservedSovereignFinancing.ts [--out report.json]
 *
 * Refuses any database whose name does not start with `ahd_test_`, and drops it
 * before and after the run.
 */
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { BOND_UNIT_FACE_VALUE, perTurnCouponPayment } from "@/lib/constants/bonds";
import { getSeedCurrencyCode, getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { getPresetMonetaryScope } from "@/lib/monetaryPolicy/presetMonetaryScope";
import type { CountryId } from "@/lib/constants/countries";
import { roundTripBudgetFor } from "@/simulation/engine/turnPhaseBudgets";

const bondsIndex = process.argv.indexOf("--bonds");
const BONDS_PER_COUNTRY = bondsIndex > 0 ? Number(process.argv[bondsIndex + 1]) : 32;
if (!Number.isSafeInteger(BONDS_PER_COUNTRY) || BONDS_PER_COUNTRY < 1 || BONDS_PER_COUNTRY > 128)
  throw new Error("--bonds must be an integer between 1 and 128");
const UNITS_PER_BOND = 1_000;
const COUPON_RATE = 6;
/** Phase limits the result is judged against (turn phase command budget and timeout). */
const COMMAND_BUDGET = roundTripBudgetFor("treasuryTurn");
const TIMEOUT_MS = 240_000;

const dbName = process.env.MONGODB_DB ?? "";
const uri = process.env.MONGODB_URI ?? "";
if (!dbName.startsWith("ahd_test_") || !uri) {
  throw new Error("Set MONGODB_URI and an ahd_test_* MONGODB_DB; refusing any other database.");
}
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex > 0 ? process.argv[outIndex + 1] : undefined;

const turnsIndex = process.argv.indexOf("--turns");
const turnCount = turnsIndex > 0 ? Number(process.argv[turnsIndex + 1]) : TURNS_PER_YEAR;
if (!Number.isSafeInteger(turnCount) || turnCount < 1 || turnCount > TURNS_PER_YEAR) {
  throw new Error("--turns must be an integer between 1 and TURNS_PER_YEAR");
}
const PRESET = "1991-default";
const currencyFor = (country: string) => getSeedCurrencyCode(country as CountryId, PRESET);
let lastCommand = "none";

type Counter = {
  total: number;
  byOp: Record<string, number>;
  replyBytes: number;
  returnedDocuments: number;
};
let counter: Counter = { total: 0, byOp: {}, replyBytes: 0, returnedDocuments: 0 };

async function main() {
  const client = new MongoClient(uri, { monitorCommands: true });
  client.on("commandStarted", (event) => {
    if (["hello", "isMaster", "ping", "endSessions"].includes(event.commandName)) return;
    const target = event.command[event.commandName];
    const op = `${event.commandName}:${typeof target === "string" ? target : "-"}`;
    lastCommand = op;
    counter.total += 1;
    counter.byOp[op] = (counter.byOp[op] ?? 0) + 1;
  });
  client.on("commandSucceeded", (event) => {
    if (["hello", "isMaster", "ping", "endSessions"].includes(event.commandName)) return;
    counter.replyBytes += BSON.calculateObjectSize(event.reply);
    const cursor = event.reply.cursor as
      { firstBatch?: unknown[]; nextBatch?: unknown[] } | undefined;
    counter.returnedDocuments += cursor?.firstBatch?.length ?? cursor?.nextBatch?.length ?? 0;
  });
  await client.connect();
  const db = client.db(dbName);
  try {
    // The engine's getDb() reuses this client, so its commands are counted too.
    (globalThis as { _mongoClientPromise?: Promise<MongoClient> })._mongoClientPromise =
      Promise.resolve(client);
    await db.dropDatabase();

    const { processTreasuryTurn } = await import("@/lib/turn/treasuryTurn");
    const { processBondMarketPoolTurn } = await import("@/lib/bonds/marketPoolTurn");
    const { SOVEREIGN_COUPON_CLAIMS_COLLECTION } =
      await import("@/lib/banking/fundedSovereignCoupons");

    // The ECB is a monetary authority, not a fiscal country with a budget.
    const countries = getPresetMonetaryScope(PRESET).centralBankCountries;
    const couponPerTurn = perTurnCouponPayment(COUPON_RATE, BOND_UNIT_FACE_VALUE) * UNITS_PER_BOND;
    const couponsPerCountryPerTurn = couponPerTurn * BONDS_PER_COUNTRY;
    // Revenue covers coupons 3x; primary spending takes 60% of revenue.
    const annualRevenue = couponsPerCountryPerTurn * TURNS_PER_YEAR * 3;
    const annualPrimary = annualRevenue * 0.6;
    const householdOpening = annualRevenue * 20;

    const currencies = [...new Set(countries.map(currencyFor))];
    const bankIds = [...new Set(currencies.map((c) => getBankId(getCountryIdForCurrency(c))))];
    await seed(db, countries, bankIds, currencies, annualRevenue, annualPrimary, householdOpening);

    const opening = await stockByBank(db);
    const turns: Array<Record<string, unknown>> = [];
    let maxResidual = 0;
    for (let turn = 1; turn <= turnCount; turn += 1) {
      counter = { total: 0, byOp: {}, replyBytes: 0, returnedDocuments: 0 };
      let started = Date.now();
      const heartbeat = setInterval(() => {
        console.log(
          `turn ${turn}: Treasury pending, ${counter.total} commands, last ${lastCommand}`
        );
      }, 30_000);
      try {
        await processTreasuryTurn(turn);
      } finally {
        clearInterval(heartbeat);
      }
      const treasury = {
        commands: counter.total,
        ms: Date.now() - started,
        byOp: counter.byOp,
        replyBytes: counter.replyBytes,
        returnedDocuments: counter.returnedDocuments,
      };
      counter = { total: 0, byOp: {}, replyBytes: 0, returnedDocuments: 0 };
      started = Date.now();
      await processBondMarketPoolTurn(db, turn, new Date());
      const pool = { commands: counter.total, ms: Date.now() - started };

      const stock = await stockByBank(db);
      for (const [bank, value] of stock) {
        maxResidual = Math.max(maxResidual, Math.abs(value - (opening.get(bank) ?? 0)));
      }
      const budgets = await db
        .collection("federalBudget")
        .find(
          {},
          { projection: { treasuryCashLocal: 1, sovereignCouponClaims: 1, conservedFiscalCash: 1 } }
        )
        .toArray();
      // Open claims live in the claim store; a claim pinned by a pre-store
      // partial receipt can still sit on the budget's legacy array.
      const storedOpenClaims = await db
        .collection(SOVEREIGN_COUPON_CLAIMS_COLLECTION)
        .countDocuments({ settledTurn: { $exists: false } });
      turns.push({
        turn,
        treasuryCommands: treasury.commands,
        treasuryMs: treasury.ms,
        treasuryReplyBytes: treasury.replyBytes,
        treasuryReturnedDocuments: treasury.returnedDocuments,
        poolCommands: pool.commands,
        poolMs: pool.ms,
        openCouponClaims:
          storedOpenClaims +
          budgets.reduce(
            (n, b) => n + ((b.sovereignCouponClaims as unknown[] | undefined)?.length ?? 0),
            0
          ),
        treasuryCashTotal: round(budgets.reduce((n, b) => n + (b.treasuryCashLocal ?? 0), 0)),
        householdTaxArrears: round(
          budgets.reduce((n, b) => n + (b.conservedFiscalCash?.householdTaxArrearsLocal ?? 0), 0)
        ),
        primarySpendingArrears: round(
          budgets.reduce((n, b) => n + (b.conservedFiscalCash?.primarySpendingArrearsLocal ?? 0), 0)
        ),
        ...(turn === 1 ? { treasuryCommandsByOp: treasury.byOp } : {}),
      });
      console.log(
        `turn ${turn}: treasury ${treasury.commands} cmds ${treasury.ms}ms, pool ${pool.commands} cmds`
      );
    }

    const pools = await db.collection("bondMarketPools").find({}).toArray();
    const report = {
      scope:
        "Bounded financing simulation: real Treasury and bond-pool phases only, fixed macro fixtures. Not a full world engine run.",
      source: "scripts/sim/conservedSovereignFinancing.ts",
      assumptions: {
        countries: countries.length,
        currencies: currencies.length,
        householdStocks: bankIds.length,
        bondsPerCountry: BONDS_PER_COUNTRY,
        unitsPerBond: UNITS_PER_BOND,
        couponRatePct: COUPON_RATE,
        couponClaimsPerTurn: countries.length * BONDS_PER_COUNTRY,
        couponsPerCountryPerTurn: round(couponsPerCountryPerTurn),
        annualRevenuePerCountry: round(annualRevenue),
        annualPrimarySpendingPerCountry: round(annualPrimary),
        householdOpeningPerStock: round(householdOpening),
        holders: "public float only (bond market pool); bank-held claims not exercised",
        turnsPerYear: TURNS_PER_YEAR,
        turnsRun: turnCount,
      },
      limits: { commandBudget: COMMAND_BUDGET, timeoutMs: TIMEOUT_MS },
      summary: {
        maxTreasuryCommands: Math.max(...turns.map((t) => t.treasuryCommands as number)),
        maxTreasuryMs: Math.max(...turns.map((t) => t.treasuryMs as number)),
        maxPoolCommands: Math.max(...turns.map((t) => t.poolCommands as number)),
        maxConservationResidual: maxResidual,
        finalOpenCouponClaims: turns.at(-1)?.openCouponClaims,
        finalPoolCash: Object.fromEntries(pools.map((p) => [p._id, round(p.cashLocal ?? 0)])),
      },
      turns,
    };
    const qualification = {
      conserved: Number.isFinite(maxResidual) && maxResidual < 0.01,
      allCouponsPaid: report.summary.finalOpenCouponClaims === 0,
      commandBudget: report.summary.maxTreasuryCommands <= COMMAND_BUDGET,
      localTimeout: report.summary.maxTreasuryMs < TIMEOUT_MS,
    };
    Object.assign(report, { qualification });
    if (outPath) writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report.summary, qualification }, null, 2));
    if (Object.values(qualification).some((passed) => !passed)) process.exitCode = 1;
  } finally {
    await db.dropDatabase();
    await client.close();
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function stockByBank(db: Db): Promise<Map<string, number>> {
  const [banks, budgets, pools] = await Promise.all([
    db.collection("centralBanks").find({}).toArray(),
    db.collection("federalBudget").find({}).toArray(),
    db.collection("bondMarketPools").find({}).toArray(),
  ]);
  const stock = new Map<string, number>();
  const add = (bank: string, value: number) => stock.set(bank, (stock.get(bank) ?? 0) + value);
  for (const bank of banks) add(String(bank._id), bank.externalBroadMoney ?? 0);
  for (const budget of budgets) {
    const currency = currencyFor(String(budget.countryId));
    add(getBankId(getCountryIdForCurrency(currency)), budget.treasuryCashLocal ?? 0);
  }
  for (const pool of pools) {
    add(getBankId(getCountryIdForCurrency(pool._id as never)), pool.cashLocal ?? 0);
  }
  return stock;
}

async function seed(
  db: Db,
  countries: string[],
  bankIds: string[],
  currencies: string[],
  annualRevenue: number,
  annualPrimary: number,
  householdOpening: number
) {
  await db.collection("gameConfig").insertOne({
    _id: "default" as never,
    treasuryCashLedgerEnabled: true,
    conservedSovereignFinancingEnabled: true,
    ledgerShadow: false,
  });
  await db.collection("gameState").insertOne({
    _id: "current" as never,
    currentTurn: 1,
    preset: PRESET,
    startingYear: 1991,
    currentYear: 1991,
    forexEnabled: true,
    eurozoneEnabled: false,
  });
  await db
    .collection("exchangeRates")
    .insertMany(currencies.map((c) => ({ _id: c as never, currencyCode: c, rate: 1 })));
  await db.collection("centralBanks").insertMany(
    bankIds.map((id) => ({
      _id: id as never,
      countryId: countries.find((country) => getBankId(country as CountryId) === id),
      primeRate: 5,
      externalBroadMoney: householdOpening,
    }))
  );
  await db
    .collection("bondMarketPools")
    .insertMany(
      currencies.map((c) => ({ _id: c as never, cashLocal: 0, targetCashLocal: 0, lifetime: {} }))
    );
  await db.collection("federalBudget").insertMany(
    countries.map((id) => ({
      _id: (id === "US" ? "federal" : id) as never,
      countryId: id,
      currencyCode: currencyFor(id),
      gdp: annualRevenue * 4,
      debtToGdpRatio: 0.6,
      creditRating: "A",
      economicFactors: { inflationRate: 3 },
      revenue: { total: annualRevenue },
      spending: { total: annualPrimary, debtInterest: 0 },
      debt: { principal: 0, interestRate: 0 },
      treasuryBalance: 0,
      treasuryCashLocal: 0,
    }))
  );
  await db.collection("bonds").insertMany(
    countries.flatMap((id) =>
      Array.from({ length: BONDS_PER_COUNTRY }, () => ({
        _id: new ObjectId(),
        issuerType: "sovereign",
        countryId: id,
        currencyCode: currencyFor(id),
        couponRate: COUPON_RATE,
        maturityTurn: 10_000,
        matured: false,
        defaulted: false,
        publicFloat: UNITS_PER_BOND,
        holders: [],
      }))
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
