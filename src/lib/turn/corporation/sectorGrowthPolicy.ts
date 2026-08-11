import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import { isCommandEconomy } from "@/lib/constants/commandEconomy";
import { getEraTrendGdpGrowth } from "@/lib/constants/monetaryEra";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { trendGrowthRate } from "@/lib/utils/sectorGrowth";

/**
 * Largest share of a sector's gross margin that growth may consume before the
 * turn-path brake pulls its rate back. Half leaves the rest to cover corporate
 * overhead and still return a profit.
 */
const GROWTH_COST_MARGIN_SHARE = 0.5;
/** Percentage points the brake removes per turn while growth is unaffordable. */
const GROWTH_BRAKE_STEP = 0.5;
/**
 * Percentage points a planned sector drifts toward its plan anchor per turn.
 * Small on purpose: at 48 turns a year this is about a point a year, enough
 * for the era trajectory to assert itself over a long run while leaving
 * deliberate investment room to hold a sector above its anchor.
 */
const PLAN_GRAVITY_STEP = 0.02;

/**
 * Plan priority by sector under a command economy, the Group A / Group B
 * split. Soviet-type planning deliberately favoured producer goods (Group A:
 * heavy industry, energy, extraction, defence) over consumer goods and
 * distribution (Group B: retail, agriculture), and the gap was the defining
 * structural feature of those economies. Agriculture in particular was
 * chronically under-invested. Without this every planned sector grew at
 * exactly the national trend, so all planned sectors carried an identical
 * target and the column had no variation at all. Unlisted sector types get 1.
 */
const COMMAND_PLAN_PRIORITY: Readonly<Record<string, number>> = {
  defense: 1.25,
  manufacturing: 1.2,
  extraction: 1.15,
  energy: 1.15,
  chemical_industries: 1.1,
  logistics: 0.95,
  retail: 0.7,
  agriculture: 0.65,
};

export interface SectorGrowthPolicyInput {
  corp: Corporation;
  sector: CorporateSector;
  currentYear?: number;
  commandEconomyEnabled?: boolean;
  sectorRevenueAnchor: number;
  plantsEnabled: boolean;
  embargoSuppressed: boolean;
  useTradeExposureEmbargo: boolean;
}

export interface SectorGrowthPolicyResult {
  brakedTargetRate: number;
  newCurrentGrowthRate: number;
  perTurnGrowthRate: number;
  embargoLegacyMothball: boolean;
  embargoTradeExposureActive: boolean;
  newRevenue: number;
  preFlipNameplateRevenue: number;
}

/**
 * Resolve growth, command-plan gravity, affordability braking, and embargo
 * behavior for one sector. Revenue stays in anchor currency.
 */
export function resolveSectorGrowthPolicy(
  input: SectorGrowthPolicyInput
): SectorGrowthPolicyResult {
  const {
    corp,
    sector,
    currentYear,
    commandEconomyEnabled,
    sectorRevenueAnchor,
    plantsEnabled,
    embargoSuppressed,
    useTradeExposureEmbargo,
  } = input;

  const seedCurrentRate = sector.currentGrowthRate ?? sector.growthRate ?? 0;
  const seedTargetRate = sector.targetGrowthRate ?? seedCurrentRate;
  const trendedGrowthRate = trendGrowthRate(seedCurrentRate, seedTargetRate);
  const priorRevenue = sector.revenue ?? 0;
  const priorGrowthCostShare =
    priorRevenue > 0 ? (100 * (sector.currentGrowthCost ?? 0)) / priorRevenue : 0;
  const priorMargin = sector.effectiveProfitMargin ?? sector.profitMargin ?? 0;
  const countryId = (sector.countryId ?? corp.countryId) as CountryId;
  const softBudget = isCommandEconomy(countryId, currentYear, commandEconomyEnabled);
  const growthUnaffordable =
    !softBudget &&
    priorRevenue > 0 &&
    (priorMargin <= 0 || priorGrowthCostShare >= priorMargin * GROWTH_COST_MARGIN_SHARE);

  const plannedTarget = softBudget
    ? (() => {
        const trend = getEraTrendGdpGrowth(countryId, currentYear);
        if (trend === undefined) return undefined;
        const priority = COMMAND_PLAN_PRIORITY[String(sector.sectorType)] ?? 1;
        return Math.max(0, Math.round(trend * priority * 100) / 100);
      })()
    : undefined;
  const towardPlan =
    plannedTarget !== undefined
      ? seedTargetRate +
        Math.max(-PLAN_GRAVITY_STEP, Math.min(PLAN_GRAVITY_STEP, plannedTarget - seedTargetRate))
      : undefined;
  const soeRecoveryAnchor =
    !softBudget && !growthUnaffordable && isStateOwned(corp)
      ? getEraTrendGdpGrowth(countryId, currentYear)
      : undefined;
  const brakedTargetRate =
    towardPlan !== undefined
      ? Math.max(0, Math.round(towardPlan * 100) / 100)
      : growthUnaffordable
        ? Math.max(0, seedTargetRate - GROWTH_BRAKE_STEP)
        : soeRecoveryAnchor !== undefined && seedTargetRate < soeRecoveryAnchor
          ? Math.round(Math.min(soeRecoveryAnchor, seedTargetRate + GROWTH_BRAKE_STEP) * 100) / 100
          : seedTargetRate;
  const newCurrentGrowthRate = growthUnaffordable
    ? Math.max(0, Math.min(trendedGrowthRate, brakedTargetRate))
    : trendedGrowthRate;
  const perTurnGrowthRate = newCurrentGrowthRate / GROWTH_RATE_TURNS_PER_YEAR;
  const embargoLegacyMothball = embargoSuppressed && !useTradeExposureEmbargo;
  const embargoTradeExposureActive = embargoSuppressed && useTradeExposureEmbargo;
  const grownRevenue = sectorRevenueAnchor * (1 + perTurnGrowthRate / 100);

  return {
    brakedTargetRate,
    newCurrentGrowthRate,
    perTurnGrowthRate,
    embargoLegacyMothball,
    embargoTradeExposureActive,
    newRevenue: embargoLegacyMothball || plantsEnabled ? sectorRevenueAnchor : grownRevenue,
    preFlipNameplateRevenue: embargoLegacyMothball ? sectorRevenueAnchor : grownRevenue,
  };
}
