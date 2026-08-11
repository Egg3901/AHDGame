import type { Db } from "mongodb";
import type {
  Bond,
  CentralBank,
  FederalBudget,
  GameConfig,
  MonetaryPolicyDecision,
  MonetaryPolicyEvaluation,
  MoneySupplySnapshot,
} from "@/lib/db/types";
import { getInflationTarget } from "@/lib/budget/inflation";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { executeMonetaryOperation, MONETARY_OPERATION_COOLDOWN_TURNS } from "./operations";
import { MONEY_SUPPLY_SNAPSHOTS_COLLECTION } from "./snapshot";
import { isMoneySupplyEnabledFromConfig } from "./featureFlag";

interface NppMonetaryConditions {
  inflation: number;
  targetInflation: number;
  gdpGrowth: number;
  annualizedM2GrowthPct: number;
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
  const excessMoneyGrowth = input.moneyGrowthReliable
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
    .find({ chairMode: "npp", chairControlsLocked: { $ne: true } })
    .toArray();
  let operationsExecuted = 0;
  let evaluationsRecorded = 0;
  for (const bank of banks) {
    if (
      bank.lastMonetaryOperationTurn != null &&
      turn - bank.lastMonetaryOperationTurn < MONETARY_OPERATION_COOLDOWN_TURNS
    )
      continue;
    const countryId = bank.countryId as CountryId;
    const currencyCode = COUNTRY_CURRENCY_MAP[bank.countryId] ?? "USD";
    const [budget, bond, moneySupply] = await Promise.all([
      db
        .collection<FederalBudget>("federalBudget")
        .findOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }),
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
        .findOne({ currencyCode }, { sort: { turn: -1 } }),
    ]);
    if (!budget) continue;
    const inflation =
      budget.economicFactors?.inflationRate ?? getInflationTarget(countryId, currentYear);
    const targetInflation = getInflationTarget(countryId, currentYear);
    const gdpGrowth = budget.economicFactors?.gdpGrowth ?? 2;
    const decision = chooseNppMonetaryOperation({
      inflation,
      targetInflation,
      gdpGrowth,
      annualizedM2GrowthPct: moneySupply?.annualizedM2GrowthPct ?? gdpGrowth,
      moneyGrowthReliable: (moneySupply?.turn ?? 0) >= 12,
      publicFloat: bond?.publicFloat ?? 0,
      holdings: bond?.centralBankHoldings ?? 0,
      bankReserves: bank.reserveBalance ?? 0,
      gdp: budget.gdp ?? 0,
      treasuryBalance: budget.treasuryBalance ?? -(budget.debt?.principal ?? 0),
    });
    const evaluation: MonetaryPolicyEvaluation = {
      turn,
      decision: decision.type as MonetaryPolicyDecision,
      rationale: decision.rationale,
      inflation,
      targetInflation,
      gdpGrowth,
      annualizedM2GrowthPct: moneySupply?.annualizedM2GrowthPct ?? gdpGrowth,
      moneyGrowthReliable: (moneySupply?.turn ?? 0) >= 12,
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
        actorName: `${bank._id} Monetary Committee`,
        reason: decision.rationale,
      });
      operationsExecuted++;
    }
    await db
      .collection<CentralBank>("centralBanks")
      .updateOne({ _id: bank._id }, { $set: { lastMonetaryPolicyEvaluation: evaluation } });
    evaluationsRecorded++;
  }
  return { banksProcessed: banks.length, evaluationsRecorded, operationsExecuted };
}
