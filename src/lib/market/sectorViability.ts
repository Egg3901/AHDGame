import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";
import type { SectorStrategy } from "@/lib/constants/sectorStrategies";
import { priceRealizationFactor } from "@/lib/market/priceRealization";

export type ViabilityStatus = "viable" | "stress_sensitive" | "impossible_at_balance";

export interface ViabilityScenario {
  inputPriceRatio: number;
  outputPriceRatio: number;
  revenueShare: number;
  inputCostShare: number;
  contributionShare: number;
}

export interface StrategyViability {
  sectorType: CorporationType;
  strategyId: string;
  strategyName: string;
  balancedOutputRate: number;
  balancedInputShare: number;
  balancedContributionShare: number;
  breakEvenOutputRealization: number;
  breakEvenUtilization: number | null;
  inputShock: ViabilityScenario;
  outputShock: ViabilityScenario;
  combinedShock: ViabilityScenario;
  status: ViabilityStatus;
}

const rateSum = (rates: Partial<Record<CommodityType, number>>): number =>
  COMMODITY_TYPES.reduce((sum, commodity) => sum + (rates[commodity] ?? 0), 0);

export function evaluateRecipeScenario(
  strategy: Pick<SectorStrategy, "supply" | "demand">,
  inputPriceRatio: number,
  outputPriceRatio: number
): ViabilityScenario {
  const revenueShare = priceRealizationFactor(outputPriceRatio);
  const inputCostShare = rateSum(strategy.demand) * priceRealizationFactor(inputPriceRatio);
  return {
    inputPriceRatio,
    outputPriceRatio,
    revenueShare,
    inputCostShare,
    contributionShare: revenueShare - inputCostShare,
  };
}

export function analyzeStrategyViability(
  sectorType: CorporationType,
  strategy: SectorStrategy
): StrategyViability {
  const balancedInputShare = rateSum(strategy.demand);
  const balancedContributionShare = 1 - balancedInputShare;
  const inputShock = evaluateRecipeScenario(strategy, 1.25, 1);
  const outputShock = evaluateRecipeScenario(strategy, 1, 0.75);
  const combinedShock = evaluateRecipeScenario(strategy, 1.25, 0.75);
  const impossibleAtBalance = balancedContributionShare <= 0;
  const stressSensitive = combinedShock.contributionShare <= 0;

  return {
    sectorType,
    strategyId: strategy.id,
    strategyName: strategy.name,
    balancedOutputRate: rateSum(strategy.supply),
    balancedInputShare,
    balancedContributionShare,
    breakEvenOutputRealization: balancedInputShare,
    // Recipe tables do not contain a fixed-cost split. Live sector P&L does,
    // so utilization belongs in the live-sector explanation, not this audit.
    breakEvenUtilization: null,
    inputShock,
    outputShock,
    combinedShock,
    status: impossibleAtBalance
      ? "impossible_at_balance"
      : stressSensitive
        ? "stress_sensitive"
        : "viable",
  };
}
