import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import type {
  TradeFlowSnapshot,
  CommodityTradeFlows,
  NationalTradeRollup,
} from "@/lib/db/types/tradeFlowSnapshot";
import { clearCommodity } from "./clearing";
import type { ClearingResult } from "./types";

export type ByCountryBalances = Map<string, Map<CommodityType, { supply: number; demand: number }>>;

export interface TradeSnapshotInput {
  /** Countries participating (typically COUNTRY_ORDER). */
  countries: CountryId[];
  /** Per-country per-commodity balances in UNITS (the turn's byCountry). */
  byCountry: ByCountryBalances;
  /** Per-commodity national price ($≡₳) keyed by country; fallback to globalPrices. */
  nationalPrices: Map<CommodityType, Record<string, number>>;
  /** Per-commodity global price ($≡₳) fallback. */
  globalPrices: Map<CommodityType, number>;
  /** Affinity weight provider (≥ 0). Phase 2 passes base geography. */
  affinityFor: (commodity: CommodityType, exporter: CountryId, importer: CountryId) => number;
  /** Optional per-pair unit cap (embargo). Phase 2 passes undefined. */
  capUnitsFor?: (
    commodity: CommodityType,
    exporter: CountryId,
    importer: CountryId
  ) => number | undefined;
  turn: number;
  now: Date;
}

/**
 * Run trade clearing (in UNITS) for every commodity from per-country balances.
 * Returned per-commodity results feed both the dampened-convergence step
 * (`applyTradeConvergence`) and the ₳ valuation (`valueTradeSnapshot`). Pure.
 */
export function clearAllCommodities(
  countries: CountryId[],
  byCountry: ByCountryBalances,
  affinityFor: (commodity: CommodityType, exporter: CountryId, importer: CountryId) => number,
  capUnitsFor?: (
    commodity: CommodityType,
    exporter: CountryId,
    importer: CountryId
  ) => number | undefined
): Map<CommodityType, ClearingResult> {
  const out = new Map<CommodityType, ClearingResult>();
  for (const commodity of COMMODITY_TYPES) {
    const supply: Partial<Record<CountryId, number>> = {};
    const demand: Partial<Record<CountryId, number>> = {};
    for (const c of countries) {
      const bal = byCountry.get(c)?.get(commodity);
      supply[c] = bal?.supply ?? 0;
      demand[c] = bal?.demand ?? 0;
    }
    out.set(
      commodity,
      clearCommodity({
        countries,
        supply,
        demand,
        affinity: (e, i) => affinityFor(commodity, e, i),
        capUnits: capUnitsFor ? (e, i) => capUnitsFor(commodity, e, i) : undefined,
      })
    );
  }
  return out;
}

/**
 * Value per-commodity clearing results (UNITS) into a per-turn ₳ snapshot.
 * Exports and imports are both valued at the EXPORTER price (the price the
 * goods actually trade at), so a country's import value equals the sum of the
 * valued flows it receives — exports and imports conserve worldwide even when
 * national prices differ. Pure.
 */
