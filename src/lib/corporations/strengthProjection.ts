import {
  calcLogisticsGrowth,
  calcMarketingGrowth,
  calcRdGrowth,
  LOGISTICS_DECAY_RATE,
  RD_DECAY_RATE,
} from "@/lib/constants/corporations";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";

interface StrengthProjectionInput {
  marketingBudget?: number | null;
  marketingStrength?: number | null;
  logisticsBudget?: number | null;
  logisticsStrength?: number | null;
  rdBudget?: number | null;
  rdScore?: number | null;
  liquidCurrencyCode?: CurrencyCode | string | null;
}

export interface StrengthProjection {
  marketingStrengthGrowth: number;
  logisticsStrengthNetChange: number;
  rdScoreNetChange: number;
}

export function calculateCorpStrengthProjection(
  corporation: StrengthProjectionInput,
  fxRate: number
): StrengthProjection {
  const marketingBudgetAnchor = readCorpEconomicAnchor(
    corporation.marketingBudget ?? 0,
    corporation.liquidCurrencyCode,
    fxRate
  );
  const logisticsBudgetAnchor = readCorpEconomicAnchor(
    corporation.logisticsBudget ?? 0,
    corporation.liquidCurrencyCode,
    fxRate
  );
  const rdBudgetAnchor = readCorpEconomicAnchor(
    corporation.rdBudget ?? 0,
    corporation.liquidCurrencyCode,
    fxRate
  );

  const currentLogisticsStrength = corporation.logisticsStrength ?? 0;
  const logisticsGrowth = calcLogisticsGrowth(logisticsBudgetAnchor);
  const logisticsDecay = currentLogisticsStrength * LOGISTICS_DECAY_RATE;

  const currentRdScore = corporation.rdScore ?? 0;
  const rdGrowth = calcRdGrowth(rdBudgetAnchor, currentRdScore);
  const rdDecay = currentRdScore * RD_DECAY_RATE;

  return {
    marketingStrengthGrowth: calcMarketingGrowth(
      marketingBudgetAnchor,
      corporation.marketingStrength ?? 0
    ),
    logisticsStrengthNetChange: logisticsGrowth - logisticsDecay,
    rdScoreNetChange: rdGrowth - rdDecay,
  };
}
