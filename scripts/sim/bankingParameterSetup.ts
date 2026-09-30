/** Explicitly funded parameter fixtures use retained currency context and production settlement. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ObjectId, type Db, type Document } from "mongodb";
import type { Corporation, Character } from "@/lib/db/types";
import type { BankCharterType } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getCurrencyFxRate } from "@/lib/currency/corporationCapital";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { oid } from "@/lib/banking/rules/boundary";
import { injectBankCapital } from "@/lib/banking/bankCash";
import { getRateCorridors, clampOffsets } from "@/lib/banking/regulationQ";
import { corridorDepositTarget } from "@/lib/banking/npcBanks";
import { getEffectiveBankRates, setBankRates } from "@/lib/banking/rates";
import { getReserveRequirement, setReserveRequirement } from "@/lib/banking/reserves";
import { setBranchCapacityShare } from "@/lib/banking/capacityAllocation";

export const BANK = new ObjectId("000000000000000000002118");
export const BORROWER = new ObjectId("000000000000000000002119");
export const SAVER = new ObjectId("000000000000000000002120");
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface ParameterCase {
  id: string;
  currency: "USD" | "GBP" | "IEP";
  charter: BankCharterType;
  branchShare?: number;
  reserve?: number;
  depositRate?: "low" | "high" | "charter-default";
  lendingRate?: "low" | "high" | "charter-default";
  withdrawal?: number;
  defaultShock?: boolean;
  windowBridge?: boolean;
}
export interface RetainedContext {
  rows: Record<string, Document[]>;
  banks: Corporation[];
  character: Character;
  hash: string;
}
const CONTEXT = [
  "gameState",
  "gameConfig",
  "centralBanks",
  "exchangeRates",
  "bankingLaws",
  "federalBudget",
  "systemSettings",
];
export async function loadRetainedContext(source: Db): Promise<RetainedContext> {
  const rows: Record<string, Document[]> = {};
  for (const name of CONTEXT)
    rows[name] = await source.collection(name).find({}).sort({ _id: 1 }).toArray();
  const banks = await source
    .collection<Corporation>("corporations")
    .find({
      "bankCharter.status": "active",
      "bankCharter.currency": { $in: ["USD", "GBP", "IEP"] },
    })
    .sort({ _id: 1 })
    .toArray();
  const character = await source.collection<Character>("characters").findOne({});
  assert(character && banks.length >= 3);
  assert(
    rows.gameConfig.some((row) => row.privateBankingEnabled === true),
    "Retained reference must have banking enabled"
  );
  assert(
    banks.some(
      (bank) => (bank.bankCharter?.npcDeposits ?? 0) > 0 && (bank.bankCharter?.totalLoans ?? 0) > 0
    ),
    "An empty off-flag world is not a banking reference"
  );
  return { rows, banks, character, hash: hash({ rows, banks, character }) };
}
export async function transfer(
  db: Db,
  key: string,
  currency: CurrencyCode,
  amount: number,
  from: { collection: string; filter: Record<string, unknown>; path: string },
  to: { collection: string; filter: Record<string, unknown>; path: string },
  turn: number
) {
  if (amount <= 0) return;
  const settled = await settleTransition(db, {
    key,
    kind: "banking_parameter_fixture_transfer",
    turn,
    currency,
    legs: [
      { kind: "debit", amount, ...from, note: "explicit scenario funding source" },
      { kind: "credit", amount, ...to, note: "explicit scenario recipient" },
    ],
    projections: [],
    event: { kind: "charter.issued", command: "sim.parameter.transfer", amount },
  });
  assert(
    ["applied", "replayed"].includes(settled.status),
    `${key}: ${settled.error ?? settled.status}`
  );
}
export async function setupCase(db: Db, context: RetainedContext, scenario: ParameterCase) {
  // This database was exclusively created by the runner. Each case starts from the same context.
  for (const row of await db.listCollections({}, { nameOnly: true }).toArray())
    await db.collection(row.name).deleteMany({});
  for (const [name, rows] of Object.entries(context.rows))
    if (rows.length) await db.collection(name).insertMany(rows.map((row) => ({ ...row })));
  const template = context.banks.find((bank) => bank.bankCharter?.currency === scenario.currency);
  assert(template?.bankCharter);
  const country = getCountryIdForCurrency(scenario.currency),
    centralBankId = getBankId(country);
  const currency = scenario.currency as CurrencyCode;
  await db.collection("gameConfig").updateOne(
    { _id: "default" as never },
    {
      $set: {
        privateBankingEnabled: true,
        bankPropTradingEnabled: true,
        bankContagionEnabled: true,
        savingsAccountsMode: "authoritative",
        savingsAccountsReadCurrencies: [currency],
      },
    }
  );
  const sourceState = context.rows.gameState.find((row) => row._id === "current");
  const turn = Number(sourceState?.currentTurn ?? 565);
  await db
    .collection("gameState")
    .updateOne({ _id: "current" as never }, { $set: { currentTurn: turn } });
  const fx = await getCurrencyFxRate(db, currency);
  assert(Number.isFinite(fx) && fx > 0);
  const native = (anchor: number) => Math.round(anchor * fx * 100) / 100;
  const bank = {
    ...template,
    _id: BANK,
    name: `Parameter ${scenario.charter} bank`,
    liquidCapital: 0,
    liquidCurrencyCode: currency,
    bankCharter: {
      ...template.bankCharter,
      type: scenario.charter,
      status: "active" as const,
      currency,
      postedCapital: 0,
      cashReserves: 0,
      npcDeposits: 0,
      playerDeposits: 0,
      totalDeposits: 0,
      totalLoans: 0,
      depositOffset: 0,
      lendingOffset: 0,
      discountWindowDebt: 0,
      discountWindowArrears: 0,
      cbMarginDebt: 0,
      cbMarginArrears: 0,
      interbankDebt: 0,
      propBook: [],
      propBookMarkValue: 0,
      confidence: 1,
      panicTurns: 0,
      undercapitalizedSinceTurn: undefined,
      lastSupervisionTurn: turn - 1,
      lastSolvencyTurn: turn - 1,
      lastBankingIncomeTurn: undefined,
      lastBankingIncome: 0,
      publicRescueCapital: 0,
      lastBankingTurn: turn - 1,
      capitalStanding: "adequate" as const,
      warningBand: "green" as const,
      requireApproval: false,
      branchCapacityShare: 0.5,
      lastDefaultedAtTurn: undefined,
      recentDefaults: 0,
    },
  };
  await db.collection("corporations").insertMany([
    bank,
    {
      ...template,
      _id: BORROWER,
      name: "Parameter borrowing business",
      bankCharter: undefined,
      liquidCapital: 0,
      liquidCurrencyCode: currency,
    },
  ]);
  await db.collection("corporateSectors").insertOne({
    corporationId: BANK,
    sectorType: "financial",
    strategyId: "standard",
    capitalStock: 250,
    revenue: native(1_000_000),
  });
  await db.collection("characters").insertOne({
    ...context.character,
    _id: SAVER,
    name: "Parameter depositor",
    countryId: country,
    currentOffice: null,
    savingsAccountsOpened: { [currency]: true },
    currencyBalances: {
      personal: { [currency]: 0 },
      savings: { [currency]: 0 },
      savingsHolder: {},
    },
  });
  await db.collection("depositInsuranceFunds").insertOne({
    _id: currency as never,
    currency,
    balance: 0,
    premiumsCollectedLifetime: 0,
    claimsPaidLifetime: 0,
  });
  // This hypothetical large borrower's disclosed income is an underwriting input, not a cash credit.
  await db.collection("corporationHistory").insertMany(
    Array.from({ length: 12 }, (_, i) => ({
      corporationId: BORROWER,
      turn: turn - 11 + i,
      income: native(30_000_000),
    }))
  );
  const pool = {
    collection: "centralBanks",
    filter: { _id: centralBankId },
    path: "externalBroadMoney",
  };
  const sourceCash = Number(
    (await db.collection("centralBanks").findOne({ _id: centralBankId as never }))
      ?.externalBroadMoney
  );
  assert(
    sourceCash > native(500_000_000),
    "Scenario is funded from observed monetary pool, never minted"
  );
  await transfer(
    db,
    `${scenario.id}:capital-funding`,
    currency,
    native(10_000_000),
    pool,
    { collection: "corporations", filter: { _id: oid(BANK.toHexString()) }, path: "liquidCapital" },
    turn
  );
  const injection = await injectBankCapital(db, BANK, Math.floor(native(10_000_000)));
  assert(injection.ok, JSON.stringify(injection));
  await transfer(
    db,
    `${scenario.id}:saver-funding`,
    currency,
    native(100_000_000),
    pool,
    {
      collection: "characters",
      filter: { _id: oid(SAVER.toHexString()) },
      path: `currencyBalances.personal.${currency}`,
    },
    turn
  );
  const corridors = await getRateCorridors(db, country);
  const initial = clampOffsets({ depositOffset: 0, lendingOffset: 0 }, corridors);
  const depositOffset =
    scenario.depositRate === "low"
      ? corridors.deposit.minOffset
      : scenario.depositRate === "high"
        ? corridors.deposit.maxOffset
        : scenario.depositRate === "charter-default"
          ? initial.depositOffset
          : corridorDepositTarget(corridors.deposit.minOffset, corridors.deposit.maxOffset);
  const lendingOffset =
    scenario.lendingRate === "low"
      ? corridors.lending.minOffset
      : scenario.lendingRate === "high"
        ? corridors.lending.maxOffset
        : scenario.lendingRate === "charter-default"
          ? initial.lendingOffset
          : (corridors.lending.minOffset + corridors.lending.maxOffset) / 2;
  if (scenario.charter !== "investment") {
    assert((await setBankRates(db, BANK, depositOffset, lendingOffset)).ok);
    assert((await setBranchCapacityShare(db, BANK, scenario.branchShare ?? 0.5)).ok);
  } else
    await db
      .collection("corporations")
      .updateOne({ _id: BANK }, { $set: { "bankCharter.lendingOffset": lendingOffset } });
  const retainedReserve = await getReserveRequirement(db, currency);
  assert((await setReserveRequirement(db, currency, scenario.reserve ?? retainedReserve)).ok);
  const configured = await db.collection<Corporation>("corporations").findOne({ _id: BANK });
  assert(configured?.bankCharter);
  const rates = await getEffectiveBankRates(db, configured.bankCharter);
  return {
    turn,
    currency,
    country,
    centralBankId,
    pool,
    fx,
    native,
    corridors,
    depositOffset,
    lendingOffset,
    rates,
    retainedReserve,
    reserve: scenario.reserve ?? retainedReserve,
    retainedBank: {
      cash: template.bankCharter.cashReserves,
      deposits: template.bankCharter.npcDeposits,
      loans: template.bankCharter.totalLoans,
    },
    initialPool: sourceCash,
  };
}