export function valueTradeSnapshot(
  countries: CountryId[],
  clearing: Map<CommodityType, ClearingResult>,
  nationalPrices: Map<CommodityType, Record<string, number>>,
  globalPrices: Map<CommodityType, number>,
  turn: number,
  now: Date
): Omit<TradeFlowSnapshot, "_id"> {
  const commodities: Partial<Record<CommodityType, CommodityTradeFlows>> = {};
  // Bilateral ₳ net across all commodities: bilateralNet[a][b] = a's net vs b.
  const bilateralNet: Record<string, Record<string, number>> = {};
  const nationalExports: Record<string, number> = {};
  const nationalImports: Record<string, number> = {};
  let worldGross = 0;
  let worldCleared = 0;
  let worldUncleared = 0;

  for (const c of countries) {
    nationalExports[c] = 0;
    nationalImports[c] = 0;
    bilateralNet[c] = {};
    for (const d of countries) bilateralNet[c][d] = 0;
  }

  const priceOf = (commodity: CommodityType, country: string): number =>
    nationalPrices.get(commodity)?.[country] ?? globalPrices.get(commodity) ?? 0;

  for (const [commodity, result] of clearing) {
    if (result.clearedVolume <= 0) {
      // Still account for uncleared surplus in world gross/uncleared totals.
      for (const c of countries) {
        const u = result.perCountry[c]?.uncleared ?? 0;
        if (u > 0) {
          const v = u * priceOf(commodity, c);
          worldGross += v;
          worldUncleared += v;
        }
      }
      continue;
    }

    const flowValue: Record<string, Record<string, number>> = {};
    const perCountry: CommodityTradeFlows["perCountry"] = {};
    let worldVolume = 0;
    const exportsV: Record<string, number> = {};
    const importsV: Record<string, number> = {};
    for (const c of countries) {
      exportsV[c] = 0;
      importsV[c] = 0;
    }

    for (const e of countries) {
      const row = result.flow[e] ?? {};
      for (const i of Object.keys(row)) {
        const v = row[i] * priceOf(commodity, e);
        if (v <= 0) continue;
        (flowValue[e] ??= {})[i] = v;
        worldVolume += v;
        exportsV[e] += v;
        importsV[i] += v;
        bilateralNet[e][i] += v;
        bilateralNet[i][e] -= v;
      }
    }

    for (const c of countries) {
      const pc = result.perCountry[c];
      const unclearedV = (pc?.uncleared ?? 0) * priceOf(commodity, c);
      perCountry[c] = {
        exports: exportsV[c],
        imports: importsV[c],
        net: exportsV[c] - importsV[c],
        uncleared: unclearedV,
      };
      nationalExports[c] += exportsV[c];
      nationalImports[c] += importsV[c];
      worldCleared += exportsV[c];
      worldGross += exportsV[c];
      if (unclearedV > 0) {
        worldGross += unclearedV;
        worldUncleared += unclearedV;
      }
    }

    commodities[commodity] = { flow: flowValue, perCountry, worldVolume };
  }

  const national: Partial<Record<CountryId, NationalTradeRollup>> = {};
  for (const c of countries) {
    let topSur: { countryId: CountryId; net: number } | undefined;
    let topDef: { countryId: CountryId; net: number } | undefined;
    for (const d of countries) {
      if (d === c) continue;
      const n = bilateralNet[c][d];
      if (n > 0 && (!topSur || n > topSur.net)) topSur = { countryId: d as CountryId, net: n };
      if (n < 0 && (!topDef || n < topDef.net)) topDef = { countryId: d as CountryId, net: n };
    }
    national[c] = {
      exports: nationalExports[c],
      imports: nationalImports[c],
      net: nationalExports[c] - nationalImports[c],
      topPartnerSurplus: topSur,
      topPartnerDeficit: topDef,
    };
  }

  return {
    turn,
    updatedAt: now,
    commodities,
    national,
    world: {
      grossVolume: worldGross,
      clearedVolume: worldCleared,
      unclearedSurplus: worldUncleared,
    },
  };
}

/**
 * Build a per-turn trade-flow snapshot (all monetary values in ₳) from
 * per-country commodity balances (units) — clears every commodity then values
 * the results. Pure. Used directly where clearing and valuation happen together
 * (no price feedback); the turn path calls `clearAllCommodities` and
 * `valueTradeSnapshot` separately so dampened convergence can run in between.
 */
export function buildTradeFlowSnapshot(input: TradeSnapshotInput): Omit<TradeFlowSnapshot, "_id"> {
  const clearing = clearAllCommodities(
    input.countries,
    input.byCountry,
    input.affinityFor,
    input.capUnitsFor
  );
  return valueTradeSnapshot(
    input.countries,
    clearing,
    input.nationalPrices,
    input.globalPrices,
    input.turn,
    input.now
  );
}
