import { freshMilitaryDiversion } from "@/lib/military/arsenal";
import type { CorporateSector, Corporation, StateMetrics } from "@/lib/db/types";
import type { State } from "@/lib/db/types/state";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  fxRateForSectorHostFromMap,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import {
  EXTRACTABLE_RESOURCES,
  SECTOR_SUPPLY,
  commodityMixWeight,
  embargoSupplyFactorFor,
  extractionOutputScaleFor,
  plantsSupplyScaledUnits,
  type CommodityType,
  type ExtractableResource,
  type GdpGrowthData,
} from "@/lib/constants/commodities";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import { plannedEconomyMediaSupplyFactor } from "@/lib/constants/sectorStrategies";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import type { CorporationType } from "@/lib/constants/corporations";
import { impliedOutputUnits } from "@/lib/market/capital";
import { realizedOutputFraction } from "@/lib/extraction/realizedOutputFraction";
import type { ExtractionSectorInput } from "@/lib/turn/extraction/extractionCapacity";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import type { PlantsUnits, SectorLedgerRow } from "./ledgerTypes";

export interface StateLookups {
  stateGdpMap: Map<string, number>;
  stateToCountry: Map<string, string>;
  roadConditionByState: Map<string, number>;
}

/**
 * State GDP map + stateId->countryId lookup + road-condition map.
 * The country lookup feeds both national aggregation and the sector
 * countryId stamp for sectorDemandModifier lookups.
 */
export function buildStateLookups(
  allStates: Pick<State, "_id" | "countryId" | "gdp">[],
  allStateMetrics: StateMetrics[]
): StateLookups {
  const stateGdpMap = new Map<string, number>();
  const stateToCountry = new Map<string, string>();
  const roadConditionByState = new Map<string, number>();
  for (const state of allStates) {
    if (NATIONAL_SCOPE_IDS.has(state._id)) continue;
    stateToCountry.set(state._id, state.countryId);
    if (state.gdp && state.gdp > 0) {
      stateGdpMap.set(state._id, state.gdp);
    }
  }
  for (const metrics of allStateMetrics) {
    const road = metrics.infrastructure?.roadCondition?.value;
    if (typeof road === "number" && Number.isFinite(road)) {
      roadConditionByState.set(String(metrics._id), road);
    }
  }
  return { stateGdpMap, stateToCountry, roadConditionByState };
}

export interface SectorRowInputs {
  allSectors: CorporateSector[];
  corporationById: Map<string, Corporation>;
  natcorpIds: Set<string>;
  fxByCurrency: Map<CurrencyCode, number>;
  stateToCountry: Map<string, string>;
  ledgerCurrentYear: number | null;
  ledgerCommandEconomyEnabled: boolean;
  turn: number;
}

/**
 * Owned-sector rows for the world supply/demand ledger. Sector economic
 * fields are stored in the host state's currency, so revenue is normalized
 * at the host rate; embargo + planned-economy media factors scale the units
 * each sector contributes to world supply (mirrored on the clearing offer in
 * turn/corporation/index.ts).
 */
export function buildSectorRows(inputs: SectorRowInputs): SectorLedgerRow[] {
  const {
    allSectors,
    corporationById,
    natcorpIds,
    fxByCurrency,
    stateToCountry,
    ledgerCurrentYear,
    ledgerCommandEconomyEnabled,
    turn,
  } = inputs;
  return allSectors.map((s: CorporateSector) => {
    const corp = corporationById.get(s.corporationId.toString());
    const hostCurrencyCode = resolveSectorHostCurrencyCode(s, corp);
    const hostFxRate = fxRateForSectorHostFromMap(s, corp, fxByCurrency);
    const embargoSupplyFactor =
      embargoSupplyFactorFor(s) *
      plannedEconomyMediaSupplyFactor(
        s.sectorType as CorporationType,
        isPlannedEconomy(
          stateToCountry.get(s.stateId),
          ledgerCurrentYear,
          ledgerCommandEconomyEnabled
        )
      );
    return {
      sectorType: s.sectorType,
      revenue: readCorpEconomicAnchor(s.revenue, hostCurrencyCode, hostFxRate),
      stateId: s.stateId,
      sectorId: s._id.toString(),
      corporationId: s.corporationId,
      isNatcorp: natcorpIds.has(s.corporationId.toString()),
      strategyId: s.strategyId,
      transitionFromStrategyId: s.transitionFromStrategyId,
      transitionStartTurn: s.transitionStartTurn,
      productionPolicyLevel: s.productionPolicyLevel,
      // World Events v1 Phase 1: lets computeRawSupplyDemand apply active
      // sectorDemandModifier world-event effects to this sector's demand.
      countryId: stateToCountry.get(s.stateId),
      // Command economies have no advertising market: their media output is
      // state information, re-denominated in the shared output remap.
      plannedEconomy: isPlannedEconomy(
        stateToCountry.get(s.stateId),
        ledgerCurrentYear,
        ledgerCommandEconomyEnabled
      ),
      producedUnits: typeof s.producedUnits === "number" ? s.producedUnits : null,
      // Output shipped to a state arsenal under a defence contract does not
      // also reach the market. Resolved for staleness here because this is
      // where the turn is known; the ledger itself only multiplies.
      militaryDivertedFraction: freshMilitaryDiversion(s, turn),
      soldUnits: typeof s.soldUnits === "number" ? s.soldUnits : null,
      capacityUnits: s.operatingCapacityUnits ?? s.capitalStock ?? null,
      mothballed: s.mothballed === true,
      embargoSupplyFactor,
      // Filled in after the extraction block (plants only).
      extractionRealizedFraction: null as number | null,
    };
  });
}

