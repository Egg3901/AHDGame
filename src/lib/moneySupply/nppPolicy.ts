/**
 * Autonomous monetary policy weighs inflation, growth and comparable money
 * observations. processNppMonetaryOperations excludes legacy accounting and
 * incomplete observation windows from the money-growth signal.
 */
import { aggregateEuroPolicyIndicators, euroPolicyBankId } from "@/lib/currency/euro/rules";
import { getGdpAnchorRate } from "@/lib/currency/gdpAnchorRate";
import { currentMoneyGrowth } from "./rules/growthSignal";
import { MONEY_ACCOUNTING_VERSION } from "./calculate";
import type { Db } from "mongodb";
import type {
  Bond,
  CentralBank,
  FederalBudget,
  GameConfig,
  GameState,
  MonetaryPolicyDecision,
  MonetaryPolicyEvaluation,
  MoneySupplySnapshot,
} from "@/lib/db/types";
import { getInflationTarget } from "@/lib/budget/inflation";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { isBankGovernmentControlled } from "@/lib/centralBank/governance";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { executeMonetaryOperation, MONETARY_OPERATION_COOLDOWN_TURNS } from "./operations";
import { MONEY_SUPPLY_SNAPSHOTS_COLLECTION } from "./snapshot";
import { isMoneySupplyEnabledFromConfig } from "./featureFlag";

interface NppMonetaryConditions {
  inflation: number;
  targetInflation: number;
  gdpGrowth: number;
  annualizedM2GrowthPct: number | null;
  moneyGrowthReliable: boolean;
  publicFloat: number;
  holdings: number;
  bankReserves: number;
  gdp: number;
  treasuryBalance: number;
}

export type NppMonetaryDecision =
  | { type: "qe" | "qt"; units: number; rationale: string }
  | { type: "treasury_advance" | "liquidity_injection"; amount: number; rationale: string }
  | { type: "hold"; rationale: string };

export function chooseNppMonetaryOperation(input: NppMonetaryConditions): NppMonetaryDecision {
  const inflationGap = input.inflation - input.targetInflation;
  const excessMoneyGrowth =
    input.moneyGrowthReliable && input.annualizedM2GrowthPct != null
      ? input.annualizedM2GrowthPct - input.gdpGrowth
      : 0;

  if (
    inflationGap <= -3 &&
    input.gdpGrowth <= -3 &&
    input.gdp > 0 &&
    input.treasuryBalance <= -input.gdp * 0.5
  ) {
    return {
      type: "treasury_advance",
      amount: Math.max(1, Math.floor(input.gdp * 0.001)),
      rationale:
        "Emergency anti-deflation financing during a severe recession and acute fiscal stress",
    };
  }

  if ((inflationGap > 1 || excessMoneyGrowth > 6) && input.holdings > 0) {
    return {
      type: "qt",
      units: Math.max(1, Math.floor(input.holdings * 0.1)),
      rationale:
        inflationGap > 1
          ? "Inflation is above target; reduce broad money and normalize the balance sheet"
          : "Broad-money growth materially exceeds real growth; withdraw excess accommodation",
    };
  }

  if (inflationGap > 1 || excessMoneyGrowth > 6) {
    return {
      type: "hold",
      rationale:
        "Tightening is warranted, but the bank has no sovereign-bond holdings to sell; rely on rate policy",
    };
  }

  if (inflationGap < -0.5 && input.gdpGrowth < 1.5 && input.publicFloat > 0) {
    return {
      type: "qe",
      units: Math.max(1, Math.floor(input.publicFloat * 0.01)),
      rationale: "Inflation is below target and growth is weak; support demand through QE",
    };
  }

  if (
    input.gdpGrowth < 0 &&
    inflationGap <= 0 &&
    input.gdp > 0 &&
    input.bankReserves < input.gdp * 0.005
  ) {
    return {
      type: "liquidity_injection",
      amount: Math.max(1, Math.floor(input.gdp * 0.0025)),
      rationale: "Recession and thin lending reserves threaten credit availability",
    };
  }

  return {
    type: "hold",
    rationale: "Inflation, growth, broad money, and liquidity remain within the policy corridor",
  };
}

