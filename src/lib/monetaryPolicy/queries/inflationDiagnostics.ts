/**
 * Inflation diagnostics: which driver is pushing a country's inflation.
 * loadInflationDiagnostics recomputes each country's inflation from live inputs
 * and returns the stored rate beside the fresh one with a per-driver breakdown
 * (unemployment, GDP gap, monetary, fiscal, tariff, wage, commodity, forex,
 * savings, housing). Read only.
 */
/**
 * Per-country inflation diagnostics for the admin panel.
 *
 * Replays the same input collection as `inflationRecalc.ts` and exposes both
 * the stored `economicFactors.inflationRate` and the live recomputed value +
 * full breakdown. Lets an admin see exactly which channel is dominating when
 * inflation hits the floor (or the ceiling).
 *
 * No DB writes; safe to call from any read path.
 */

import type { Db } from "mongodb";
import { COUNTRY_ORDER, COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getEraTrendGdpGrowth } from "@/lib/constants/monetaryEra";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getBankId } from "@/lib/centralBank/helpers";
import {
  calculateInflationWithBreakdown,
  computeHousingCostPressure,
  computeEffectivePrimeRate,
  getCostOfLivingNeutralIndex,
  getInflationTarget,
  getNeutralPrimeRate,
  MIN_INFLATION,
  MAX_INFLATION,
  type InflationBreakdown,
} from "@/lib/budget/inflation";
import { savingsFlowPressureRatio } from "@/lib/budget/savingsFlowPressure";
import {
  countryTurnTariffInflationExposure,
  loadTurnTariffInflationExposure,
} from "@/lib/tariffs/tariffInflationExposure";
import type { CentralBank, TurnSnapshot } from "@/lib/db/types/centralBank";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import type { SavingsLedgerEntry } from "@/lib/db/types/savingsLedger";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";

const SAVINGS_FLOW_WINDOW_TURNS = 12;

export interface InflationDiagnosticInputs {
  unemployment: number;
  gdpGrowth: number;
  primeRate: number;
  neutralPrimeRate: number;
  targetInflation: number;
  effectiveRate: number;
  primeRateHistoryLength: number;
  surplusToGdp: number;
  tariffRate: number;
  tariffExposureAvailable: boolean;
  tariffExposureMode: "active_delivered" | "shadow_simulated" | "unavailable";
  tariffExposureImportShare: number;
  tariffExposureCoveredCommodities: string[];
  tariffHouseholdAbsorptionValue: number;
  tariffHouseholdDeliveredDuty: number;
  tariffProductionInputAbsorptionValue: number;
  tariffProductionInputDeliveredDuty: number;
  wageGrowth: number;
  commodityPressure: number;
  forexPressure: number;
  savingsPressure: number;
  policyStancePressure: number;
  previousInflation: number;
  nationalCostOfLiving: number;
  nationalCostOfLivingBaseline: number;
  housingCostPressure: number;
  fxRate: number | null;
  fxBaseRate: number | null;
}

export interface InflationDiagnosticRow {
  countryId: CountryId;
  countryName: string;
  storedRate: number | null;
  computedRate: number;
  /** True when stored rate sits at the MIN_INFLATION (-2) or MAX_INFLATION (15) floor/ceiling. */
  storedHitsFloor: boolean;
  storedHitsCeiling: boolean;
  /** True when computed rate sits at the floor/ceiling — driver of stuck behavior. */
  computedHitsFloor: boolean;
  computedHitsCeiling: boolean;
  inputs: InflationDiagnosticInputs;
  breakdown: InflationBreakdown;
  recentInflationHistory: TurnSnapshot[];
}