/**
 * GDP growth data for retail demand scaling. Uses the GDP-weighted average
 * so larger economies contribute proportionally more to the national signal.
 */
export function buildGdpGrowthData(
  allStateMetrics: StateMetrics[],
  stateGdpMap: Map<string, number>
): GdpGrowthData {
  const gdpByState = new Map<string, number>();
  let gdpWeightedSum = 0;
  let totalGdpWeight = 0;
  for (const sm of allStateMetrics) {
    const stateId = String(sm._id);
    if (NATIONAL_SCOPE_IDS.has(stateId)) continue;
    const gdpVal = sm.economic?.gdpGrowth?.value;
    const stateGdp = stateGdpMap.get(stateId) ?? 0;
    if (typeof gdpVal === "number") {
      gdpByState.set(stateId, gdpVal);
      if (stateGdp > 0) {
        gdpWeightedSum += gdpVal * stateGdp;
        totalGdpWeight += stateGdp;
      }
    }
  }
  return {
    nationalAverage: totalGdpWeight > 0 ? gdpWeightedSum / totalGdpWeight : 0,
    byState: gdpByState,
  };
}

/** stateId -> prime rate, via each state's country central bank. */
export function buildPrimeRateByState(
  allStates: Pick<State, "_id" | "countryId">[],
  centralBankByCountry: Map<string, number>
): Map<string, number> {
  const primeRateByState = new Map<string, number>();
  for (const state of allStates) {
    if (NATIONAL_SCOPE_IDS.has(state._id)) continue;
    const countryRate = centralBankByCountry.get(state.countryId);
    if (countryRate !== undefined) {
      primeRateByState.set(state._id, countryRate);
    }
  }
  return primeRateByState;
}

export interface ExtractionRevenueInputs {
  extractionInputs: ExtractionSectorInput[];
}

/**
 * Per-sector revenue-nameplate output per extractable resource, in ledger
 * units. Also resolves sectorId -> realized/nameplate extraction output and
 * records it on the caller-owned map, which the depletion booking and the
 * ledger supply leg must both read (same number on both sides).
 *
 * A mothballed extraction sector is cold (fraction 0, depletes nothing);
 * below plants `producedUnits` is never persisted so the map stays empty and
 * the booking keeps the old nameplate derivation byte-identical.
 */