export async function processNppMonetaryOperations(
  db: Db,
  turn: number,
  currentYear?: number | null
): Promise<{ banksProcessed: number; evaluationsRecorded: number; operationsExecuted: number }> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { moneySupplyEnabled: 1 } });
  if (!isMoneySupplyEnabledFromConfig(config))
    return { banksProcessed: 0, evaluationsRecorded: 0, operationsExecuted: 0 };
  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find(
      {},
      {
        projection: {
          countryId: 1,
          chairMode: 1,
          chairControlsLocked: 1,
          governmentControlled: 1,
          lastMonetaryOperationTurn: 1,
          reserveBalance: 1,
        },
      }
    )
    .toArray();
  // Era START year for the government-control gate below, resolved once for the
  // whole sweep — `isBankGovernmentControlledLive` costs an uncached gameState
  // read per call.
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { startingYear: 1, preset: 1, euroMonetaryUnion: 1 } }
    );
  const startingYear =
    gameState?.startingYear ?? getStartingYearForPreset(gameState?.preset ?? DEFAULT_SEED_PRESET);
  const union = gameState?.euroMonetaryUnion;
  const bankById = new Map(banks.map((bank) => [bank._id, bank]));
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find(
      {},
      {
        projection: { gdp: 1, economicFactors: 1, treasuryBalance: 1, "debt.principal": 1 },
      }
    )
    .toArray();
  const budgetById = new Map(budgets.map((budget) => [String(budget._id), budget]));
  const common = union
    ? aggregateEuroPolicyIndicators(
        Object.keys(union.members).map((id) => {
          const country = id as CountryId;
          const budget = budgetById.get(getNationalBudgetId(country));
          return {
            gdpAnchor: (budget?.gdp ?? NaN) * getGdpAnchorRate(country, gameState?.preset),
            inflationRate: budget?.economicFactors?.inflationRate ?? NaN,
            gdpGrowth: budget?.economicFactors?.gdpGrowth ?? NaN,
            targetInflation: getInflationTarget(country, currentYear),
            neutralRate: 0,
          };
        })
      )
    : undefined;
  let banksProcessed = 0;
  let operationsExecuted = 0;
  let evaluationsRecorded = 0;
  for (const bank of banks) {
    const countryId = bank.countryId as CountryId;
    const member = union?.members[countryId];
    const authority = member ? bankById.get(euroPolicyBankId(countryId, union)) : bank;
    if (!authority || authority.chairMode !== "npp" || authority.chairControlsLocked) continue;
    if (member && !common) continue;
    banksProcessed++;
    if (
      bank.lastMonetaryOperationTurn != null &&
      turn - bank.lastMonetaryOperationTurn < MONETARY_OPERATION_COOLDOWN_TURNS
    )
      continue;
    // A government-controlled bank runs no autonomous open-market operations,
    // for the same reason it sets no autonomous rate: monetary policy is the
    // Treasury's, and the technocrat chair holds no authority to act on its own.
    if (isBankGovernmentControlled(authority, authority.countryId as CountryId, startingYear))
      continue;
    const currencyCode = COUNTRY_CURRENCY_MAP[bank.countryId] ?? "USD";
    const budget = budgetById.get(getNationalBudgetId(countryId));
    const [bond, moneySupply] = await Promise.all([
      db
        .collection<Bond>("bonds")
        .find({
          issuerType: "sovereign",
          countryId,
          matured: false,
          defaulted: false,
          $or: [{ publicFloat: { $gt: 0 } }, { centralBankHoldings: { $gt: 0 } }],
        })
        .sort({ maturityTurn: -1 })
        .limit(1)
        .next(),
      db
        .collection<MoneySupplySnapshot>(MONEY_SUPPLY_SNAPSHOTS_COLLECTION)
        .findOne(
          { currencyCode, turn: { $lte: turn } },
          { sort: { turn: -1 }, projection: { accountingVersion: 1, annualizedM2GrowthPct: 1 } }
        ),
    ]);
    if (!budget) continue;
    const inflation =
      (member ? common?.inflationRate : budget.economicFactors?.inflationRate) ??
      getInflationTarget(countryId, currentYear);
    const targetInflation =
      (member ? common?.targetInflation : undefined) ?? getInflationTarget(countryId, currentYear);
    const gdpGrowth = (member ? common?.gdpGrowth : budget.economicFactors?.gdpGrowth) ?? 2;
    // National-denomination snapshots do not constitute a comparable area-wide
    // observation. Use common inflation and growth until that series exists.
    const moneyGrowth = member ? null : currentMoneyGrowth(moneySupply);
    const decision = chooseNppMonetaryOperation({
      inflation,
      targetInflation,
      gdpGrowth,
      annualizedM2GrowthPct: moneyGrowth,
      moneyGrowthReliable: moneyGrowth != null,
      publicFloat: bond?.publicFloat ?? 0,
      holdings: bond?.centralBankHoldings ?? 0,
      bankReserves: bank.reserveBalance ?? 0,
      gdp: budget.gdp ?? 0,
      treasuryBalance: budget.treasuryBalance ?? -(budget.debt?.principal ?? 0),
    });
    const evaluation: MonetaryPolicyEvaluation = {
      accountingVersion: MONEY_ACCOUNTING_VERSION,
      turn,
      decision: decision.type as MonetaryPolicyDecision,
      rationale: decision.rationale,
      inflation,
      targetInflation,
      gdpGrowth,
      annualizedM2GrowthPct: moneyGrowth,
      moneyGrowthReliable: moneyGrowth != null,
      bankReserves: bank.reserveBalance ?? 0,
      gdp: budget.gdp ?? 0,
      createdAt: new Date(),
    };

    if (decision.type !== "hold") {
      await executeMonetaryOperation(db, {
        countryId,
        type: decision.type,
        ...((decision.type === "qe" || decision.type === "qt") && bond
          ? { units: decision.units, bondId: bond._id.toString() }
          : "amount" in decision
            ? { amount: decision.amount }
            : {}),
        turn,
        actorName: `${authority._id} Monetary Committee`,
        reason: decision.rationale,
      });
      operationsExecuted++;
    }
    await db
      .collection<CentralBank>("centralBanks")
      .updateOne({ _id: bank._id }, { $set: { lastMonetaryPolicyEvaluation: evaluation } });
    evaluationsRecorded++;
  }
  return { banksProcessed, evaluationsRecorded, operationsExecuted };
}