export interface InflationDiagnosticsPayload {
  currentTurn: number;
  /** Hard floor / ceiling currently configured in the inflation formula. */
  minInflation: number;
  maxInflation: number;
  rows: InflationDiagnosticRow[];
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

export async function loadInflationDiagnostics(
  db: Db,
  currentTurn: number
): Promise<InflationDiagnosticsPayload> {
  const [
    banks,
    exchangeRates,
    commodityPriceDocs,
    savingsFlowAgg,
    gameState,
    tariffExposureSnapshot,
  ] = await Promise.all([
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
    db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
    db
      .collection<CommodityPrice>("commodityPrices")
      .find({}, { projection: { commodity: 1, basePrice: 1, nationalPrices: 1 } })
      .toArray(),
    db
      .collection<SavingsLedgerEntry>("savingsLedger")
      .aggregate<{ _id: { countryId: string; type: string }; total: number }>([
        {
          $match: {
            type: { $in: ["deposit", "withdraw"] },
            turn: { $gte: currentTurn - SAVINGS_FLOW_WINDOW_TURNS },
          },
        },
        {
          $group: {
            _id: { countryId: "$countryId", type: "$type" },
            total: { $sum: "$amount" },
          },
        },
      ])
      .toArray(),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1, startingYear: 1 } }),
    loadTurnTariffInflationExposure(db, currentTurn),
  ]);

  const exchangeRateByCountry = new Map(exchangeRates.map((r) => [r.countryId as CountryId, r]));
  const bankByCountry = new Map<CountryId, CentralBank>();
  for (const bank of banks) {
    if (bank.countryId) bankByCountry.set(bank.countryId as CountryId, bank);
  }

  const savingsFlowByCountry = new Map<string, { deposits: number; withdrawals: number }>();
  for (const row of savingsFlowAgg) {
    const { countryId, type } = row._id;
    if (!savingsFlowByCountry.has(countryId)) {
      savingsFlowByCountry.set(countryId, { deposits: 0, withdrawals: 0 });
    }
    const entry = savingsFlowByCountry.get(countryId)!;
    if (type === "deposit") entry.deposits += row.total;
    else if (type === "withdraw") entry.withdrawals += row.total;
  }

  const rows: InflationDiagnosticRow[] = [];

  for (const countryId of COUNTRY_ORDER) {
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) continue;

    const bankId = getBankId(countryId);
    const bank = bankByCountry.get(countryId) ?? banks.find((b) => b._id === bankId);
    if (!bank) continue;

    const budgetId = getNationalBudgetId(countryId);
    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: budgetId } as { _id: "federal" });

    const nationalDocId = getNationalDocId(countryId);
    const nationalMetrics = nationalDocId
      ? await db.collection<StateMetrics>("macroMetrics").findOne({ _id: nationalDocId })
      : null;

    const unemployment = finiteOr(nationalMetrics?.economic?.unemploymentRate?.value, 5.0);
    const gdpGrowth = finiteOr(
      nationalMetrics?.economic?.gdpGrowth?.value,
      getEraTrendGdpGrowth(countryId, gameState?.currentYear) ?? 2.5
    );
    const targetInflation = getInflationTarget(countryId, gameState?.currentYear);
    const neutralPrimeRate = getNeutralPrimeRate(countryId, gameState?.currentYear);
    const primeRate = finiteOr(bank.primeRate, neutralPrimeRate);
    const primeRateHistory = (bank.interestRateHistory ?? [])
      .map((s) => s.rate)
      .filter((r): r is number => typeof r === "number" && Number.isFinite(r));
    const effectiveRate = computeEffectivePrimeRate(primeRate, primeRateHistory);

    const gdp = budget?.gdp || 27_000_000_000_000;
    const surplusToGdp = finiteOr(budget?.surplus, 0) / gdp;
    const wageGrowth = finiteOr(budget?.economicFactors?.wageGrowth, 3.0);

    const tariffExposure = countryTurnTariffInflationExposure(tariffExposureSnapshot, countryId);
    const tariffRate = tariffExposure.tariffRate;

    const commodityPressures: number[] = [];
    for (const doc of commodityPriceDocs) {
      const nationalPrice = (doc.nationalPrices as Record<string, number> | undefined)?.[countryId];
      if (
        typeof nationalPrice === "number" &&
        Number.isFinite(nationalPrice) &&
        typeof doc.basePrice === "number" &&
        doc.basePrice > 0
      ) {
        const raw = nationalPrice / doc.basePrice - 1.0;
        const clamped = Math.max(-0.9, Math.min(10.0, raw));
        commodityPressures.push(clamped);
      }
    }
    const commodityPressure =
      commodityPressures.length > 0
        ? commodityPressures.reduce((sum, value) => sum + value, 0) / commodityPressures.length
        : 0.0;

    // Members of a shared currency without their own FX doc inherit the
    // currency anchor's rate (SCO/WAL → GBP under UK) — mirrors inflationRecalc.
    const currencyCode = COUNTRY_CURRENCY_MAP[countryId];
    const currencyAnchorId = currencyCode ? getCountryIdForCurrency(currencyCode) : countryId;
    const fxDoc =
      exchangeRateByCountry.get(countryId) ?? exchangeRateByCountry.get(currencyAnchorId);
    const fxRateRaw = fxDoc?.rateHistory?.at(-1)?.rate ?? fxDoc?.rate ?? null;
    const fxRate = typeof fxRateRaw === "number" && Number.isFinite(fxRateRaw) ? fxRateRaw : null;
    const fxBaseRate =
      typeof fxDoc?.baseRate === "number" && Number.isFinite(fxDoc.baseRate)
        ? fxDoc.baseRate
        : null;
    const forexPressure =
      fxRate != null && fxBaseRate != null && fxBaseRate > 0 ? fxRate / fxBaseRate - 1.0 : 0.0;

    // Savings flows are keyed by currency jurisdiction (= the bank's own
    // countryId), matching nationalSavingsBalance on the bank doc — mirrors
    // inflationRecalc, so shared-bank members see the shared pressure.
    const flow = savingsFlowByCountry.get((bank.countryId as CountryId) ?? countryId);
    const totalSavingsBalance = bank.nationalSavingsBalance ?? 0;
    const deposits = flow?.deposits ?? 0;
    const withdrawals = flow?.withdrawals ?? 0;
    const savingsPressure = savingsFlowPressureRatio(
      withdrawals - deposits,
      deposits + withdrawals,
      totalSavingsBalance
    );

    const previousInflation = finiteOr(budget?.economicFactors?.inflationRate, targetInflation);
    const nationalCostOfLiving = finiteOr(nationalMetrics?.economic?.costOfLiving?.value, 100);
    const nationalCostOfLivingBaseline = getCostOfLivingNeutralIndex(
      typeof gameState?.startingYear === "number" ? gameState.startingYear : undefined
    );
    const housingCostPressure = computeHousingCostPressure(
      nationalCostOfLiving,
      nationalCostOfLivingBaseline
    );
    const policyStancePressure = finiteOr(bank.policyInflationPressure, 0);

    const { rate: computedRate, breakdown } = calculateInflationWithBreakdown({
      targetInflation,
      neutralPrimeRate,
      unemployment,
      gdpGrowth,
      primeRate,
      primeRateHistory,
      surplusToGdp,
      tariffRate,
      wageGrowth,
      commodityPressure,
      forexPressure,
      savingsPressure,
      policyStancePressure,
      housingCostPressure,
      previousInflation,
    });

    const storedRate =
      typeof budget?.economicFactors?.inflationRate === "number" &&
      Number.isFinite(budget.economicFactors.inflationRate)
        ? budget.economicFactors.inflationRate
        : null;

    rows.push({
      countryId,
      countryName: config.name,
      storedRate,
      computedRate,
      storedHitsFloor: storedRate != null && nearlyEqual(storedRate, MIN_INFLATION),
      storedHitsCeiling: storedRate != null && nearlyEqual(storedRate, MAX_INFLATION),
      computedHitsFloor: nearlyEqual(computedRate, MIN_INFLATION),
      computedHitsCeiling: nearlyEqual(computedRate, MAX_INFLATION),
      inputs: {
        unemployment,
        gdpGrowth,
        primeRate,
        neutralPrimeRate,
        targetInflation,
        effectiveRate,
        primeRateHistoryLength: primeRateHistory.length,
        surplusToGdp,
        tariffRate,
        tariffExposureAvailable: tariffExposure.available,
        tariffExposureMode: tariffExposure.mode,
        tariffExposureImportShare: tariffExposure.importShare,
        tariffExposureCoveredCommodities: tariffExposure.coveredCommodities,
        tariffHouseholdAbsorptionValue: tariffExposure.householdAbsorptionValue,
        tariffHouseholdDeliveredDuty: tariffExposure.householdDeliveredTariffPaid,
        tariffProductionInputAbsorptionValue: tariffExposure.productionInputAbsorptionValue,
        tariffProductionInputDeliveredDuty: tariffExposure.productionInputDeliveredTariffPaid,
        wageGrowth,
        commodityPressure,
        forexPressure,
        savingsPressure,
        policyStancePressure,
        previousInflation,
        nationalCostOfLiving,
        nationalCostOfLivingBaseline,
        housingCostPressure,
        fxRate,
        fxBaseRate,
      },
      breakdown,
      recentInflationHistory: (bank.inflationHistory ?? []).slice(-24),
    });
  }

  return {
    currentTurn,
    minInflation: MIN_INFLATION,
    maxInflation: MAX_INFLATION,
    rows,
  };
}
