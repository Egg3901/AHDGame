import type { Db } from "mongodb";
import type { EconomicMetric, EconomicVitalSigns } from "@/lib/db/types";
import { ECONOMIC_VITAL_SIGNS_COLLECTION } from "@/lib/economy/economicVitalSigns";
export { GLOBAL_FINANCIAL_CRISIS_KEY } from "./financialCrisisKey";

type Metric = Pick<EconomicMetric, "value"> | null | undefined;

export interface FinancialCrisisIndicators {
  creditToM2?: Metric;
  corporateNoHolderBondShare?: Metric;
  sovereignNoHolderBondShare?: Metric;
  organicTwoSidedListingShare?: Metric;
  lossMakingShare?: Metric;
}

export interface FinancialCrisisSignal {
  pressure: number;
  openingTrackDeltas: Record<string, number>;
  observations: number;
}

function value(metric: Metric): number | null {
  return typeof metric?.value === "number" && Number.isFinite(metric.value) ? metric.value : null;
}

function clamp(valueToClamp: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, valueToClamp));
}

function negative(valueToNegate: number): number {
  return valueToNegate === 0 ? 0 : -valueToNegate;
}

function ramp(reading: number | null, floor: number, ceiling: number, weight: number): number {
  if (reading === null || reading <= floor) return 0;
  return clamp((reading - floor) / (ceiling - floor), 0, 1) * weight;
}

/**
 * Convert live balance-sheet and market observations into bounded opening
 * pressure. Missing observations contribute no risk rather than inventing a
 * crisis from absent data. The score is a trigger, not a GDP damage formula.
 */
export function financialCrisisSignal(
  indicators: FinancialCrisisIndicators
): FinancialCrisisSignal {
  const credit = value(indicators.creditToM2);
  const corporateFailure = value(indicators.corporateNoHolderBondShare);
  const sovereignFailure = value(indicators.sovereignNoHolderBondShare);
  const twoSided = value(indicators.organicTwoSidedListingShare);
  const firmLosses = value(indicators.lossMakingShare);
  const readings = [credit, corporateFailure, sovereignFailure, twoSided, firmLosses];
  const observations = readings.filter((reading) => reading !== null).length;

  const leverageRisk = ramp(credit, 0.55, 1.2, 30);
  const corporateFundingRisk = ramp(corporateFailure, 0.1, 0.75, 20);
  const sovereignFundingRisk = ramp(sovereignFailure, 0.08, 0.65, 15);
  const liquidityRisk = ramp(twoSided === null ? null : 1 - twoSided, 0.25, 0.9, 20);
  const solvencyRisk = ramp(firmLosses, 0.2, 0.75, 15);
  const pressure = Math.round(
    clamp(leverageRisk + corporateFundingRisk + sovereignFundingRisk + liquidityRisk + solvencyRisk)
  );

  return {
    pressure,
    observations,
    openingTrackDeltas: {
      financialFragility: Math.round(leverageRisk + corporateFundingRisk + solvencyRisk),
      liquidityStress: Math.round(liquidityRisk + corporateFundingRisk / 2),
      bankSolvency: negative(Math.round(solvencyRisk + leverageRisk / 3)),
      contagion: Math.round((corporateFundingRisk + sovereignFundingRisk + liquidityRisk) / 2),
      marketConfidence: negative(Math.round(liquidityRisk + sovereignFundingRisk / 2)),
      sovereignSpreads: Math.round(sovereignFundingRisk),
    },
  };
}

type FinancialVitalSigns = Pick<EconomicVitalSigns, "turn"> & {
  firms?: { lossMakingShare?: EconomicMetric };
  money?: { creditToM2?: EconomicMetric };
  securities?: {
    corporateNoHolderBondShare?: EconomicMetric;
    sovereignNoHolderBondShare?: EconomicMetric;
    organicTwoSidedListingShare?: EconomicMetric;
  };
};

/** Load only the latest fields used by the trigger, never the full diagnostics document. */
export async function loadFinancialCrisisSignal(
  db: Db,
  currentTurn: number
): Promise<FinancialCrisisSignal> {
  const snapshot = await db
    .collection<FinancialVitalSigns>(ECONOMIC_VITAL_SIGNS_COLLECTION)
    .findOne(
      { turn: { $lte: currentTurn } },
      {
        projection: {
          turn: 1,
          "firms.lossMakingShare.value": 1,
          "money.creditToM2.value": 1,
          "securities.corporateNoHolderBondShare.value": 1,
          "securities.sovereignNoHolderBondShare.value": 1,
          "securities.organicTwoSidedListingShare.value": 1,
        },
        sort: { turn: -1 },
      }
    );

  if (!snapshot) return financialCrisisSignal({});
  return financialCrisisSignal({
    creditToM2: snapshot.money?.creditToM2,
    corporateNoHolderBondShare: snapshot.securities?.corporateNoHolderBondShare,
    sovereignNoHolderBondShare: snapshot.securities?.sovereignNoHolderBondShare,
    organicTwoSidedListingShare: snapshot.securities?.organicTwoSidedListingShare,
    lossMakingShare: snapshot.firms?.lossMakingShare,
  });
}