export function buildExtractionRevenueInputs(
  extractionSectors: SectorLedgerRow[],
  turn: number,
  ledgerBasePrices: Record<CommodityType, number>,
  extractionOutputScaleEnabled: boolean,
  realizedFractionBySectorId: Map<string, number>
): ExtractionSectorInput[] {
  return extractionSectors.map((sector) => {
    const hasStrategy = sector.strategyId && sector.strategyId !== "standard";
    const strategyRates =
      hasStrategy || sector.transitionFromStrategyId
        ? getEffectiveStrategyRates(
            "extraction",
            sector.strategyId ?? "standard",
            sector.transitionFromStrategyId,
            sector.transitionStartTurn,
            turn
          )
        : null;

    const revenueBasedOutput: Partial<Record<ExtractableResource, number>> = {};
    for (const resource of EXTRACTABLE_RESOURCES) {
      const rate = strategyRates
        ? (strategyRates.supply[resource] ?? 0)
        : ((SECTOR_SUPPLY["extraction"] ?? []).find((f) => f.commodity === resource)?.rate ?? 0);
      if (rate > 0) {
        // Same scale applied to the S/D accumulation, so the capacity haircut
        // is computed against the boosted output (fills idle deposit capacity).
        const scale = extractionOutputScaleFor(resource, extractionOutputScaleEnabled);
        revenueBasedOutput[resource] = (sector.revenue * rate * scale) / ledgerBasePrices[resource];
      }
    }

    // sectorId -> realized/nameplate output units, for the depletion booking.
    // Nameplate here is `impliedOutputUnits(revenue)` — the SAME quantity
    // sectorTurn derived `producedUnits` from — summed over the sector's whole
    // priced supply mix, so the ratio is exactly the production legs (ramp
    // lambda, throughput, revenue multiplier) that the revenue nameplate does
    // not carry. Empty below plants, where `producedUnits` is never persisted.
    if (sector.mothballed === true) {
      realizedFractionBySectorId.set(sector.sectorId!, 0);
    } else if (typeof sector.producedUnits === "number") {
      const supplyRates =
        strategyRates?.supply ??
        Object.fromEntries((SECTOR_SUPPLY["extraction"] ?? []).map((f) => [f.commodity, f.rate]));
      // Scale 1: LEDGER_BASE_PRICES already carries the era unit basis.
      const nameplateUnits = impliedOutputUnits(
        sector.revenue,
        supplyRates as Partial<Record<CommodityType, number>>,
        ledgerBasePrices,
        1
      );
      // Clamped at both ends — see `realizedOutputFraction` for why the UPPER
      // clamp matters (a stale-low `revenue` on a fresh NatCorp sector would
      // otherwise over-book depletion).
      const fraction = realizedOutputFraction(sector.producedUnits, nameplateUnits);
      if (fraction != null) {
        realizedFractionBySectorId.set(sector.sectorId!, fraction);
      }
    }

    return {
      sectorId: sector.sectorId!,
      stateId: sector.stateId,
      corporationId: sector.corporationId,
      revenueBasedOutput,
    };
  });
}

/**
 * Per-commodity produced/sold units from corporate plants, split across each
 * sector's output mix by the SAME weights the supply ledger uses. Feeds the
 * inventory advance so unsold output lands in stock instead of vanishing.
 * Extraction is excluded (its rationing legs live elsewhere) and mothballed
 * plants contribute nothing on either side.
 */
export function accumulatePlantsUnits(
  sectorData: SectorLedgerRow[],
  turn: number,
  ledgerBasePrices: Record<CommodityType, number>
): Map<CommodityType, PlantsUnits> {
  const plantsUnitsByCommodity = new Map<CommodityType, PlantsUnits>();
  for (const sector of sectorData) {
    if (sector.sectorType === "extraction" || sector.mothballed) continue;
    if (typeof sector.producedUnits !== "number") continue;
    const rates = getEffectiveStrategyRates(
      sector.sectorType as Parameters<typeof getEffectiveStrategyRates>[0],
      sector.strategyId ?? "standard",
      sector.transitionFromStrategyId,
      sector.transitionStartTurn,
      turn
    );
    const supplyRates = rates.supply ?? {};
    // Same legs the ledger applies on top of producedUnits (natcorpScale x
    // embargoSupplyFactor; the production-policy output curve is already in
    // `producedUnits` since ticket #1072), taken from the shared
    // `plantsSupplyScaledUnits` instead of re-derived here — that helper is
    // the single source of the chain and computeRawSupplyDemand plus the
    // clearing offer both call it. The chain is linear in `producedUnits`, so
    // the sold leg is the SAME call with soldUnits substituted; that is what
    // keeps produced and sold in identical units.
    const scaleArgs = {
      isNatcorp: sector.isNatcorp,
      embargoSupplyFactor: sector.embargoSupplyFactor,
    };
    const produced =
      plantsSupplyScaledUnits({ ...scaleArgs, producedUnits: sector.producedUnits }) ?? 0;
    const sold =
      plantsSupplyScaledUnits({
        ...scaleArgs,
        producedUnits: sector.soldUnits ?? sector.producedUnits,
      }) ?? 0;
    for (const commodity of Object.keys(supplyRates) as CommodityType[]) {
      const w = commodityMixWeight(supplyRates, ledgerBasePrices, commodity);
      if (w <= 0) continue;
      const entry = plantsUnitsByCommodity.get(commodity) ?? { produced: 0, sold: 0 };
      entry.produced += produced * w;
      entry.sold += Math.min(produced, sold) * w;
      plantsUnitsByCommodity.set(commodity, entry);
    }
  }
  return plantsUnitsByCommodity;
}
